/**
 * Notification Pusher
 *
 * Proactive notification delivery system
 */

import type { PendingNotification, NotificationPriority } from '../proactive/types';
import { getNotificationsLazy } from './notifications';

export type PusherChannel = 'cli' | 'feishu' | 'webhook';
type StorageChannel = 'cli' | 'websocket' | 'email';
const PUSHER_CHANNELS_METADATA_KEY = '__pusherChannels';

function mapToStorageChannels(channels: PusherChannel[]): StorageChannel[] {
  const mapping: Record<PusherChannel, StorageChannel> = {
    cli: 'cli',
    feishu: 'websocket',
    webhook: 'websocket',
  };
  return channels.map(ch => mapping[ch]);
}

export interface PushOptions {
  message: string;
  priority?: NotificationPriority;
  category?: string;
  scheduledFor?: string;
  expiresAt?: string;
  channels?: PusherChannel[];
  metadata?: Record<string, unknown>;
  // Feishu specific
  feishuChatId?: string;
  feishuUserId?: string;
}

export interface PushResult {
  success: boolean;
  notificationId?: string;
  delivered?: boolean;
  error?: string;
}

// Delivery handlers
type DeliveryHandler = (notification: PendingNotification) => Promise<boolean>;

const deliveryHandlers: Map<string, DeliveryHandler> = new Map();

// CLI delivery handler (default)
let cliDeliveryHandler: ((message: string, priority: NotificationPriority) => void) | null = null;

/**
 * Set CLI delivery handler (called by CLI on startup)
 */
export function setCliDeliveryHandler(handler: (message: string, priority: NotificationPriority) => void): void {
  cliDeliveryHandler = handler;
}

/**
 * Register a custom delivery handler for a channel
 */
export function registerDeliveryHandler(channel: string, handler: DeliveryHandler): void {
  deliveryHandlers.set(channel, handler);
}

/**
 * Push a notification immediately
 */
