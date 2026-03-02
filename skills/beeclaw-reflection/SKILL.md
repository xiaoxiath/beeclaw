---
name: beeclaw-reflection
description: Beeclaw's core reflection skill for learning from failures. TRIGGER THIS SKILL whenever a skill execution fails, the user corrects your behavior, you notice repetitive patterns (3+ similar tasks), or the user expresses frustration. This skill enables continuous improvement through structured failure analysis.
tags: [beeclaw, evolution, learning, improvement]
---

# Beeclaw Reflection & Evolution

Beeclaw's core capability for learning from experience. Use this skill to analyze what went wrong, identify patterns, and propose concrete improvements to skills and behavior.

## When to Use This Skill

**Always trigger reflection when:**
- Any skill execution produces poor results or errors
- User says "wrong", "no", "not what I wanted", "try again"
- User corrects you: "I meant...", "what I actually wanted..."
- User shows frustration: "ugh", "this is annoying", "always getting this wrong"
- You catch yourself doing the same task 3+ times
- A workaround was used instead of following skill instructions
- User says "you always..." or "every time..."

## The Reflection Process

### Step 1: Gather Context

Before analyzing, collect the facts:

```
1. What was the user trying to accomplish?
2. What skill/method was used?
3. What actually happened vs. what was expected?
4. Were there similar past failures? (use memory_grep)
5. What context might have been missed?
```

**Why this matters:** Jumping to conclusions without context leads to wrong fixes. Understanding the full picture helps identify the real root cause.

### Step 2: Analyze the Failure

Ask targeted questions based on failure type:

**For skill execution failures:**
- Were the skill's instructions clear but execution wrong?
- Were edge cases not covered?
- Was the skill triggered in the wrong context?

**For user corrections:**
- What assumption did I make incorrectly?
- What context did I miss or misinterpret?
- Is this a recurring misunderstanding?

**For repetitive patterns:**
- What task am I repeating?
- Is there a consistent structure I could codify?
- Would a new skill help?

### Step 3: Determine the Right Action

| Situation | Action |
|-----------|--------|
| Instructions unclear | Clarify the skill with examples |
| Missing edge case | Add edge case handling |
| Wrong trigger context | Update skill description |
| No skill exists | Create new skill |
| Fundamental flaw | Propose redesign |

### Step 4: Propose Specific Changes

Write proposals in this format:

```markdown
## Reflection: [Skill Name or "New Skill"]

### Problem
[One sentence: what went wrong]

### Root Cause
[Why it happened - be specific, not vague]

### Proposed Changes

**For existing skill:**
- Section: [which part to modify]
- Current: "[exact current text]"
- Proposed: "[exact new text]"
- Reason: [why this helps]

**For new skill:**
- Name: [skill-name]
- Description: [trigger + what it does]
- Draft: [key sections of SKILL.md]

### Expected Impact
[How this improves future interactions]
```

### Step 5: Get User Confirmation

**Always ask before making changes:**

```
I've identified an issue and have a proposal.

**Problem:** [one-line summary]
**Proposed fix:** [one-line summary]

Should I:
1. Apply this change now
2. Show full diff first
3. Adjust the proposal
4. Skip for now
```

**Why ask first:** User knows their needs best. A change that seems logical might not match their intent. Getting confirmation prevents wasted effort and builds trust.

## Skill Improvement Patterns

### Pattern 1: Add Missing Context

When instructions lack necessary background:

```markdown
## Before
Generate a summary of the document.

## After
Generate a summary of the document.

**Context that helps:**
- Summaries should be 2-3 sentences for documents under 1000 words
- For longer documents, create a structured summary with key points
- Preserve any numbers, dates, or names exactly as written
```

### Pattern 2: Add Edge Case Handling

When unexpected situations break the flow:

```markdown
## Edge Cases

**If the file is empty:**
Return "The file is empty" - do not attempt to summarize.

**If the file is binary (images, PDFs):**
Do not read as text. Suggest appropriate tools instead.

**If encoding fails:**
Try UTF-8 first, then Latin-1, then ask user for correct encoding.
```

### Pattern 3: Clarify Ambiguity

When "do X appropriately" means nothing:

