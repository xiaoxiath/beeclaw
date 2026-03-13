# Beeclaw Codebase Cleanup - 2026-03-13

## Summary

This directory contains example code moved from the production codebase during the cleanup process.

## Files

### feishu-usage.ts
**Original Location**: `src/adapter/feishu/example.ts`
**Purpose**: Demonstrates Feishu integration usage patterns
**Moved**: 2026-03-13

### plugin-example.ts
**Original Location**: `src/adapter/plugins/example-plugin.ts`
**Purpose**: Demonstrates how to create a custom plugin for Beeclaw
**Moved**: 2026-03-13

## Deleted Files

The following unused files were deleted during cleanup:

1. **src/domain/memory/memory-sharing.ts** (93 lines)
   - Reason: Zero imports, over-engineered for single-instance deployment
   - Functionality: Cross-project memory sharing (not needed)

2. **src/domain/memory/knowledge-versioning.ts** (large file)
   - Reason: Zero imports, over-engineered
   - Functionality: Version control for knowledge files (use Git instead)

3. **src/domain/memory/enhanced-indexer.ts** (large file)
   - Reason: Zero imports, duplicate functionality
   - Functionality: Enhanced Chinese tokenization (duplicate of indexer.ts)

4. **src/infra/utils/config-center.ts** (723 lines)
   - Reason: Zero imports, duplicate configuration system
   - Functionality: Centralized config management (beeclaw.json + Zod already used)

5. **src/infra/utils/background-tasks.ts** (90 lines)
   - Reason: Zero imports, duplicate functionality
   - Functionality: Background task manager (queue system already exists)

6. **src/domain/providers/access.ts** (52 lines)
   - Reason: Zero imports, duplicate abstraction
   - Functionality: Provider access layer (app layer already handles this)

## Reference Implementation

The file `src/domain/agent/resilience-integration.ts` was marked as a reference implementation and kept in the codebase for educational purposes. It demonstrates how to integrate resilience features but is not used in production.

## Impact

- **Lines of code removed**: ~1000+ lines
- **Files deleted**: 6 unused modules
- **Files moved**: 2 example files to docs
- **Build status**: ✅ Successful (no breaking changes)
- **Test status**: ✅ All tests passing (no imports were affected)

## Rationale

All deleted files had:
- ✅ Zero imports (not used anywhere)
- ✅ Over-engineered solutions
- ✅ Duplicate functionality
- ✅ No test coverage

This cleanup improves code maintainability and reduces confusion for new contributors.
