---
name: human-in-the-loop
description: Best practices for Human-in-the-Loop (HITL) interactions - when and how to request user confirmation and input
maturity: mature
tags: [interaction, confirmation, user-input, safety]
---

# Human-in-the-Loop Interaction Guide

## 📋 Overview

Human-in-the-Loop (HITL) is a critical safety and collaboration mechanism that allows the AI agent to request user confirmation or input before proceeding with certain actions. This skill provides guidance on when and how to use HITL effectively.

## 🎯 When to Request Confirmation

### Always Request User Confirmation For:

1. **Destructive Operations**
   - Deleting files or directories
   - Dropping databases or tables
   - Removing user accounts
   - Clearing caches or logs

2. **Irreversible Actions**
   - Sending emails or messages to external users
   - Deploying to production environments
   - Modifying system configurations
   - Committing to git repositories

3. **High-Risk Commands**
   - Shell execution with `sudo` or root privileges
   - Running untrusted scripts
   - Executing commands that affect system state
   - Network operations (opening ports, changing firewall rules)

4. **Sensitive Data Access**
   - Reading credentials or secrets
   - Accessing personal or private data
   - Viewing configuration files with sensitive information
   - Exporting data to external locations

### Example Confirmation Scenarios

```
✅ GOOD: Request confirmation
User: "Delete all temporary files"
Agent: "I'm about to execute: rm -rf /tmp/*. This will permanently delete all temporary files. Do you want to proceed?"
[✅ Approve] [❌ Deny]

✅ GOOD: Request confirmation
User: "Deploy to production"
Agent: "I'm about to deploy the current version to production. This action is irreversible. Proceed?"
[✅ Approve] [❌ Deny]

❌ BAD: No confirmation for high-risk operation
User: "Delete the database"
Agent: [Deletes database immediately]  # WRONG! Should request confirmation
```

## 🤔 When to Ask User Questions

### Ask Questions When:

1. **Information is Ambiguous**
   - Multiple interpretations of user request
   - Unclear which tool or approach to use
   - Missing required parameters

2. **Multiple Valid Approaches Exist**
   - Trade-offs between speed vs. safety
   - Different implementation strategies
   - User preference matters

3. **Critical Decision Points**
   - Choosing between options with different consequences
   - Selecting which files or resources to affect
   - Determining scope of operation

### Example Question Scenarios

```
✅ GOOD: Ask for clarification
User: "Fix the bug"
Agent: "I found 3 potential bugs. Which one would you like me to fix?"
Options:
  1. Null pointer exception in login.ts
  2. Memory leak in data-processing.ts
  3. Type error in validation.ts

✅ GOOD: Ask for preference
User: "Optimize the code"
Agent: "There are two optimization strategies available. Which do you prefer?"
Options:
  1. Speed optimization (faster execution, more memory)
  2. Memory optimization (slower execution, less memory)

❌ BAD: Proceed without asking
User: "Fix the bug"
Agent: [Fixes wrong bug]  # WRONG! Should ask which bug to fix
```

## 🛠️ How to Use HITL

### For Tool Developers

If you're developing a tool that needs confirmation, return the appropriate flags:

#### Request Confirmation

```typescript
// In tool executor
export async function executeDangerousTool(params: any): Promise<ToolResult> {
  // Check if operation is high-risk
  if (isHighRisk(params)) {
    return {
      success: false,
      needsConfirmation: true,
      riskLevel: 'high',  // 'low' | 'medium' | 'high' | 'critical'
      confirmationMessage: `About to execute: ${params.command}`,
      timeoutMs: 60000,  // Optional: confirmation timeout
    };
  }

  // Proceed with normal execution
  // ...
}
```

#### Request User Input

```typescript
export async function executeWithUserChoice(params: any): Promise<ToolResult> {
  // Need user input to proceed
  return {
    success: false,
    needsUserInput: true,
    question: 'Which file should I use?',
    options: ['file1.txt', 'file2.txt', 'file3.txt'],
    inputType: 'choice',  // 'text' | 'choice' | 'multi_choice' | 'confirmation'
    context: 'Multiple files match the pattern',
  };
}
```

### For Agent

When you encounter ambiguity or need user input, use the `ask_user_question` tool:

#### Ask for Text Input

```json
{
  "name": "ask_user_question",
  "parameters": {
    "question": "What name should I use for the new file?",
    "inputType": "text",
    "context": "I need a filename to create the file"
  }
}
```

#### Ask for Single Choice

```json
{
  "name": "ask_user_question",
  "parameters": {
    "question": "Which deployment strategy should I use?",
    "options": [
      "Blue-Green (safer, requires more resources)",
      "Rolling (faster, requires less resources)",
      "Canary (gradual, best for testing)"
    ],
    "inputType": "choice",
    "context": "Each strategy has different trade-offs"
  }
}
```

#### Ask for Multiple Selections

```json
{
  "name": "ask_user_question",
  "parameters": {
    "question": "Which files should I include in the backup?",
    "options": [
      "Configuration files",
      "Log files",
      "Database dumps",
      "User uploads"
    ],
    "inputType": "multi_choice",
    "context": "Select all that apply"
  }
}
```

#### Ask for Confirmation

```json
{
  "name": "ask_user_question",
  "parameters": {
    "question": "Should I proceed with the deployment?",
    "inputType": "confirmation",
    "context": "This will deploy to production"
  }
}
```

