import { Hono } from 'hono';
import { logger } from '../../../../infra/observability/logger';
import { listSessions, getSession } from '@/domain/session';

/**
 * B-P1-05: Ownership verification helper.
 * Extracts userId from the request context (header or auth) and checks
 * whether the session belongs to the requesting user.
 * Returns the userId string, or null if not authenticated.
 */
function getUserIdFromContext(c: any): string | null {
  // Try common auth header patterns
  return (
    c.req.header('x-user-id') ||
    c.get?.('userId') ||
    c.req.header('x-authenticated-user') ||
    null
  );
}

/**
 * B-P1-05: Check if the requesting user owns the session.
 * If the session has a channel/userId association, verify it matches.
 */
function verifyOwnership(session: any, userId: string | null): boolean {
  // If no userId in request, deny access (unauthenticated)
  if (!userId) return false;

  // If session has an owner/userId, verify match
  const sessionOwner = session.userId || session.metadata?.userId || session.channel?.userId;
  if (sessionOwner && sessionOwner !== userId) {
    return false;
  }

  return true;
}

export default new Hono()
  // List all sessions
  .get('/', async (c) => {
    logger.debug('[Sessions API] GET /');
    const userId = getUserIdFromContext(c);
    const allSessions = listSessions();

    // B-P1-05: Filter sessions to only those owned by the requesting user
    const sessions = userId
      ? allSessions.filter(s => {
          const owner = (s as any).userId || (s as any).metadata?.userId || (s as any).channel?.userId;
          return !owner || owner === userId;
        })
      : allSessions;

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

    // B-P1-05: Ownership check
    const userId = getUserIdFromContext(c);
    if (!verifyOwnership(session, userId)) {
      logger.warn(`[Sessions API] Ownership check failed: user=${userId}, session=${sessionId}`);
      return c.json({ error: 'Forbidden', message: 'Access denied' }, 403);
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

    // B-P1-05: Ownership check
    const userId = getUserIdFromContext(c);
    if (!verifyOwnership(session, userId)) {
      logger.warn(`[Sessions API] Ownership check failed: user=${userId}, session=${sessionId}`);
      return c.json({ error: 'Forbidden', message: 'Access denied' }, 403);
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
