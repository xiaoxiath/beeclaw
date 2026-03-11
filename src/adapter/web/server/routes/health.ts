import { Hono } from 'hono';

export default new Hono()
  .get('/', (c) => {
    return c.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.2.1',
    });
  });
