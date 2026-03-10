import { hc } from 'hono/client';
import type { ApiType } from '../../server';

// Create Hono RPC client with type inference
export const api = hc<ApiType>('/');
