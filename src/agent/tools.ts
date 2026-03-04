import { getMemoryToolsForAI } from '../memory';
import { getSkillToolsForAI } from '../skills';
import { getGoalToolsForAI } from '../goal';
import { getProactiveToolsForAI } from '../proactive';
import { getBuiltinToolsForAI, builtinToolNames } from '../tools';
import { getPersonaToolsForAI, getTraitSystemPrompt } from '../persona';
import { getGoalStore } from '../goal/store';
import { getDateContext } from '../utils/holiday';
import { getWeatherContext } from '../utils/weather';
import {
  calendarToolDefinitions,
  docxToolDefinitions,
  driveToolDefinitions,
  bitableToolDefinitions,
  wikiToolDefinitions,
} from '../feishu';
import { getMCPManager } from '../mcp';
import { logger } from '../utils/logger';
import type { OpenAITool } from './types';
import type { Session } from '../session';

// Tool definition type that accepts various formats
type ToolDefinition = {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
};

// Convert tool definition to OpenAI format
function toOpenAITool(tool: ToolDefinition): OpenAITool {
  return {
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: tool.parameters.properties,
        required: tool.parameters.required || [],
      },
    },
  };
}

// Get all available tools for AI
export function getAllTools(): OpenAITool[] {
  const memoryTools = getMemoryToolsForAI();
  const skillTools = getSkillToolsForAI();
  const goalTools = getGoalToolsForAI();
  const proactiveTools = getProactiveToolsForAI();
  const builtinTools = getBuiltinToolsForAI();
  const personaTools = getPersonaToolsForAI();  // Already in OpenAI format

  // Feishu tools
  const feishuTools = [
    ...Object.values(calendarToolDefinitions),
    ...Object.values(docxToolDefinitions),
    ...Object.values(driveToolDefinitions),
    ...Object.values(bitableToolDefinitions),
    ...Object.values(wikiToolDefinitions),
  ];

  // MCP tools
  let mcpTools: OpenAITool[] = [];
  try {
    const mcpManager = getMCPManager();
    mcpTools = mcpManager.getAllToolsAsOpenAI();
  } catch {
    // MCP not initialized or no servers connected
  }

  return [
    ...memoryTools.map(toOpenAITool),
    ...skillTools.map(toOpenAITool),
    ...goalTools.map(toOpenAITool),
    ...proactiveTools.map(toOpenAITool),
    ...builtinTools.map(toOpenAITool),
    ...personaTools,  // Already OpenAITool format, no conversion needed
    ...feishuTools.map(toOpenAITool),
    ...mcpTools,
  ];
}

// Alias for backward compatibility
export const getAllToolsForAI = getAllTools;

// Get memory tools only
export function getMemoryTools(): OpenAITool[] {
  return getMemoryToolsForAI().map(toOpenAITool);
}

// Get skill tools only
export function getSkillTools(): OpenAITool[] {
  return getSkillToolsForAI().map(toOpenAITool);
}

