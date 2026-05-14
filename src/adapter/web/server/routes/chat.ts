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

        const session = await getOrCreateSession({
          sessionId: sessionId || `web-${Date.now()}`,
          channel,
          userId: 'web-user',
        });

        session.messages.push({
          role: 'user',
          content: message,
          timestamp: new Date().toISOString(),
        });
        saveSession(session);

        await stream.writeSSE({
          event: 'session',
          data: JSON.stringify({ sessionId: session.id }),
        });

        const agent = getAgent();

        // Stream the response token-by-token via the chatStream() async
        // generator. The previous implementation called the synchronous
        // `agent.chat()` and emitted the entire response in one final
        // 'chunk' event — visually identical to a non-streaming POST,
        // even though the SSE plumbing was already in place.
        //
        // Each yielded `content` event accumulates into `cumulative`;
        // we send the cumulative text per yield so the existing client
        // (which does `lastMsg.content = parsed.chunk`) renders the
        // partial response without any client changes.
        let cumulative = '';
        const toolCalls: Array<{ name: string; params: Record<string, unknown>; result?: unknown }> = [];

        for await (const ev of agent.chatStream(message)) {
          if (ev.type === 'content') {
            cumulative += ev.content;
            await stream.writeSSE({
              event: 'chunk',
              data: JSON.stringify({ chunk: cumulative }),
            });
          } else if (ev.type === 'tool_call') {
            toolCalls.push({ name: ev.name, params: ev.params });
            await stream.writeSSE({
              event: 'tool_call',
              data: JSON.stringify({ name: ev.name, params: ev.params }),
            });
          } else if (ev.type === 'tool_result') {
            // Pair with the most recent unresolved call of the same name.
            const pending = [...toolCalls].reverse().find(t => t.name === ev.name && t.result === undefined);
            if (pending) pending.result = ev.result;
            // Truncate large results before serializing — SSE frames over
            // ~8KB are a common cause of client decoder lag.
            const resultStr = typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result);
            const preview = resultStr.length > 1000 ? resultStr.slice(0, 1000) + '… [truncated]' : resultStr;
            await stream.writeSSE({
              event: 'tool_result',
              data: JSON.stringify({ name: ev.name, result: preview }),
            });
          }
        }

        logger.debug('[Chat API] Agent stream complete, length:', cumulative.length);

        // Convert internal stream-event tool shape into the OpenAI
        // ChatCompletionMessageToolCall format the session schema expects.
        const sessionToolCalls = toolCalls.length > 0
          ? toolCalls.map((t, i) => ({
              id: `web-${session.id}-${i}`,
              type: 'function' as const,
              function: {
                name: t.name,
                arguments: JSON.stringify(t.params),
              },
            }))
          : undefined;

        session.messages.push({
          role: 'assistant',
          content: cumulative,
          timestamp: new Date().toISOString(),
          toolCalls: sessionToolCalls,
        });
        session.updatedAt = new Date().toISOString();
        saveSession(session);

        // Backward-compat: existing client also listens for `tool_calls`
        // aggregated event at the end. Keep emitting it so prior client
        // builds still get the toolCalls field on the saved message.
        if (toolCalls.length > 0) {
          await stream.writeSSE({
            event: 'tool_calls',
            data: JSON.stringify({ toolCalls }),
          });
        }

        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({ response: cumulative }),
        });

      } catch (error) {
        logger.error('[Chat API] Error in SSE stream:', error);
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
