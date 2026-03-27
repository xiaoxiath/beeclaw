---
name: human-in-the-loop
description: "Guide for Human-in-the-Loop (HITL) interactions - requesting user confirmation or input before proceeding. **CRITICAL: Use this skill whenever:**
- Planning destructive operations (file deletion, database drops, force pushes)
- Considering irreversible actions (overwriting files, sending messages, deploying to production)
- Encountering high-risk commands (system modifications, credential changes, bulk operations)
- Accessing sensitive data (credentials, personal information, production databases)
- Facing ambiguous requirements (multiple valid approaches, unclear user intent)
- Making critical decisions (architecture choices, breaking changes, security settings)
- Tool returns needsConfirmation: true or needsUserInput: true
- User asks about 'confirmation', 'approval', 'permission', 'HITL', 'human in the loop'

**DO NOT proceed without user confirmation in these scenarios.** This skill ensures safe, user-aligned execution."
tags: [hitl, confirmation, approval, safety, user-interaction]
version: 1.0.0
---

# Human-in-the-Loop (HITL) Interaction Guide

This skill provides comprehensive guidance on when and how to request user confirmation or input before proceeding with actions. HITL is a critical safety and alignment mechanism that prevents unintended consequences and ensures actions match user intent.

## Core Principles

### Why HITL Matters

Human-in-the-loop interactions serve three essential purposes:

1. **Safety** - Prevent destructive, irreversible, or high-impact operations from executing without explicit approval
2. **Alignment** - Ensure actions match user intent, especially when multiple approaches exist
3. **Transparency** - Keep users informed and in control of critical decisions

**The golden rule:** When in doubt, ask. It's better to request confirmation for a safe operation than to proceed without asking on a dangerous one.

### Risk Level Classification

Classify operations by risk level to determine HITL requirements:

| Risk Level | Examples | HITL Required | Timing |
|------------|----------|---------------|--------|
| **Critical** | Deleting files, dropping databases, production deployments | **ALWAYS** | Before any action |
| **High** | Overwriting files, sending messages, modifying configs | **ALWAYS** | Before modification |
| **Medium** | Installing packages, creating resources, multi-step operations | **Recommended** | Before execution |
| **Low** | Reading files, listing directories, searching | **Optional** | Only if ambiguous |

**Risk escalation:** If uncertain about risk level, treat it as higher risk and ask.

## When to Request User Confirmation

### 1. Destructive Operations

**Always confirm before:**

- Deleting files or directories (`rm -rf`, `fs.rm`)
- Dropping databases or tables
- Removing git branches or tags
- Clearing caches or logs
- Truncating data structures
- Uninstalling packages or dependencies

**Example confirmation:**
```
I'm about to delete the following files:
- /path/to/old-config.json
- /path/to/temp-cache/

This action cannot be undone. Should I proceed?
```

### 2. Irreversible Actions

**Always confirm before:**

- Overwriting existing files (especially without backup)
- Sending messages, emails, or notifications
- Deploying to production environments
- Publishing packages or releases
- Committing and pushing to shared branches
- Modifying production databases
- Changing system configurations

**Example confirmation:**
```
I'm about to overwrite /config/app.json with new settings.
Current file will be lost. Should I:
1. Create backup first, then overwrite
2. Overwrite directly
3. Cancel
```

### 3. High-Risk Commands

**Always confirm before:**

- `git push --force` or `git reset --hard`
- System-level installations (`sudo` operations)
- Modifying environment variables or credentials
- Running scripts from untrusted sources
- Bulk operations affecting multiple resources
- Network-level changes (firewall rules, routing)
- Security-related changes (permissions, access control)

**Example confirmation:**
```
You've requested a force push to main branch.
This will rewrite history and may disrupt other developers.

Force push: origin/main ← local/main

Are you sure? Type "confirm force push" to proceed.
```

### 4. Sensitive Data Access

**Always confirm before:**

- Reading credential files (.env, credentials.json, secrets)
- Accessing production databases
- Viewing personal information (PII)
- Listing API keys or tokens
- Exporting sensitive data

**Example confirmation:**
```
I need to read .env to check the database configuration.
This file may contain sensitive credentials.

Should I:
1. Read the entire file
2. Read only specific variables (specify which)
3. Skip and proceed with assumptions
```

## When to Ask User Questions

### 1. Ambiguous Information

**Ask questions when:**

- Multiple valid approaches exist for the same goal
- User request can be interpreted in different ways
- Missing critical information that affects the outcome
- Context is insufficient to make a confident decision

**Example question:**
```
I can implement the authentication in several ways:
1. JWT tokens (stateless, scalable)
2. Session-based (simpler, server-side storage)
3. OAuth integration (third-party auth)

Which approach fits your needs?
```

