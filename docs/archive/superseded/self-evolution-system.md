# Beeclaw Self-Evolution System

## Overview

**Goal**: Enable Beeclaw to autonomously modify its own source code through Claude Code, test changes safely, and deploy with zero downtime and automatic rollback capabilities.

**Why This Matters**:
- Currently, Beeclaw can only evolve behaviorally (skills, memory, preferences)
- Source code improvements require manual intervention
- No automated testing or deployment pipeline exists
- AI-driven feature addition and self-improvement capability

**Current System State**:
- ✅ Claude Code CLI integration exists (`claude_code` tool)
- ✅ Mature skill system with runtime modification
- ✅ Behavioral evolution (SOUL.md, preferences, lessons)
- ✅ Task queue with persistence
- ❌ **No source code modification** (restricted to safe directories)
- ❌ **No automated testing/validation**
- ❌ **No deployment mechanism** (manual restart only)
- ❌ **No rollback capability**
- ❌ **No process manager** (single Bun process)

---

## Architecture

### Pipeline Overview

```
┌─────────────────────────────────────────────────────────────┐
│              Self-Evolution Pipeline                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  User Request → [1. Propose] → [2. Test] → [3. Deploy]     │
│                      ↓             ↓             ↓          │
│              Git Worktree    Validation    Watchdog         │
│              Isolation       Pipeline       Process         │
│                      ↓             ↓             ↓          │
│              [Snapshot System + Rollback Mechanism]         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

#### 1. Git Worktree Isolation
- Create isolated worktree for each change: `.worktrees/evolution-<id>/`
- Symlink `data/` and `beeclaw.json` to share state
- Test changes in isolation without affecting main codebase
- Archive completed worktrees for history

#### 2. Validation Pipeline
- TypeScript compilation (`bun run tsc --noEmit`)
- Unit tests (`bun test`)
- Type checking with strict mode
- Linting (warnings allowed)
- Integration tests (optional but recommended)

#### 3. Graceful Deployment (Bun-native, no PM2)
- Create snapshot (git commit + state export)
- Drain queues (complete active jobs, pause new ones)
- Persist state (sessions, schedules, queue state)
- Merge worktree to main branch
- Graceful shutdown (SIGTERM)
- **Watchdog process** detects shutdown and restarts with `--restore` flag
- Restore state on startup

#### 4. Automatic Rollback
- Monitor health for 60s post-deployment
- Auto-rollback if bot crashes or health checks fail
- Detect restart loops (3+ failures in 5 minutes)
- Restore from last successful snapshot
- Log rollback metrics for learning

#### 5. Safety Mechanisms
- Path whitelist (allowed: `src/agent/**`, `src/utils/**`, `src/tools/**`)
- Path blacklist (forbidden: `src/config/**`, `.env`, `beeclaw.json`)
- Change size limits (100KB per file, 10KB total diff)
- Risk assessment scoring (0-100)
- Auto-approve low-risk (score ≤20), require approval for higher

---

## Implementation Phases

### Phase 1: Foundation (2-3 weeks)

**Goal**: Basic self-modification with manual approval and restart

**Components to Build**:

1. **Worktree Manager** (`src/evolution/worktree.ts`)
   - Create isolated git worktree
   - Manage symlinks to shared resources
   - Merge back to main branch
   - Archive completed worktrees

2. **Code Modifier** (`src/evolution/code-modifier.ts`)
   - Wrap existing `claude_code` tool
   - Execute in worktree context
   - Validate file paths against whitelist
   - Check change size limits

3. **Test Runner** (`src/evolution/test-runner.ts`)
   - Run TypeScript compilation
   - Execute unit tests
   - Type checking
   - Linting (optional)

4. **Snapshot System** (`src/evolution/snapshot.ts`)
   - Create git commit snapshot
   - Export queue state
   - Export session cache
   - Export schedules
   - Save to `data/snapshots/<id>/`

5. **Safety Checker** (`src/evolution/safety.ts`)
   - Path whitelist/blacklist validation
   - Change size limits
   - Risk score calculation
   - Approval requirement determination

**Deliverables**:
- Can propose code changes through Claude Code
- Can test changes in isolated worktree
- Can create snapshots before deployment
- Manual deployment (user runs deploy command)
- Manual rollback (user runs rollback command)

**Safety**:
- All changes require manual approval
- Only allow modifications to whitelisted paths
- Manual restart required

**Files to Create**:
```
src/evolution/
├── worktree.ts           # Git worktree management
├── code-modifier.ts      # Claude Code wrapper
├── test-runner.ts        # Validation pipeline
├── snapshot.ts           # Snapshot creation/loading
├── safety.ts             # Safety checker
└── types.ts              # Type definitions
```

**Integration Points**:
- `src/tools/builtin.ts` - Add evolution tools (propose, test, snapshot)
- No changes to bot.ts yet (manual restart)

---

### Phase 2: Enhanced Safety (2-3 weeks)

**Goal**: Automatic rollback and graceful restart

**Components to Build**:

1. **Watchdog Process** (`src/evolution/watchdog.ts`)
   - Monitor bot process health
   - Detect shutdown and restart
   - Handle `--restore` flag
   - Implement health checks (heartbeat file)

2. **State Manager** (`src/evolution/state-manager.ts`)
   - Export queue state to JSON
   - Export active sessions
   - Export schedules
   - Import on restart with `--restore`

3. **Rollback Manager** (`src/evolution/rollback.ts`)
   - Load snapshot
   - Restore git commit
   - Restore state files
   - Handle state conflicts

4. **Graceful Deployer** (`src/evolution/deployer.ts`)
   - Notify pending restart
   - Persist state
   - Drain queues (wait max 30s)
   - Save sessions
   - Merge worktree
   - Write restart manifest
   - Trigger SIGTERM

**Integration Changes**:

1. **Bot Entry Point** (`src/bot.ts`)
   - Add `--restore` flag support
   - On restore: load state from snapshot
   - Graceful shutdown handlers (already exist)
   - Health heartbeat (write to `data/.health` every 30s)

2. **Queue Manager** (`src/queue/manager.ts`)
   - Add `exportState()` method
   - Add `importState()` method
   - Add `pauseQueue()` / `resumeQueue()` methods

3. **Session Manager** (`src/session/index.ts`)
   - Add `exportAllSessions()` function
   - Add `importSessions()` function

**Deliverables**:
- Automatic rollback on deployment failure
- Zero state loss during restart
- Process monitoring and auto-restart
- Health check system

**Files to Create**:
```
src/evolution/
├── watchdog.ts           # Process watchdog
├── state-manager.ts      # State persistence
├── rollback.ts           # Rollback management
└── deployer.ts           # Graceful deployment
```

**Files to Modify**:
```
src/bot.ts                # Add --restore flag, health heartbeat
src/queue/manager.ts      # Add state export/import
src/session/index.ts      # Add session export/import
```

---

### Phase 3: Full Automation (3-4 weeks)

**Goal**: Autonomous evolution with intelligent proposals

**Components to Build**:

1. **Evolution Orchestrator** (`src/evolution/orchestrator.ts`)
   - Coordinate all evolution components
   - Manage proposal lifecycle
   - Schedule executions
   - Track metrics

2. **Code Proposer** (`src/evolution/code-proposer.ts`)
   - Analyze error patterns
   - Detect improvement opportunities
   - Generate structured proposals
   - AI-driven suggestions

3. **Approval System** (`src/evolution/approval.ts`)
   - Queue proposals for review
   - Auto-approve low-risk changes
   - Request user approval for medium/high risk
   - Track approval history

4. **Evolution CLI** (`src/evolution/cli.ts`)
   - `/evolution propose "description"`
   - `/evolution list`
   - `/evolution approve <id>`
   - `/evolution status`
   - `/snapshot list`
   - `/snapshot rollback <id>`

5. **Metrics Dashboard** (`src/evolution/metrics.ts`)
   - Track success/failure rates
   - Monitor deployment duration
   - Rollback frequency
   - Risk score accuracy

**Deliverables**:
- Fully automated evolution pipeline
- AI-driven improvement suggestions
- Intelligent auto-approval
- Comprehensive monitoring

**Files to Create**:
```
src/evolution/
├── orchestrator.ts       # Main coordinator
├── code-proposer.ts      # AI-driven proposals
├── approval.ts           # Approval workflow
├── cli.ts                # Evolution commands
└── metrics.ts            # Performance tracking
```

---

## Critical Files and Reuse Opportunities

### Existing Code to Reuse

**1. Claude Code Integration**
- **File**: `src/tools/builtin.ts` (lines 741-830)
- **What**: `claude_code` tool already wraps CLI
- **Reuse**: Call from code-modifier with worktree path

**2. Task Queue System**
- **File**: `src/queue/manager.ts`
- **What**: Bunqueue with SQLite persistence
- **Reuse**: Add state export/import methods

**3. Session Persistence**
- **File**: `src/session/index.ts`
- **What**: Already persists to `data/memory/sessions/`
- **Reuse**: Add export/import for snapshots

**4. Daemon Mode**
- **File**: `src/proactive/daemon.ts`
- **What**: Scheduler with state persistence
- **Reuse**: Add schedule export/import

**5. Graceful Shutdown**
- **File**: `src/bot.ts` (lines 193-196)
- **What**: SIGINT/SIGTERM handlers
- **Reuse**: Extend to persist state before exit

### New Files to Create

**Phase 1** (Foundation):
```
src/evolution/
├── types.ts              # Type definitions
├── worktree.ts           # Git worktree management
├── code-modifier.ts      # Claude Code wrapper
├── test-runner.ts        # Validation pipeline
├── snapshot.ts           # Snapshot system
└── safety.ts             # Safety checker
```

**Phase 2** (Enhanced Safety):
```
src/evolution/
├── watchdog.ts           # Process monitoring
├── state-manager.ts      # State persistence
├── rollback.ts           # Rollback system
└── deployer.ts           # Graceful deployment
```

**Phase 3** (Full Automation):
```
src/evolution/
├── orchestrator.ts       # Main coordinator
├── code-proposer.ts      # AI proposals
├── approval.ts           # Approval workflow
├── cli.ts                # CLI commands
└── metrics.ts            # Metrics tracking
```

---

## Safety Strategy

### Path Restrictions

**Allowed** (auto-modification OK):
- `src/agent/**` - Agent logic
- `src/utils/**` - Utility functions
- `src/tools/**` - Tool implementations
- `src/search/**` - Search functionality
- `src/memory/**` - Memory tools
- `src/skills/**` - Skill tools

**Forbidden** (require manual approval):
- `src/config/**` - Configuration loading
- `src/feishu/**` - External integrations
- `.env` - Environment variables
- `beeclaw.json` - Main config file
- `data/memory/SOUL.md` - Core identity

### Risk Assessment

**Scoring System** (0-100):
- 0-20: **Low risk** → Auto-approve
- 21-50: **Medium risk** → Require user approval
- 51-100: **High risk** → Require manual review + approval

**Risk Factors**:
- Change size (+10-30 points)
- Multiple files (+20 points)
- Critical areas (+25 points)
- No tests included (+15 points)
- Adds dependencies (+20 points)

### Multiple Safety Nets

1. **Worktree Isolation** - Test without affecting main code
2. **Validation Pipeline** - Catch errors before deployment
3. **Snapshot System** - Backup before every change
4. **Watchdog Process** - Monitor and auto-restart
5. **Health Checks** - Verify success post-deployment
6. **Auto-Rollback** - Recover from failures automatically

---

## Verification Plan

### Phase 1 Testing

**Test 1: Worktree Creation**
```bash
# Create worktree
bun run cli
> /evolution propose "Add test utility function"

# Verify worktree created
ls .worktrees/evolution-*/
# Should show: src/, data@ (symlink), beeclaw.json@ (symlink)
```

**Test 2: Code Modification**
```bash
# Apply changes via Claude Code
> /evolution execute <id>