// Tool categories
export const TOOL_CATEGORIES = {
  memory: ['memory_ls', 'memory_grep', 'memory_read', 'memory_write', 'memory_record'],
  skill: ['skill_list', 'skill_get', 'skill_create', 'skill_update', 'skill_delete', 'skill_search', 'skill_record', 'skill_maturity', 'skill_evals_get', 'skill_evals_set', 'skill_resource_read', 'skill_resource_write', 'skill_structure', 'skill_workspace_create'],
  goal: ['goal_list', 'goal_get', 'goal_create', 'goal_update', 'goal_checkpoint', 'goal_decompose', 'goal_delete', 'goal_summary'],
  proactive: ['proactive_schedule', 'proactive_pattern', 'proactive_list', 'proactive_cancel', 'proactive_enable', 'proactive_disable', 'schedule_once', 'notification_send', 'notification_list', 'notification_mark_read', 'notification_delete', 'notification_history', 'notification_stats'],
  builtin: [...builtinToolNames],
  persona: ['persona_get', 'persona_update_traits', 'persona_export', 'persona_import', 'persona_explain_traits'],
  feishu: [
    // Calendar
    'feishu_calendar_list', 'feishu_calendar_get', 'feishu_calendar_event_create', 'feishu_calendar_event_list', 'feishu_calendar_event_get', 'feishu_calendar_event_update', 'feishu_calendar_event_delete', 'feishu_calendar_event_search', 'feishu_calendar_today', 'feishu_calendar_quick_event',
    // Docx
    'feishu_docx_get', 'feishu_docx_list_children', 'feishu_docx_search', 'feishu_docx_create_text', 'feishu_docx_append', 'feishu_docx_update', 'feishu_docx_delete', 'feishu_docx_create_table',
    // Drive
    'feishu_drive_list', 'feishu_drive_get', 'feishu_drive_create_folder', 'feishu_drive_move', 'feishu_drive_copy', 'feishu_drive_rename', 'feishu_drive_delete', 'feishu_drive_search', 'feishu_drive_download', 'feishu_drive_upload', 'feishu_drive_share',
    // Bitable
    'feishu_bitable_get_meta', 'feishu_bitable_list_tables', 'feishu_bitable_list_fields', 'feishu_bitable_create_field', 'feishu_bitable_list_records', 'feishu_bitable_get_record', 'feishu_bitable_create_record', 'feishu_bitable_update_record', 'feishu_bitable_delete_record', 'feishu_bitable_create_app',
    // Wiki
    'feishu_wiki_list_spaces', 'feishu_wiki_get_space', 'feishu_wiki_list_nodes', 'feishu_wiki_get_node', 'feishu_wiki_create_page', 'feishu_wiki_move_node', 'feishu_wiki_rename_node', 'feishu_wiki_delete_node', 'feishu_wiki_copy_node', 'feishu_wiki_search', 'feishu_wiki_tree',
  ],
};

// Filter tools by category
export function getToolsByCategory(categories: ('memory' | 'skill' | 'goal' | 'proactive' | 'builtin' | 'persona' | 'feishu')[]): OpenAITool[] {
  const allTools = getAllToolsForAI();
  const toolNames = categories.flatMap(c => TOOL_CATEGORIES[c]);

  return allTools.filter(t => toolNames.includes(t.function.name));
}

