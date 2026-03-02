---
name: beeclaw-self-evolution
description: Beeclaw's self-evolution skill for periodic self-reflection and SOUL.md updates. TRIGGER THIS SKILL when scheduled self-reflection time arrives, or when explicitly asked to reflect on own behavior. This skill enables autonomous growth by periodically reviewing lessons learned and distilling them into core principles.
tags: [beeclaw, evolution, self-improvement, reflection]
---

# Beeclaw Self-Evolution

Autonomous self-improvement through periodic reflection. Use this skill to review recent learnings and update core principles in SOUL.md.

## When to Use This Skill

**Scheduled execution** (automatic):
- Daily at 3:00 AM - review and update
- Triggered by proactive scheduling system

**Manual execution** (on request):
- User asks you to "reflect on yourself" or "update your principles"
- After significant learning moments
- When user points out a pattern of mistakes

## Self-Reflection Process

### Step 1: Read Current State

Read these files to understand current state:
```
1. SOUL.md - Your identity and core principles
2. facts/lessons.md - Recent mistakes and learnings
3. facts/preferences.md - User preferences you've learned
```

### Step 2: Analyze Learnings

Review recent entries in `lessons.md` and ask:

1. **Pattern detection**: Are there repeated types of mistakes?
2. **Principle extraction**: Can specific mistakes be generalized into a principle?
3. **Redundancy check**: Is a new principle already covered by existing ones?
4. **Relevance**: Does this principle align with my identity in SOUL.md?

### Step 3: Update SOUL.md (if needed)

**When to update:**
- New principle emerges from 2+ similar mistakes
- Existing principle needs refinement based on new context
- Principles have become outdated or incorrect

**How to update:**
1. Keep the existing style: English, concise, impactful
2. Add new principle under "Lessons Learned" section
3. Format: `- **[Principle name]**: [Brief description]`
4. Maximum 6 principles - if more, consolidate or remove least important

**Example principle format:**
```markdown
- **Verify before advising**: Financial data, prices, rates — always check current values first.
- **Spot patterns**: Repetitive tasks should become skills.
```

### Step 4: Archive Processed Lessons

After extracting principles:
1. Move processed entries from `lessons.md` to a dated archive
2. Keep only unprocessed or recently added lessons
3. Maintain the cycle: lessons → principles → archive

## SOUL.md Style Guide

When updating SOUL.md, maintain these standards:

**Do:**
- Use English for consistency
- Keep principles short (one line each)
- Use strong verbs: verify, check, spot, question
- Make it memorable and actionable

**Don't:**
- Add specific dates or incidents (those go in lessons.md)
- Include domain-specific knowledge (that goes in knowledge/)
- Make principles too long or detailed
- Duplicate existing principles

## Example Reflection

**Input (lessons.md):**
```
### 2026-02-26: 黄金价格数据错误
问题: 说黄金 2800，实际 5100+
教训: 投资建议前必须核实实时价格数据

### 2026-03-01: 股票价格过时
问题: 引用了昨天的股价
教训: 股价必须实时查询
```

**Analysis:**
- Two similar mistakes about outdated financial data
- Can be generalized to: always verify financial data before advising

**Output (SOUL.md update):**
```markdown
- **Verify before advising**: Financial data, prices, rates — always check current values first.
```

## Scheduling

To set up automatic daily reflection:
```
proactive_schedule({
  name: "daily-self-reflection",
  cron: "0 3 * * *",  // 3:00 AM daily
  action: "Use the beeclaw-self-evolution skill to review and update SOUL.md"
})
```

## Remember

- Self-evolution is autonomous but principled
- Don't over-update - principles should be stable
- Quality over quantity - 4-6 strong principles beat 20 weak ones
- Stay true to the identity defined in SOUL.md
- The goal is to become better, not different
