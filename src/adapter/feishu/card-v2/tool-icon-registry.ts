/**
 * Tool Icon Registry
 *
 * Maps tool names to their icons and generates step descriptions.
 * Extensible registry for custom tool icons.
 */

import { IconToken } from './types/styles';

/**
 * Tool icon entry definition
 */
export interface ToolIconEntry {
  /**
   * Feishu standard icon token
   */
  iconToken: string;

  /**
   * Generate step description from tool input
   */
  label: (input: any) => string;
}

/**
 * Tool Icon Registry
 * Maps tool names to icon configurations
 */
export class ToolIconRegistry {
  private registry: Map<string, ToolIconEntry> = new Map();

  constructor() {
    // Register core Beeclaw tools
    this.registerCoreTools();
  }

  /**
   * Register a tool icon
   */
  register(toolName: string, entry: ToolIconEntry): void {
    this.registry.set(toolName, entry);
  }

  /**
   * Get tool icon entry
   */
  get(toolName: string): ToolIconEntry | undefined {
    return this.registry.get(toolName);
  }

  /**
   * Check if tool is registered
   */
  has(toolName: string): boolean {
    return this.registry.has(toolName);
  }

  /**
   * Get icon token for tool
   */
  getIconToken(toolName: string): string {
    const entry = this.registry.get(toolName);
    return entry?.iconToken ?? IconToken.Code; // Default icon
  }

  /**
   * Generate step description for tool
   */
  generateLabel(toolName: string, input: any): string {
    const entry = this.registry.get(toolName);
    if (entry) {
      return entry.label(input);
    }
    // Default label
    return `Executing ${toolName}`;
  }

