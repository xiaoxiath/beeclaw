#!/usr/bin/env bun
/**
 * Beeclaw CLI - Interactive AI Assistant with Function Calling
 *
 * Usage:
 *   bun run src/cli.ts          # Start interactive chat
 *   bun run src/cli.ts --help   # Show help
 *
 * Note: Bun automatically loads .env file
 */

import { createInterface } from 'readline';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import clipboardy from 'clipboardy';
import { sessionService } from './domain/session/service';
import { getMemoryStore, executeMemoryTool, getMemoryToolsForAI } from './domain/memory';
import { getSkillStore, executeSkillTool, getSkillToolsForAI } from './domain/skills';
import { getGoalStore, executeGoalTool, getGoalToolsForAI } from './domain/agent/goal';
import { getScheduler, getNotificationManager, getDaemon, executeProactiveTool, pushPendingNotifications, formatNotifications, setCliDeliveryHandler } from './domain/proactive';
import { getAllToolsForAI, SYSTEM_PROMPTS } from './domain/agent';
import { getCompressionEngine } from './domain/memory/compression';
import { initTaskManager, createReminderTask, getQueueStatistics } from './infra/queue';
import { initWorkers } from './app/queue-handlers/workers';
import { getPendingNotifications } from './app/queue-handlers/handlers/reminder-handler';
import { LoadingIndicator, formatElapsed, withSpinner, rewriteLine } from './adapter/cli/input';
import { initApp, getAgent, getProvider, getModel, switchModel, isInitialized, getConfig_, getOrCreateSession, continueConversation, listSessions, getSession, deleteSession, getSessionStats, type Session } from './app';
import { recommendSessions, formatRecommendation } from './domain/session/recommender';
import { getPersonaStore, executePersonaTool } from './domain/agent/persona';
import { getMBTIDescription, getOCEANDescription, getOCEANLevel } from './domain/agent/persona/traits';
import type { AIProvider } from './infra/config/schema';

let rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Module-level reference to current agent (for memory refresh command)
let currentAgent: ReturnType<typeof createAgent> | null = null;

// CLI session (unified with Bot)
let cliSession: Session | null = null;

// Background reminder checker
let reminderCheckInterval: NodeJS.Timeout | null = null;

function startBackgroundReminderCheck() {
  if (reminderCheckInterval) return;

  reminderCheckInterval = setInterval(async () => {
    try {
      const notifications = getPendingNotifications('cli-user');
      for (const notification of notifications) {
        console.log(`\n\n⏰ REMINDER: ${notification.message}`);
        console.log(`   (${new Date().toLocaleTimeString()})`);
        process.stdout.write('> ');
      }
    } catch {
      // Queue might not be initialized
    }
  }, 5000); // Check every 5 seconds

  console.log('[Background] Reminder checker started (5s interval)');
}

function stopBackgroundReminderCheck() {
  if (reminderCheckInterval) {
    clearInterval(reminderCheckInterval);
    reminderCheckInterval = null;
    console.log('[Background] Reminder checker stopped');
  }
}

function prompt(query: string): Promise<string> {
  return new Promise((resolve) => {
    // For non-TTY, use simple readline
    if (!process.stdin.isTTY) {
      rl.question(query, resolve);
      return;
    }

    // Close readline to prevent duplicate input handling
    rl.close();

    let buffer = '';
    let typedBeforePaste = ''; // Text typed before paste
    let pastedContent = ''; // Content from clipboard
    let pasteId = 1;
    let lastInputTime = 0;
    let isPasting = false;
    let pasteTimeout: ReturnType<typeof setTimeout> | null = null;

    // Switch to raw mode
    process.stdin.resume();
    process.stdin.setRawMode(true);
    process.stdout.write(query);

    const cleanup = () => {
      if (pasteTimeout) clearTimeout(pasteTimeout);
      process.stdin.setRawMode(false);
      process.stdin.removeListener('data', handler);
      rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
    };

    const readFromClipboard = (): string | null => {
      try {
        return clipboardy.readSync();
      } catch {
        return null;
      }
    };

    const showPasteIndicator = (content: string) => {
      const lines = content.split('\n').length;
      // Show: original_text {Pasted text +N lines}
      const display = typedBeforePaste
        ? `${query}${typedBeforePaste} \x1B[36m{Pasted text #${pasteId} +${lines} lines}\x1B[0m `
        : `${query}\x1B[36m{Pasted text #${pasteId} +${lines} lines}\x1B[0m `;
      process.stdout.write(`\r\x1B[2K${display}`);
      pasteId++;
    };

    const handler = (data: Buffer) => {
      const str = data.toString('utf8');
      const now = Date.now();
      const timeSinceLastInput = now - lastInputTime;
      lastInputTime = now;

      // Detect paste: large chunk (>30 chars)
      const isLargeChunk = str.length > 30;

      // Start paste mode on large chunk
      if (!isPasting && isLargeChunk) {
        isPasting = true;
        // Remember what was typed before paste
        typedBeforePaste = buffer;
        // Read from clipboard
        const clipboardContent = readFromClipboard();
        if (clipboardContent) {
          pastedContent = clipboardContent;
          buffer = typedBeforePaste + pastedContent;
          showPasteIndicator(clipboardContent);
        }
      }

      // Reset paste timeout
      if (pasteTimeout) clearTimeout(pasteTimeout);

      if (isPasting) {
        // Stay in paste mode, ignore stdin content
        pasteTimeout = setTimeout(() => {
          isPasting = false;
        }, 150);
        return;
      }

      // Normal character processing
      for (const char of str) {
        // Ctrl+C - exit
        if (char === '\x03') {
          cleanup();
          console.log('\n👋 Goodbye!');
          process.exit(0);
        }

        // Ctrl+D - submit
        if (char === '\x04') {
          cleanup();
          console.log();
          resolve(buffer);
          return;
        }

        // Ctrl+V - paste from clipboard
        if (char === '\x16') {
          typedBeforePaste = buffer;
          const clipboardContent = readFromClipboard();
          if (clipboardContent) {
            pastedContent = clipboardContent;
            buffer = typedBeforePaste + pastedContent;
            showPasteIndicator(clipboardContent);
          }
          continue;
        }

        // Enter - submit
        if (char === '\r' || char === '\n') {
          // If there was pasted content, show it before submitting
          if (pastedContent) {
            process.stdout.write(`\r\x1B[2K${query}${buffer}\n`);
          } else {
            console.log();
          }
          cleanup();
          resolve(buffer);
          return;
        }

        // Backspace
        if (char === '\x7f' || char === '\x08') {
          if (buffer.length > 0) {
            buffer = buffer.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }

        // Regular character
        if (char.charCodeAt(0) >= 32 || char === '\t') {
          buffer += char;
          process.stdout.write(char);
        }
      }
    };

    process.stdin.on('data', handler);
  });
}

/**
 * Enhanced prompt that handles large pasted content better
 * Uses a chunked approach for very large inputs
 */
function promptEnhanced(query: string): Promise<string> {
  return new Promise((resolve) => {
    // For non-TTY, use simple readline
    if (!process.stdin.isTTY) {
      rl.question(query, resolve);
      return;
    }

    let inputBuffer = '';
    let chunkCount = 0;

    // Show prompt
    process.stdout.write(query);

    // Close readline to prevent duplicate input handling
    rl.close();

    // Handle data in chunks for large pastes
    const dataHandler = (chunk: Buffer) => {
      const str = chunk.toString('utf8');
      inputBuffer += str;
      chunkCount++;

      // Show indicator for large inputs being received
      if (chunkCount > 1 || inputBuffer.length > 100) {
        // Clear line and show progress
        const lines = inputBuffer.split('\n').length;
        const chars = inputBuffer.length;
        process.stdout.write(`\r\x1B[2K${query}\x1B[90m(receiving... ${lines} lines, ${chars} chars)\x1B[0m`);
      }
    };

    // Switch to raw mode for better paste handling
    process.stdin.resume();
    process.stdin.setRawMode(true);

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;

      process.stdin.setRawMode(false);
      process.stdin.off('data', dataHandler);

      // Recreate readline for next prompt
      rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      // Show final input size if large
      if (inputBuffer.length > 100) {
        const lines = inputBuffer.split('\n').length;
        process.stdout.write(`\r\x1B[2K${query}\x1B[90m(${lines} lines, ${inputBuffer.length} chars)\x1B[0m\n`);
      }

      // Clean up the buffer - remove trailing newline if present
      let result = inputBuffer;
      if (result.endsWith('\n') || result.endsWith('\r')) {
        result = result.replace(/[\r\n]+$/, '');
      }

      resolve(result);
    };

    process.stdin.on('data', dataHandler);

    // Set a max timeout for very slow pastes
    setTimeout(() => {
      if (!finished && inputBuffer.length > 0) {
        finish();
      }
    }, 500);
  });
}

