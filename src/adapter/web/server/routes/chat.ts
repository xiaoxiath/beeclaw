import { Hono } from 'hono';
import { logger } from '../../../../infra/observability/logger';
import { streamSSE } from 'hono/streaming';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getAgent } from '@/app';
import { getOrCreateSession, getSession, saveSession, listSessions, deleteSession } from '@/domain/session';

const sendMessageSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional().nullable(), // Allow null from frontend
  channel: z.enum(['cli', 'feishu', 'webhook', 'api', 'web']).default('web'),
});

logger.debug('[Chat API] Schema loaded - allowed channels:', ['cli', 'feishu', 'webhook', 'api', 'web']);

export default new Hono()
  // Send message with SSE streaming
  .post('/', async (c, next) => {
    logger.debug('[Chat API] ===== NEW REQUEST =====');
    logger.debug('[Chat API] Content-Type:', c.req.header('Content-Type'));

    try {
      const body = await c.req.json();
      logger.debug('[Chat API] Request body:', JSON.stringify(body, null, 2));
      logger.debug('[Chat API] Body has message:', 'message' in body);
      logger.debug('[Chat API] Body has sessionId:', 'sessionId' in body);
      logger.debug('[Chat API] Body has channel:', 'channel' in body, '- value:', body.channel);
    } catch (e) {
      console.error('[Chat API] Failed to parse request body:', e);
    }

    return next();
  }, zValidator('json', sendMessageSchema), async (c) => {
    logger.debug('[Chat API] Validation passed');
    const body = c.req.valid('json');
    logger.debug('[Chat API] Validated body:', JSON.stringify(body, null, 2));
    const { message, sessionId, channel } = body;
    logger.debug(`[Chat API] Processing: message="${message}", sessionId=${sessionId}, channel=${channel}`);

    return streamSSE(c, async (stream) => {
      try {
        logger.debug('[Chat API] Starting SSE stream');

        // Get or create session
        const session = await getOrCreateSession({
          sessionId: sessionId || `web-${Date.now()}`,
          channel,
          userId: 'web-user',
        });

        logger.debug('[Chat API] Session ready:', session.id);

        // Add user message to session
        session.messages.push({
          role: 'user',
          content: message,
          timestamp: new Date().toISOString(),
        });
        logger.debug('[Chat API] User message added to session');

        // Save session to disk
        saveSession(session);
        logger.debug('[Chat API] Session saved after user message');

        // Send session ID
        await stream.writeSSE({
          event: 'session',
          data: JSON.stringify({ sessionId: session.id }),
        });

        logger.debug('[Chat API] Getting agent');
        const agent = getAgent();

        // Collect tool calls during streaming
        const _collectedToolCalls: any[] = [];

        logger.debug('[Chat API] Calling agent.chat()');
        const fullResponse = await agent.chat(message, {
          sessionId: session.id,
          loadMemory: true,
          autoRefreshMemory: false,
          onToolCall: (name, _params) => {
            logger.debug('[Chat API] Tool call:', name);
          },
          onToolResult: (name, _result) => {
            logger.debug('[Chat API] Tool result:', name);
          },
        });

        logger.debug('[Chat API] Agent response received, length:', fullResponse.length);

        // Get tool calls from agent and save to session
        const toolCalls = agent.getLastToolCalls();
        logger.debug('[Chat API] Tool calls from agent:', toolCalls?.length || 0);

        // Save assistant response to session
        session.messages.push({
          role: 'assistant',
          content: fullResponse,
          timestamp: new Date().toISOString(),
          toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
        });
        session.updatedAt = new Date().toISOString();

        // Save session to disk
        saveSession(session);
        logger.debug('[Chat API] Assistant response saved to session');

        // Send tool calls if any
        if (toolCalls && toolCalls.length > 0) {
          await stream.writeSSE({
            event: 'tool_calls',
            data: JSON.stringify({ toolCalls }),
          });
          logger.debug('[Chat API] Tool calls sent');
        }

        // Send the full response
        await stream.writeSSE({
          event: 'chunk',
          data: JSON.stringify({ chunk: fullResponse, index: 0 }),
        });

        logger.debug('[Chat API] Chunk sent');

        // Send completion event
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({ response: fullResponse }),
        });

        logger.debug('[Chat API] SSE stream complete');

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
    logger.debug('[Chat API] GET /sessions');
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
    logger.debug('[Chat API] GET /sessions/:id', sessionId);
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
    logger.debug('[Chat API] DELETE /sessions/:id', sessionId);
    const success = deleteSession(sessionId);

    if (!success) {
      return c.json({ error: 'Not found', message: 'Session not found' }, 404);
    }

    return c.json({ success: true, message: 'Session deleted' });
  });
