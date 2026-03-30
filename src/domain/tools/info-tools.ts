/**
 * Info Tools — Beeclaw System Info
 *
 * Extracted from builtin.ts for modular organization.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../../infra/observability/logger';
import { getConfig } from '../../infra/config';
import type { BuiltinToolResult } from './builtin';

// ============================================================================
// Beeclaw System Info Tool
// ============================================================================

export const beeclawInfoTool = {
  name: 'beeclaw_info',
  description: 'Get Beeclaw system information including version, runtime environment, and capabilities. Use this to understand what version of Beeclaw is running and its current configuration.',
  parameters: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
};

export async function executeBeeclawInfo(): Promise<BuiltinToolResult> {
  try {
    // Read version from package.json
    const packageJsonPath = join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

    // Get runtime info
    const runtime = {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptime: Math.floor(process.uptime()),
    };

    // Get config info (if available)
    let configInfo: string | Record<string, unknown> = 'Not loaded';
    try {
      const config = getConfig();
      if (config) {
        configInfo = {
          provider: config.providers?.[0]?.type || 'unknown',
          model: config.agent?.role || 'unknown',
          timezone: config.user?.timezone || 'Asia/Shanghai',
          daemonEnabled: false,
        };
      }
    } catch (error) {
      logger.debug('Failed to get config info:', error);
    }

    const result = `# Beeclaw System Information

## Version
**Beeclaw**: v${packageJson.version}
**Description**: ${packageJson.description}

## Runtime Environment
**Node Version**: ${runtime.nodeVersion}
**Platform**: ${runtime.platform}
**Architecture**: ${runtime.arch}
**Process ID**: ${runtime.pid}
**Uptime**: ${runtime.uptime} seconds

## Configuration
\`\`\`json
${JSON.stringify(configInfo, null, 2)}
\`\`\`

## Capabilities
- ✅ Multi-provider AI support (OpenAI, Anthropic, Zhipu, MiniMax)
- ✅ Persistent memory system with compression
- ✅ Skill management with testing and evaluation
- ✅ Proactive task scheduling
- ✅ Feishu/Lark bot integration
- ✅ MCP (Model Context Protocol) support
- ✅ Multi-channel support (CLI, Feishu, Webhook)

---
*Running Beeclaw v${packageJson.version}*`;

    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get Beeclaw info: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}