function printHelp(): void {
  console.log(`
🐝 Beeclaw CLI - Interactive AI Assistant with Function Calling

Usage:
  bun run src/cli.ts [options]

Options:
  --help, -h     Show this help message
  --memory       Test memory tools directly
  --skills       Test skill tools directly
  --no-tools     Disable function calling (just chat)
  --daemon       Start daemon mode (background scheduling)
  --daemon-stop  Stop daemon process

Commands (in chat):
  Model:
    /model                      Show current model info
    /model list                 List available models
    /model switch <name>        Switch to a different provider/model

  Reminders:
    /reminder                   Show pending reminders
    /reminder add <time> <msg>  Add a reminder (e.g., "10s 喝水", "2h 休息")
    /reminder cancel <id>       Cancel a reminder
    /reminder auto              Toggle auto-check (background mode)
    /auto                       Enable background auto-mode

  Memory:
    /memory ls <path>           List memory directory
    /memory grep <query>        Search memory (full-text)
    /memory search <query>      Search by keyword index
    /memory read <file>         Read memory file
    /memory record <cat> <fact> Record a fact
    /memory refresh             Reload facts/*.md into context
    /memory compress [--dry-run] Compress old memories
    /memory stats               Show compression statistics
    /memory index               Rebuild keyword index

  Skills:
    /skill list                 List all skills
    /skill get <name>           Get skill details
    /skill create <name> <desc> Create a new skill
    /skill search <query>       Search skills
    /skill maturity <name>      Check skill maturity

  Goals:
    /goal                       List all goals
    /goal active                List active goals
    /goal get <id>              Get goal details
    /goal create <title>        Create a new goal
    /goal update <id> <state>   Update goal state (active/paused/completed)
    /goal checkpoint <id> <title> Add a checkpoint to a goal

  Persona (AIEOS):
    /persona                    Show current persona info
    /persona traits             Show personality traits (MBTI, OCEAN)
    /persona export             Export persona as portable package
    /persona explain            Explain what current traits mean
    /goal checkpoint <id> <title> Add a checkpoint to a goal

  Proactive:
    /proactive                  List scheduled tasks
    /proactive add <cron> <type> Add a scheduled task
    /proactive cancel <id>      Cancel a scheduled task
    /notifications              View pending notifications

  General:
    /quit, /exit                Exit the CLI
    /help                       Show available commands
    /clear                      Clear conversation history
    /sessions                   List all sessions
    /multi                      Enter multiline input mode (end with END)
    /tools                      Show available AI tools
    /auto                       Toggle background auto-mode

Built-in Tools Available:
  🌐 web_search    - Search the web
  📄 web_fetch     - Fetch webpage content
  🕐 time_now      - Get current time
  🔢 calc          - Calculate expressions
  💻 code_execute  - Run JavaScript
  🌤️ weather       - Get weather info
  🔗 url_shorten   - Shorten URLs
  📱 qrcode        - Generate QR codes
  🤖 claude_code   - Execute tasks with Claude Code SDK
`);
}

async function testMemoryTools(): Promise<void> {
  console.log('\n📝 Testing Memory Tools...\n');

  const tools = getMemoryToolsForAI();
  console.log('Available tools:', tools.map(t => t.name).join(', '));

  // Test ls
  console.log('\n--- Testing memory_ls ---');
  let result = executeMemoryTool('memory_ls', { path: 'facts' });
  console.log(result.success ? result.data : result.error);

  // Test record
  console.log('\n--- Testing memory_record ---');
  result = executeMemoryTool('memory_record', { category: 'user', fact: 'Testing CLI' });
  console.log(result.success ? result.data : result.error);

  // Test read
  console.log('\n--- Testing memory_read ---');
  result = executeMemoryTool('memory_read', { file: 'facts/user.md' });
  console.log(result.success ? result.data : result.error);

  // Test grep
  console.log('\n--- Testing memory_grep ---');
  result = executeMemoryTool('memory_grep', { query: 'Testing' });
  console.log(result.success ? result.data : result.error);

  console.log('\n✅ Memory tools test complete!\n');
}

async function testSkillTools(): Promise<void> {
  console.log('\n🔧 Testing Skill Tools...\n');

  const tools = getSkillToolsForAI();
  console.log('Available tools:', tools.map(t => t.name).join(', '));

  // Test ensure (create)
  console.log('\n--- Testing skill_ensure (create) ---');
  let result = executeSkillTool('skill_ensure', {
    name: 'test-skill',
    description: 'A test skill for CLI testing',
    content: '# Test Skill\n\nThis is a test skill.',
    tags: ['test'],
  });
  console.log(result.success ? `Created/Updated: ${(result.data as any).name || 'test-skill'}` : result.error);

  // Test list
  console.log('\n--- Testing skill_list ---');
  result = executeSkillTool('skill_list', {});
  console.log(result.success ? `${(result.data as any[]).length} skills found` : result.error);

  // Test get
  console.log('\n--- Testing skill_get ---');
  result = executeSkillTool('skill_get', { name: 'test-skill' });
  console.log(result.success ? `Got: ${(result.data as any).name}` : result.error);

  // Test maturity
  console.log('\n--- Testing skill_maturity ---');
  result = executeSkillTool('skill_maturity', { name: 'test-skill' });
  console.log(result.success ? `Ready: ${(result.data as any).ready}, Score: ${(result.data as any).score}` : result.error);

  // Test delete
  console.log('\n--- Testing skill_delete ---');
  result = executeSkillTool('skill_delete', { name: 'test-skill' });
  console.log(result.success ? 'Deleted!' : result.error);

  console.log('\n✅ Skill tools test complete!\n');
}

