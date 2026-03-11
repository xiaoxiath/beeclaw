/**
 * Reminder Worker Handler
 *
 * Handles scheduled reminder jobs
 */

import type { Job } from 'bunqueue/client';
import type { ReminderJobData } from '../types';

// Store pending notifications (in production, this would use a proper notification system)
const pendingNotifications: Map<string, ReminderJobData[]> = new Map();

export async function handleReminderJob(job: Job<ReminderJobData>): Promise<unknown> {
  const { userId, message, type } = job.data;

  console.log(`[Worker:reminder] Processing reminder for user ${userId}`);

  await job.updateProgress(50);

  // Store the notification for the user
  // In production, this would push to WebSocket, send email, etc.
  const userNotifications = pendingNotifications.get(userId) || [];
  userNotifications.push({
    userId,
    message,
    type,
  });
  pendingNotifications.set(userId, userNotifications);

  await job.updateProgress(100);

  console.log(`[Worker:reminder] Reminder sent: "${message}"`);

  return {
    success: true,
    userId,
    message,
    type,
    deliveredAt: new Date().toISOString(),
  };
}

/**
 * Get pending notifications for a user
 */
export function getPendingNotifications(userId: string): ReminderJobData[] {
  const notifications = pendingNotifications.get(userId) || [];
  // Clear after reading
  pendingNotifications.delete(userId);
  return notifications;
}

/**
 * Check if user has pending notifications
 */
export function hasPendingNotifications(userId: string): boolean {
  const notifications = pendingNotifications.get(userId);
  return notifications ? notifications.length > 0 : false;
}
