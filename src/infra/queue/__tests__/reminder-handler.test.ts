import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  handleReminderJob,
  getPendingNotifications,
  hasPendingNotifications,
} from '../handlers/reminder-handler';
import type { ReminderJobData } from '../types';
import type { Job } from 'bunqueue/client';

// Mock Job object
function createMockJob<T>(data: T): Job<T> {
  let progress = 0;
  return {
    id: `job-${Date.now()}`,
    name: 'test-job',
    data,
    queueName: 'test-queue',
    state: 'waiting',
    progress: 0,
    timestamp: Date.now(),
    updateProgress: async (p: number) => {
      progress = p;
    },
    getProgress: () => progress,
  } as unknown as Job<T>;
}

describe('Reminder Handler', () => {
  describe('handleReminderJob', () => {
    test('creates reminder with required fields', async () => {
      const job = createMockJob<ReminderJobData>({
        userId: 'user1',
        message: 'Test reminder',
        type: 'one-time',
      });

      const result = await handleReminderJob(job);

      expect(result).toBeDefined();
      expect((result as any).success).toBe(true);
      expect((result as any).userId).toBe('user1');
      expect((result as any).message).toBe('Test reminder');
      expect((result as any).type).toBe('one-time');
    });

    test('creates recurring reminder', async () => {
      const job = createMockJob<ReminderJobData>({
        userId: 'user2',
        message: 'Daily reminder',
        type: 'recurring',
      });

      const result = await handleReminderJob(job);

      expect(result).toBeDefined();
      expect((result as any).type).toBe('recurring');
    });

    test('includes delivery timestamp', async () => {
      const job = createMockJob<ReminderJobData>({
        userId: 'user1',
        message: 'Timestamp test',
        type: 'one-time',
      });

      const result = await handleReminderJob(job);

      expect((result as any).deliveredAt).toBeDefined();
    });
  });

  describe('getPendingNotifications', () => {
    test('returns pending notifications for user', async () => {
      // Create a reminder
      const job = createMockJob<ReminderJobData>({
        userId: 'test-user',
        message: 'Pending notification',
        type: 'one-time',
      });

      await handleReminderJob(job);

      const notifications = getPendingNotifications('test-user');

      expect(notifications.length).toBe(1);
      expect(notifications[0].message).toBe('Pending notification');
    });

    test('returns empty array for user with no notifications', () => {
      const notifications = getPendingNotifications('no-notifications-user');

      expect(notifications).toEqual([]);
    });

    test('clears notifications after reading', async () => {
      const job = createMockJob<ReminderJobData>({
        userId: 'clear-test-user',
        message: 'To be cleared',
        type: 'one-time',
      });

      await handleReminderJob(job);

      // First read
      const first = getPendingNotifications('clear-test-user');
      expect(first.length).toBe(1);

      // Second read (should be cleared)
      const second = getPendingNotifications('clear-test-user');
      expect(second.length).toBe(0);
    });

    test('accumulates multiple notifications', async () => {
      const job1 = createMockJob<ReminderJobData>({
        userId: 'multi-user',
        message: 'First notification',
        type: 'one-time',
      });
      const job2 = createMockJob<ReminderJobData>({
        userId: 'multi-user',
        message: 'Second notification',
        type: 'one-time',
      });

      await handleReminderJob(job1);
      await handleReminderJob(job2);

      const notifications = getPendingNotifications('multi-user');

      expect(notifications.length).toBe(2);
    });
  });

  describe('hasPendingNotifications', () => {
    test('returns true when notifications exist', async () => {
      const job = createMockJob<ReminderJobData>({
        userId: 'has-pending-user',
        message: 'Pending check',
        type: 'one-time',
      });

      await handleReminderJob(job);

      expect(hasPendingNotifications('has-pending-user')).toBe(true);
    });

    test('returns false when no notifications', () => {
      expect(hasPendingNotifications('no-pending-user')).toBe(false);
    });

    test('returns false after notifications are read', async () => {
      const job = createMockJob<ReminderJobData>({
        userId: 'read-then-check-user',
        message: 'Will be read',
        type: 'one-time',
      });

      await handleReminderJob(job);
      getPendingNotifications('read-then-check-user');

      expect(hasPendingNotifications('read-then-check-user')).toBe(false);
    });
  });
});
