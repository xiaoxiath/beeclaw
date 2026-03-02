/**
 * Notification Pusher
 *
 * Proactive notification delivery system
 */

import type { PendingNotification, NotificationPriority } from '../proactive/types';
import { getNotificationManager } from '../proactive/notifications';

export interface PushOptions {
  message: string;
  priority?: NotificationPriority;
  category?: string;
  scheduledFor?: string;
  expiresAt?: string;
  channels?: ('cli' | 'feishu' | 'webhook')[];
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
    const manager = getNotificationManager();

    // Create the notification
    const result = manager.create({
      userId: 'cli-user',
      message: options.message,
      priority: options.priority || 'normal',
      category: options.category,
      scheduledFor: options.scheduledFor,
      expiresAt: options.expiresAt,
      channels: (options.channels as ('cli' | 'websocket' | 'email')[]) || ['cli'],
      metadata: options.metadata,
    });

    if (!result.success || !result.data) {
      return { success: false, error: result.error };
    }

    const notification = result.data as PendingNotification;

    // Try immediate delivery
    const delivered = await deliverNotification(notification);

    if (delivered) {
      manager.markDelivered(notification.id, 'cli');
    }

    return {
      success: true,
      notificationId: notification.id,
      delivered,
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
async function deliverNotification(notification: PendingNotification): Promise<boolean> {
  const channels = notification.delivery.channels;

  for (const channel of channels) {
    const handler = deliveryHandlers.get(channel);

    if (handler) {
      try {
        const delivered = await handler(notification);
        if (delivered) {
          return true;
        }
      } catch (error) {
        console.error(`[Pusher] Delivery failed for channel ${channel}:`, error);
      }
    }

    // CLI channel with registered handler
    if (channel === 'cli' && cliDeliveryHandler) {
      try {
        cliDeliveryHandler(notification.message, notification.priority);
        return true;
      } catch (error) {
        console.error('[Pusher] CLI delivery failed:', error);
      }
    }
  }

  return false;
}

/**
 * Push pending notifications (called on CLI startup or periodically)
 */
export async function pushPendingNotifications(): Promise<{
  pushed: number;
  failed: number;
  notifications: PendingNotification[];
}> {
  const manager = getNotificationManager();
  const notifications = manager.getPending('cli-user');

  let pushed = 0;
  let failed = 0;
  const deliveredNotifications: PendingNotification[] = [];

  for (const notification of notifications) {
    const delivered = await deliverNotification(notification);

    if (delivered) {
      manager.markDelivered(notification.id, 'cli');
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
  // Import dynamically to avoid circular dependency
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
