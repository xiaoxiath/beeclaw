import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getAgent } from '../../../app';
import { getOrCreateSession, getSession, saveSession } from '../../../session';

const sendMessageSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional().nullable(), // Allow null from frontend
  channel: z.enum(['cli', 'feishu', 'webhook', 'api', 'web']).default('web'),
});

console.log('[Chat API] Schema loaded - allowed channels:', ['cli', 'feishu', 'webhook', 'api', 'web']);

export default new Hono()
  // Send message with SSE streaming
  .post('/', async (c, next) => {
    console.log('[Chat API] ===== NEW REQUEST =====');
    console.log('[Chat API] Content-Type:', c.req.header('Content-Type'));

    try {
      const body = await c.req.json();
      console.log('[Chat API] Request body:', JSON.stringify(body, null, 2));
      console.log('[Chat API] Body has message:', 'message' in body);
      console.log('[Chat API] Body has sessionId:', 'sessionId' in body);
      console.log('[Chat API] Body has channel:', 'channel' in body, '- value:', body.channel);
    } catch (e) {
      console.error('[Chat API] Failed to parse request body:', e);
    }

    return next();
  }, zValidator('json', sendMessageSchema), async (c) => {
    console.log('[Chat API] Validation passed');
    const body = c.req.valid('json');
    console.log('[Chat API] Validated body:', JSON.stringify(body, null, 2));
    const { message, sessionId, channel } = body;
    console.log(`[Chat API] Processing: message="${message}", sessionId=${sessionId}, channel=${channel}`);

    return streamSSE(c, async (stream) => {
      try {
        console.log('[Chat API] Starting SSE stream');

        // Get or create session
        const session = await getOrCreateSession({
          sessionId: sessionId || `web-${Date.now()}`,
          channel,
          userId: 'web-user',
        });

        console.log('[Chat API] Session ready:', session.id);

        // Add user message to session
        session.messages.push({
          role: 'user',
          content: message,
          timestamp: new Date().toISOString(),
        });
        console.log('[Chat API] User message added to session');

        // Save session to disk
        saveSession(session);
        console.log('[Chat API] Session saved after user message');

        // Send session ID
        await stream.writeSSE({
          event: 'session',
          data: JSON.stringify({ sessionId: session.id }),
        });

        console.log('[Chat API] Getting agent');
        const agent = getAgent();

        console.log('[Chat API] Calling agent.chat()');
        const fullResponse = await agent.chat(message, {
          sessionId: session.id,
          loadMemory: true,
          autoRefreshMemory: false,
        });

        console.log('[Chat API] Agent response received, length:', fullResponse.length);

        // Save assistant response to session
        session.messages.push({
          role: 'assistant',
          content: fullResponse,
          timestamp: new Date().toISOString(),
        });
        session.updatedAt = new Date().toISOString();

        // Save session to disk
        saveSession(session);
        console.log('[Chat API] Assistant response saved to session');

        // Send the full response
        await stream.writeSSE({
          event: 'chunk',
          data: JSON.stringify({ chunk: fullResponse, index: 0 }),
        });

        console.log('[Chat API] Chunk sent');

        // Send completion event
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({ response: fullResponse }),
        });

        console.log('[Chat API] SSE stream complete');

      } catch (error) {
        console.error('[Chat API] Error in SSE stream:', error);
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            error: true,
            message: error instanceof Error ? error.message : 'Unknown error',
          }),
        });
      }
    });
  })

  // Get chat sessions
  .get('/sessions', async (c) => {
    console.log('[Chat API] GET /sessions');
    const { listSessions } = await import('../../../session');
    const sessions = listSessions();

    return c.json({
      sessions: sessions.map(s => ({
        id: s.id,
        channel: s.channel,
        messageCount: s.messages.length,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        summary: s.summary,
      })),
      total: sessions.length,
    });
  })

  // Get session history
  .get('/sessions/:id', async (c) => {
    const sessionId = c.req.param('id');
    console.log('[Chat API] GET /sessions/:id', sessionId);
    const { getSession } = await import('../../../session');
    const session = getSession(sessionId);

    if (!session) {
      return c.json({ error: 'Not found', message: 'Session not found' }, 404);
    }

    return c.json({
      session: {
        id: session.id,
        channel: session.channel,
        messages: session.messages,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        summary: session.summary,
      },
    });
  })

  // Delete session
  .delete('/sessions/:id', async (c) => {
    const sessionId = c.req.param('id');
    console.log('[Chat API] DELETE /sessions/:id', sessionId);
    const { deleteSession } = await import('../../../session');
    const success = deleteSession(sessionId);

    if (!success) {
      return c.json({ error: 'Not found', message: 'Session not found' }, 404);
    }

    return c.json({ success: true, message: 'Session deleted' });
  });