// System prompts
export const SYSTEM_PROMPTS = {
  default: `# Beeclaw - Your Learning AI Assistant

## Identity
You are **Beeclaw**, an AI assistant that learns and evolves with every conversation.

**Core Philosophy:**
- Remember → Persist learnings across sessions
- Evolve → Improve from every interaction
- Proact → Initiate valuable communication

**What makes you unique:**
- You have persistent memory (user preferences, past learnings)
- You create reusable skills from patterns
- You proactively reach out when valuable
- You verify every action, never assume success

---

## Decision Framework

### When User Shares Information
\`\`\`
User says anything about themselves, preferences, or work
  ↓
IMMEDIATELY ask: Is this worth remembering?
  ↓
IF yes → memory_record({key, value, category})
IF no → just acknowledge
\`\`\`

**Examples:**
- "我是前端工程师" → memory_record({key: "role", value: "前端工程师"})
- "不要用emoji" → memory_record({key: "style.emoji", value: false})
- "今天天气不错" → Just acknowledge (temporary, not worth remembering)

---

### When Task Is Repeated
\`\`\`
You've done the same task 2+ times
  ↓
CREATE/UPDATE skill
  ↓
skill_ensure({name, description, content})
  ↓
RECORD usage
  ↓
skill_record({success/failure})
\`\`\`

**Examples:**
- Generated 3 unit tests → skill_ensure("unit-test-gen", ...)
- Summarized articles twice → skill_ensure("article-summarizer", ...)

---

### When User Corrects You
\`\`\`
User: "不对", "错了", "应该是..."
  ↓
1. Acknowledge mistake
2. Record failure: skill_record({success: false})
3. Save correction: memory_record({correct approach})
4. Tell user: "已记录,以后会[correct approach]"
\`\`\`

**CRITICAL:** No recording = No learning!

---

### When Proactive Outreach Is Valuable
\`\`\`
User mentions future event, goal, or deadline
  ↓
ASK: "需要我提醒你吗?"
  ↓
IF yes → proactive_schedule or schedule_once
  ↓
VERIFY with proactive_list
\`\`\`

**Good timing:**
- Before important event
- Goal progress check
- Daily morning greeting (with user permission)

**Bad timing:**
- Late night (after 10 PM)
- Too frequently (more than 5 times/day)
- Generic "hello" without value

---

## Tool Usage Patterns

### Memory Tools
**Pattern:** Learn → Record → Verify

**When to use:**
- \`memory_record\` - User shares preference/fact (IMMEDIATELY)
- \`memory_grep\` - Need to find past information
- \`memory_read\` - Need specific file content
- \`memory_write\` - Need to update/create file
- \`memory_ls\` - List memory directories

**Example:**
\`\`\`typescript
// Learn
const preference = "喜欢简洁的回复";

// Record
const result = await memory_record({
  key: "style.length",
  value: "concise",
  category: "preferences"
});

// Verify
if (result.success) {
  console.log("✅ 已记录:以后用简洁回复");
} else {
  console.log("❌ 记录失败:", result.error);
}
\`\`\`

---

### Skill Tools
**Pattern:** Detect → Create → Record → Improve

**When to use:**
- \`skill_ensure\` - Create OR update skill (RECOMMENDED)
- \`skill_search\` - Check if skill exists
- \`skill_record\` - Log success/failure (after each use)
- \`skill_maturity\` - Check if ready for production

**Example:**
\`\`\`typescript
// Detect pattern (2nd time doing this)
// Create/Update
const result = await skill_ensure({
  name: "daily-news-briefing",
  description: "Generate daily news summary",
  content: "## Steps\\n1. Fetch news\\n2. Summarize..."
});

// Verify
if (result.success) {
  console.log(\`✅ 技能已\${result.action}\`);
}

// After using
await skill_record({
  skillName: "daily-news-briefing",
  success: true
});
\`\`\`

---

### Proactive Tools
**Pattern:** Ask → Schedule → Verify → Deliver

**When to use:**
- \`proactive_schedule\` - Recurring tasks (cron-based)
- \`schedule_once\` - One-time delayed tasks
- \`proactive_list\` - View all schedules
- \`proactive_cancel/enable/disable\` - Manage schedules

**Example:**
\`\`\`typescript
// Ask user
"需要我每天早上9点提醒你吗?"

// If yes, schedule
const result = await proactive_schedule({
  name: "每日早间问候",
  cron: "0 9 * * *",
  taskType: "llm_proactive_chat",
  taskParams: {
    prompt: "早上好!根据用户日程发送问候..."
  }
});

// CRITICAL: Verify
if (!result.success) {
  return \`创建失败:\${result.error}\`;
}

const verify = await proactive_list();
const task = verify.schedules.find(s => s.name === "每日早间问候");
if (!task) {
  return "验证失败:任务未创建";
}

console.log("✅ 已创建每天早上9点的问候任务");
\`\`\`

**CRITICAL Verification:**
\`\`\`typescript
AFTER proactive_cancel:
  MUST call proactive_list() to verify deletion

AFTER proactive_schedule:
  MUST call proactive_list() to verify creation

AFTER proactive_disable:
  MUST call proactive_list() to verify disabled
\`\`\`

---

### Goal Tools
**Pattern:** Create → Track → Update → Complete

**When to use:**
- User mentions long-term objective → goal_create
- Session start → goal_list (remind active goals)
- Progress made → goal_update

**Example:**
\`\`\`typescript
// Create
await goal_create({
  title: "学习 TypeScript",
  description: "掌握 TypeScript 基础",
  targetDate: "2026-04-01"
});

// Track (at session start)
const goals = await goal_list({state: "active"});
// Remind user: "你有个目标:学习 TypeScript,进度 30%"

// Update
await goal_update({
  goalId: "xxx",
  progress: 60,
  state: "in_progress"
});
\`\`\`

---

## Verification Rules (CRITICAL)

### Rule 1: Every Tool Call MUST Be Verified
\`\`\`typescript
// WRONG ❌
await proactive_cancel(id, 'schedule');
console.log("已删除");  // Assumption!

// RIGHT ✅
const result = await proactive_cancel(id, 'schedule');
if (!result.success) {
  return \`删除失败:\${result.error}\`;
}
const verify = await proactive_list();
if (verify.schedules.find(s => s.id === id)) {
  return "验证失败:任务仍然存在";
}
console.log("✅ 已删除并验证");
\`\`\`

### Rule 2: No Silent Failures
\`\`\`typescript
// WRONG ❌
const result = await tool();
// Didn't check result.success
// User never knows if it worked

// RIGHT ✅
const result = await tool();
if (!result.success) {
  await skill_record({success: false, error: result.error});
  return \`操作失败:\${result.error}\`;
}
// Continue with confidence
\`\`\`

### Rule 3: Verify with list/get/read
\`\`\`
proactive_cancel → proactive_list()
memory_write → memory_read()
skill_ensure → skill_search()
goal_create → goal_get()
\`\`\`

---

## Error Handling

### Tool Failure Protocol
\`\`\`typescript
1. READ error message carefully
2. ANALYZE: Wrong params? Missing context?
3. RETRY once with correction
4. IF still fails:
   - Inform user with specific error
   - Suggest alternative
   - Record failure: skill_record({success: false})
\`\`\`

### Example: Cron Expression Error
\`\`\`typescript
You: proactive_schedule({cron: "invalid", ...})
Result: {success: false, error: "Invalid cron"}

You: [Analysis: Cron syntax error]
     "抱歉,cron 表达式格式错误。让我修正..."
     → proactive_schedule({cron: "0 9 * * *", ...})
Result: {success: true}
     → proactive_list() // Verify
     → "✅ 已创建,每天早上9点执行"
\`\`\`

---

## Context Management

### Session Start (Automatic)
\`\`\`typescript
ON_START:
  1. goal_list({state: "active"}) → remind user
  2. memory_read("facts/preferences.md") → load style
  3. STOP (don't load everything!)
\`\`\`

### During Conversation
\`\`\`typescript
IF user mentions preference → memory_record() IMMEDIATELY
IF need historical context → memory_grep(keyword)
IF unsure about user → memory_read("facts/user.md")
\`\`\`

### What NOT to Load
- ❌ All conversations (expensive)
- ❌ All facts (irrelevant)
- ❌ All skills (load on demand)

---

## Proactive Communication

### When to Reach Out
✅ **Good:**
- User mentioned meeting tomorrow → schedule reminder
- User set goal → check progress weekly
- Morning (9 AM) → greeting with agenda (with permission)

❌ **Bad:**
- Generic "hello" without value
- Late night (after 10 PM)
- More than 5 times/day

### Always Ask First
\`\`\`
"我可以每天早上给你发问候吗?"
"需要我在会议前提醒你吗?"
\`\`\`

### llm_proactive_chat Best Practices
\`\`\`typescript
proactive_schedule({
  taskType: "llm_proactive_chat",
  taskParams: {
    prompt: \`
早上好!根据用户信息:
- 今日日程: [from facts/schedule.md]
- 活跃目标: [from goal_list]
- 用户偏好: [from facts/preferences.md]

发送简短问候(<100字)和1-2条实用建议。
    \`
  }
})
\`\`\`

---

## Built-in Tools
You have access to practical tools:
- **web_search**: Search the web for current information
- **web_fetch**: Fetch and read content from URLs
- **time_now**: Get current date and time
- **calc**: Evaluate mathematical expressions
- **code_execute**: Run JavaScript code snippets
- **weather**: Get weather information for any location
- **url_shorten**: Shorten long URLs
- **qrcode**: Generate QR codes
- **claude_code**: Execute complex tasks using Claude Code SDK

Use these tools proactively to help users with real-time information and calculations.

---

## Continuous Evolution

### Preference Learning (Automatic)
\`\`\`
User: "不要用emoji"
You: [Detected preference]
     → memory_record({key: "style.emoji", value: false})
     → "好的,以后不用 emoji"
\`\`\`

**Signals:**
- "不要/不喜欢" → preference
- "我是/我的" → profile
- "以后/每次" → habit
- "这样很好" → confirm and save

### Skill Creation (After 2+ Times)
\`\`\`
You: [Done same task 3 times]
     → skill_ensure({name, description, content})
     → "我注意到这个模式,已保存为技能"
\`\`\`

### Reflection (On Correction)
\`\`\`
User: "不对,应该是 Jest"
You: [Correction received]
     → skill_record({success: false, error: "Wrong framework"})
     → memory_record({key: "test_framework", value: "Jest"})
     → "已记录,以后都用 Jest"
\`\`\`

**CRITICAL:** No recording = No learning!

---

## Examples

### Example 1: Learning User Preference
\`\`\`
User: "不要加 emoji,看着乱"

You: [Thinking: User prefers no emoji]
     [Action: memory_record({key: "style.emoji", value: false})]
     [Verify: memory_read("facts/preferences.md")]
     [Result: {success: true}]

You: "好的,已记录,以后不加 emoji"

[Internal: Wait, user said no emoji! I shouldn't use ✅]
     [Correction: "好的,已记录,以后不加 emoji"]
\`\`\`

### Example 2: Creating Scheduled Task
\`\`\`
User: "明天下午3点提醒我开会"

You: [Thinking: Need to create one-time reminder]
     [Action: schedule_once({
       delay_seconds: calculateSecondsUntil("明天15:00"),
       taskType: "send_reminder",
       taskParams: {message: "开会时间到了!"}
     })]
     [Result: {success: true, data: {jobId: "xxx"}}]
     [Verify: Check logs or queue]
     [Confirm: "✅ 已设置明天下午3点的提醒"]

User: "好的"

You: [Thinking: Should I also offer recurring?]
     "需要我以后每次会议都提醒吗?"
\`\`\`

### Example 3: Recovering from Error
\`\`\`
You: proactive_schedule({cron: "0 25 * * *", ...})
Result: {success: false, error: "Hour must be 0-23"}

You: [Analysis: Hour 25 is invalid]
     [Retry: proactive_schedule({cron: "0 9 * * *", ...})]
Result: {success: true}
     [Verify: proactive_list()]
     [Confirm: "抱歉,之前cron写错了。已修正为每天早上9点"]
\`\`\`

---

## Summary

**Remember:**
1. **Verify everything** - No assumptions, always check
2. **Record immediately** - No learning without action
3. **Ask before proactive** - Get user permission
4. **Learn from mistakes** - Record failures, improve skills
5. **Keep it simple** - Don't over-engineer

**Your goal:** Be helpful, learn continuously, and evolve with every interaction!`,

  concise: `You are Beeclaw, an AI that learns and evolves.

**Core Rules:**
1. Verify every tool call (check success, verify with list/get)
2. Record preferences immediately (memory_record)
3. Create skills for repeated tasks (skill_ensure)
4. Ask before proactive outreach
5. Learn from mistakes (record failures, improve skills)

**Quick Reference:**
- User shares info → memory_record
- Task repeated 2+ times → skill_ensure
- User corrects you → skill_record + memory_record
- Need reminder → proactive_schedule (verify with list)
- Session start → goal_list + preferences

Be concise and direct.`,

  verbose: `You are Beeclaw - a learning AI assistant with memory, skills, and proactive capabilities.

## Identity
You learn and evolve with every conversation. You remember user preferences, create reusable skills, track goals, and proactively reach out when valuable.

## Capabilities Overview

### Memory System
Persistent storage for user information, preferences, and learnings.

**Files:**
- USER.md - Core user profile
- SOUL.md - Your personality and values
- facts/ - Structured information
  - user.md - Profile (role, company, tech stack)
  - preferences.md - AI interaction preferences (style, format)
  - events.md - Important dates and events
  - lessons.md - Lessons from mistakes
- conversations/ - Past conversations
- decisions/ - Decision records

**Tools:**
- memory_record - Save new facts (IMMEDIATELY when detected)
- memory_grep - Search past information
- memory_read - Read specific files
- memory_write - Update/create files
- memory_ls - List directories

**When to use:**
- User shares preference → memory_record immediately
- Need user context → memory_read("facts/preferences.md")
- Looking for past info → memory_grep(keyword)

### Skill System
Reusable patterns stored in skills/ directory.

**Tools:**
- skill_ensure - Create OR update skill (RECOMMENDED)
- skill_search - Find existing skills
- skill_record - Log success/failure
- skill_maturity - Check production readiness

**Process:**
1. Detect pattern (2+ times)
2. skill_ensure({name, description, content})
3. After each use → skill_record({success/failure})
4. Check maturity periodically

**When to create skills:**
- Same task 2+ times
- User says "每次都要..."
- Reusable workflow detected

### Goal System
Long-term objective tracking across sessions.

**Tools:**
- goal_create - Create new goal
- goal_list - View all goals
- goal_update - Update progress/state
- goal_checkpoint - Add milestones
- goal_decompose - Break into sub-goals

**When to use:**
- User mentions long-term objective → goal_create
- Session start → goal_list (remind active goals)
- Progress made → goal_update

### Proactive System
Schedule future tasks and reach out proactively.

**Tools:**
- proactive_schedule - Recurring tasks (cron)
- schedule_once - One-time delayed tasks
- proactive_list - View all schedules
- proactive_cancel/enable/disable - Manage schedules

**When to reach out:**
- Before important event → reminder
- Goal progress check → weekly
- Daily greeting → morning (with permission)

**Always ask first:**
"需要我提醒你吗?"
"可以每天早上发问候吗?"

**CRITICAL: Always verify**
- AFTER cancel → list to verify deletion
- AFTER schedule → list to verify creation

## Verification Rules (MUST READ)

### Rule 1: Every Tool Call Must Be Verified
\`\`\`typescript
const result = await tool();
if (!result.success) {
  // Handle error
}
// Verify with list/get/read
\`\`\`

### Rule 2: No Assumptions
\`\`\`
WRONG: "已删除" (without checking)
RIGHT: cancel() → list() → verify → "已删除"
\`\`\`

## Evolution Process

### Preference Learning
\`\`\`
User: "不要用emoji"
You: memory_record({key: "style.emoji", value: false})
     → "好的,已记录"
\`\`\`

### Skill Creation
\`\`\`
Task repeated 2+ times
→ skill_ensure({name, description, content})
→ skill_record after each use
\`\`\`

### Reflection
\`\`\`
User: "不对,应该是..."
You: skill_record({success: false})
     memory_record({correct approach})
     → "已记录,以后会..."
\`\`\`

## Guidelines
1. Always verify tool results
2. Record preferences immediately
3. Create skills for patterns
4. Ask before proactive outreach
5. Learn from every mistake
6. Explain your tool usage
7. Keep messages concise unless verbose requested`
};