  /**
   * Register core Beeclaw tools
   */
  private registerCoreTools(): void {
    // Web Search
    this.register('web_search', {
      iconToken: IconToken.Search,
      label: (input) => {
        const query = input?.query || input?.q || 'web';
        return `Searching for "${query}"`;
      },
    });

    // Bash/Shell Commands
    this.register('Bash', {
      iconToken: IconToken.Terminal,
      label: (input) => {
        const cmd = input?.command || input?.cmd || 'command';
        const shortCmd = cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd;
        return `Running: ${shortCmd}`;
      },
    });

    // File Operations
    this.register('Read', {
      iconToken: IconToken.Folder,
      label: (input) => {
        const path = input?.file_path || input?.path || 'file';
        return `Reading ${path}`;
      },
    });

    this.register('Write', {
      iconToken: IconToken.Edit,
      label: (input) => {
        const path = input?.file_path || input?.path || 'file';
        return `Writing ${path}`;
      },
    });

    this.register('Edit', {
      iconToken: IconToken.Edit,
      label: (input) => {
        const path = input?.file_path || input?.path || 'file';
        return `Editing ${path}`;
      },
    });

    // Glob/Grep
    this.register('Glob', {
      iconToken: IconToken.Search,
      label: (input) => {
        const pattern = input?.pattern || 'pattern';
        return `Finding files matching "${pattern}"`;
      },
    });

    this.register('Grep', {
      iconToken: IconToken.Search,
      label: (input) => {
        const pattern = input?.pattern || 'pattern';
        return `Searching for "${pattern}" in files`;
      },
    });

    // Memory Tools
    this.register('memory_write', {
      iconToken: IconToken.Edit,
      label: (input) => {
        const category = input?.category || 'memory';
        return `Writing to ${category} memory`;
      },
    });

    this.register('memory_read', {
      iconToken: IconToken.Folder,
      label: (input) => {
        const id = input?.id || 'memory';
        return `Reading memory ${id}`;
      },
    });

    this.register('memory_ls', {
      iconToken: IconToken.Folder,
      label: (input) => {
        const category = input?.category || 'all';
        return `Listing ${category} memories`;
      },
    });

    this.register('memory_grep', {
      iconToken: IconToken.Search,
      label: (input) => {
        const pattern = input?.pattern || 'pattern';
        return `Searching memories for "${pattern}"`;
      },
    });

    this.register('memory_record', {
      iconToken: IconToken.Edit,
      label: () => 'Recording new memory',
    });

    // Skill Tools
    this.register('skill_get', {
      iconToken: IconToken.Robot,
      label: (input) => {
        const name = input?.name || 'skill';
        return `Loading skill: ${name}`;
      },
    });

    this.register('skill_list', {
      iconToken: IconToken.Folder,
      label: () => 'Listing available skills',
    });

    this.register('skill_ensure', {
      iconToken: IconToken.Edit,
      label: (input) => {
        const name = input?.name || 'skill';
        return `Creating/updating skill: ${name}`;
      },
    });

    // Task Management
    this.register('TaskCreate', {
      iconToken: IconToken.Edit,
      label: (input) => {
        const subject = input?.subject || 'task';
        return `Creating task: ${subject}`;
      },
    });

    this.register('TaskUpdate', {
      iconToken: IconToken.Edit,
      label: (input) => {
        const taskId = input?.taskId || 'task';
        return `Updating task ${taskId}`;
      },
    });

    this.register('TaskList', {
      iconToken: IconToken.Folder,
      label: () => 'Listing tasks',
    });

    this.register('TaskGet', {
      iconToken: IconToken.Folder,
      label: (input) => {
        const taskId = input?.taskId || 'task';
        return `Getting task ${taskId}`;
      },
    });

    // Web Fetch
    this.register('WebFetch', {
      iconToken: IconToken.Globe,
      label: (input) => {
        const url = input?.url || 'URL';
        const shortUrl = url.length > 50 ? url.substring(0, 50) + '...' : url;
        return `Fetching ${shortUrl}`;
      },
    });

    // Agent Tools
    this.register('Agent', {
      iconToken: IconToken.Robot,
      label: (input) => {
        const subagent_type = input?.subagent_type || 'agent';
        return `Launching ${subagent_type} agent`;
      },
    });

    // Ask User
    this.register('AskUserQuestion', {
      iconToken: IconToken.Chat,
      label: () => 'Asking user for input',
    });

    // Cron/Scheduling
    this.register('CronCreate', {
      iconToken: IconToken.Clock,
      label: (input) => {
        const cron = input?.cron || 'schedule';
        return `Creating schedule: ${cron}`;
      },
    });

    this.register('CronDelete', {
      iconToken: IconToken.Edit,
      label: (input) => {
        const id = input?.id || 'schedule';
        return `Deleting schedule ${id}`;
      },
    });

    this.register('CronList', {
      iconToken: IconToken.Folder,
      label: () => 'Listing schedules',
    });

    // Worktree
    this.register('EnterWorktree', {
      iconToken: IconToken.Folder,
      label: (input) => {
        const name = input?.name || 'worktree';
        return `Entering worktree: ${name}`;
      },
    });

    this.register('ExitWorktree', {
      iconToken: IconToken.Folder,
      label: () => 'Exiting worktree',
    });

    // Git Operations
    this.register('git_status', {
      iconToken: IconToken.Folder,
      label: () => 'Checking git status',
    });

    this.register('git_commit', {
      iconToken: IconToken.Edit,
      label: () => 'Creating git commit',
    });

    this.register('git_push', {
      iconToken: IconToken.ArrowRight,
      label: () => 'Pushing to remote',
    });

    // Code Analysis
    this.register('analyze_image', {
      iconToken: IconToken.Search,
      label: () => 'Analyzing image',
    });

    // MCP Tools
    this.register('mcp__web_reader__webReader', {
      iconToken: IconToken.Globe,
      label: (input) => {
        const url = input?.url || 'URL';
        const shortUrl = url.length > 50 ? url.substring(0, 50) + '...' : url;
        return `Reading ${shortUrl}`;
      },
    });

    // Default for unknown tools
    this.register('default', {
      iconToken: IconToken.Code,
      label: (_input, toolName) => `Executing ${toolName}`,
    });
  }
}

/**
 * Global tool icon registry instance
 */
export const toolIconRegistry = new ToolIconRegistry();