### 2. Multiple Approaches

**Ask questions when:**

- Different implementations have different tradeoffs
- User hasn't specified preference between options
- Choice affects performance, security, or maintainability
- No clear "best" option without user context

**Example question:**
```
For the data migration, I can:
1. Migrate in-place (faster, but locks tables)
2. Migrate to new tables then swap (safer, but needs 2x storage)
3. Migrate incrementally (slowest, but zero downtime)

What's your priority: speed, safety, or availability?
```

### 3. Critical Decisions

**Ask questions when:**

- Architecture choices that are hard to reverse
- Security-related configurations
- Breaking changes that affect existing functionality
- Cost or resource implications
- Third-party service selections

**Example question:**
```
You're choosing between AWS and GCP for deployment.
This affects:
- Pricing model (AWS: reserved instances, GCP: sustained use discounts)
- Services available (AWS: more mature, GCP: better Kubernetes support)
- Team expertise (affects learning curve)

Which provider aligns with your priorities?
```

## HITL Implementation for Tool Developers

### Tool Return Structure

Tools can request HITL by returning specific flags:

```typescript
interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;

  // HITL flags
  needsConfirmation?: boolean;
  confirmationMessage?: string;
  needsUserInput?: boolean;
  inputPrompt?: string;
  inputOptions?: string[];
}
```

### Using needsConfirmation

**When to use:** Tool is about to perform a destructive/irreversible operation.

**Example:**
```typescript
// In tool executor
if (fileExists && !force) {
  return {
    success: false,
    needsConfirmation: true,
    confirmationMessage: `File ${path} already exists. Overwrite?`,
    output: `File exists: ${path}\nSize: ${stats.size} bytes\nModified: ${stats.mtime}`
  };
}
```

**Agent behavior:** Agent will ask user for confirmation before retrying with appropriate flags.

### Using needsUserInput

**When to use:** Tool needs additional information or choice from user.

**Example:**
```typescript
// In tool executor
const matchingFiles = await searchFiles(pattern);

if (matchingFiles.length > 5) {
  return {
    success: false,
    needsUserInput: true,
    inputPrompt: `Found ${matchingFiles.length} files matching "${pattern}". Which one?`,
    inputOptions: matchingFiles.slice(0, 10).map(f => f.path),
    output: `Multiple matches found:\n${matchingFiles.map(f => `- ${f.path}`).join('\n')}`
  };
}
```

**Agent behavior:** Agent will ask user to choose or provide input.

### Best Practices for Tool Developers

1. **Provide context in confirmation messages:**
   ```typescript
   // Bad
   confirmationMessage: "Proceed?"

   // Good
   confirmationMessage: `About to delete ${count} files in ${directory}. This cannot be undone. Proceed?`
   ```

2. **Include relevant information:**
   ```typescript
   output: `File: ${path}
   Size: ${size}
   Modified: ${modified}
   Owner: ${owner}
   Permissions: ${perms}`
   ```

3. **Offer options when possible:**
   ```typescript
   inputOptions: [
     "Overwrite existing",
     "Create backup first",
     "Skip this file",
     "Cancel operation"
   ]
   ```

4. **Be specific about impact:**
   ```typescript
   confirmationMessage: `This will affect:
   - ${fileCount} files
   - ${userCount} users
   - Estimated time: ${estimatedTime}

   Proceed with operation?`
   ```

## HITL Implementation for Agents

### Using ask_user_question Tool

**When to use:** Agent needs to ask user for input or decision.

**Example usage:**
```typescript
// Agent calls tool
await useTool("ask_user_question", {
  question: "Which database migration strategy?",
  context: "I need to migrate 10GB of data with minimal downtime",
  options: [
    "Migrate in-place (faster, locks tables)",
    "Migrate to new tables then swap (safer, needs 2x storage)",
    "Migrate incrementally (slowest, zero downtime)"
  ]
});
```

**Best practices:**
- Provide clear context for why the question is needed
- Offer concrete options when possible
- Explain tradeoffs of each option
- Allow "other" or custom input when appropriate

### Confirmation Flow Pattern

**Standard pattern:**
```
1. Identify operation needs confirmation
2. Present clear summary of what will happen
3. Explain impact and risks
4. Ask for explicit confirmation
5. Proceed only if confirmed
6. Report outcome
```

**Example:**
```
I'm about to deploy to production. Here's what will happen:

**Deployment Summary:**
- Environment: production
- Version: v2.3.1
- Services: api-server, web-ui, worker
- Estimated downtime: 2-5 minutes

**Risks:**
- Database migration may take additional time
- Existing sessions will be invalidated
- CDN cache will be cleared

**Rollback plan:**
- Previous version: v2.3.0
- Rollback command: `deploy rollback v2.3.0`

Do you want to proceed with deployment?
```