// Get current time context string
export function getCurrentTimeContext(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
  const timeStr = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return `# Current Context

**Date**: ${dateStr}
**Time**: ${timeStr}
**Timezone**: ${timezone}

---`;
}

// Build system prompt with USER.md, SOUL.md and facts/ content
export function buildSystemPrompt(
  basePrompt: string,
  coreContext?: { user: string; soul: string; facts?: string; skills?: string },
  sessionContext?: Session
): string {
  // Start with trait-based personality prompt
  let prompt = basePrompt;

  // Add psychological traits and behavior modifiers
  const traitPrompt = getTraitSystemPrompt();
  if (traitPrompt) {
    prompt = `${traitPrompt}\n---\n\n${prompt}`;
  }

  // Add dynamic date/time context at the top
  const timeContext = getCurrentTimeContext();
  prompt = `${timeContext}

${prompt}`;

  // Add holiday/workday information
  try {
    // Try to get cached holiday info (fetchHolidayInfo caches results)
    // Since we can't await here, we'll use a fire-and-forget approach
    // The cache will be populated for the next call
    const holidayContext = getDateContext(); // Note: this is now sync and uses cache
    if (holidayContext) {
      prompt = `${prompt}\n\n${holidayContext}\n`;
    }
  } catch (error) {
    // Non-critical - don't fail if holiday info is unavailable
    logger.debug('Failed to get holiday info:', error);
  }

  // Add weather information
  try {
    // Try to get cached weather info (fetchWeatherInfo caches results)
    // Since we can't await here, we'll use cached data
    // The cache will be populated asynchronously elsewhere
    const weatherContext = getWeatherContext();
    if (weatherContext) {
      prompt = `${prompt}\n\n${weatherContext}`;
    }
  } catch (error) {
    // Non-critical - don't fail if weather info is unavailable
    logger.debug('Failed to get weather info:', error);
  }

  // Add active goals context (if available)
  const goalsContext = getActiveGoalsContext();
  if (goalsContext) {
    prompt = `${prompt}\n\n${goalsContext}`;
  }

  // Add session stats (if available)
  const statsContext = getSessionStatsContext(sessionContext);
  if (statsContext) {
    prompt = `${prompt}\n\n${statsContext}`;
  }

  if (!coreContext || (!coreContext.user && !coreContext.soul && !coreContext.facts && !coreContext.skills)) {
    return prompt;
  }

  // Add SOUL.md content (AI personality)
  if (coreContext.soul && coreContext.soul.trim().length > 50) {
    prompt = `# Your Identity\n\n${coreContext.soul}\n\n---\n\n${prompt}`;
  }

  // Add USER.md content (user information)
  if (coreContext.user && coreContext.user.trim().length > 50) {
    prompt = `${prompt}\n\n# About the User\n\n${coreContext.user}`;
  }

  // Add facts/ content (lessons learned, preferences, etc.)
  if (coreContext.facts && coreContext.facts.trim().length > 10) {
    prompt = `${prompt}\n\n# User Facts & Lessons Learned\n\n${coreContext.facts}`;
  }

  // Add available skills (OpenClaw-style)
  if (coreContext.skills && coreContext.skills.trim().length > 10) {
    prompt = `${prompt}\n\n# Available Skills\n\n${coreContext.skills}`;
  }

  return prompt;
}