# Verify changes in worktree
cd .worktrees/evolution-<id>
git diff
# Should show proposed changes
```

**Test 3: Validation**
```bash
# Run validation pipeline
> /evolution test <id>

# Should see:
# ✓ TypeScript compilation
# ✓ Type checking
# ✓ Unit tests
# ⚠ Linting (warnings OK)
```

**Test 4: Snapshot Creation**
```bash
# Create snapshot
> /snapshot create

# Verify snapshot
ls data/snapshots/snap-*/
# Should show: snapshot.json, queue-state.json, sessions.json
```

### Phase 2 Testing

**Test 5: Graceful Deployment**
```bash
# Deploy change
> /evolution deploy <id>

# Observe:
# - Queues pausing
# - Active jobs completing
# - State saving
# - Bot shutting down
# - Watchdog restarting bot
# - State restoring
# - Queues resuming
```

**Test 6: Automatic Rollback**
```bash
# Deploy broken change
> /evolution deploy <bad-id>

# Observe:
# - Bot crashes on startup
# - Watchdog detects failure
# - Auto-rollback triggered
# - Bot restarts with last snapshot
# - System recovers
```

**Test 7: State Persistence**
```bash
# Start with active sessions
> Create multiple chat sessions

# Deploy change
> /evolution deploy <id>

