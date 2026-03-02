---
name: beeclaw-reflection-trigger
description: Beeclaw's trigger detection system. This skill runs automatically to detect when reflection should be invoked. Understanding these patterns helps you recognize when something needs improvement. Triggers include user corrections, frustration signals, skill failures, and repetitive patterns.
tags: [beeclaw, evolution, triggers, detection]
---

# Beeclaw Reflection Trigger Detection

This skill defines the patterns that signal reflection is needed. The system checks these automatically, but understanding them helps you recognize improvement opportunities.

## Trigger Categories

### 1. User Correction (Medium Priority) ⚠️

User indicates the AI made a mistake or misunderstood.

**Chinese patterns:**
```
"不对" / "错了" / "不是这样" / "重新来" / "再来一次"
"你总是..." / "每次都..." / "怎么又..."
"我说的是..." / "我的意思是..." / "其实我是想..."
"你.*理解错" / "误解了" / "误会"
"不好" / "不满意" / "不行"
```

**English patterns:**
```
"No" / "Wrong" / "Incorrect" / "Not right" / "Try again"
"Let me clarify" / "What I meant" / "I said..."
"That's not what I asked" / "You misunderstood"
"I wanted X, not Y"
```

**What to do:** Analyze the misunderstanding. Was it ambiguous input? Missing context? Wrong assumption?

### 2. User Frustration (High Priority) 🚨

User shows signs of frustration or considering giving up.

**Chinese patterns:**
```
"烦死" / "崩溃" / "无语" / "受不了" / "够了"
"为什么总是..." / "怎么又..." / "第.*次了"
"算了" / "不用了" / "我自己来" / "还是我来吧"
```

**English patterns:**
```
"Frustrated" / "Annoying" / "So annoying" / "This is annoying"
"Forget it" / "Never mind" / "I'll do it myself"
"Ugh" / "Argh" / "OMG" / "Stop"
"This is hopeless" / "Giving up"
```

**What to do:** Immediately acknowledge the frustration. Identify root cause. Prioritize fixing the most painful issue first.

### 3. Skill Failure (High Priority) 🚨

A skill execution failed repeatedly.

**Detection rules:**
- Same skill fails 2+ times consecutively
- Same skill fails 3+ times within 10 minutes
- `skill_record` called with `success=false`

**What to do:** The skill may need significant improvement or complete redesign. Check if the skill's assumptions match reality.

### 4. Repetitive Pattern (Low Priority) 💡

Similar queries appear multiple times, suggesting a missing skill.

**Detection rules:**
- Similar user requests 3+ times within 30 minutes
- Pattern: same task type, different specifics

**Example:**
```
Request 1: "帮我创建一个网页抓取技能"
Request 2: "帮我创建一个数据分析技能"
Request 3: "帮我创建一个图表生成技能"

→ Pattern: User repeatedly creates skills
→ Action: Maybe create a skill-creation-helper skill
```

**What to do:** Consider if this pattern deserves its own skill. Don't over-generalize too early.

### 5. Workaround Detected (Medium Priority) ⚠️

User tries to do something themselves because AI failed.

**Patterns:**
```
"我自己..." / "我来..." / "让我自己..."
"不用了" / "不需要了" / "我自己来"
"I'll do it myself" / "Never mind I'll handle it"
```

**What to do:** Identify what the AI failed to provide. This is valuable feedback - the user gave up on AI help.

## Severity Levels

| Level | Icon | Meaning | Response |
|-------|------|---------|----------|
| Low | 💡 | Minor issue | Note for later improvement |
| Medium | ⚠️ | Should address | Propose fix soon |
| High | 🚨 | Critical | Address immediately, stop other work |

## How Triggers Flow

```
┌─────────────────────────────────────────────────────────┐
│                  User Message Received                   │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│              Check All Trigger Patterns                  │
│                                                          │
│  1. User correction phrases?         → Medium priority   │
│  2. Frustration signals?             → High priority     │
│  3. Skill just failed?               → High priority     │
│  4. Similar query repeated 3+ times? → Low priority      │
│  5. Workaround language detected?    → Medium priority   │
└────────────────────────┬────────────────────────────────┘
                         │
              ┌──────────┴──────────┐
              │                     │
              ▼                     ▼
         No triggers           Triggers found
              │                     │
              ▼                     ▼
         Continue              Generate context
         conversation          for reflection skill
                                     │
                                     ▼
                               ┌─────────────────┐
                               │ Invoke          │
                               │ beeclaw-        │
                               │ reflection      │
                               └─────────────────┘
```

## Configuration

Default thresholds (adjustable via config):

| Setting | Default | Description |
|---------|---------|-------------|
| `consecutiveFailureThreshold` | 2 | Same skill fails N times in a row |
| `failureCountThreshold` | 3 | Same skill fails N times in window |
| `failureTimeWindowMs` | 600000 | 10 minute window for counting failures |
| `repetitiveQueryThreshold` | 3 | Similar query appears N times |
| `repetitiveQueryTimeWindowMs` | 1800000 | 30 minute window for counting queries |

## When You Detect a Trigger

1. **Read the context carefully** - It tells you what type of issue was detected
2. **Don't ignore or dismiss** - Even if you think it's fine, the user doesn't
3. **Invoke beeclaw-reflection** - Follow its structured analysis process
4. **Search for similar past issues** - Use `memory_grep` to find patterns
5. **Propose specific fixes** - Not vague improvements
6. **Always confirm with user** - Before modifying any skills

## Adding New Trigger Patterns

If you notice a new pattern that should trigger reflection:

```markdown
## Proposed New Trigger Pattern

**Pattern type:** [correction/frustration/failure/repetitive/workaround]

**Phrases to detect:**
- Chinese: [...]
- English: [...]

**Severity:** [low/medium/high]

**Why this matters:**
[Explain what this pattern indicates]

**Suggested action:**
[What should happen when detected]
```

## Examples

### Example 1: User Correction

```
User: "不对，我要的是 TypeScript，不是 JavaScript"

Detected: User correction pattern
Severity: Medium
Action: Invoke reflection to analyze why wrong language was used
```

### Example 2: Frustration

```
User: "怎么又是这样，第三次了！算了我自己写"

Detected: Frustration + Workaround
Severity: High
Action: Immediately address the recurring issue
```

### Example 3: Skill Failure

```
System: skill_record(skill="web-scraper", success=false)
System: skill_record(skill="web-scraper", success=false)

Detected: Consecutive skill failure
Severity: High
Action: Analyze web-scraper skill for fundamental issues
```

## Remember

- Triggers are signals, not commands - use judgment
- High severity triggers should pause other work
- Multiple triggers in one message = higher overall priority
- The goal is continuous improvement, not blame
- Every trigger is a learning opportunity
