# Feishu SDK to feishu-cli Migration Progress

## Phase 1: Infrastructure Setup ✅ COMPLETE

### Completed Tasks

1. **CLI Runner Implementation** (`src/adapter/feishu/cli-runner.ts`)
   - ✅ Core `FeishuCLIRunner` class with process execution
   - ✅ JSON output parsing
   - ✅ Timeout handling with process cleanup
   - ✅ Retry logic with exponential backoff
   - ✅ Error classification and normalization
   - ✅ Binary availability checking
   - ✅ Singleton instance management
   - ✅ User access token support

2. **CLI Response Types** (`src/adapter/feishu/cli-types.ts`)
   - ✅ Zod schemas for CLI command outputs
   - ✅ Type mapping functions (CLI → existing types)
   - ✅ Drive types (file list, file metadata, upload response)
   - ✅ Wiki types (spaces, nodes)
   - ✅ Calendar types (calendars, events)
   - ✅ Document types (blocks)
   - ✅ Bitable types (tables, records)

3. **Configuration Schema Updates** (`src/infra/config/schema.ts`)
   - ✅ Added `mode` field (sdk/cli/hybrid)
   - ✅ Added `cliPath` field (default: 'feishu')
   - ✅ Added `cliTimeout` field (default: 30000ms)
   - ✅ Added `cliRetries` field (default: 2)
   - ✅ Added `toolMode` field for per-tool overrides
   - ✅ Backward compatible with existing SDK configuration

4. **Exports Updates** (`src/adapter/feishu/index.ts`)
   - ✅ Export `FeishuCLIRunner` and related types
   - ✅ Export CLI response types and schemas
   - ✅ Maintain backward compatibility

5. **Tool Executor Updates** (`src/domain/agent/index.ts`)
   - ✅ Import `getConfig` and `getFeishuCLIRunner`
   - ✅ Implement mode detection (sdk/cli/hybrid)
   - ✅ Route to CLI runner or SDK client based on mode
   - ✅ Support per-tool mode override via `toolMode` config
   - ✅ Maintain error handling and auth card support

6. **Tests**
   - ✅ Unit tests for CLI runner (`src/adapter/feishu/__tests__/cli-runner.test.ts`)
     - 12 passing tests covering all core functionality
   - ✅ Integration tests template (`tests/integration/feishu-cli.test.ts`)
     - Tests for CLI availability, authentication, and command execution

### Test Results

```bash
bun test src/adapter/feishu/__tests__/cli-runner.test.ts
# 12 pass
# 0 fail
# 16 expect() calls
```

---

## Phase 2: Migrate Simple Tools 🚧 IN PROGRESS

### Next Steps

1. **Update Drive Tools** (`src/adapter/feishu/tools/drive.ts`)
   - [ ] Refactor tool functions to accept `Client | FeishuCLIRunner`
   - [ ] Implement CLI execution paths for each tool:
     - `listFiles` → `feishu file list`
     - `getFileInfo` → `feishu file get`
     - `createFolder` → `feishu file mkdir`
     - `createDocument` → `feishu doc create`
     - `uploadFile` → `feishu file upload`
     - `downloadFile` → `feishu file download`
     - `moveFile` → `feishu file move`
     - `copyFile` → `feishu file copy`
     - `deleteFile` → `feishu file delete`

2. **Update Wiki Tools** (`src/adapter/feishu/tools/wiki.ts`)
   - [ ] Refactor tool functions to accept `Client | FeishuCLIRunner`
   - [ ] Implement CLI execution paths for each tool:
     - `listSpaces` → `feishu wiki spaces`
     - `getSpaceInfo` → `feishu wiki space-get`
     - `listNodes` → `feishu wiki nodes`
     - `createPage` → `feishu wiki create`
     - `moveNode` → `feishu wiki move`
     - `deleteNode` → `feishu wiki delete`

3. **Testing**
   - [ ] Port existing drive tool tests to mock CLI runner
   - [ ] Port existing wiki tool tests to mock CLI runner
   - [ ] Integration tests with real CLI (optional)
   - [ ] Performance benchmarks (SDK vs CLI latency)

---

## Phase 3: Migrate Complex Tools (Not Started)

### Calendar Tools
- [ ] Investigate CLI support for user access tokens
- [ ] Implement hybrid mode for calendar tools
- [ ] Update `calendar.ts` to support CLI

### Document Tools
- [ ] Implement Markdown ↔ Feishu document conversion
- [ ] Update `docx.ts` to support CLI
- [ ] Test block structure mapping

### Bitable Tools
- [ ] Update `bitable.ts` to support CLI
- [ ] Test record operations

---

## Phase 4: Remove SDK Dependency (Not Started)

### Cleanup Tasks
- [ ] Search for remaining SDK imports
- [ ] Remove SDK client initialization
- [ ] Update exports to remove SDK client
- [ ] Remove `@larksuiteoapi/node-sdk` from package.json
- [ ] Update documentation
- [ ] Create migration guide

---

## Configuration Example

```json
{
  "feishu": {
    "enabled": true,
    "mode": "cli",
    "cliPath": "/usr/local/bin/feishu",
    "cliTimeout": 30000,
    "cliRetries": 2,
    "appId": "${FEISHU_APP_ID}",
    "appSecret": "${FEISHU_APP_SECRET}",
    "toolMode": {
      "feishu_calendar_event_create": "sdk"
    }
  }
}
```

---

## Key Decisions

1. **Hybrid Mode Support**: Configuration allows per-tool mode override for gradual migration
2. **Backward Compatibility**: Default mode is 'sdk', existing deployments continue working
3. **Error Normalization**: CLI errors are mapped to SDK-like error types for consistency
4. **Process Management**: Uses `Bun.spawn()` for CLI execution with proper timeout handling
5. **Retry Strategy**: Exponential backoff for transient failures (rate limits, timeouts)

---

## Performance Targets

- CLI overhead: < 200ms per tool call
- Test coverage: > 80%
- Zero breaking changes to tool interface

---

## Next Action

Start Phase 2 by migrating `drive.ts` tools as the reference implementation.

See: `/Users/tanghao/workspace/beeclaw/docs/migration/feishu-cli-drive-migration.md` (to be created)
