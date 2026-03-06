#!/usr/bin/env bun
import { readFileSync, writeFileSync, readdirSync, statSync, from 'fs';
import { join } from 'path';

const filesToProcess = [
  'src/tools/builtin.ts',
  'src/agent/index.ts',
  'src/app/index.ts',
  'src/subagent/runtime.ts',
  'src/session/index.ts',
  'src/memory/index.ts',
  'src/agent/api.ts',
  'src/feishu/ws-client.ts',
  'src/proactive/job-handlers.ts',
  'src/proactive/daemon.ts',
];