# Verify after restart:
# - All sessions restored
# - Queue jobs resumed
# - Schedules intact
```

### Phase 3 Testing

**Test 8: End-to-End Evolution**
```bash
# User request
User: "Add a tool to generate QR codes for URLs"

# System automatically:
[Evolution] Analyzing request...
[Evolution] Risk: LOW (score: 15)
[Evolution] Auto-approved
[Evolution] Creating worktree...
[Evolution] Applying changes via Claude Code...
[Evolution] Running tests... ✓
[Evolution] Creating snapshot...
[Evolution] Deploying...
[Evolution] Monitoring health... ✓
[Evolution] ✓ Complete!

# Verify:
- New tool exists
- Tests pass
- Bot running
- No downtime
```

**Test 9: Risk-Based Approval**
```bash
# High-risk change
User: "Refactor the entire config system"

[Evolution] Analyzing request...
[Evolution] Risk: HIGH (score: 65)
[Evolution] Requires approval
[Evolution] Created proposal: PROP-20260301-001

# User reviews
> /evolution list
> /evolution approve PROP-20260301-001

# Then executes
```

---

## Configuration

Add to `beeclaw.json`:

```json
{
  "evolution": {
    "enabled": true,
    "mode": "semi-automatic",
    "safety": {
      "allowedPaths": [
        "src/agent/**",
        "src/utils/**",
        "src/tools/**",
        "src/search/**",
        "src/memory/**",
        "src/skills/**"
      ],
      "forbiddenPaths": [
        "src/config/**",
        "src/feishu/**",
        ".env",
        "beeclaw.json",
        "data/memory/SOUL.md"
      ],
      "maxFileSize": 102400,
      "maxTotalChanges": 10240,
      "autoApproveThreshold": 20
    },
    "worktrees": {
      "directory": ".worktrees",
      "maxAge": 7,
      "maxCount": 10
    },
    "snapshots": {
      "directory": "data/snapshots",
      "retentionDays": 30,
      "maxCount": 50
    },
    "deployment": {
      "gracePeriodMs": 30000,
      "healthCheckDurationMs": 60000
    },
    "rollback": {
      "autoRollbackEnabled": true,
      "failureThreshold": 3,
      "failureWindowMs": 300000
    }
  }
}
```

---

## Success Criteria

### Phase 1 Success
- ✅ Can create isolated worktree
- ✅ Can modify code via Claude Code
- ✅ Can run validation (tests pass)
- ✅ Can create/restore snapshots manually

### Phase 2 Success
- ✅ Can deploy with zero state loss
- ✅ Automatic rollback on failure
- ✅ Bot restarts automatically
- ✅ Health monitoring works

### Phase 3 Success
- ✅ Can propose improvements autonomously
- ✅ Auto-approves low-risk changes
- ✅ End-to-end evolution works
- ✅ 95%+ success rate on deployments

---

## Risk Mitigation

**Risk 1: Broken Deployment**
- Mitigation: Snapshot system + auto-rollback
- Recovery: < 2 minutes

**Risk 2: State Loss**
- Mitigation: Multi-layer persistence (queue, sessions, schedules)
- Recovery: Restore from snapshot

**Risk 3: Runaway Evolution**
- Mitigation: Approval workflow + risk limits
- Override: Manual disable switch

**Risk 4: Performance Degradation**
- Mitigation: Validation pipeline catches regressions
- Monitoring: Track deployment duration metrics

---

## Next Steps

1. **Review this plan** - Ensure it meets requirements
2. **Prioritize phases** - Phase 1 is minimum viable
3. **Start implementation** - Begin with worktree manager
4. **Iterate** - Test thoroughly before proceeding to next phase