```markdown
## Before
Format the output appropriately.

## After
Format the output:
1. Use Markdown for all text output
2. Tables should have headers and aligned columns
3. Code blocks must specify language: ```typescript
4. Lists should be numbered for procedures, bulleted for options
```

### Pattern 4: Add Concrete Examples

When abstract rules are hard to follow:

```markdown
## Example

**User says:** "add profit margin column"
**Interpretation:** Calculate (revenue - cost) / revenue * 100

**Good response:**
1. Read the spreadsheet
2. Find revenue (C) and cost (D) columns
3. Add formula `=(C2-D2)/C2*100` to new column E
4. Format as percentage

**Bad response:**
"Sure, I'll add that column." (too vague, no verification)
```

## Pattern Extraction for New Skills

When you notice doing the same thing 3+ times:

### Step 1: Identify the Pattern

```
Task: [What you keep doing]
Trigger: [When this happens]
Steps: [What you do each time]
Output: [What you produce]
```

### Step 2: Generalize

Remove specifics, keep structure:
- Instead of: "Create bar chart of Q4 sales"
- Write: "Create visualizations from user data"

### Step 3: Draft the Skill

Keep it under 200 lines. Include:
- Clear trigger description
- Step-by-step process
- Output format
- 1-2 examples

### Step 4: Validate

Before proposing:
- Does it handle the original cases?
- Is it general enough for future similar cases?
- Are triggers clear enough to match correctly?

## Recording Learnings

After improvements, record for future reference:

```
memory_record category: decisions
fact: "Improved [skill] to handle [case] after [issue] was reported"
```

This creates an evolution trail explaining why skills are designed as they are.

## Tools to Use

| Tool | Use Case |
|------|----------|
| `memory_grep` | Find similar past situations |
| `memory_read` | Read skill content before modifying |
| `memory_write` | Update skill files |
| `skill_maturity` | Check if skill is production-ready |
| `skill_record` | Log success/failure for tracking |

## Anti-Patterns to Avoid

1. **Over-engineering** - Don't add complexity for hypothetical cases that haven't occurred
2. **Under-generalizing** - Don't hardcode specifics that should be flexible
3. **Vague instructions** - "Do the right thing" is not instruction
4. **Too many MUSTs** - Explain why, don't just command
5. **Skipping examples** - Abstract rules need concrete examples

## The Evolution Loop

```
┌─────────────┐
│ Use Skill   │
└──────┬──────┘
       │
       ├─ Success → skill_record(success=true) → Done
       │
       └─ Failure → skill_record(success=false)
                         │
                         ▼
                   ┌─────────────┐
                   │ Reflection  │ ← You are here
                   └──────┬──────┘
                          │
                          ▼
                   ┌─────────────┐
                   │ Propose Fix │
                   └──────┬──────┘
                          │
                          ▼
                   ┌─────────────┐
                   │ User Review │
                   └──────┬──────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
           Apply      Modify       Skip
              │           │           │
              └───────────┴───────────┘
                          │
                          ▼
                   ┌─────────────┐
                   │ Better Skill│
                   └─────────────┘
```

## Evolution System Architecture

### LLM-Driven Detection (Implemented Feb 2026)

The evolution system now uses LLM for all detection and judgment, not regex patterns.

**How it works:**
1. System Prompt includes "Continuous Evolution" section with clear instructions
2. LLM proactively detects preferences, patterns, and failures during conversation
3. LLM directly calls tools (memory_write, skill_create, skill_update, skill_record)
4. No separate detection layer needed - LLM understands context naturally

**Files changed:**
- `src/agent/tools.ts` - Added "Continuous Evolution" section to SYSTEM_PROMPTS
- `src/evolution/reflection-trigger.ts` - Simplified to statistics only
- `src/evolution/preference-learning.ts` - Simplified to types only
- `src/agent/index.ts` - Removed checkReflectionTriggers call

**Why LLM-based is better:**
- Semantic understanding (e.g., "这个回答太啰嗦了" → style.length=concise)
- Handles novel expressions not in any pattern list
- No manual pattern maintenance
- Context-aware decisions
- No extra API calls - main conversation LLM handles detection

## Remember

- Skills evolve through real usage, not theoretical perfection
- User feedback is the most valuable input - treat it with care
- Small targeted improvements beat big rewrites
- Always explain the "why" - understanding helps future decisions
- The goal is better future interactions, not being "right"
