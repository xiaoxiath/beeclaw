/**
 * Tests for card-callback-handler.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    debug: vi.fn(() => {}),
    info: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    error: vi.fn(() => {}),
  },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

const { mockSetDecision, mockSetUserInput, mockResume } = vi.hoisted(() => ({
  mockSetDecision: vi.fn(() => {}),
  mockSetUserInput: vi.fn(() => {}),
  mockResume: vi.fn(() => {}),
}));

vi.mock('../../../domain/session/hitl-manager', () => ({
  setDecision: mockSetDecision,
  setUserInput: mockSetUserInput,
  resume: mockResume,
}));

import { CardCallbackHandler, callbackEventDedup } from '../card-callback-handler';
import type { CardCallbackEvent } from '../card-callback-handler';

function makeMockClient() {
  return {
    patchCard: vi.fn(() => Promise.resolve()),
  } as any;
}

function makeFullCallbackEvent(overrides: Record<string, any> = {}): CardCallbackEvent {
  return {
    schema: '2.0',
    header: {
      event_id: overrides.event_id || `ev_${Date.now()}`,
      token: 'tok',
      create_time: '123',
      event_type: 'card.action.trigger',
      tenant_key: 'tk',
      app_id: 'app',
    },
    event: {
      operator: { tenant_key: 'tk', open_id: 'ou_1' },
      token: 'action_tok',
      action: {
        tag: 'button',
        value: {
          action: 'hitl_callback',
          hitlType: 'confirmation',
          decision: 'APPROVED',
          toolCallId: 'tc_1',
          toolName: 'run_command',
          sessionId: 'sess_1',
          ...(overrides.actionValue || {}),
        },
      },
      host: 'im_message',
      context: {
        open_message_id: 'msg_1',
        open_chat_id: 'oc_1',
      },
    },
    ...overrides,
  } as CardCallbackEvent;
}

describe('CardCallbackHandler', () => {
  let handler: CardCallbackHandler;
  let mockClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    mockClient = makeMockClient();
    handler = new CardCallbackHandler(mockClient);
    mockSetDecision.mockClear();
    mockSetUserInput.mockClear();
    mockResume.mockClear();
    mockClient.patchCard.mockClear();
    callbackEventDedup.clear();
  });

  // ===================== handleCallback =====================
  describe('handleCallback', () => {
    it('handles full callback structure (confirmation APPROVED)', async () => {
      const event = makeFullCallbackEvent();
      await handler.handleCallback(event);
      expect(mockSetDecision).toHaveBeenCalledWith('sess_1', 'tc_1', 'APPROVED');
      expect(mockResume).toHaveBeenCalledWith('sess_1');
      expect(mockClient.patchCard).toHaveBeenCalledTimes(1);
    });

    it('handles confirmation DENIED', async () => {
      const event = makeFullCallbackEvent({
        actionValue: { decision: 'DENIED' },
      });
      await handler.handleCallback(event);
      expect(mockSetDecision).toHaveBeenCalledWith('sess_1', 'tc_1', 'DENIED');
      expect(mockResume).not.toHaveBeenCalled(); // DENIED should NOT resume
    });

    it('handles unpacked event structure', async () => {
      const event = makeFullCallbackEvent();
      // Pass the event part directly (SDK-unpacked)
      await handler.handleCallback(event.event);
      // When unpacked, no header -> no event_id for dedup, but should still process
      expect(mockSetDecision).toHaveBeenCalledTimes(1);
    });

    it('handles user_input callback', async () => {
      const event = makeFullCallbackEvent({
        actionValue: {
          action: 'hitl_callback',
          hitlType: 'user_input',
          inputType: 'select',
          requestId: 'req_1',
          sessionId: 'sess_2',
          value: 'option_a',
        },
      });
      // Override the action value
      event.event.action.value = {
        action: 'hitl_callback',
        hitlType: 'user_input',
        inputType: 'select',
        requestId: 'req_1',
        sessionId: 'sess_2',
      };
      event.event.action.option = 'option_a';
      await handler.handleCallback(event);
      expect(mockSetUserInput).toHaveBeenCalledWith('sess_2', 'req_1', 'option_a');
      expect(mockResume).toHaveBeenCalledWith('sess_2');
    });

    it('skips unknown data structure', async () => {
      await handler.handleCallback({ random: 'data' });
      expect(mockSetDecision).not.toHaveBeenCalled();
    });

    it('skips invalid event structure (no action)', async () => {
      await handler.handleCallback({
        schema: '2.0',
        header: { event_id: 'ev_1' },
        event: { operator: {}, context: {} },
      });
      expect(mockSetDecision).not.toHaveBeenCalled();
    });

    it('skips unknown action type', async () => {
      const event = makeFullCallbackEvent();
      event.event.action.value = { action: 'unknown_action' };
      await handler.handleCallback(event);
      expect(mockSetDecision).not.toHaveBeenCalled();
    });

    it('handles error in callback gracefully', async () => {
      mockSetDecision.mockImplementation(() => { throw new Error('boom'); });
      const event = makeFullCallbackEvent();
      // Should not throw
      await handler.handleCallback(event);
    });

    it('skips missing sessionId in confirmation', async () => {
      const event = makeFullCallbackEvent({
        actionValue: { sessionId: undefined },
      });
      event.event.action.value!.sessionId = undefined;
      await handler.handleCallback(event);
      expect(mockSetDecision).not.toHaveBeenCalled();
    });

    it('skips missing toolCallId in confirmation', async () => {
      const event = makeFullCallbackEvent({
        actionValue: { toolCallId: undefined },
      });
      event.event.action.value!.toolCallId = undefined;
      await handler.handleCallback(event);
      expect(mockSetDecision).not.toHaveBeenCalled();
    });

    it('handles patchCard failure gracefully', async () => {
      mockClient.patchCard.mockRejectedValue(new Error('patch fail'));
      const event = makeFullCallbackEvent();
      // Should not throw
      await handler.handleCallback(event);
      expect(mockSetDecision).toHaveBeenCalledTimes(1);
    });
  });

  // ===================== Dedup =====================
  describe('callbackEventDedup', () => {
    it('detects duplicate events', async () => {
      const event = makeFullCallbackEvent({ event_id: 'ev_dup_1' });
      await handler.handleCallback(event);
      expect(mockSetDecision).toHaveBeenCalledTimes(1);

      // Send same event again
      mockSetDecision.mockClear();
      await handler.handleCallback(event);
      expect(mockSetDecision).not.toHaveBeenCalled();
    });

    it('allows different event_ids', async () => {
      const ev1 = makeFullCallbackEvent({ event_id: 'ev_a' });
      const ev2 = makeFullCallbackEvent({ event_id: 'ev_b' });
      await handler.handleCallback(ev1);
      await handler.handleCallback(ev2);
      expect(mockSetDecision).toHaveBeenCalledTimes(2);
    });

    it('tracks size correctly', () => {
      callbackEventDedup.clear();
      expect(callbackEventDedup.size).toBe(0);
      callbackEventDedup.isDuplicate('test1');
      expect(callbackEventDedup.size).toBe(1);
    });

    it('cleans up old entries when over max size', () => {
      callbackEventDedup.clear();
      // Add many entries
      for (let i = 0; i < 1100; i++) {
        callbackEventDedup.isDuplicate(`ev_${i}`);
      }
      // After cleanup, size should be reduced
      callbackEventDedup.isDuplicate('trigger_cleanup');
      expect(callbackEventDedup.size).toBeLessThanOrEqual(1100);
    });
  });

  // ===================== User input edge cases =====================
  describe('user input edge cases', () => {
    it('skips missing sessionId in user input', async () => {
      const event = makeFullCallbackEvent();
      event.event.action.value = {
        action: 'hitl_callback',
        hitlType: 'user_input',
        requestId: 'req_1',
        // No sessionId
      };
      await handler.handleCallback(event);
      expect(mockSetUserInput).not.toHaveBeenCalled();
    });

    it('skips missing requestId in user input', async () => {
      const event = makeFullCallbackEvent();
      event.event.action.value = {
        action: 'hitl_callback',
        hitlType: 'user_input',
        sessionId: 'sess_1',
        // No requestId
      };
      await handler.handleCallback(event);
      expect(mockSetUserInput).not.toHaveBeenCalled();
    });
  });
});
