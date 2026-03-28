/**
 * Tests for onboarding module
 *
 * Covers needsOnboarding, quickSetup, runOnboardingWizard
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────

const { mockExistsSync, mockWriteFileSync, mockQuestion, mockClose } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(() => false),
  mockWriteFileSync: vi.fn(),
  mockQuestion: vi.fn((_q: string, cb: Function) => cb('test answer')),
  mockClose: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  writeFileSync: mockWriteFileSync,
}));

vi.mock('path', () => ({
  join: (...args: string[]) => args.join('/'),
}));

vi.mock('readline', () => ({
  createInterface: vi.fn(() => ({
    question: mockQuestion,
    close: mockClose,
  })),
}));

vi.mock('../../infra/observability/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { needsOnboarding, quickSetup, runOnboardingWizard } from '../onboarding';

describe('onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── needsOnboarding ────────────────────────────────────────────────────

  describe('needsOnboarding', () => {
    it('should return true when SOUL.md does not exist', () => {
      mockExistsSync.mockImplementation((p: string) => !p.includes('SOUL'));
      expect(needsOnboarding('/mem')).toBe(true);
    });

    it('should return true when USER.md does not exist', () => {
      mockExistsSync.mockImplementation((p: string) => !p.includes('USER'));
      expect(needsOnboarding('/mem')).toBe(true);
    });

    it('should return true when neither file exists', () => {
      mockExistsSync.mockReturnValue(false);
      expect(needsOnboarding('/mem')).toBe(true);
    });

    it('should return false when both files exist', () => {
      mockExistsSync.mockReturnValue(true);
      expect(needsOnboarding('/mem')).toBe(false);
    });

    it('should check correct paths', () => {
      mockExistsSync.mockReturnValue(true);
      needsOnboarding('/my/memory');
      expect(mockExistsSync).toHaveBeenCalledWith('/my/memory/SOUL.md');
      expect(mockExistsSync).toHaveBeenCalledWith('/my/memory/USER.md');
    });
  });

  // ── quickSetup ─────────────────────────────────────────────────────────

  describe('quickSetup', () => {
    it('should create SOUL.md when it does not exist', async () => {
      mockExistsSync.mockReturnValue(false);
      await quickSetup('/mem');
      const soulCall = mockWriteFileSync.mock.calls.find(
        (c: any[]) => c[0].includes('SOUL.md')
      );
      expect(soulCall).toBeDefined();
      expect(soulCall![1]).toContain('# SOUL');
    });

    it('should create USER.md when it does not exist', async () => {
      mockExistsSync.mockReturnValue(false);
      await quickSetup('/mem');
      const userCall = mockWriteFileSync.mock.calls.find(
        (c: any[]) => c[0].includes('USER.md')
      );
      expect(userCall).toBeDefined();
      expect(userCall![1]).toContain('# USER');
    });

    it('should not overwrite existing SOUL.md', async () => {
      mockExistsSync.mockImplementation((p: string) => p.includes('SOUL'));
      await quickSetup('/mem');
      const soulCall = mockWriteFileSync.mock.calls.find(
        (c: any[]) => c[0].includes('SOUL.md')
      );
      expect(soulCall).toBeUndefined();
    });

    it('should not overwrite existing USER.md', async () => {
      mockExistsSync.mockImplementation((p: string) => p.includes('USER'));
      await quickSetup('/mem');
      const userCall = mockWriteFileSync.mock.calls.find(
        (c: any[]) => c[0].includes('USER.md')
      );
      expect(userCall).toBeUndefined();
    });

    it('should not write any file when both exist', async () => {
      mockExistsSync.mockReturnValue(true);
      await quickSetup('/mem');
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('should write SOUL.md with utf-8 encoding', async () => {
      mockExistsSync.mockReturnValue(false);
      await quickSetup('/mem');
      const soulCall = mockWriteFileSync.mock.calls.find(
        (c: any[]) => c[0].includes('SOUL.md')
      );
      expect(soulCall![2]).toBe('utf-8');
    });

    it('SOUL.md default content includes expected sections', async () => {
      mockExistsSync.mockReturnValue(false);
      await quickSetup('/mem');
      const content = mockWriteFileSync.mock.calls.find(
        (c: any[]) => c[0].includes('SOUL.md')
      )![1] as string;
      expect(content).toContain('Core Values');
      expect(content).toContain('Communication Style');
      expect(content).toContain('Behavioral Guidelines');
    });

    it('USER.md default content includes expected sections', async () => {
      mockExistsSync.mockReturnValue(false);
      await quickSetup('/mem');
      const content = mockWriteFileSync.mock.calls.find(
        (c: any[]) => c[0].includes('USER.md')
      )![1] as string;
      expect(content).toContain('Basic Information');
      expect(content).toContain('Goals');
      expect(content).toContain('Preferences');
    });
  });

  // ── runOnboardingWizard ────────────────────────────────────────────────

  describe('runOnboardingWizard', () => {
    it('should create both SOUL.md and USER.md via wizard', async () => {
      // The mock readline returns 'test answer' for every question
      await runOnboardingWizard('/mem');

      const soulCall = mockWriteFileSync.mock.calls.find(
        (c: any[]) => c[0].includes('SOUL.md')
      );
      const userCall = mockWriteFileSync.mock.calls.find(
        (c: any[]) => c[0].includes('USER.md')
      );
      expect(soulCall).toBeDefined();
      expect(userCall).toBeDefined();
    });

    it('should close readline interface after completion', async () => {
      await runOnboardingWizard('/mem');
      expect(mockClose).toHaveBeenCalled();
    });

    it('SOUL.md should contain user answers', async () => {
      await runOnboardingWizard('/mem');
      const content = mockWriteFileSync.mock.calls.find(
        (c: any[]) => c[0].includes('SOUL.md')
      )![1] as string;
      expect(content).toContain('test answer');
    });

    it('USER.md should contain user answers', async () => {
      await runOnboardingWizard('/mem');
      const content = mockWriteFileSync.mock.calls.find(
        (c: any[]) => c[0].includes('USER.md')
      )![1] as string;
      expect(content).toContain('test answer');
    });

    it('should use default values when user presses Enter (empty input)', async () => {
      mockQuestion.mockImplementation((_q: string, cb: Function) => cb(''));
      await runOnboardingWizard('/mem');

      const soulContent = mockWriteFileSync.mock.calls.find(
        (c: any[]) => c[0].includes('SOUL.md')
      )![1] as string;
      // Default values should be present
      expect(soulContent).toContain('helpful');
      expect(soulContent).toContain('clear');

      const userContent = mockWriteFileSync.mock.calls.find(
        (c: any[]) => c[0].includes('USER.md')
      )![1] as string;
      expect(userContent).toContain('User');
      expect(userContent).toContain('中文');
    });

    it('should close readline even when wizard throws', async () => {
      mockWriteFileSync.mockImplementationOnce(() => {
        throw new Error('write failed');
      });

      await expect(runOnboardingWizard('/mem')).rejects.toThrow('write failed');
      expect(mockClose).toHaveBeenCalled();
    });
  });
});
