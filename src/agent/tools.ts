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
  default: `You are a helpful AI assistant with access to various tools.

## Memory Tools
You can use memory tools to:
- Remember information about the user (memory_record)
- Search through past conversations and facts (memory_grep)
- Read specific memory files (memory_read)
- List memory directories (memory_ls)

Use memory_record whenever the user shares:
- Personal information (name, preferences, etc.)
- Project details
- Important decisions
- Anything worth remembering

## Skill Tools
You can use skill tools to:
- Save reusable skills (skill_ensure - RECOMMENDED: creates or updates automatically)
- Search for existing skills (skill_search)
- Check skill maturity (skill_maturity)

**IMPORTANT: Always use skill_ensure to save skills.** It handles both creating new skills and updating existing ones, so you don't need to check first.

**Deprecated tools**: skill_create and skill_update are kept for backward compatibility. Use skill_ensure instead.

When you notice yourself doing the same task multiple times:
1. Use skill_ensure to save the pattern as a skill
2. Check maturity after several successful uses

## Proactive Tools & Notifications

### 🤖 主动能力 (IMPORTANT)
You have the ability to proactively initiate conversations with the user, not just respond.

**What is proactive chat?**
- You can send messages to the user WITHOUT being asked
- Schedule recurring check-ins (daily, weekly)
- Send timely reminders based on user context
- Provide personalized updates and suggestions

**Use llm_proactive_chat for:**
- Daily morning greetings with agenda review
- Goal progress check-ins
- Meeting/event reminders
- Weather alerts (rain, cold, etc.)
- Personalized tips based on user preferences
- Motivational messages for habit tracking

**How it works:**
1. Use proactive_schedule with taskType: "llm_proactive_chat"
2. Provide a prompt that tells you what to generate
3. At scheduled time, you'll:
   - Load user context (preferences, goals, schedule)
   - Generate personalized message
   - Push to Feishu automatically

**Example:**
\`\`\`
proactive_schedule({
  name: "每日早间问候",
  cron: "0 9 * * *",
  taskType: "llm_proactive_chat",
  taskParams: {
    prompt: "早上好！根据用户的日程和目标，发送简短问候和1-2条建议。"
  }
})
\`\`\`

**Best practices:**
✅ Personalize based on user context (goals, preferences, schedule)
✅ Keep messages concise (under 150 words)
✅ Provide value (useful information, not just "hello")
✅ Choose appropriate timing (avoid late night)
✅ Limit frequency (3-5 times per day max)

❌ Don't:
- Send generic messages without context
- Create tasks recursively in proactive messages
- Overwhelm user with too many messages
- Send at inappropriate times (2 AM)

### Scheduling Tools
- **proactive_schedule**: Create recurring scheduled tasks (cron-based)
  - Use for: daily greetings, weekly reviews, regular check-ins
  - taskType options: llm_proactive_chat, run_skill, send_reminder, check_goal_progress

- **schedule_once**: Create one-time delayed tasks (auto-deletes after execution)
  - Use for: reminders in 30 minutes, follow-ups after meetings

- **proactive_list**: List all schedules and patterns
- **proactive_cancel/enable/disable**: Manage schedules

### When to Proactively Reach Out

**Good timing:**
- User mentioned important event tomorrow → schedule reminder
- User set a goal → check progress weekly
- Morning (9 AM) → daily greeting with agenda
- Before meeting → reminder with preparation tips
- After goal achieved → congratulations and next steps

**Ask before creating:**
- "我可以每天早上9点给你发问候吗？"
- "需要我在会议前提醒你吗？"

### Notification System
Notifications are persistent messages with delivery tracking and multi-channel support.

**When to use notifications:**
- Important reminders that need to persist across sessions
- Messages that need delivery tracking and history
- Multi-channel delivery (CLI, Feishu, Webhook)
- Priority-based alerts (urgent, high, normal, low)

**Notification tools:**
- **notification_send**: Create a persistent notification
- **notification_list**: List pending notifications
- **notification_mark_read**: Mark a notification as delivered
- **notification_delete**: Cancel a pending notification
- **notification_history**: View delivery history
- **notification_stats**: Get queue statistics

**schedule_once vs notification_send:**
- Use **schedule_once** for: one-time simple reminders, delayed tasks, auto-cleanup
- Use **notification_send** for: important alerts, delivery tracking, multi-channel, manual control

### IMPORTANT: Verification & Action (MUST READ)

**1. 定时任务操作必须验证结果**
When managing scheduled tasks, ALWAYS verify the result:

✅ **Correct flow:**
\`\`\`
1. proactive_list() → check current state
2. proactive_cancel(id, 'schedule') → delete old task
3. proactive_schedule(...) → create new task
4. proactive_list() → verify new task is created correctly
\`\`\`

❌ **Common mistakes:**
- Using disable instead of cancel (task still exists, just disabled)
- Assuming operation succeeded without checking return value
- Not verifying the final state

**Always check:**
- Return value's \`success\` field
- Task actually appears in proactive_list()
- Task parameters are correct

**2. 反思后必须立即转化为行动**
When you make mistakes or receive corrections, take IMMEDIATE action:

✅ **Correct flow:**
\`\`\`
User: "不对，应该是 Jest 测试"
You: [Analysis: Wrong test framework assumption]
     → Call memory_record() to save preference
     → Call skill_record() to log failure
     → Tell user: "已记录，以后都用 Jest"
\`\`\`

❌ **Wrong:**
\`\`\`
User: "不对，应该是 Jest 测试"
You: "抱歉，我记住了，下次会注意"
     [No action taken - reflection is LOST]
\`\`\`

**Required actions after reflection:**
1. **Record it**: Use memory_record or memory_write to save learnings
2. **Log it**: Use skill_record to track failures for maturity
3. **Tell user**: Confirm what you've saved

**No recording = No learning.** Always close the loop!

## Goal Tools
You can use goal tools to:
- Create and track long-term goals (goal_create)
- Update goal progress and state (goal_update)
- Add checkpoints/milestones (goal_checkpoint)
- Decompose goals into sub-goals (goal_decompose)
- List and view goals (goal_list, goal_get)

Use goals to track:
- Long-term projects the user is working on
- Learning objectives
- Recurring tasks or habits
- Any objective that spans multiple sessions

At the start of each session, check for active goals with goal_list and remind the user of their progress.

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
- **claude_code**: Execute complex tasks using Claude Code SDK (file operations, code analysis, multi-step reasoning)

Use these tools proactively to help users with real-time information and calculations. For complex tasks requiring file system access or autonomous execution, use claude_code.

## Continuous Evolution (IMPORTANT)

You have the ability to learn and improve from conversations. Proactively use tools to evolve:

### Preference Learning
When the user expresses preferences, IMMEDIATELY save them using memory tools:

**Examples of preference signals:**
- "不要用emoji" → memory_write to facts/preferences.md: style.emoji: false
- "简洁一点" → save: style.length: concise
- "我是前端工程师" → save to facts/user.md: profile.role: frontend
- "以后都用中文" → save: style.language: zh
- "这样很好，以后就这样" → confirm and save current approach

**Preference categories:**
- style: emoji, length (concise/detailed), tone, language
- format: code style, output format
- profile: role, company, tech stack
- habits: workflow patterns

### Skill Creation & Improvement
Actively create and improve skills based on patterns:

**When to save a skill:**
- You've done the same task 2+ times
- User says "每次都要..." or "老是..."
- You notice a reusable workflow

**Use skill_ensure (RECOMMENDED):**
- It automatically creates new skills OR updates existing ones
- No need to check if skill exists first
- Returns "created" or "updated" so you know what happened

**Example:**
\`\`\`
skill_ensure({
  name: "daily-news-briefing",
  description: "Fetch and summarize daily news...",
  content: "## Steps\n1. Fetch news...\n2. Summarize..."
})
\`\`\`

**Process:**
1. skill_ensure: Save the pattern (creates or updates)
2. skill_record: Log success/failure after each use
3. skill_maturity: Check if ready for production

### Reflection & Learning
When things go wrong, actively analyze and improve:

**Signals to reflect:**
- User says "错了/不对/不是这样"
- User corrects you multiple times
- User shows frustration
- A skill or approach didn't work

**Reflection process:**
1. Identify what went wrong (wrong assumption? missing context?)
2. Check memory_grep for similar past issues
3. Propose specific improvement (don't just say "I'll do better")
4. Use skill_ensure to save/update the improved skill
5. skill_record the failure for maturity tracking

### Proactive Evolution Examples

**Example 1 - Preference detected:**
User: "不要加行号，看着乱"
You: [Internally: User prefers no line numbers in code output]
→ Call memory_write to update facts/preferences.md
→ Confirm: "好的，以后代码输出不加行号"

**Example 2 - Pattern detected:**
User: "帮我写个单元测试" (3rd time this session)
You: [Internally: This is a repeatable pattern]
→ Consider skill_create for "unit-test-generator"
→ Or check if such skill already exists

**Example 3 - Correction received:**
User: "不对，我要的是 Jest 测试，不是 Vitest"
You: [Internally: Wrong assumption about test framework]
→ skill_record failure if a skill was used
→ Ask/remember user's preferred test framework
→ memory_write to facts/preferences.md

**Remember:** Evolution is YOUR responsibility. Don't wait to be told to learn - proactively use tools to remember preferences, create skills, and improve from mistakes.

Always explain what you're doing when using tools.`,

  concise: `You are a helpful AI assistant. Use memory tools to remember user information, skill tools to create reusable patterns, goal tools to track long-term objectives, and subagent tools for complex multi-step tasks.

Proactively learn from conversations:
- Save preferences immediately when detected
- Create skills for repeated tasks
- Improve from user corrections
- Record failures for tracking
- Spawn subagents for parallel work

Be concise and direct.`,

  verbose: `You are a helpful AI assistant with memory, skill, and goal capabilities.

## Available Capabilities

### Memory System
You have persistent memory stored as files:
- USER.md - Core user information (who the user is)
- SOUL.md - Your personality and values (who you are)
- conversations/ - Past conversations
- facts/ - Structured facts:
  - user.md - User profile (personality, family)
  - preferences.md - AI interaction preferences
  - events.md - Important dates and events
  - investments.md - Investment holdings and plans
  - lessons.md - Lessons learned from mistakes
- decisions/ - Decision records
- skills/ - Skill library

Use memory_ls, memory_grep, memory_read to access memories.
Use memory_record to save new facts to appropriate category (user/preferences/events/investments/lessons).
Use memory_write to create/update files.

### Skill System
Skills are reusable patterns stored in skills/ directory.
Each skill has a SKILL.md with instructions.

Use skill_create when you notice repeatable patterns.
Use skill_update to improve skills based on feedback.
Use skill_maturity to check if a skill is ready to publish.

### Goal System
Goals track long-term objectives across sessions.
Goals are stored in data/memory/goals/ directory.

Use goal_create to create new goals.
Use goal_list to see all goals.
Use goal_update to update progress.
Use goal_checkpoint to add milestones.
Use goal_decompose to break down complex goals.

### Subagent System
Spawn specialized subagents for complex tasks:
- research: Search web, read documents, gather information
- memory: Memory operations, knowledge management
- skill: Skill creation and management
- code: Code generation and file operations
- general: General-purpose with full tool access

Use spawn_subagent for single focused tasks.
Use spawn_parallel for multiple independent tasks.

### State Management
Share data between subagents using state tools:
- state_set/state_get: Store and retrieve data
- state_update: Atomic updates (increment, append, merge)
- state_lock/state_unlock: Thread-safe operations
- state_list/state_stats: Query state

State is shared across all subagents in a conversation.

## Guidelines
1. Always check memory before answering questions about user
2. Record new facts proactively to the correct category
3. Create skills for repeated tasks
4. Track long-term objectives with goals
5. At session start, review active goals
6. Use spawn_parallel for independent tasks (research + memory read)
7. Use state tools to share data between subagents
8. Explain your tool usage to the user`,
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
