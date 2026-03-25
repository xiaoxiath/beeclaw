import { Hono } from 'hono';
import { logger } from '../../../../infra/observability/logger';
import { listSessions, getSession } from '@/domain/session';

export default new Hono()
  // List all sessions
  .get('/', async (c) => {
    logger.debug('[Sessions API] GET /');
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

  // Get session details
  .get('/:id', async (c) => {
    const sessionId = c.req.param('id');
    logger.debug('[Sessions API] GET /:id', sessionId);

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

  // Get DAG execution data for session
  .get('/:id/dag', async (c) => {
    const sessionId = c.req.param('id');
    logger.debug('[Sessions API] GET /:id/dag', sessionId);

    const session = getSession(sessionId);

    if (!session) {
      return c.json({ error: 'Not found', message: 'Session not found' }, 404);
    }

    // Extract DAG data from session messages
    // DAG data is typically in tool calls within assistant messages
    const dagNodes: any[] = [];
    const dagEdges: any[] = [];
    let nodeIndex = 0;

    session.messages.forEach((message, _messageIndex) => {
      if (message.role === 'assistant' && (message as any).toolCalls) {
        const toolCalls = (message as any).toolCalls;
        toolCalls.forEach((toolCall: any) => {
          const nodeId = `node-${nodeIndex++}`;
          dagNodes.push({
            id: nodeId,
            type: 'task',
            data: {
              label: toolCall.function?.name || 'Unknown Tool',
              arguments: toolCall.function?.arguments,
              status: 'completed',
              timestamp: message.timestamp,
            },
            position: { x: 100, y: nodeIndex * 100 },
          });

          // Add edges from previous tool calls
          if (nodeIndex > 1) {
            dagEdges.push({
              id: `edge-${nodeIndex - 2}-${nodeIndex - 1}`,
              source: `node-${nodeIndex - 2}`,
              target: nodeId,
            });
          }
        });
      }
    });

    // Return empty DAG if no tool calls found
    return c.json({
      sessionId,
      nodes: dagNodes,
      edges: dagEdges,
    });
  });