export async function pushNotification(options: PushOptions): Promise<PushResult> {
  try {
    const manager = getNotificationsLazy();
    const pusherChannels = options.channels || ['cli'];

    // Create the notification
    // Merge feishuChatId / feishuUserId into metadata so delivery handlers can access them
    const metadata: Record<string, unknown> = {
      ...options.metadata,
      ...(options.feishuChatId ? { feishuChatId: options.feishuChatId } : {}),
      ...(options.feishuUserId ? { feishuUserId: options.feishuUserId } : {}),
      [PUSHER_CHANNELS_METADATA_KEY]: pusherChannels,
    };

    const result = manager.create({
      userId: 'cli-user',
      message: options.message,
      priority: options.priority || 'normal',
      category: options.category,
      scheduledFor: options.scheduledFor,
      expiresAt: options.expiresAt,
      channels: mapToStorageChannels(pusherChannels),
      metadata,
    });

    if (!result.success || !result.data) {
      return { success: false, error: result.error };
    }

    const notification = result.data as PendingNotification;

    // Try immediate delivery
    const deliveredChannel = await deliverNotification(notification);

    if (deliveredChannel) {
      manager.markDelivered(notification.id, deliveredChannel);
    }

    return {
      success: true,
      notificationId: notification.id,
      delivered: Boolean(deliveredChannel),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Deliver a notification through configured channels
 */
async function deliverNotification(notification: PendingNotification): Promise<StorageChannel | null> {
  const channels = notification.delivery.channels;

  for (const channel of channels) {
    const channelsToTry = getDeliveryHandlerChannels(notification, channel);

    for (const ch of channelsToTry) {
      const handler = deliveryHandlers.get(ch);

      if (handler) {
        try {
          const delivered = await handler(notification);
          if (delivered) {
            return channel;
          }
        } catch (error) {
          console.error(`[Pusher] Delivery failed for channel ${ch}:`, error);
        }
      }
    }

    // CLI channel with registered handler
    if (channel === 'cli' && cliDeliveryHandler) {
      try {
        cliDeliveryHandler(notification.message, notification.priority);
        return channel;
      } catch (error) {
        console.error('[Pusher] CLI delivery failed:', error);
      }
    }
  }

  return null;
}

function getDeliveryHandlerChannels(notification: PendingNotification, channel: StorageChannel): string[] {
  if (channel !== 'websocket') {
    return [channel];
  }

  const originalChannels = getOriginalPusherChannels(notification);
  const websocketAliases = originalChannels.filter((ch) => ch === 'feishu' || ch === 'webhook');

  // New notifications preserve their original pusher channel, so use that
  // exact handler first, then fall back to a generic websocket handler.
  if (websocketAliases.length > 0) {
    return [...websocketAliases, 'websocket'];
  }

  return ['websocket'];
}

function getOriginalPusherChannels(notification: PendingNotification): PusherChannel[] {
  const rawChannels = notification.metadata?.[PUSHER_CHANNELS_METADATA_KEY];
  if (Array.isArray(rawChannels)) {
    const channels = rawChannels.filter(isPusherChannel);
    if (channels.length > 0) return channels;
  }

  // Backward-compatible inference for pending notifications created before
  // original pusher channels were persisted.
  if (notification.metadata?.feishuChatId || notification.metadata?.feishuUserId) {
    return ['feishu'];
  }
  if (notification.metadata?.webhookUrl || notification.metadata?.webhookEndpoint) {
    return ['webhook'];
  }
  return [];
}

function isPusherChannel(value: unknown): value is PusherChannel {
  return value === 'cli' || value === 'feishu' || value === 'webhook';
}

/**
 * Push pending notifications (called on CLI startup or periodically)
 */
export async function pushPendingNotifications(): Promise<{
  pushed: number;
  failed: number;
  notifications: PendingNotification[];
}> {
  const manager = getNotificationsLazy();
  const notifications = manager.getPending('cli-user');

  let pushed = 0;
  let failed = 0;
  const deliveredNotifications: PendingNotification[] = [];

  for (const notification of notifications) {
    const deliveredChannel = await deliverNotification(notification);

    if (deliveredChannel) {
      manager.markDelivered(notification.id, deliveredChannel);
      deliveredNotifications.push(notification);
      pushed++;
    } else {
      manager.markAttempted(notification.id);
      failed++;
    }
  }

  return { pushed, failed, notifications: deliveredNotifications };
}

/**
 * Quick push for urgent notifications
 */
export async function pushUrgent(message: string, metadata?: Record<string, unknown>): Promise<PushResult> {
  return pushNotification({
    message,
    priority: 'urgent',
    channels: ['cli'],
    metadata,
  });
}

/**
 * Push a reminder (helper for scheduled tasks)
 */
export async function pushReminder(message: string, scheduledFor?: string): Promise<PushResult> {
  return pushNotification({
    message,
    priority: 'normal',
    category: 'reminder',
    scheduledFor,
  });
}

/**
 * Push a goal progress update
 */
export async function pushGoalProgress(goalTitle: string, progress: number): Promise<PushResult> {
  return pushNotification({
    message: `Goal "${goalTitle}" progress: ${progress}%`,
    priority: progress < 50 ? 'high' : 'normal',
    category: 'goal-progress',
  });
}

/**
 * Format notification for display
 */
export function formatNotification(notification: PendingNotification): string {
  const priorityEmoji: Record<NotificationPriority, string> = {
    low: '⚪',
    normal: '🟢',
    high: '🟠',
    urgent: '🔴',
  };

  const emoji = priorityEmoji[notification.priority] || '⚪';
  const category = notification.category ? `[${notification.category}]` : '';

  return `${emoji} ${category} ${notification.message}`;
}

/**
 * Format multiple notifications for display
 */
export function formatNotifications(notifications: PendingNotification[]): string {
  if (notifications.length === 0) {
    return '📬 No pending notifications';
  }

  const lines = [`📬 ${notifications.length} Pending Notification${notifications.length > 1 ? 's' : ''}:\n`];

  for (const n of notifications) {
    lines.push(`  ${formatNotification(n)}`);
    if (n.scheduledFor) {
      lines.push(`     Scheduled: ${n.scheduledFor}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================
// Feishu Proactive Push Support
// ============================================================

/**
 * Push notification to Feishu chat
 */
export async function pushToFeishu(
  chatId: string,
  message: string,
  options?: {
    priority?: NotificationPriority;
    category?: string;
  }
): Promise<PushResult> {
  return pushNotification({
    message,
    priority: options?.priority || 'normal',
    category: options?.category,
    channels: ['feishu'],
    feishuChatId: chatId,
  });
}

/**
 * Register Feishu delivery handler (called by bot on startup)
 */
export function registerFeishuHandler(
  sendFunc: (chatId: string, message: string) => Promise<boolean>
): void {
  registerDeliveryHandler('feishu', async (notification) => {
    const chatId = notification.metadata?.feishuChatId as string;
    if (!chatId) {
      console.error('[Pusher] No feishuChatId in notification metadata');
      return false;
    }

    try {
      return await sendFunc(chatId, notification.message);
    } catch (error) {
      console.error('[Pusher] Feishu delivery failed:', error);
      return false;
    }
  });
}

/**
 * Proactive message to Feishu user (starts or continues a conversation)
 */
export async function proactiveMessageToFeishu(
  chatId: string,
  userId: string,
  message: string,
  context?: Record<string, unknown>
): Promise<PushResult> {
  // ⚠️ EXCEPTION: Dynamic import to avoid circular dependency (session ↔ proactive)
  // eslint-disable-next-line no-restricted-syntax
  const { sendProactiveMessage } = await import('../session');

  const result = await sendProactiveMessage({
    message,
    userId,
    channel: 'feishu',
    sessionId: `feishu-${chatId}-${userId}`,
    context: {
      chatId,
      proactive: true,
      ...context,
    },
  });

  if (result.success) {
    return {
      success: true,
      delivered: true,
    };
  }

  return {
    success: false,
    error: result.error,
  };
}
