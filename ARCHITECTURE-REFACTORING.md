# Architecture Refactoring Plan

> **Status**: Planning — All phases pending, no work has started yet.

**Priority**: Medium-term improvement
**Risk Level**: High (requires careful migration)

---

## Problem Statement

The codebase has several architectural layer violations that violate Clean Architecture principles:

### Domain → Adapter Violations

The Domain layer should not depend on the Adapter layer, but currently does:

| File | Violation | Impact |
|------|-----------|--------|
| `domain/agent/index.ts` | Imports `adapter/mcp`, `adapter/plugins` | Agent cannot be tested in isolation |
| `domain/session/index.ts` | Imports `adapter/feishu`, `adapter/plugins` | Session manager coupled to Feishu |
| `domain/subagent/registry.ts` | Imports `adapter/plugins` | Subagent cannot be reused |

**Root Cause**: Domain logic directly instantiates adapter implementations instead of receiving them via dependency injection.

### Infra → Domain Violations

The Infrastructure layer should not depend on the Domain layer:

| File | Violation | Impact |
|------|-----------|--------|
| `infra/db/store.ts` | Imports 7 domain modules | Store manager is actually an initialization orchestrator |
| `infra/config/schema.ts` | Imports `domain/sandbox/types` | Schema depends on domain types |

**Root Cause**: `infra/db/store.ts` is misnamed - it's actually an application-layer initialization module.

---

## Proposed Solutions

### 1. Dependency Inversion for MCP/Plugins

**Current**:
```typescript
// domain/agent/index.ts
import { getMCPManager } from '../../adapter/mcp';

export async function chat() {
  const mcpManager = getMCPManager();
  // ...
}
```

**Proposed**:
```typescript
// domain/agent/types.ts
export interface IMCPManager {
  getTools(): Promise<OpenAITool[]>;
  // ...
}

// domain/agent/index.ts
export async function chat(mcpManager: IMCPManager) {
  const tools = await mcpManager.getTools();
  // ...
}

// app/index.ts
const mcpManager = getMCPManager();
const agent = createAgent({ mcpManager });
```

**Benefits**:
- Agent becomes testable with mock MCP manager
- Clear separation of concerns
- Domain layer pure and reusable

### 2. Move infra/db/store.ts to app/layer

**Current Structure**:
```
infra/db/store.ts  (imports domain/*)
```

**Proposed Structure**:
```
app/initialization/store-manager.ts  (orchestrates domain stores)
infra/db/connection.ts  (pure database connection)
```

**Migration Steps**:
1. Create `app/initialization/store-manager.ts`
2. Move store initialization logic from `infra/db/store.ts`
3. Keep only DB connection logic in `infra/db/`
4. Update all imports

### 3. Extract Feishu-Specific Logic from Session

**Current**:
```typescript
// domain/session/index.ts
import { StreamingMessageController } from '../../adapter/feishu/card-v2';
```

**Proposed**:
```typescript
// domain/session/types.ts
export interface ISessionUIController {
  sendThinking?(sessionId: string): Promise<void>;
  updateMessage(sessionId: string, content: string): Promise<void>;
}

// domain/session/index.ts
export function initSessionManager(config: {
  uiController?: ISessionUIController;
}) {
  // ...
}

// adapter/feishu/session-ui-adapter.ts
export class FeishuSessionUIAdapter implements ISessionUIController {
  async sendThinking(sessionId: string) {
    // Feishu-specific implementation
  }
}
```

---

## Migration Strategy

### Phase 1: Preparation (Week 1-2)
- [ ] Create interface definitions for all adapters
- [ ] Set up dependency injection container (optional: use tsyringe or inversify)
- [ ] Create adapter test mocks

### Phase 2: Agent Layer Refactoring (Week 3-4)
- [ ] Extract `IMCPManager` interface
- [ ] Extract `IPluginRegistry` interface
- [ ] Inject dependencies into `createAgent()`
- [ ] Update all agent callers

### Phase 3: Session Layer Refactoring (Week 5-6)
- [ ] Extract `ISessionUIController` interface
- [ ] Create `FeishuSessionUIAdapter`
- [ ] Inject UI controller into session manager
- [ ] Update session initialization

### Phase 4: Store Manager Migration (Week 7)
- [ ] Move `infra/db/store.ts` to `app/initialization/`
- [ ] Rename to `store-manager.ts`
- [ ] Keep only connection logic in `infra/db/`
- [ ] Update imports across codebase

### Phase 5: Testing & Validation (Week 8)
- [ ] Add unit tests for domain layer (now possible without adapters)
- [ ] Integration tests for dependency injection
- [ ] Regression testing
- [ ] Performance benchmarks

---

## Risks & Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking existing functionality | Comprehensive test coverage before migration |
| Large diff size | Migrate incrementally, one module at a time |
| Team unfamiliar with DI patterns | Training session + code examples |
| Circular dependency introduction | Use `madge --circular` in CI |

---

## Success Metrics

- [ ] Zero domain → adapter imports
- [ ] Zero infra → domain imports (except types)
- [ ] Domain layer 100% testable in isolation
- [ ] All adapter implementations mockable
- [ ] No circular dependencies detected by `madge`

---

## Timeline

**Total Duration**: 8 weeks
**Start Date**: TBD - Pending team discussion
**Completion Target**: TBD - Pending team discussion

**Milestones**:
- Week 2: Interface definitions complete
- Week 4: Agent layer refactored
- Week 6: Session layer refactored
- Week 7: Store manager migrated
- Week 8: Testing & validation complete

---

## References

- [Clean Architecture by Robert C. Martin](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [Dependency Inversion Principle](https://en.wikipedia.org/wiki/Dependency_inversion_principle)
- [REVIEW-REPORT.md](./REVIEW-REPORT.md) - Section: 七、架构问题汇总
