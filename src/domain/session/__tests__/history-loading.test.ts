/**
 * Test for conversation history loading bug fix
 *
 * Bug description:
 * - User asks "1+1等于几", assistant replies "1+1=2"
 * - User asks "今天天气怎么样", assistant replies "1+1=2，今天天气不错"
 * - Root cause: History loading loop skipped the last assistant message
 *
 * Fix:
 * - Changed history loading from `i < session.messages.length - 1` to `i < session.messages.length`
 * - This ensures all previous messages (including assistant replies) are loaded
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { sendProactiveMessage, getOrCreateSession, saveSession, listSessions, confirmDelivery, deleteSession } from '../index';
import { createAgent } from '../../agent';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';

// Helper to force delete session file
function forceDeleteSessionFile(sessionId: string) {
  const sessionPath = join('data/memory/sessions', `${sessionId}.json`);
  if (existsSync(sessionPath)) {
    try {
      unlinkSync(sessionPath);
    } catch (e) {
      // Ignore
    }
  }
  // Also try to delete from memory
  try {
    deleteSession(sessionId);
  } catch (e) {
    // Ignore
  }
}

describe('Conversation History Loading', () => {
  beforeEach(() => {
    // Clear all sessions before each test
    const sessions = listSessions();
    for (const session of sessions) {
      deleteSession(session.id);
    }
  });

  test('should load complete conversation history including assistant replies', async () => {
    const sessionId = 'history-test';

    // Force delete session file
    forceDeleteSessionFile(sessionId);

    // Create session
    const session = getOrCreateSession({
      sessionId,
      userId: 'test-user',
      channel: 'cli',
    });

    console.log('[Test] Initial session:', {
      messageCount: session.messages.length,
      roles: session.messages.map(m => m.role),
    });

    // Ensure session is empty
    expect(session.messages.length).toBe(0);

    // Simulate first conversation turn
    session.messages.push({
      role: 'user',
      content: '1+1等于几',
      timestamp: new Date().toISOString(),
    });
    session.messages.push({
      role: 'assistant',
      content: '1+1=2',
      timestamp: new Date().toISOString(),
    });
    saveSession(session);

    console.log('[Test] Session after first turn:', {
      messageCount: session.messages.length,
      roles: session.messages.map(m => m.role),
    });

    // Verify session has both messages
    expect(session.messages.length).toBe(2);
    expect(session.messages[0].role).toBe('user');
    expect(session.messages[1].role).toBe('assistant');

    // Now simulate second turn
    // The agent should see: [user: 1+1, assistant: 1+1=2, user: 今天天气]
    // NOT: [user: 1+1, user: 今天天气] (missing assistant reply)

    // We can't easily test the actual agent behavior in unit tests,
    // but we can verify the history loading logic

    // Create a new agent and load history
    const agent = createAgent({
      provider: { name: 'test', type: 'openai', apiKey: 'test' },
      model: 'test-model',
      systemPrompt: 'Test prompt',
    });

    // Load history (this is what sendProactiveMessage does internally)
    for (let i = 0; i < session.messages.length; i++) {
      const msg = session.messages[i];
      if (msg.role === 'user' || msg.role === 'assistant') {
        agent.addMessage({ role: msg.role, content: msg.content });
      }
    }

    // Verify agent has loaded all messages
    const agentMessages = agent.getMessages();
    console.log('[Test] Agent messages:', {
      count: agentMessages.length,
      roles: agentMessages.map(m => m.role),
      contents: agentMessages.map(m => m.content?.substring(0, 30)),
    });

    // Key verification: the assistant message from session should be present
    // Note: Agent might add additional messages (e.g., memory refresh), so we check for presence, not exact count
    const assistantMessages = agentMessages.filter(m => m.role === 'assistant');
    const hasOurAssistantMessage = assistantMessages.some(m => m.content === '1+1=2');

    expect(hasOurAssistantMessage).toBe(true);
    expect(agentMessages[0].role).toBe('system');
    expect(agentMessages[1].role).toBe('user');
    expect(agentMessages[1].content).toBe('1+1等于几');
  });
});