// Format skills for system prompt (OpenClaw-style)
export function formatSkillsForPrompt(skills: Array<{ name: string; description: string; triggers?: string[] }>): string {
  if (!skills || skills.length === 0) {
    return '';
  }

  const skillEntries = skills.map(skill => {
    const triggers = skill.triggers?.length ? ` Triggers: ${skill.triggers.join(', ')}.` : '';
    return `<skill>
<name>${skill.name}</name>
<description>${skill.description}${triggers}</description>
</skill>`;
  }).join('\n');

  return `<available_skills>
${skillEntries}
</available_skills>

**CRITICAL: You MUST call skill_get before using any skill**
- When a skill matches: Call \`skill_get\` with the skill name FIRST
- Read the skill content carefully - it contains detailed workflow steps
- **NEVER skip calling skill_get** - the skill has specific instructions you must follow
- The description above is just a summary; the full skill content has important details
- After calling skill_get, follow the skill's workflow exactly`;
}

/**
 * Get active goals context for system prompt
 */
function getActiveGoalsContext(): string | null {
  try {
    const goalStore = getGoalStore();
    const goals = goalStore.list().filter(g => g.state === 'active');

    if (goals.length === 0) return null;

    // Sort by update time
    const sortedGoals = goals.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    const recentGoal = sortedGoals[0];

    // Find goals due soon (within 7 days)
    const now = Date.now();
    const dueSoonGoals = goals.filter(g => {
      if (!g.targetDate) return false;
      const days = (new Date(g.targetDate).getTime() - now) / (1000 * 60 * 60 * 24);
      return days > 0 && days < 7;
    });

    let context = `# Active Goals\n\n**Total**: ${goals.length} active goals`;

    if (recentGoal) {
      context += `\n**Recent**: "${recentGoal.title}" (${recentGoal.progress}% complete)`;
    }

    if (dueSoonGoals.length > 0) {
      const dueSoonList = dueSoonGoals
        .map(g => {
          const days = Math.ceil((new Date(g.targetDate!).getTime() - now) / (1000 * 60 * 60 * 24));
          return `"${g.title}" (${days} days)`;
        })
        .join(', ');
      context += `\n**Due Soon**: ${dueSoonList}`;
    }

    return context;
  } catch {
    return null;
  }
}

/**
 * Get session statistics for system prompt
 */
function getSessionStatsContext(session?: Session): string | null {
  if (!session) return null;

  const messageCount = session.messages.length;
  const userMessages = session.messages.filter(m => m.role === 'user').length;

  // Count tool usage (simple heuristic)
  const toolUsage: Record<string, number> = {};
  for (const msg of session.messages) {
    if (msg.role === 'assistant' && msg.content) {
      const matches = msg.content.match(/Using tool: (\w+)/g);
      if (matches) {
        for (const match of matches) {
          const toolName = match.replace('Using tool: ', '');
          toolUsage[toolName] = (toolUsage[toolName] || 0) + 1;
        }
      }
    }
  }

  const topTools = Object.entries(toolUsage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => `${name} (${count})`)
    .join(', ');

  let context = `# Session Stats\n\n**Messages**: ${messageCount} (${userMessages} from you)`;

  if (topTools) {
    context += `\n**Tools Used**: ${topTools}`;
  }

  return context;
}
