/**
 * Persistent Notifications
 *
 * Manages notifications that persist across sessions
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type {
  PendingNotification,
  NotificationHistory,
  NotificationStorage,
  NotificationPriority,
  ProactiveToolResult,
} from './types';

export class NotificationManager {
  private basePath: string;
  private storagePath: string;
  private historyPath: string;
  private storage: NotificationStorage;
  private initialized: boolean = false;

  constructor(basePath: string) {
    this.basePath = basePath;
    this.storagePath = join(basePath, 'pending.json');
    this.historyPath = join(basePath, 'history.json');
    this.storage = {
      pending: [],
      history: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  // Initialize notification storage
  init(): void {
    if (this.initialized) return;

    // Ensure directories exist
    const notificationsDir = join(this.basePath, 'notifications');
    if (!existsSync(notificationsDir)) {
      mkdirSync(notificationsDir, { recursive: true });
    }

    // Load existing storage
    this.loadStorage();

    this.initialized = true;
  }

  // Create a new notification
  create(options: {
    userId: string;
    message: string;
    priority?: NotificationPriority;
    category?: string;
    scheduledFor?: string;
    expiresAt?: string;
    channels?: ('cli' | 'websocket' | 'email')[];
    metadata?: Record<string, unknown>;
  }): ProactiveToolResult {
    this.init();

    const notification: PendingNotification = {
      id: this.generateId(),
      userId: options.userId,
      message: options.message,
      priority: options.priority || 'normal',
      category: options.category,
      createdAt: new Date().toISOString(),
      scheduledFor: options.scheduledFor,
      expiresAt: options.expiresAt,
      delivery: {
        channels: options.channels || ['cli'],
        attempts: 0,
        maxAttempts: 3,
        delivered: false,
      },
      metadata: options.metadata,
    };

    this.storage.pending.push(notification);
    this.saveStorage();

    return { success: true, data: notification };
  }

  // Get pending notifications for a user
  getPending(userId: string): PendingNotification[] {
    this.init();
    const now = new Date();

    return this.storage.pending.filter(n => {
      // Check user
      if (n.userId !== userId && n.userId !== '*') return false;

      // Check if expired
      if (n.expiresAt && new Date(n.expiresAt) < now) return false;

      // Check if scheduled for future
      if (n.scheduledFor && new Date(n.scheduledFor) > now) return false;

      // Check if already delivered
      if (n.delivery.delivered) return false;

      return true;
    }).sort((a, b) => {
      // Sort by priority (urgent first)
      const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  // Get all pending notifications
  getAllPending(): PendingNotification[] {
    this.init();
    return this.storage.pending.filter(n => !n.delivery.delivered);
  }

  // Mark notification as delivered
  markDelivered(id: string, channel: 'cli' | 'websocket' | 'email' = 'cli'): ProactiveToolResult {
    this.init();

    const notification = this.storage.pending.find(n => n.id === id);
    if (!notification) {
      return { success: false, error: `Notification not found: ${id}` };
    }

    notification.delivery.delivered = true;
    notification.delivery.deliveredAt = new Date().toISOString();
    notification.delivery.attempts++;

    // Move to history
    const history: NotificationHistory = {
      id: notification.id,
      userId: notification.userId,
      message: notification.message,
      priority: notification.priority,
      category: notification.category,
      createdAt: notification.createdAt,
      deliveredAt: notification.delivery.deliveredAt,
      channel,
      success: true,
      metadata: notification.metadata,
    };

    this.storage.history.push(history);

    // Remove from pending
    this.storage.pending = this.storage.pending.filter(n => n.id !== id);

    this.saveStorage();

    return { success: true, data: { delivered: id } };
  }

  // Mark notification as attempted (increment attempt count)
  markAttempted(id: string): ProactiveToolResult {
    this.init();

    const notification = this.storage.pending.find(n => n.id === id);
    if (!notification) {
      return { success: false, error: `Notification not found: ${id}` };
    }

    notification.delivery.attempts++;

    // If max attempts reached, move to history as failed
    if (notification.delivery.attempts >= notification.delivery.maxAttempts) {
      const history: NotificationHistory = {
        id: notification.id,
        userId: notification.userId,
        message: notification.message,
        priority: notification.priority,
        category: notification.category,
        createdAt: notification.createdAt,
        deliveredAt: new Date().toISOString(),
        channel: 'cli',
        success: false,
        metadata: notification.metadata,
      };

      this.storage.history.push(history);
      this.storage.pending = this.storage.pending.filter(n => n.id !== id);
    }

    this.saveStorage();

    return { success: true, data: { attempted: id, attempts: notification.delivery.attempts } };
  }

  // Delete a notification
  delete(id: string): ProactiveToolResult {
    this.init();

    const index = this.storage.pending.findIndex(n => n.id === id);
    if (index === -1) {
      return { success: false, error: `Notification not found: ${id}` };
    }

    this.storage.pending.splice(index, 1);
    this.saveStorage();

    return { success: true, data: { deleted: id } };
  }

  // Clear expired notifications
  clearExpired(): number {
    this.init();
    const now = new Date();
    const before = this.storage.pending.length;

    this.storage.pending = this.storage.pending.filter(n => {
      if (n.expiresAt && new Date(n.expiresAt) < now) {
        // Move to history
        const history: NotificationHistory = {
          id: n.id,
          userId: n.userId,
          message: n.message,
          priority: n.priority,
          category: n.category,
          createdAt: n.createdAt,
          deliveredAt: now.toISOString(),
          channel: 'cli',
          success: false,
          metadata: { ...n.metadata, reason: 'expired' },
        };
        this.storage.history.push(history);
        return false;
      }
      return true;
    });

    const removed = before - this.storage.pending.length;
    if (removed > 0) {
      this.saveStorage();
    }

    return removed;
  }

  // Get notification history
  getHistory(limit: number = 50): NotificationHistory[] {
    this.init();
    return this.storage.history.slice(-limit);
  }

  // Get statistics
  getStats(): { pending: number; history: number; byPriority: Record<string, number> } {
    this.init();

    const byPriority: Record<string, number> = {
      urgent: 0,
      high: 0,
      normal: 0,
      low: 0,
    };

    for (const n of this.storage.pending) {
      byPriority[n.priority] = (byPriority[n.priority] || 0) + 1;
    }

    return {
      pending: this.storage.pending.length,
      history: this.storage.history.length,
      byPriority,
    };
  }

  // Private helper methods

  private generateId(): string {
    return `notif-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  private loadStorage(): void {
    if (existsSync(this.storagePath)) {
      try {
        const content = readFileSync(this.storagePath, 'utf-8');
        const data = JSON.parse(content);
        this.storage.pending = data.pending || [];
        this.storage.lastUpdated = data.lastUpdated;
      } catch {
        // Use defaults
      }
    }

    if (existsSync(this.historyPath)) {
      try {
        const content = readFileSync(this.historyPath, 'utf-8');
        this.storage.history = JSON.parse(content);
      } catch {
        // Use defaults
      }
    }
  }

  private saveStorage(): void {
    this.storage.lastUpdated = new Date().toISOString();
    writeFileSync(this.storagePath, JSON.stringify({
      pending: this.storage.pending,
      lastUpdated: this.storage.lastUpdated,
    }, null, 2), 'utf-8');

    writeFileSync(this.historyPath, JSON.stringify(this.storage.history, null, 2), 'utf-8');
  }
}

// Singleton instance
let notificationManager: NotificationManager | null = null;

export function getNotificationManager(basePath?: string): NotificationManager {
  if (!notificationManager && basePath) {
    notificationManager = new NotificationManager(basePath);
    notificationManager.init();
  }
  if (!notificationManager) {
    throw new Error('NotificationManager not initialized. Call getNotificationManager with basePath first.');
  }
  return notificationManager;
}

export function resetNotificationManager(): void {
  notificationManager = null;
}
