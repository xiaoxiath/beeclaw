import { hc } from 'hono/client';
import type { ApiType } from '../../server';

// Create Hono RPC client with type inference
// Cast through unknown to avoid type resolution issues in client build
export const api = hc<ApiType>('/') as unknown as {
  api: {
    skills: {
      $get: () => Promise<Response>;
      ':name': {
        toggle: {
          $post: (args: { param: { name: string } }) => Promise<Response>;
        };
        $delete: (args: { param: { name: string } }) => Promise<Response>;
      };
    };
    stats: {
      $get: () => Promise<Response>;
    };
    auth: {
      me: {
        $get: () => Promise<Response>;
      };
      logout: {
        $post: () => Promise<Response>;
      };
    };
  };
};