async function handleMemoryCommand(input: string): Promise<boolean> {
  const parts = input.slice(8).trim().split(' ');
  const subCmd = parts[0];
  const args = parts.slice(1);

  switch (subCmd) {
    case 'ls': {
      const result = executeMemoryTool('memory_ls', { path: args[0] || '' });
      console.log(result.success ? result.data : `Error: ${result.error}`);
      break;
    }
    case 'grep': {
      const result = executeMemoryTool('memory_grep', { query: args.join(' ') });
      console.log(result.success ? result.data : `Error: ${result.error}`);
      break;
    }
    case 'read': {
      const result = executeMemoryTool('memory_read', { file: args[0] });
      console.log(result.success ? result.data : `Error: ${result.error}`);
      break;
    }
    case 'record': {
      const category = args[0] as 'user' | 'preferences' | 'projects';
      const fact = args.slice(1).join(' ');
      const result = executeMemoryTool('memory_record', { category, fact });
      console.log(result.success ? result.data : `Error: ${result.error}`);
      break;
    }
    case 'refresh': {
      // Reload facts/*.md into agent's system prompt
      if (currentAgent) {
        currentAgent.refreshMemory();
        console.log('✅ Memory refreshed - facts/*.md changes applied\n');
      } else {
        console.log('⚠️  No agent available\n');
      }
      break;
    }
    case 'compress': {
      const dryRun = args.includes('--dry-run');
      const force = args.includes('--force');

      try {
        const { getCompressionEngine } = require('./memory/compression');
        const store = getMemoryStore();
        const engine = getCompressionEngine(store.getBasePath());

        console.log('\n🗜️  Memory Compression\n');

        if (dryRun) {
          console.log('  (Dry run - no changes will be made)\n');
        }

        // Start loading indicator
        const compressLoader = new LoadingIndicator('Compressing memories', '  ');
        compressLoader.start();

        const startTime = Date.now();
        const result = await engine.compress({ dryRun, force });
        const elapsed = formatElapsed(startTime);

        compressLoader.stop();

        console.log(`\n  Results (took ${elapsed}):`);
        console.log(`    Processed: ${result.processed}`);
        console.log(`    Summarized: ${result.summarized}`);
        console.log(`    Archived: ${result.archived}`);
        console.log(`    Deleted: ${result.deleted}`);

        if (result.errors.length > 0) {
          console.log(`\n  Errors:`);
          for (const err of result.errors) {
            console.log(`    - ${err}`);
          }
        }

        console.log('');
      } catch (error) {
        console.log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      break;
    }
    case 'stats': {
      try {
        const { getCompressionEngine } = require('./memory/compression');
        const store = getMemoryStore();
        const engine = getCompressionEngine(store.getBasePath());
        const stats = engine.getStats();

        console.log('\n📊 Memory Compression Stats\n');
        console.log(`  Total runs: ${stats.totalRuns}`);
        console.log(`  Total processed: ${stats.totalProcessed}`);
        console.log(`  Total summarized: ${stats.totalSummarized}`);
        console.log(`  Total archived: ${stats.totalArchived}`);
        console.log(`  Total deleted: ${stats.totalDeleted}`);
        if (stats.lastRun) {
          console.log(`  Last run: ${stats.lastRun}`);
        }
        console.log('');
      } catch (error) {
        console.log('Compression stats not available.');
      }
      break;
    }
    case 'index': {
      try {
        const store = getMemoryStore();
        console.log('\n🔍 Rebuilding Memory Index...\n');

        const startTime = Date.now();
        const result = store.rebuildIndex();
        const elapsed = formatElapsed(startTime);

        if (result.success) {
          console.log(`  ✅ ${result.data}`);
          console.log(`  Took: ${elapsed}\n`);

          const stats = store.getIndexStats();
          if (stats) {
            console.log(`  Facts keywords: ${stats.factsKeywords}`);
            console.log(`  Knowledge keywords: ${stats.knowledgeKeywords}`);
          }
          console.log('');
        } else {
          console.log(`  ❌ Error: ${result.error}\n`);
        }
      } catch (error) {
        console.log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      break;
    }
    case 'search': {
      const query = args.join(' ');
      if (!query) {
        console.log('Usage: /memory search <query>');
        break;
      }
      try {
        const store = getMemoryStore();
        const result = store.searchByKeyword(query);
        console.log(result.success ? `\n${result.data}\n` : `Error: ${result.error}`);
      } catch (error) {
        console.log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      break;
    }
    default:
      console.log('Unknown memory command. Use: ls, grep, read, record, refresh, compress, stats, index, search');
  }

  return true;
}

async function handleSkillCommand(input: string): Promise<boolean> {
  const parts = input.slice(6).trim().split(' ');
  const subCmd = parts[0];
  const args = parts.slice(1);

  switch (subCmd) {
    case 'list': {
      const result = executeSkillTool('skill_list', {});
      if (result.success) {
        const skills = result.data as any[];
        if (skills.length === 0) {
          console.log('No skills found.');
        } else {
          console.log(`\n📚 ${skills.length} Skills:\n`);
          for (const skill of skills) {
            console.log(`  ${skill.name}`);
            console.log(`    ${skill.description}`);
            console.log(`    Maturity: ${skill.maturityScore}% | Uses: ${skill.usageCount}`);
            console.log('');
          }
        }
      } else {
        console.log(`Error: ${result.error}`);
      }
      break;
    }
    case 'get': {
      const name = args[0];
      if (!name) {
        console.log('Usage: /skill get <name>');
        break;
      }
      const result = executeSkillTool('skill_get', { name });
      if (result.success) {
        const skill = result.data as any;
        console.log(`\n📖 ${skill.name}\n`);
        console.log(`Description: ${skill.description}`);
        console.log(`Tags: ${skill.tags.join(', ') || 'none'}`);
        console.log(`Maturity: ${skill.maturityScore}%`);
        console.log(`Usage: ${skill.usageCount} (${skill.successCount} success, ${skill.failureCount} fail)`);
        console.log(`\n--- SKILL.md ---\n${skill.content}`);
      } else {
        console.log(`Error: ${result.error}`);
      }
      break;
    }
    case 'create': {
      const name = args[0];
      const description = args.slice(1).join(' ');
      if (!name || !description) {
        console.log('Usage: /skill create <name> <description>');
        break;
      }
      const result = executeSkillTool('skill_ensure', { name, description });
      console.log(result.success ? `✅ Created skill: ${name}` : `Error: ${result.error}`);
      break;
    }
    case 'search': {
      const query = args.join(' ');
      if (!query) {
        console.log('Usage: /skill search <query>');
        break;
      }
      const result = executeSkillTool('skill_search', { query });
      if (result.success) {
        const skills = result.data as any[];
        console.log(`\n🔍 Found ${skills.length} skills:\n`);
        for (const skill of skills) {
          console.log(`  ${skill.name}: ${skill.description}`);
        }
      } else {
        console.log(`Error: ${result.error}`);
      }
      break;
    }
    case 'maturity': {
      const name = args[0];
      if (!name) {
        console.log('Usage: /skill maturity <name>');
        break;
      }
      const result = executeSkillTool('skill_maturity', { name });
      if (result.success) {
        const assessment = result.data as any;
        console.log(`\n📊 Maturity Assessment for ${name}\n`);
        console.log(`Ready to publish: ${assessment.ready ? '✅ Yes' : '❌ No'}`);
        console.log(`Score: ${assessment.score}%\n`);
        console.log('Checks:');
        console.log(`  Production tested: ${assessment.checks.productionTested ? '✅' : '❌'}`);
        console.log(`  Stable: ${assessment.checks.stable ? '✅' : '❌'}`);
        console.log(`  Well structured: ${assessment.checks.wellStructured ? '✅' : '❌'}`);
        console.log(`  Clean (no secrets): ${assessment.checks.clean ? '✅' : '❌'}`);
        if (assessment.recommendations.length > 0) {
          console.log('\nRecommendations:');
          for (const rec of assessment.recommendations) {
            console.log(`  - ${rec}`);
          }
        }
      } else {
        console.log(`Error: ${result.error}`);
      }
      break;
    }
    case 'delete': {
      const name = args[0];
      if (!name) {
        console.log('Usage: /skill delete <name>');
        break;
      }
      const result = executeSkillTool('skill_delete', { name });
      console.log(result.success ? `🗑️ Deleted skill: ${name}` : `Error: ${result.error}`);
      break;
    }
    default:
      console.log('Unknown skill command. Use: list, get, create, search, maturity, delete');
  }

  return true;
}

async function handleGoalCommand(input: string): Promise<boolean> {
  const parts = input.slice(6).trim().split(' ');
  const subCmd = parts[0]?.toLowerCase() || 'list';
  const args = parts.slice(1);

  switch (subCmd) {
    case '':
    case 'list': {
      const result = executeGoalTool('goal_list', {});
      if (result.success) {
        const goals = result.data as any[];
        if (goals.length === 0) {
          console.log('No goals found.');
        } else {
          console.log(`\n🎯 ${goals.length} Goals:\n`);
          for (const goal of goals) {
            const progressBar = '█'.repeat(Math.floor(goal.progress / 10)) + '░'.repeat(10 - Math.floor(goal.progress / 10));
            const stateEmoji = ({ active: '🟢', paused: '🟡', completed: '✅', cancelled: '❌' } as Record<string, string>)[goal.state] || '⚪';
            console.log(`  ${stateEmoji} ${goal.title}`);
            console.log(`     [${progressBar}] ${goal.progress}% | ${goal.priority} | ${goal.state}`);
            console.log(`     ID: ${goal.id}`);
            console.log('');
          }
        }
      } else {
        console.log(`Error: ${result.error}`);
      }
      break;
    }

    case 'active': {
      const result = executeGoalTool('goal_list', { state: 'active' });
      if (result.success) {
        const goals = result.data as any[];
        if (goals.length === 0) {
          console.log('\n✅ No active goals.\n');
        } else {
          console.log(`\n🟢 ${goals.length} Active Goals:\n`);
          for (const goal of goals) {
            const progressBar = '█'.repeat(Math.floor(goal.progress / 10)) + '░'.repeat(10 - Math.floor(goal.progress / 10));
            console.log(`  ${goal.title}`);
            console.log(`     [${progressBar}] ${goal.progress}% | ${goal.priority}`);
            console.log(`     ID: ${goal.id}`);
            console.log('');
          }
        }
      } else {
        console.log(`Error: ${result.error}`);
      }
      break;
    }

    case 'get': {
      const id = args[0];
      if (!id) {
        console.log('Usage: /goal get <id>');
        break;
      }
      const result = executeGoalTool('goal_get', { id });
      if (result.success) {
        const goal = result.data as any;
        const progressBar = '█'.repeat(Math.floor(goal.progress / 10)) + '░'.repeat(10 - Math.floor(goal.progress / 10));
        console.log(`\n🎯 ${goal.title}\n`);
        console.log(`Description: ${goal.description || '(none)'}`);
        console.log(`State: ${goal.state}`);
        console.log(`Priority: ${goal.priority}`);
        console.log(`Progress: [${progressBar}] ${goal.progress}%`);
        console.log(`ID: ${goal.id}`);
        console.log(`Created: ${goal.createdAt}`);
        if (goal.targetDate) {
          console.log(`Target: ${goal.targetDate}`);
        }
        if (goal.checkpoints && goal.checkpoints.length > 0) {
          console.log(`\nCheckpoints:`);
          for (const cp of goal.checkpoints) {
            const status = cp.completed ? '✅' : '⬜';
            console.log(`  ${status} ${cp.title}`);
          }
        }
        if (goal.context?.why) {
          console.log(`\nWhy: ${goal.context.why}`);
        }
        console.log('');
      } else {
        console.log(`Error: ${result.error}`);
      }
      break;
    }

    case 'create': {
      const title = args.join(' ');
      if (!title) {
        console.log('Usage: /goal create <title>');
        break;
      }
      const result = executeGoalTool('goal_create', { title });
      if (result.success) {
        const goal = result.data as any;
        console.log(`\n✅ Created goal: ${goal.title}`);
        console.log(`   ID: ${goal.id}\n`);
      } else {
        console.log(`Error: ${result.error}`);
      }
      break;
    }

    case 'update': {
      const id = args[0];
      const state = args[1];
      if (!id || !state) {
        console.log('Usage: /goal update <id> <state>');
        console.log('States: active, paused, completed, cancelled\n');
        break;
      }
      const result = executeGoalTool('goal_update', { id, state });
      if (result.success) {
        const goal = result.data as any;
        console.log(`\n✅ Updated goal: ${goal.title}`);
        console.log(`   State: ${goal.state}`);
        console.log(`   Progress: ${goal.progress}%\n`);
      } else {
        console.log(`Error: ${result.error}`);
      }
      break;
    }

    case 'checkpoint':
    case 'cp': {
      const id = args[0];
      const title = args.slice(1).join(' ');
      if (!id || !title) {
        console.log('Usage: /goal checkpoint <goalId> <title>');
        break;
      }
      const result = executeGoalTool('goal_checkpoint', { goalId: id, action: 'add', title });
      if (result.success) {
        const goal = result.data as any;
        console.log(`\n✅ Added checkpoint to: ${goal.title}`);
        console.log(`   Checkpoints: ${goal.checkpoints?.length || 0}\n`);
      } else {
        console.log(`Error: ${result.error}`);
      }
      break;
    }

    case 'complete': {
      const id = args[0];
      if (!id) {
        console.log('Usage: /goal complete <id>');
        break;
      }
      const result = executeGoalTool('goal_update', { id, state: 'completed' });
      if (result.success) {
        const goal = result.data as any;
        console.log(`\n🎉 Goal completed: ${goal.title}\n`);
      } else {
        console.log(`Error: ${result.error}`);
      }
      break;
    }

    case 'delete': {
      const id = args[0];
      if (!id) {
        console.log('Usage: /goal delete <id>');
        break;
      }
      const result = executeGoalTool('goal_delete', { id });
      console.log(result.success ? `\n🗑️ Deleted goal: ${id}\n` : `Error: ${result.error}`);
      break;
    }

    case 'summary': {
      const result = executeGoalTool('goal_summary', {});
      if (result.success) {
        const summary = result.data as any;
        console.log(`\n📊 Goal Summary:\n`);
        console.log(`   Active: ${summary.active}`);
        console.log(`   Paused: ${summary.paused}`);
        console.log(`   Completed: ${summary.completed}`);
        console.log(`   Cancelled: ${summary.cancelled}`);
        console.log(`   Total: ${summary.total}\n`);
      }
      break;
    }

    default:
      console.log('Unknown goal command. Use: list, active, get, create, update, checkpoint, complete, delete, summary');
  }

  return true;
}

async function handleProactiveCommand(input: string): Promise<boolean> {
  // Use a smarter parsing that handles quoted strings for cron expressions
  const rest = input.slice(10).trim();
  const parts = rest.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  const subCmd = parts[0]?.toLowerCase() || 'list';
  const args = parts.slice(1).map(p => p.replace(/^["']|["']$/g, ''));

  switch (subCmd) {
    case '':
    case 'list': {
      const result = executeProactiveTool('proactive_list', { type: 'all' });
      if (result.success) {
        const data = result.data as any;
        console.log('\n⏰ Scheduled Tasks:\n');

        if (data.schedules && data.schedules.length > 0) {
          console.log('  Schedules:');
          for (const s of data.schedules) {
            const status = s.enabled ? '✅' : '⏸️';
            console.log(`    ${status} ${s.name} (${s.cron})`);
            console.log(`       Type: ${s.taskType} | Runs: ${s.runCount} | Next: ${s.nextRun || 'N/A'}`);
            console.log(`       ID: ${s.id}`);
          }
        } else {
          console.log('  No schedules found.');
        }

        console.log('');
        if (data.patterns && data.patterns.length > 0) {
          console.log('  Patterns:');
          for (const p of data.patterns) {
            const status = p.enabled ? '✅' : '⏸️';
            console.log(`    ${status} ${p.name} (${p.triggerType})`);
            console.log(`       Condition: ${p.condition}`);
          }
        }

        console.log('');
      } else {
        console.log(`Error: ${result.error}`);
      }
      break;
    }

    case 'add':
    case 'create': {
      const cron = args[0];
      const taskType = args[1] || 'send_reminder';
      const name = args.slice(2).join(' ') || `Task ${Date.now()}`;

      if (!cron) {
        console.log('Usage: /proactive add <cron> [type] [name]');
        console.log('Cron examples: "*/5 * * * *" (every 5 min), "0 9 * * *" (daily at 9am)\n');
        break;
      }

      const result = executeProactiveTool('proactive_schedule', {
        name,
        cron,
        taskType,
        taskParams: taskType === 'send_reminder' ? { message: name } : {},
      });

      if (result.success) {
        const schedule = result.data as any;
        console.log(`\n✅ Created schedule: ${schedule.name}`);
        console.log(`   ID: ${schedule.id}`);
        console.log(`   Cron: ${schedule.cron}`);
        console.log(`   Next run: ${schedule.nextRun || 'Calculating...'}\n`);
      } else {
        console.log(`Error: ${result.error}`);
      }
      break;
    }

    case 'cancel':
    case 'delete': {
      const id = args[0];
      if (!id) {
        console.log('Usage: /proactive cancel <id>');
        break;
      }
      const result = executeProactiveTool('proactive_cancel', { id, type: 'schedule' });
      console.log(result.success ? `\n🗑️ Cancelled schedule: ${id}\n` : `Error: ${result.error}`);
      break;
    }

    case 'enable': {
      const id = args[0];
      if (!id) {
        console.log('Usage: /proactive enable <id>');
        break;
      }
      const result = executeProactiveTool('proactive_enable', { id });
      console.log(result.success ? `\n✅ Enabled schedule: ${id}\n` : `Error: ${result.error}`);
      break;
    }

    case 'disable': {
      const id = args[0];
      if (!id) {
        console.log('Usage: /proactive disable <id>');
        break;
      }
      const result = executeProactiveTool('proactive_disable', { id });
      console.log(result.success ? `\n⏸️ Disabled schedule: ${id}\n` : `Error: ${result.error}`);
      break;
    }

    default:
      console.log('Unknown proactive command. Use: list, add, cancel, enable, disable');
  }

  return true;
}

async function handleNotificationsCommand(): Promise<void> {
  try {
    const notificationManager = getNotificationManager();
    const notifications = notificationManager.getPending('cli-user');

    console.log('\n📬 Pending Notifications:\n');

    if (notifications.length === 0) {
      console.log('  No pending notifications');
    } else {
      for (const n of notifications) {
        const priorityEmoji = { urgent: '🔴', high: '🟠', normal: '🟢', low: '⚪' }[n.priority];
        console.log(`  ${priorityEmoji} ${n.message}`);
        console.log(`     ID: ${n.id} | Created: ${n.createdAt}`);
        if (n.category) {
          console.log(`     Category: ${n.category}`);
        }
        console.log('');
      }
    }

    console.log('');
  } catch (error) {
    console.log('Notification system not initialized.');
  }
}

async function handlePersonaCommand(input: string): Promise<void> {
  const parts = input.slice(8).trim().split(' ');
  const subCmd = parts[0]?.toLowerCase() || 'info';

  try {
    switch (subCmd) {
      case '':
      case 'info': {
        const store = getPersonaStore();
        const identity = store.getIdentity();
        const traits = store.getTraits();

        console.log('\n🎭 Current Persona\n');

        if (identity) {
          console.log(`  Name: ${identity.name}`);
          console.log(`  Version: ${identity.version}`);
          if (identity.description) {
            console.log(`  Description: ${identity.description}`);
          }
          if (identity.tags.length > 0) {
            console.log(`  Tags: ${identity.tags.join(', ')}`);
          }
        }

        if (traits.mbti) {
          console.log(`\n  MBTI: ${traits.mbti}`);
          console.log(`    ${getMBTIDescription(traits.mbti)}`);
        }

        console.log('');
        break;
      }

      case 'traits': {
        const result = executePersonaTool('persona_get', { section: 'traits' });

        if (result.success && result.data) {
          const traits = result.data as any;

          console.log('\n🧠 Personality Traits\n');

          if (traits.mbti) {
            console.log(`  MBTI: ${traits.mbti}`);
            console.log(`    ${getMBTIDescription(traits.mbti)}`);
            console.log('');
          }

          if (traits.ocean) {
            console.log('  OCEAN (Big Five):');
            for (const [key, value] of Object.entries(traits.ocean)) {
              const level = getOCEANLevel(key as any, value as number);
              const bar = '█'.repeat(Math.round((value as number) * 10)) + '░'.repeat(10 - Math.round((value as number) * 10));
              console.log(`    ${key.padEnd(16)} [${bar}] ${Math.round((value as number) * 100)}% (${level})`);
            }
            console.log('');
          }

          if (traits.linguisticStyle) {
            console.log('  Linguistic Style:');
            const style = traits.linguisticStyle;
            for (const [key, value] of Object.entries(style)) {
              const bar = '█'.repeat(Math.round((value as number) * 10)) + '░'.repeat(10 - Math.round((value as number) * 10));
              console.log(`    ${key.padEnd(16)} [${bar}] ${Math.round((value as number) * 100)}%`);
            }
            console.log('');
          }

          if (traits.motivation) {
            console.log('  Core Motivations:');
            if (traits.motivation.primary?.length > 0) {
              console.log(`    Primary: ${traits.motivation.primary.join(', ')}`);
            }
            if (traits.motivation.secondary?.length > 0) {
              console.log(`    Secondary: ${traits.motivation.secondary.join(', ')}`);
            }
            if (traits.motivation.avoided?.length > 0) {
              console.log(`    Avoided: ${traits.motivation.avoided.join(', ')}`);
            }
            console.log('');
          }
        } else {
          console.log('Error loading traits');
        }
        break;
      }

      case 'export': {
        const result = executePersonaTool('persona_export', { includeMemories: true });

        if (result.success && result.data) {
          const pkg = result.data as any;
          const filename = `persona-${Date.now()}.json`;
          writeFileSync(filename, JSON.stringify(pkg, null, 2));
          console.log(`\n📤 Persona exported to: ${filename}\n`);
          console.log(`  Schema: ${pkg.schema}`);
          console.log(`  Exported at: ${pkg.exportedAt}`);
          console.log('');
        } else {
          console.log(`Error: ${result.error}`);
        }
        break;
      }

      case 'explain': {
        const result = executePersonaTool('persona_explain_traits', {});

        if (result.success && result.data) {
          console.log('\n📚 Trait Explanation\n');
          console.log(result.data);
          console.log('');
        } else {
          console.log(`Error: ${result.error}`);
        }
        break;
      }

      default:
        console.log('\nUnknown persona command.');
        console.log('Usage:');
        console.log('  /persona          - Show persona info');
        console.log('  /persona traits   - Show detailed traits');
        console.log('  /persona export   - Export persona');
        console.log('  /persona explain  - Explain current traits\n');
    }
  } catch (error) {
    console.log('Persona system not initialized.');
    console.log(error);
  }
}

// Store active reminders for this session
const activeReminders: Map<string, { timer: NodeJS.Timeout; message: string; time: Date }> = new Map();

async function handleReminderCommand(input: string): Promise<void> {
  const parts = input.slice(10).trim().split(' ');
  const subCmd = parts[0]?.toLowerCase();

  switch (subCmd) {
    case '':
    case 'list': {
      console.log('\n⏰ Pending Reminders:\n');
      if (activeReminders.size === 0) {
        console.log('  No pending reminders');
      } else {
        let i = 1;
        for (const [id, reminder] of activeReminders) {
          const remaining = Math.max(0, reminder.time.getTime() - Date.now());
          const seconds = Math.floor(remaining / 1000);
          console.log(`  ${i}. [${id}] "${reminder.message}" in ${seconds}s`);
          i++;
        }
      }
      console.log('');
      break;
    }

    case 'add':
    case 'set': {
      const timeStr = parts[1];
      const message = parts.slice(2).join(' ');

      if (!timeStr || !message) {
        console.log('Usage: /reminder add <time> <message>');
        console.log('Time formats: 10s, 5m, 2h, 1d, or "9:00" (24h format)\n');
        break;
      }

      // Parse time
      let delayMs: number;
      const timeMatch = timeStr.match(/^(\d+)(s|m|h|d)?$/);

      if (timeMatch) {
        const value = parseInt(timeMatch[1], 10);
        const unit = timeMatch[2] || 's';
        const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
        delayMs = value * multipliers[unit];
      } else {
        // Try HH:MM format
        const hourMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
        if (hourMatch) {
          const hours = parseInt(hourMatch[1], 10);
          const minutes = parseInt(hourMatch[2], 10);
          const now = new Date();
          const target = new Date(now);
          target.setHours(hours, minutes, 0, 0);
          if (target.getTime() <= now.getTime()) {
            target.setDate(target.getDate() + 1); // Tomorrow
          }
          delayMs = target.getTime() - now.getTime();
        } else {
          console.log('Invalid time format. Use: 10s, 5m, 2h, 1d, or 9:00\n');
          break;
        }
      }

      const reminderId = `reminder-${Date.now()}`;
      const triggerTime = new Date(Date.now() + delayMs);

      // Set up local timer for immediate notification
      const timer = setTimeout(() => {
        console.log(`\n\n⏰ REMINDER: ${message}`);
        console.log(`   (Press Enter to continue)\n`);
        process.stdout.write('> ');
        activeReminders.delete(reminderId);
      }, delayMs);

      activeReminders.set(reminderId, { timer, message, time: triggerTime });

      // Also create queue task for persistence
      try {
        await createReminderTask('cli-user', message, { delay: delayMs });
      } catch {
        // Queue might not be initialized, that's OK for CLI
      }

      const delayStr = delayMs < 60000
        ? `${Math.round(delayMs / 1000)}s`
        : delayMs < 3600000
        ? `${Math.round(delayMs / 60000)}m`
        : `${Math.round(delayMs / 3600000)}h`;

      console.log(`\n✅ Reminder set for ${delayStr} from now (${triggerTime.toLocaleTimeString()})`);
      console.log(`   Message: "${message}"\n`);
      break;
    }

    case 'cancel':
    case 'remove':
    case 'delete': {
      const id = parts[1];
      if (!id) {
        console.log('Usage: /reminder cancel <id>');
        console.log('Use /reminder to see IDs\n');
        break;
      }

      const reminder = activeReminders.get(id);
      if (reminder) {
        clearTimeout(reminder.timer);
        activeReminders.delete(id);
        console.log(`\n✅ Reminder cancelled: "${reminder.message}"\n`);
      } else {
        // Try to cancel by index
        const index = parseInt(id, 10) - 1;
        if (!isNaN(index) && index >= 0 && index < activeReminders.size) {
          const keys = Array.from(activeReminders.keys());
          const key = keys[index];
          const r = activeReminders.get(key);
          if (r) {
            clearTimeout(r.timer);
            activeReminders.delete(key);
            console.log(`\n✅ Reminder cancelled: "${r.message}"\n`);
          }
        } else {
          console.log(`\n❌ Reminder not found: ${id}\n`);
        }
      }
      break;
    }

    case 'auto': {
      // Toggle background reminder checking
      if (reminderCheckInterval) {
        stopBackgroundReminderCheck();
        console.log('\n⏸️  Background reminder checking disabled\n');
      } else {
        startBackgroundReminderCheck();
        console.log('\n▶️  Background reminder checking enabled');
        console.log('   Will check every 5 seconds for due reminders\n');
      }
      break;
    }

    default:
      console.log('Unknown reminder command. Use: list, add, cancel, auto\n');
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  // Show startup banner
  console.log('🐝 Beeclaw CLI');
  console.log('Type /help for available commands, /quit to exit\n');

  // Initialize app (unified initialization)
  const initLoader = new LoadingIndicator('Initializing', '');
  initLoader.start();

  let config, currentProvider, currentModel;
  try {
    const app = await initApp();
    config = app.config;
    currentProvider = app.provider;
    currentModel = app.model;
    currentAgent = app.agent;
  } catch (error) {
    initLoader.stop();
    console.error('Failed to initialize:', error);
    process.exit(1);
  }
  initLoader.stop();

  // Initialize skill store separately (has its own path structure)
  getSkillStore(
    config.skills?.userPath || config.memory.path + '/skills',
    config.skills?.builtinPath
  );

  if (args.includes('--memory')) {
    await testMemoryTools();
    process.exit(0);
  }

  if (args.includes('--skills')) {
    await testSkillTools();
    process.exit(0);
  }

  // Daemon mode
  if (args.includes('--daemon')) {
    console.log('🐝 Starting Beeclaw daemon...\n');

    const daemonLoader = new LoadingIndicator('Starting daemon', '');
    daemonLoader.start();

    const daemon = getDaemon(config.memory.path + '/daemon');

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n[Daemon] Received SIGINT, shutting down...');
      await daemon.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n[Daemon] Received SIGTERM, shutting down...');
      await daemon.stop();
      process.exit(0);
    });

    await daemon.start({
      checkIntervalMs: 60000,
      heartbeatIntervalMs: 30000,
    });

    daemonLoader.stop();
    console.log('[Daemon] Running... Press Ctrl+C to stop');
    await new Promise(() => {});
    return;
  }

  // Stop daemon
  if (args.includes('--daemon-stop')) {
    console.log('🐝 Stopping Beeclaw daemon...\n');

    try {
      const daemon = getDaemon(config.memory.path + '/daemon');
      if (daemon.isRunning()) {
        const stopLoader = new LoadingIndicator('Stopping daemon', '');
        stopLoader.start();
        await daemon.stop();
        stopLoader.success('Daemon stopped');
      } else {
        console.log('ℹ️  Daemon is not running');
      }
    } catch (error) {
      console.log('❌ Failed to stop daemon:', error instanceof Error ? error.message : 'Unknown error');
    }

    process.exit(0);
  }

  // Get agent configuration
  const agentConfig = config.agents[0];
  const useTools = !args.includes('--no-tools');

  try {
    console.log('✅ Systems initialized');
    console.log('📁 Memory:', config.memory.path);

    // Create or get CLI session (unified with Bot)
    const userId = process.env.USER || process.env.USERNAME || 'cli-user';
    const sessionId = `cli-${userId}-${new Date().toISOString().split('T')[0]}`; // Daily session
    cliSession = getOrCreateSession({
      sessionId,
      userId,
      channel: 'cli',
      metadata: {
        hostname: require('os').hostname(),
        platform: process.platform,
      },
    });
    console.log(`📬 Session: ${sessionId} (${cliSession.messages.length} messages)`);

    // Smart session recommendations
    try {
      const recommendations = recommendSessions({
        workingDirectory: process.cwd(),
        currentTime: new Date(),
      }, {
        maxRecommendations: 3,
        minRelevanceScore: 0.3,
      });

      if (recommendations.length > 0) {
        console.log('\n💡 Related sessions found:');
        for (let i = 0; i < recommendations.length; i++) {
          console.log(formatRecommendation(recommendations[i], i));
        }
        console.log('   Use /sessions to see all sessions');
      }
    } catch (error) {
      // Recommender might fail, that's ok
    }

    // Show core memory files
    const memoryStore = getMemoryStore();
    const coreContext = memoryStore.getCoreContext();
    const userStatus = coreContext.user ? '✅' : '❌';
    const soulStatus = coreContext.soul ? '✅' : '❌';
    console.log(`   ${userStatus} USER.md - 用户信息`);
    console.log(`   ${soulStatus} SOUL.md - AI人格`);

    if (currentProvider) {
      console.log('🤖 Provider:', currentProvider.name);
      console.log('📝 Model:', currentModel);
    }

    // Register CLI delivery handler for real-time notifications
    setCliDeliveryHandler((message, priority) => {
      const emoji = { low: '⚪', normal: '🟢', high: '🟠', urgent: '🔴' }[priority] || '🟢';
      console.log(`\n${emoji} ${message}\n`);
    });

    // Display pending notifications on startup
    try {
      const { pushed, notifications } = await pushPendingNotifications();
      if (pushed > 0) {
        console.log(`\n📬 ${pushed} pending notification${pushed > 1 ? 's' : ''} delivered:`);
        for (const n of notifications) {
          const priorityEmoji = { low: '⚪', normal: '🟢', high: '🟠', urgent: '🔴' }[n.priority] || '🟢';
          const category = n.category ? `[${n.category}]` : '';
          console.log(`   ${priorityEmoji} ${category} ${n.message}`);
        }
        console.log('');
      }
    } catch {
      // Notifications might not be initialized
    }

    console.log('');
  } catch (error) {
    console.error('Failed to initialize:', error);
    process.exit(1);
  }

  // Model command handler
  async function handleModelCommand(input: string): Promise<void> {
    const parts = input.slice(7).trim().split(' ');
    const subCmd = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    switch (subCmd) {
      case '':
      case 'info':
      case undefined: {
        // Show current model info
        console.log('\n📊 Current Model Info:\n');
        if (currentProvider) {
          console.log(`  Provider: ${currentProvider.name} (${currentProvider.type})`);
          console.log(`  Model: ${currentModel}`);
          console.log(`  Base URL: ${currentProvider.baseUrl || 'default'}`);
        } else {
          console.log('  No provider configured');
        }
        console.log('');
        break;
      }

      case 'list': {
        console.log('\n📋 Available Providers & Models:\n');
        for (const provider of config.providers) {
          const isDefault = provider.default ? ' (default)' : '';
          const isCurrent = provider === currentProvider ? ' ✓' : '';
          console.log(`  ${provider.name}${isDefault}${isCurrent}`);
          console.log(`    Type: ${provider.type}`);
          if (provider.baseUrl) {
            console.log(`    Base URL: ${provider.baseUrl}`);
          }
          if (provider.models.length > 0) {
            console.log(`    Models: ${provider.models.join(', ')}`);
          }
          console.log('');
        }
        break;
      }

      case 'switch': {
        const providerName = args[0];
        const modelName = args[1];

        if (!providerName) {
          console.log('Usage: /model switch <provider> [model]');
          console.log('Use /model list to see available providers\n');
          break;
        }

        // Find provider
        const newProvider = config.providers.find(
          p => p.name.toLowerCase() === providerName.toLowerCase()
        );

        if (!newProvider) {
          console.log(`❌ Provider "${providerName}" not found`);
          console.log('Use /model list to see available providers\n');
          break;
        }

        // Use provided model or first available
        const newModel = modelName || newProvider.models[0] || currentModel;

        // Switch model using unified function
        try {
          const result = switchModel(newModel, providerName);
          currentProvider = result.provider;
          currentModel = result.model;
          currentAgent = result.agent;
          console.log(`\n✅ Switched to ${currentProvider.name} / ${currentModel}\n`);
        } catch (error) {
          console.log(`\n❌ Failed to switch: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
        }
        break;
      }

      default:
        console.log('Unknown model command. Use: info, list, switch\n');
    }
  }

  // Interactive loop
  console.log('💬 Start chatting');
  if (useTools && currentProvider) {
    console.log('   AI has access to memory and skill tools');
    console.log('   Type /model to see current model, /model list to see all\n');
  } else {
    console.log('   Tool calling disabled or no provider\n');
  }

  let running = true;
  while (running) {
    const input = await prompt('> ');

    if (!input.trim()) continue;

    // Handle special commands
    if (input.startsWith('/')) {
      const cmd = input.toLowerCase();

      if (cmd === '/quit' || cmd === '/exit') {
        running = false;
        console.log('👋 Goodbye!');
        continue;
      }

      if (cmd === '/help') {
        printHelp();
        continue;
      }

      if (cmd === '/clear') {
        currentAgent?.clearHistory();
        console.log('✅ Conversation history cleared.\n');
        continue;
      }

      if (cmd === '/sessions' || cmd === '/session') {
        // List all sessions
        const allSessions = listSessions();

        if (allSessions.length === 0) {
          console.log('\n📭 No sessions found.\n');
        } else {
          console.log(`\n📋 ${allSessions.length} Sessions:\n`);

          // Group by channel
          const byChannel: Record<string, typeof allSessions> = {};
          for (const session of allSessions) {
            if (!byChannel[session.channel]) {
              byChannel[session.channel] = [];
            }
            byChannel[session.channel].push(session);
          }

          // Display sessions by channel
          for (const [channel, sessions] of Object.entries(byChannel)) {
            console.log(`  ${channel.toUpperCase()} (${sessions.length}):`);

            // Sort by update time
            sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

            // Show top 5 per channel
            const topSessions = sessions.slice(0, 5);
            for (const session of topSessions) {
              const date = new Date(session.updatedAt).toLocaleDateString('zh-CN', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });
              const current = session.id === cliSession?.id ? ' ✓' : '';
              console.log(`    • ${session.id} (${session.messages.length} msgs, ${date})${current}`);
            }

            if (sessions.length > 5) {
              console.log(`    ... and ${sessions.length - 5} more`);
            }
            console.log('');
          }
        }
        continue;
      }

      if (cmd === '/multi' || cmd === '/multiline') {
        // Enter multiline input mode
        console.log('\n📝 Multiline mode - type END on a new line to finish:\n');
        const lines: string[] = [];

        while (true) {
          const line = await prompt('... ');
          if (line.trim() === 'END') {
            break;
          }
          lines.push(line);
        }

        const multilineInput = lines.join('\n');
        if (multilineInput.trim()) {
          console.log(`\x1B[90m  📋 Received ${lines.length} lines (${multilineInput.length} chars)\x1B[0m`);

          // Process this input using unified session manager
          if (cliSession && currentProvider) {
            try {
              const loading = new LoadingIndicator('Thinking', '');
              loading.start();
              const startTime = Date.now();

              const result = await continueConversation(cliSession.id, multilineInput);

              const elapsed = formatElapsed(startTime);
              loading.stop();

              if (result.success && result.response) {
                console.log(`\n🤖 \x1B[90m(${elapsed})\x1B[0m`);
                console.log(result.response);
                console.log('');
              } else {
                console.log(`\n❌ Error: ${result.error || 'Unknown error'}\n`);
              }
            } catch (error) {
              console.error('\n❌ Error:', error instanceof Error ? error.message : 'Unknown error');
              console.log('');
            }
          }
        } else {
          console.log('  (empty input, ignored)\n');
        }
        continue;
      }

      if (cmd === '/tools') {
        const tools = getAllToolsForAI();
        console.log(`\n🔧 ${tools.length} AI Tools Available:\n`);
        for (const tool of tools) {
          console.log(`  ${tool.function.name}`);
          console.log(`    ${tool.function.description}`);
        }
        console.log('');
        continue;
      }

      if (cmd === '/auto') {
        if (reminderCheckInterval) {
          stopBackgroundReminderCheck();
          console.log('\n⏸️  Background mode disabled\n');
        } else {
          startBackgroundReminderCheck();
          console.log('\n▶️  Background mode enabled');
          console.log('   - Auto-checking reminders every 5s');
          console.log('   - Auto-refreshing memory before chat\n');
        }
        continue;
      }

      if (input.startsWith('/model')) {
        await handleModelCommand(input);
        continue;
      }

      if (input.startsWith('/memory ')) {
        await handleMemoryCommand(input);
        continue;
      }

      if (input.startsWith('/skill ')) {
        await handleSkillCommand(input);
        continue;
      }

      if (input.startsWith('/goal')) {
        await handleGoalCommand(input);
        continue;
      }

      if (input.startsWith('/persona')) {
        await handlePersonaCommand(input);
        continue;
      }

      if (input.startsWith('/proactive')) {
        await handleProactiveCommand(input);
        continue;
      }

      if (input.startsWith('/notifications')) {
        await handleNotificationsCommand();
        continue;
      }

      if (input.startsWith('/reminder')) {
        await handleReminderCommand(input);
        continue;
      }

      console.log('Unknown command. Type /help for available commands.');
      continue;
    }

    // Chat with AI (using unified session manager)
    if (cliSession && currentProvider) {
      try {
        // Show input stats for large inputs
        if (input.length > 500) {
          const lines = input.split('\n').length;
          console.log(`\x1B[90m  📋 Processing ${lines} lines (${input.length} chars)...\x1B[0m`);
        }

        // Start loading indicator
        const loading = new LoadingIndicator('Thinking', '');
        loading.start();
        const startTime = Date.now();

        // Use unified session manager
        const result = await continueConversation(cliSession.id, input);

        // Stop loading and show elapsed time
        const elapsed = formatElapsed(startTime);
        loading.stop();

        if (result.success && result.response) {
          // Show response with timing info
          console.log(`\n🤖 \x1B[90m(${elapsed})\x1B[0m`);
          console.log(result.response);
          console.log('');
        } else {
          console.log(`\n❌ Error: ${result.error || 'Unknown error'}\n`);
        }
      } catch (error) {
        console.error('\n❌ Error:', error instanceof Error ? error.message : 'Unknown error');
        console.log('');
      }
    } else {
      // No provider, just record
      console.log('\n⚠️  No AI provider. Configure one to enable chat.\n');

      const memStore = getMemoryStore();
      memStore.recordConversation({
        timestamp: new Date().toISOString(),
        source: 'cli',
        user: input,
        assistant: '[No AI provider configured]',
      });
    }
  }

  rl.close();
}

main().catch(console.error);