## HITL and Card V2 Interactive Buttons

Beeclaw supports interactive buttons through Card V2 for streamlined HITL interactions.

### Button Types

1. **Confirmation buttons** - Yes/No, Confirm/Cancel
2. **Option buttons** - Multiple choice selection
3. **Input buttons** - Trigger text input dialogs

**Example Card V2 HITL flow:**
```typescript
// Tool returns structured data for Card V2 rendering
{
  success: false,
  needsConfirmation: true,
  confirmationMessage: "Deploy to production?",
  cardData: {
    blocks: [
      { type: "header", text: "Deployment Confirmation" },
      { type: "text", text: "Version v2.3.1 to production" },
      { type: "actions", buttons: [
        { text: "Confirm", style: "primary", action: "confirm" },
        { text: "Cancel", style: "default", action: "cancel" }
      ]}
    ]
  }
}
```

**User interaction:** User clicks button → Action sent back to agent → Agent proceeds accordingly.

## Risk Mitigation Strategies

### Defense in Depth

Combine multiple safety mechanisms:

1. **HITL confirmation** - User explicitly approves
2. **Dry-run preview** - Show what will happen without executing
3. **Backup creation** - Preserve state before modification
4. **Rollback plan** - Document how to undo changes
5. **Gradual rollout** - Test on subset before full deployment

**Example combined approach:**
```
Before running the migration, I'll:
1. Create database backup (automatic rollback point)
2. Run migration in dry-run mode (preview changes)
3. Ask for your confirmation
4. Execute migration
5. Verify results
6. Offer rollback if issues detected

Starting with backup creation...
```

### Context-Aware Confirmation

Adjust confirmation detail based on context:

**High-context situations** (experienced user, routine operation):
- Brief confirmation: "Deploy v2.3.1 to production?"
- Quick decision, minimal friction

**Low-context situations** (new user, first-time operation):
- Detailed confirmation: Full summary, risks, rollback plan
- Educational, builds understanding

**Detect context from:**
- User's history with similar operations
- Environment (development vs. production)
- Time since last similar action
- User's explicit preferences

## Common Mistakes to Avoid

### 1. Over-Confirming

**Problem:** Asking for confirmation on every trivial operation creates friction and trains users to auto-approve.

**Solution:** Reserve confirmation for genuine risk:
```typescript
// Bad
needsConfirmation: true,
confirmationMessage: "Read file config.json?"

// Good
// No confirmation for read operations
// Confirm before overwriting config.json
```

### 2. Under-Informing

**Problem:** Vague confirmations don't help users make informed decisions.

**Solution:** Provide actionable context:
```typescript
// Bad
confirmationMessage: "Proceed with operation?"

// Good
confirmationMessage: `Delete ${fileCount} files in ${directory}?
Total size: ${totalSize}
Oldest: ${oldestFile}
Newest: ${newestFile}
This cannot be undone.`
```

### 3. No Escape Hatch

**Problem:** Confirmations with only "proceed" option trap users.

**Solution:** Always offer alternatives:
```typescript
inputOptions: [
  "Overwrite existing",
  "Create backup first",
  "Skip this file",
  "Cancel operation"
]
```

### 4. Confirming After the Fact

**Problem:** Asking for confirmation after irreversible action has started.

**Solution:** Confirm before taking action:
```typescript
// Bad
await deleteFiles();
return { needsConfirmation: true, confirmationMessage: "Files deleted. OK?" }

// Good
return { needsConfirmation: true, confirmationMessage: "Delete files?" }
// Only delete after confirmation received
```

### 5. Ignoring Risk Context

**Problem:** Same confirmation for development and production environments.

**Solution:** Adjust urgency based on environment:
```typescript
const env = process.env.NODE_ENV;
const riskPrefix = env === 'production'
  ? "⚠️ PRODUCTION - CRITICAL OPERATION"
  : "Development environment";

confirmationMessage: `${riskPrefix}\n\nDeploy version ${version}?`
```

## HITL Workflow Examples

### Example 1: File Overwrite

```
Agent: I need to update the configuration file. Current file:
```
# Current config.json
{
  "apiUrl": "https://old-api.example.com",
  "timeout": 5000
}
```

New configuration:
```
{
  "apiUrl": "https://new-api.example.com",
  "timeout": 10000,
  "retries": 3
}
```

Changes:
- apiUrl: old-api → new-api
- timeout: 5000ms → 10000ms
- Added: retries = 3

Should I:
1. Overwrite directly
2. Create backup (config.json.backup) then overwrite
3. Show diff first
4. Cancel
```

### Example 2: Database Migration

