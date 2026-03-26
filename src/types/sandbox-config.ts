/**
 * Sandbox Configuration Schema (Shared)
 *
 * Extracted to src/types/ to avoid layering violations between
 * infra/config/schema.ts and domain/sandbox/types.ts.
 * Both layers re-export from here.
 */

import { z } from 'zod';

export const SandboxConfigSchema = z.object({
  /** Enable sandbox system */
  enabled: z.boolean().default(true),
  /** Default provider to use */
  provider: z.enum(['local', 'docker', 'auto']).default('auto'),
  /** Workspace base directory */
  workspaceBase: z.string().default('./data/sandbox'),

  /** Local provider config */
  local: z.object({
    /** Enable local provider */
    enabled: z.boolean().default(true),
    /** Default execution timeout (ms) */
    defaultTimeout: z.number().min(1000).max(300000).default(30000),
    /** Maximum output size (bytes) */
    maxOutputSize: z.number().min(1024).max(10485760).default(1048576), // 1MB
    /** Blocked commands (regex patterns) */
    blockedCommands: z.array(z.string()).default([
      'rm\\s+-rf\\s+/',
      'mkfs',
      'dd\\s+if=',
      ':(){ :|:& };:',   // fork bomb
      'chmod\\s+-R\\s+777\\s+/',
      'shutdown',
      'reboot',
      'halt',
      'init\\s+0',
    ]),
    /** Allowed commands (if set, only these are allowed) */
    allowedCommands: z.array(z.string()).optional(),
  }).default({}),

  /** Docker provider config */
  docker: z.object({
    /** Enable Docker provider */
    enabled: z.boolean().default(false),
    /** Docker image to use */
    image: z.string().default('beeclaw-sandbox:latest'),
    /** Memory limit in MB */
    memoryLimitMb: z.number().min(64).max(8192).default(512),
    /** CPU limit (fraction, e.g., 1.0 = 1 core) */
    cpuLimit: z.number().min(0.1).max(4).default(1),
    /** Enable network in containers */
    networkEnabled: z.boolean().default(false),
    /** Default execution timeout (ms) */
    defaultTimeout: z.number().min(1000).max(600000).default(60000),
    /** Maximum output size (bytes) */
    maxOutputSize: z.number().min(1024).max(10485760).default(2097152), // 2MB
    /** Container idle timeout before recycling (ms) */
    idleTimeout: z.number().min(30000).max(3600000).default(300000), // 5min
    /** Docker socket path */
    socketPath: z.string().optional(),
  }).default({}),

  /** Container pool config */
  pool: z.object({
    /** Enable container pool (pre-warm) */
    enabled: z.boolean().default(false),
    /** Minimum idle containers to keep warm */
    minIdle: z.number().min(0).max(10).default(1),
    /** Maximum total containers */
    maxTotal: z.number().min(1).max(20).default(5),
    /** How often to check pool health (ms) */
    healthCheckInterval: z.number().min(10000).max(300000).default(60000),
  }).default({}),
});

export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;
