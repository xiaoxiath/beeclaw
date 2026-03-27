---
name: beeclaw-preference-learning
description: Beeclaw's dynamic preference learning system. This skill automatically detects and learns user preferences from conversation patterns. TRIGGER when user expresses format preferences ("don't use emoji", "be concise"), identifies their role ("I'm a frontend engineer"), gives feedback on output style, or establishes habits/rituals. Preferences are stored in facts/preferences.md and applied to all future interactions.
tags: [beeclaw, memory, personalization, learning]
version: 1.0.0
---

# Beeclaw Preference Learning

Beeclaw's capability for automatic preference detection and learning. This skill enables progressive personalization - the AI gets better aligned with user needs through natural conversation, without explicit configuration.

## Core Philosophy

**Preferences are learned, not configured.**

Users shouldn't have to fill out preference forms. Instead, preferences emerge naturally through:
- Corrections ("don't use emoji")
- Positive feedback ("this format is good")
- Identity statements ("I'm a data scientist")
- Habit expressions ("I check this every morning")

The AI detects these signals and builds a preference profile over time.

## Preference Categories

| Category | Prefix | Examples |
|----------|--------|----------|
| Communication Style | `style.*` | tone, emoji, length, language |
| Output Format | `format.*` | code style, document structure |
| Technical Preferences | `tech.*` | languages, frameworks |
| Work Habits | `habits.*` | timezone, schedule, reminders |
| Role & Background | `profile.*` | job title, company, team |

## Detection Patterns

### 1. Correction Feedback → Style/Format Preferences

```
User: "不要用 emoji"
→ style.emoji = false

User: "代码块不要加行号"
→ format.code.lineNumbers = false

User: "回复太长了，简洁点"
→ style.length = concise

User: "Don't use markdown tables"
→ format.tables = false
```

### 2. Positive Feedback → Confirm Current Behavior

```
User: "这个格式不错，以后都这样"
→ Lock current output format as preference

User: "这样就很好"
→ Record current behavior pattern

User: "Perfect, do it like this always"
→ Save current approach as default
```

### 3. Identity Statements → Profile Preferences

```
User: "我是前端工程师"
→ profile.role = frontend-engineer

User: "我在某科技公司工作"
→ profile.company = ExampleCorp

User: "我主要用 TypeScript"
→ tech.primaryLanguage = typescript

User: "I'm a backend developer using Go"
→ profile.role = backend-engineer
→ tech.primaryLanguage = go
```

### 4. Habit Expressions → Behavior Preferences

```
User: "每天早上 9 点提醒我"
→ habits.morningReminder = "09:00"

User: "周报周五下午写"
→ habits.weeklyReport = friday-afternoon

User: "I check email first thing in the morning"
→ habits.morningRoutine = email-first
```

### 5. Negation Expressions → Exclusion Preferences

```
User: "我不喜欢太正式的语气"
→ style.tone = casual

User: "别用太多专业术语"
→ style.jargon = minimal

User: "I don't like bullet points"
→ format.lists = numbered
```

## Storage Location

Preferences are stored in the memory system:

```
data/memory/
├── USER.md              # Static profile (manually maintained)
├── facts/
│   ├── user.md          # User facts
│   └── preferences.md   # Learned preferences ← HERE
└── ...
```

## Preferences File Format

```markdown
# User Preferences

> Automatically learned and maintained by Beeclaw
> Last updated: 2025-02-26

## Profile
- Role: Frontend Engineer
- Company: ExampleCorp
- Tech Stack: TypeScript, React

## Communication Style
- Language: Chinese
- Tone: Professional but friendly
- Emoji: ❌ Do not use
- Length: Concise preferred

## Output Format
- Code Language: TypeScript
- Code Line Numbers: ❌ Do not show
- Document Format: Markdown
- List Style: Numbered

## Work Habits
- Timezone: Asia/Shanghai
- Work Hours: 10:00-19:00

## Preference History
- 2025-02-26: Set style.emoji = false (user said "不要用 emoji")
- 2025-02-25: Set profile.role = frontend-engineer
```

## Execution Flow

When a potential preference is detected:

### Step 1: Acknowledge and Confirm

Don't silently record - confirm with the user:

```
"I understand you prefer [X]. I'll apply this to future responses. Is that correct?"
```

**Why confirm:** Misunderstanding preferences is worse than not knowing them. A quick confirmation prevents incorrect assumptions.

### Step 2: Extract Structured Preference

Parse the natural language into a key-value pair:

```
"不要用 emoji" → { key: "style.emoji", value: false }
"我是前端" → { key: "profile.role", value: "frontend-engineer" }
```

### Step 3: Check for Conflicts

Before updating, check if this conflicts with existing preferences:

```
Current: style.emoji = true
Detected: "不要用 emoji"

→ Conflict detected
→ Ask: "Previously you accepted emoji. Should I stop using them going forward?"
```

### Step 4: Update File

Use `memory_write` to update `facts/preferences.md`:

```
memory_write file: facts/preferences.md
content: [updated content with new preference]
```

### Step 5: Record History

Append to preference history for traceability:

```markdown
- 2025-02-26: Set style.emoji = false (user said "不要用 emoji")
```

**Why history matters:** Understanding when and why preferences changed helps make better decisions later.

## Conflict Resolution

```
Scenario:
  Existing: style.length = detailed
  New: "简洁点"

Resolution:
1. Detect conflict
2. Ask: "Previously you preferred detailed responses. Should I be more concise going forward?"
3. User confirms → Update preference
4. Record change in history with reason
```

## Guidelines

### Do:
- **Confirm before recording** - Prevent misunderstandings
- **Learn incrementally** - Don't ask too many preference questions at once
- **Keep history** - Record when and why preferences changed
- **Respect user agency** - Users can view, modify, or delete any preference

### Don't:
- **Over-infer** - Only record explicitly stated preferences
- **Ask leading questions** - "Don't you prefer X?" biases the answer
- **Ignore conflicts** - Always surface preference contradictions
- **Forget preferences** - Persist across sessions

## Integration with Other Skills

| Skill | Interaction |
|-------|-------------|
| beeclaw-reflection | Reference preferences when analyzing failures |
| memory tools | Use `memory_read` and `memory_write` for persistence |
| skill-creator | Apply preferences when generating new skills |

## Example Session

```
User: 帮我分析下这个数据
AI: [Detailed analysis with emoji and long explanation]

User: 不要用 emoji，简洁点
AI: 我理解了，以后我会：
    - 不使用 emoji
    - 保持回复简洁

    这样对吗？

User: 对的
AI: [Records: style.emoji = false, style.length = concise]

[Later]

User: 分析下另一个数据
AI: [Concise analysis without emoji - preferences applied]
```

## Remember

- Preferences emerge through conversation, not configuration forms
- One clear preference is worth ten guessed ones
- Confirmation prevents cascading errors
- History explains the "why" behind current preferences
- Progressive personalization: Day 1 is generic, Day 30 is highly tailored
