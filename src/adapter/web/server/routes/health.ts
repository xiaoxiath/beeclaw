import { Hono } from 'hono';
import { readFileSync } from 'fs';
import { resolve } from 'path';

let appVersion = 'unknown';
try { appVersion = JSON.parse(readFileSync(resolve(import.meta.dir ?? __dirname, '../../../../package.json'), 'utf-8')).version; } catch {}

export default new Hono()
  .get('/', (c) => {
    return c.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: appVersion,
    });
  });