```
Agent: Ready to run database migration v20260320.

**Migration details:**
- Add column `last_login_at` to users table
- Create index on `users.email`
- Estimated time: 30 seconds
- Tables affected: users (10,000 rows)

**Impact:**
- Read-only mode during migration
- Existing sessions continue to work
- New logins will wait for migration to complete

**Rollback plan:**
- Migration v20260320_rollback available
- Command: `migrate rollback v20260320`
- Rollback time: ~10 seconds

Proceed with migration?
```

### Example 3: Production Deployment

```
Agent: I've prepared deployment for review.

**Deployment Summary:**
- Branch: main
- Commit: a1b2c3d "feat: add user authentication"
- Services: api (3 replicas), web (2 replicas), worker (1 replica)
- Environment: production

**Changes since last deployment:**
- JWT authentication implementation
- Session management endpoints
- Password reset flow
- Rate limiting on auth endpoints

**Pre-deployment checks:**
✓ All tests passing
✓ No security vulnerabilities detected
✓ Database migrations ready
✓ Environment variables configured
✓ Rollback plan documented

**Deployment strategy:**
- Rolling update (zero downtime)
- Health check: /health endpoint
- Rollback trigger: 3 consecutive health check failures

Ready to deploy? Confirm to proceed.
```

### Example 4: Ambiguous Request

```
User: Make the API faster

Agent: I can improve API performance in several ways. What's your priority?

**Options:**
1. **Add caching** - Cache frequent queries (Redis)
   - Impact: 10-100x faster for cached requests
   - Cost: Additional Redis server (~$50/month)
   - Tradeoff: Slightly stale data possible

2. **Optimize database queries** - Add indexes, rewrite queries
   - Impact: 2-5x faster for all requests
   - Cost: Development time (2-3 days)
   - Tradeoff: More complex queries to maintain

3. **Add CDN** - Serve static assets from edge locations
   - Impact: 5-10x faster for static content
   - Cost: CDN charges (~$20-100/month based on traffic)
   - Tradeoff: Cache invalidation complexity

4. **Implement rate limiting** - Reduce load from abusive clients
   - Impact: More consistent performance
   - Cost: Minimal
   - Tradeoff: Some legitimate requests may be throttled

Which approach should I prioritize?
```

## Integration with Beeclaw Systems

### Memory Integration

Record HITL decisions for future reference:

```typescript
// After user confirms a pattern, record it
await memory_write({
  category: "decisions",
  content: `User preference: Always create backup before overwriting config files`,
  tags: ["hitl", "backup", "configuration"]
});
```

### Skill Integration

Skills can trigger HITL for specialized scenarios:

```markdown
## Deployment Skill

Before deploying:
1. Run pre-deployment checks
2. Generate deployment summary
3. Request user confirmation via HITL
4. Proceed with deployment if confirmed
```

### Subagent Integration

Subagents should escalate to HITL for critical decisions:

```typescript
// Subagent encounters critical decision
if (risk === 'critical') {
  // Escalate to parent agent for HITL
  return {
    needsUserInput: true,
    inputPrompt: "Subagent requires approval for critical operation",
    context: fullContextForDecision
  };
}
```

## Quick Reference

### HITL Decision Tree

```
Operation needs HITL?
│
├─ Is it destructive? → YES → Always confirm
│
├─ Is it irreversible? → YES → Always confirm
│
├─ Is it high-risk? → YES → Always confirm
│
├─ Does it access sensitive data? → YES → Confirm access
│
├─ Is it ambiguous? → YES → Ask clarifying question
│
├─ Are there multiple approaches? → YES → Ask for preference
│
└─ Is it a critical decision? → YES → Ask for confirmation
```

### Confirmation Message Template

```markdown
**[Operation Type]**: [Brief description]

**What will happen:**
- [Action 1]
- [Action 2]
- [Action 3]

**Impact:**
- [Affected resource 1]
- [Affected resource 2]

**Risks:**
- [Risk 1]
- [Risk 2]

**Alternatives:**
1. [Option 1]
2. [Option 2]
3. [Cancel]

[Confirm] [Cancel]
```

### Question Prompt Template

```markdown
**Question**: [Clear question]

**Context**: [Why you're asking]

**Options:**
1. **[Option 1]** - [Description + tradeoffs]
2. **[Option 2]** - [Description + tradeoffs]
3. **[Option 3]** - [Description + tradeoffs]

Which option do you prefer?
```

## Summary

Human-in-the-loop is not bureaucracy—it's safety and alignment. Use HITL to:

- **Prevent disasters** by confirming destructive operations
- **Ensure alignment** by clarifying ambiguous requests
- **Build trust** by keeping users informed and in control
- **Enable learning** by understanding user preferences

**Remember:** Every confirmation is an opportunity to verify understanding and prevent unintended consequences. When in doubt, ask.