## 📊 Risk Level Guidelines

### Risk Level Classification

| Risk Level | Description | Examples | Default Timeout |
|------------|-------------|----------|-----------------|
| **Low** | Minimal impact, easily reversible | Creating temporary files, reading public data | 5 minutes |
| **Medium** | Moderate impact, may require cleanup | Installing packages, modifying user settings | 10 minutes |
| **High** | Significant impact, difficult to reverse | Deploying to staging, modifying system config | 30 minutes |
| **Critical** | Severe impact, irreversible | Deploying to production, deleting databases | 1 hour |

### Risk Assessment Checklist

Before executing an operation, ask yourself:

- [ ] Can this operation be easily undone?
- [ ] Does this affect production systems?
- [ ] Could this result in data loss?
- [ ] Does this require elevated privileges?
- [ ] Could this impact other users or systems?
- [ ] Is this operation time-sensitive?

If you answered "yes" to any of these, request confirmation!

## 🎨 Best Practices

### 1. Provide Clear Context

```
✅ GOOD
"About to delete 15 temporary files in /tmp/project-*. This will free up 50MB of space. Proceed?"

❌ BAD
"Delete files?"  # Too vague
```

### 2. Explain Consequences

```
✅ GOOD
"Deploying to production will:
- Update the live website
- Affect all users immediately
- Cannot be easily rolled back
Proceed?"

❌ BAD
"Deploy?"  # No explanation of consequences
```

### 3. Offer Alternatives

```
✅ GOOD
"This operation is high-risk. Alternatives:
1. Test in staging first
2. Create a backup before proceeding
3. Proceed anyway
What would you like to do?"

❌ BAD
[Approve] [Deny]  # No alternatives offered
```

### 4. Set Appropriate Timeouts

```typescript
// Critical operations: longer timeout
{
  riskLevel: 'critical',
  timeoutMs: 3600000,  // 1 hour
}

// Low-risk operations: shorter timeout
{
  riskLevel: 'low',
  timeoutMs: 300000,  // 5 minutes
}
```

### 5. Use Specific Language

```
✅ GOOD
"Type 'DELETE_ALL' to confirm deletion of all temporary files"

❌ BAD
"Click OK to confirm"  # Too easy to accidentally approve
```

## ⚠️ Common Mistakes

### 1. Over-Confirming

```
❌ BAD: Requesting confirmation for trivial operations
User: "Create a new file"
Agent: "Are you sure you want to create a new file?"  # Unnecessary

✅ GOOD: Only confirm meaningful operations
User: "Delete all files"
Agent: "Confirm deletion of all files?"  # Appropriate
```

### 2. Under-Confirming

```
❌ BAD: Not requesting confirmation for dangerous operations
User: "Clean up the database"
Agent: [Drops all tables]  # WRONG! Should request confirmation

✅ GOOD: Always confirm dangerous operations
User: "Clean up the database"
Agent: "This will permanently delete all tables. Type 'CONFIRM_DELETE' to proceed."
```

### 3. Vague Messages

```
❌ BAD: Unclear confirmation message
"Proceed?"

✅ GOOD: Specific confirmation message
"Delete 15 files in /tmp/ (50MB)? This cannot be undone."
```

### 4. Missing Context

```
❌ BAD: No context for user decision
"Choose option A or B"

✅ GOOD: Explain implications
"Choose deployment strategy:
A) Blue-Green: Safer, requires 2x servers
B) Rolling: Faster, minimal downtime
Which do you prefer?"
```

## 🔄 HITL Flow Examples

### Example 1: File Deletion

```
User: "Delete old log files"
Agent: [Uses file_delete tool]
Tool: {
  needsConfirmation: true,
  riskLevel: 'medium',
  confirmationMessage: 'Found 23 log files older than 30 days (150MB). Delete them?'
}
[Card shows: ⚠️ 需要您的批准]
User: [Clicks ✅ 批准执行]
Agent: [Deletes files]
Agent: "Successfully deleted 23 log files, freed 150MB"
```

### Example 2: Ambiguous Request

```
User: "Fix the test failures"
Agent: [Runs tests, finds 3 failures]
Agent: "I found 3 test failures. Which one should I fix first?"
Options:
  1. login.test.ts - Authentication timeout issue
  2. api.test.ts - Response format mismatch
  3. db.test.ts - Connection pool exhausted
User: [Selects option 1]
Agent: [Fixes login.test.ts]
Agent: "Fixed authentication timeout. Run remaining tests?"
```

### Example 3: High-Risk Deployment

```
User: "Deploy to production"
Agent: "This will deploy to production. Please confirm:
- Version: v1.2.3
- Environment: production
- Impact: All users
- Rollback: Manual only

Type 'DEPLOY_PRODUCTION_v1.2.3' to confirm."
User: [Types confirmation]
Agent: [Deploys to production]
Agent: "✅ Deployment successful. Monitoring for issues..."
```

## 📚 Related Resources

- [Tool Development Guide](../development/tool-development.md)
- [Safety Best Practices](../development/safety-guidelines.md)
- [Agent Decision Making](../architecture/agent-decisions.md)

---

**Remember**: When in doubt, ask! It's better to over-communicate than to make irreversible mistakes.
