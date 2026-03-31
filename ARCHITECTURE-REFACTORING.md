# Architecture Refactoring Plan

> **Status**: In Progress — Phase 1-2 substantially complete. Phase 3-4 partially done.
> **Last Updated**: 2026-03-31

**Priority**: Medium-term improvement
**Risk Level**: High (requires careful migration)

---

## Progress Summary

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1: Preparation | Interface definitions | ✅ Complete |
| Phase 2: Agent Layer | Port interfaces + DI | ✅ Substantially complete |
| Phase 3: Session Layer | Eliminate reverse deps | 🔄 In progress |
| Phase 4: Store Manager | Module extraction | 🔄 Partial |
| Phase 5: Testing | Validation | ⏳ Pending |

### What's Been Done

1. **Port Layer (`domain/ports/`)**: `IHookRunner`, `IMCPManager`, `IPluginRegistry`, `IChannelClient`, `IMessageController` interfaces defined and registered.
2. **Agent refactoring**: `ToolDispatcher`, `TokenBudgetManager`, `SkillRunner`, `MemoryManager` extracted from Agent god-object.
3. **Session layer**: `getConfig_()` reverse dependency on `app/` eliminated (2026-03-31). Config now injected via `initSessionManager({ feishuConfig })`.
4. **`bootstrap-stores.ts`**, **`bootstrap-health.ts`** extracted from `app/index.ts`.
5. **Feishu message format unified**: All outbound Feishu messages (proactive, recovery, reminder) now use Card V2 via `registerCardV2Renderer()` pattern.

### What Remains

- `app/index.ts` still 900+ lines — needs further split into `bootstrap-agent.ts`, `bootstrap-plugins.ts`, `bootstrap-mcp.ts`
- `agent/index.ts` still 1750+ lines — `chat()` / `chatStream()` need extraction into `ConversationLoop`
- Legacy `hooks/runner.ts` still used by `app/index.ts` — migrate to `createHookRunner(registry)`
- Global singletons still prevalent — consider DI container

---

## Problem Statement

The codebase has several architectural layer violations that violate Clean Architecture principles:

### Domain → Adapter Violations

| File | Violation | Status |
|------|-----------|--------|
| `domain/agent/index.ts` | Was importing `adapter/mcp`, `adapter/plugins` | ✅ Fixed via Port layer |
| `domain/session/index.ts` | Was importing `app/index.ts` (`getConfig_`) | ✅ Fixed (2026-03-31) |
| `domain/session/index.ts` | Was importing `adapter/feishu` StreamingController | ✅ Fixed via Port `IMessageController` |
| `domain/subagent/registry.ts` | Was importing `adapter/plugins` | ✅ Fixed via Port `IPluginRegistry` |

### Remaining Issues

| File | Issue | Priority |
|------|-------|----------|
| `app/index.ts` | God Module (928 lines) | P1 |
| `domain/agent/index.ts` | God Object (1758 lines) | P1 |
| `adapter/plugins/hooks/runner.ts` | Legacy singleton still used | P2 |
| Multiple modules | Global singletons | P2 |

---

## References

- [Clean Architecture by Robert C. Martin](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [Dependency Inversion Principle](https://en.wikipedia.org/wiki/Dependency_inversion_principle)
- [Historical Review Report](./docs/historical/REVIEW-REPORT-v2.1.3-legacy.md) — For context on original issues
