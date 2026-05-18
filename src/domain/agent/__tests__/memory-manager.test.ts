/**
 * Tests for memory-manager.ts
 *
 * Covers: MemoryManager — refreshMemory, recordConversation, simpleHash dirty-checking
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockGetCoreContext = vi.fn(() => ({ identity: 'test', user: '', facts: '' }));
const mockRecordConversation = vi.fn(async () => {});
const mockGrep = vi.fn(() => ({ success: true, data: '' }));
vi.mock('../../memory', () => ({
  getMemoryStore: () => ({
    getCoreContext: mockGetCoreContext,
    recordConversation: mockRecordConversation,
    grep: mockGrep,
  }),
}));

const mockCheckAfterRecord = vi.fn(async () => {});
vi.mock('../../memory/lifecycle-manager', () => ({
  getLifecycleManager: () => ({ checkAfterRecord: mockCheckAfterRecord }),
}));

const mockSkillList = vi.fn(() => []);
vi.mock('../../skills/store', () => ({
  getSkillStore: () => ({ list: mockSkillList }),
}));

vi.mock('../tools', () => ({
  buildSystemPrompt: vi.fn((base: string, ctx: any) => `${base}\n${ctx.identity || ''}`),
  formatSkillsForPrompt: vi.fn((skills: any[]) => skills.map((s: any) => s.name).join(',')),
}));

vi.mock('../context', () => ({
  estimateMessageTokens: vi.fn((msg: any) => {
    const content = typeof msg.content === 'string' ? msg.content : '';
    return Math.ceil(content.length / 3);
  }),
}));

vi.mock('../../../infra/observability/logger', () => {
  const m = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  return { logger: m, getLogger: () => m };
});

import { MemoryManager } from '../memory-manager';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('MemoryManager', () => {
  let manager: MemoryManager;

  beforeEach(() => {
    manager = new MemoryManager();
    mockGetCoreContext.mockReturnValue({ identity: 'test-identity', user: '', facts: '' });
    mockRecordConversation.mockReset();
    mockCheckAfterRecord.mockReset();
    mockSkillList.mockReturnValue([]);
  });

  describe('refreshMemory', () => {
    it('builds system prompt and updates existing system message', () => {
      const messages: any[] = [
        { role: 'system', content: 'old prompt' },
        { role: 'user', content: 'hello' },
      ];

      const delta = manager.refreshMemory('base', messages);
      expect(messages[0].content).toContain('base');
      // delta should be the difference in tokens
      expect(typeof delta).toBe('number');
    });

    it('inserts system message if none exists', () => {
      const messages: any[] = [
        { role: 'user', content: 'hello' },
      ];

      const delta = manager.refreshMemory('base', messages);
      expect(messages[0].role).toBe('system');
      expect(delta).toBeGreaterThan(0);
    });

    it('returns 0 when content hash unchanged (KV-Cache optimization)', () => {
      const messages: any[] = [
        { role: 'system', content: 'old' },
      ];

      // First call — will update
      manager.refreshMemory('base', messages);

      // Second call with same context — should return 0
      const delta = manager.refreshMemory('base', messages);
      expect(delta).toBe(0);
    });

    it('returns 0 on error', () => {
      mockGetCoreContext.mockImplementation(() => { throw new Error('store broken'); });
      const messages: any[] = [];
      const delta = manager.refreshMemory('base', messages);
      expect(delta).toBe(0);
    });

    it('injects skills metadata when skills are available', () => {
      mockSkillList.mockReturnValue([
        { name: 'my-skill', description: 'test', triggers: ['go'] },
      ]);
      const messages: any[] = [{ role: 'system', content: 'old' }];
      manager.refreshMemory('base', messages);
      // The buildSystemPrompt mock includes context, so skills should be injected
      expect(mockSkillList).toHaveBeenCalled();
    });

    it('calls hookRunner.runBeforePromptBuild when provided', () => {
      const hookRunner = {
        runBeforePromptBuild: vi.fn(async () => {}),
      };
      const messages: any[] = [{ role: 'system', content: 'old' }];
      manager.refreshMemory('base', messages, hookRunner as any);
      expect(hookRunner.runBeforePromptBuild).toHaveBeenCalled();
    });
  });

  describe('recordConversation', () => {
    it('records conversation to memory store', async () => {
      await manager.recordConversation('user msg', 'assistant msg');
      expect(mockRecordConversation).toHaveBeenCalled();
      const arg = mockRecordConversation.mock.calls[0][0];
      expect(arg.user).toBe('user msg');
      expect(arg.assistant).toBe('assistant msg');
      expect(arg.source).toBe('agent');
    });

    it('triggers lifecycle check after recording', async () => {
      await manager.recordConversation('u', 'a');
      expect(mockCheckAfterRecord).toHaveBeenCalled();
    });

    it('does not throw when lifecycle check fails', async () => {
      mockCheckAfterRecord.mockRejectedValue(new Error('lifecycle error'));
      await expect(manager.recordConversation('u', 'a')).resolves.toBeUndefined();
    });

    it('does not throw when memory store is not initialized', async () => {
      mockRecordConversation.mockRejectedValue(new Error('not init'));
      await expect(manager.recordConversation('u', 'a')).resolves.toBeUndefined();
    });
  });
});
