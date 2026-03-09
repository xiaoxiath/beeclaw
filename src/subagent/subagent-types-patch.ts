/**
 * subagent-types-patch.ts — 研究子 Agent 能力扩展补丁
 * 
 * 扩展 BeeClaw 现有 SubAgentType 定义，为 research 类型子 Agent 增加：
 * 1. 写入能力 (memory_write, memory_record)
 * 2. 状态管理 (state_get, state_set)
 * 3. 目标检查点 (goal_checkpoint)
 * 4. 递归研究 (deep_research) —— 子 Agent 可发起子研究
 * 5. 制品管理 (artifact_save, artifact_load)
 * 
 * 与 BeeClaw 现有架构的集成点：
 * - src/subagent/types.ts      → 扩展 SubAgentType 接口
 * - src/subagent/factory.ts    → 扩展工厂创建逻辑
 * - src/subagent/scheduler.ts  → 保持兼容（无需修改）
 * - src/tools/builtin.ts       → 注册新工具
 * 
 * 设计原则：
 * - 最小侵入：使用 TypeScript 模块扩充（module augmentation）
 * - 向后兼容：现有 research 子 Agent 无需修改即可运行
 * - 渐进启用：新能力通过 capability flags 控制
 * 
 * @module subagent-types-patch
 */

// ============================================================
// 能力标志位
// ============================================================

/**
 * 研究子 Agent 能力标志
 * 
 * 与 BeeClaw 的 SubAgentConfig 扩展集成
 */
export interface ResearchCapabilities {
  /** 是否允许写入 memory */
  canWriteMemory: boolean;
  /** 是否允许管理制品 */
  canManageArtifacts: boolean;
  /** 是否允许发起子研究 */
  canRecurseResearch: boolean;
  /** 子研究最大深度 */
  maxRecursionDepth: number;
  /** 是否允许状态管理 */
  canManageState: boolean;
  /** 是否允许设置目标检查点 */
  canSetCheckpoints: boolean;
  /** 最大工具调用次数（覆盖默认值） */
  maxToolCalls?: number;
}

/** 默认能力配置 */
export const DEFAULT_RESEARCH_CAPABILITIES: ResearchCapabilities = {
  canWriteMemory: false,
  canManageArtifacts: false,
  canRecurseResearch: false,
  maxRecursionDepth: 1,
  canManageState: false,
  canSetCheckpoints: false,
};

/** 增强型研究能力（显式启用后） */
export const ENHANCED_RESEARCH_CAPABILITIES: ResearchCapabilities = {
  canWriteMemory: true,
  canManageArtifacts: true,
  canRecurseResearch: true,
  maxRecursionDepth: 2,
  canManageState: true,
  canSetCheckpoints: true,
  maxToolCalls: 50,
};

// ============================================================
// 扩展的子 Agent 类型
// ============================================================

/**
 * 扩展的研究子 Agent 配置
 * 
 * 与 BeeClaw 现有 SubAgentConfig 合并使用：
 * 
 * ```ts
 * // 在 types.ts 中
 * export interface SubAgentConfig {
 *   type: SubAgentType;
 *   name: string;
 *   tools: string[];
 *   // ... 现有字段
 *   researchCapabilities?: ResearchCapabilities; // ← 新增
 * }
 * ```
 */
export interface ExtendedResearchSubAgentConfig {
  type: 'research';
  name: string;

  /** 原有工具（只读） */
  baseTools: string[];

  /** 新增工具（根据 capabilities 动态注入） */
  extendedTools: string[];

  /** 研究能力配置 */
  capabilities: ResearchCapabilities;

  /** 研究上下文 */
  researchContext?: {
    parentSessionId?: string;
    assignedAspect?: string;
    maxContentPerSource?: number;
    synthesisGuidelines?: string;
  };
}

// ============================================================
// 新增工具定义
// ============================================================

/**
 * 研究子 Agent 新增工具的规范定义
 * 
 * 这些定义用于生成工具 schema，注册到 builtin.ts
 */
export const RESEARCH_EXTENDED_TOOLS = {
  // ── 写入能力 ──
  memory_write: {
    name: 'memory_write',
    description: 'Write a key-value pair to the agent memory system for later retrieval',
    parameters: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'Memory key (hierarchical path, e.g., "research/findings/topic1")' },
        value: { type: 'string', description: 'Content to store' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for categorization',
        },
      },
      required: ['key', 'value'],
    },
    requiresCapability: 'canWriteMemory' as keyof ResearchCapabilities,
  },

  memory_record: {
    name: 'memory_record',
    description: 'Record a structured research finding with metadata',
    parameters: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          enum: ['finding', 'source', 'contradiction', 'gap', 'insight'],
          description: 'Type of research record',
        },
        title: { type: 'string', description: 'Brief title of the record' },
        content: { type: 'string', description: 'Detailed content' },
        confidence: { type: 'number', description: 'Confidence score 0.0-1.0' },
        sources: {
          type: 'array',
          items: { type: 'string' },
          description: 'Source URLs or references',
        },
      },
      required: ['category', 'title', 'content'],
    },
    requiresCapability: 'canWriteMemory' as keyof ResearchCapabilities,
  },

  // ── 状态管理 ──
  state_get: {
    name: 'state_get',
    description: 'Get a value from the shared research state',
    parameters: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'State key' },
      },
      required: ['key'],
    },
    requiresCapability: 'canManageState' as keyof ResearchCapabilities,
  },

  state_set: {
    name: 'state_set',
    description: 'Set a value in the shared research state (visible to other sub-agents)',
    parameters: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'State key' },
        value: { type: 'string', description: 'State value (JSON-serializable string)' },
        merge: {
          type: 'boolean',
          description: 'If true, merge with existing value (for objects/arrays)',
        },
      },
      required: ['key', 'value'],
    },
    requiresCapability: 'canManageState' as keyof ResearchCapabilities,
  },

  // ── 目标检查点 ──
  goal_checkpoint: {
    name: 'goal_checkpoint',
    description: 'Report progress toward the assigned research goal. Used by parent agent to track sub-agent completion.',
    parameters: {
      type: 'object' as const,
      properties: {
        goalId: { type: 'string', description: 'The assigned goal/aspect ID' },
        status: {
          type: 'string',
          enum: ['in_progress', 'blocked', 'completed'],
          description: 'Current status',
        },
        progress: { type: 'number', description: 'Progress percentage 0-100' },
        summary: { type: 'string', description: 'Brief summary of what has been accomplished' },
        blockers: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of blockers (if status is "blocked")',
        },
      },
      required: ['goalId', 'status', 'progress'],
    },
    requiresCapability: 'canSetCheckpoints' as keyof ResearchCapabilities,
  },

  // ── 递归研究 ──
  deep_research: {
    name: 'deep_research_sub',
    description: 'Launch a sub-research task on a specific sub-topic. Use when the current aspect requires deeper investigation.',
    parameters: {
      type: 'object' as const,
      properties: {
        topic: { type: 'string', description: 'Sub-topic to research' },
        depth: {
          type: 'string',
          enum: ['quick', 'standard'],
          description: 'Research depth (sub-research cannot use "comprehensive")',
        },
        maxSources: { type: 'number', description: 'Maximum sources to collect (default: 5)' },
        parentContext: { type: 'string', description: 'Context from parent research to guide sub-research' },
      },
      required: ['topic'],
    },
    requiresCapability: 'canRecurseResearch' as keyof ResearchCapabilities,
  },

  // ── 制品管理 ──
  artifact_save: {
    name: 'artifact_save',
    description: 'Save a research artifact (finding, chart data, intermediate analysis) for persistence',
    parameters: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          enum: ['finding', 'data', 'analysis', 'chart', 'table', 'reference_list'],
          description: 'Artifact type',
        },
        title: { type: 'string', description: 'Artifact title' },
        content: { type: 'string', description: 'Artifact content (text, JSON, markdown)' },
        format: {
          type: 'string',
          enum: ['text', 'json', 'markdown', 'csv'],
          description: 'Content format',
        },
      },
      required: ['type', 'title', 'content'],
    },
    requiresCapability: 'canManageArtifacts' as keyof ResearchCapabilities,
  },

  artifact_load: {
    name: 'artifact_load',
    description: 'Load a previously saved research artifact by its ID',
    parameters: {
      type: 'object' as const,
      properties: {
        artifactId: { type: 'string', description: 'Artifact ID to load' },
      },
      required: ['artifactId'],
    },
    requiresCapability: 'canManageArtifacts' as keyof ResearchCapabilities,
  },
} as const;

// ============================================================
// 工具注册辅助
// ============================================================

/**
 * 根据能力配置生成该子 Agent 可用的工具列表
 * 
 * @example
 * ```ts
 * // 在 subagent factory 中
 * const baseTools = ['web_search', 'web_fetch', 'memory_read', 'memory_grep', 'memory_ls'];
 * const capabilities = ENHANCED_RESEARCH_CAPABILITIES;
 * const allTools = getResearchTools(baseTools, capabilities);
 * // → ['web_search', 'web_fetch', 'memory_read', 'memory_grep', 'memory_ls',
 * //    'memory_write', 'memory_record', 'state_get', 'state_set', 
 * //    'goal_checkpoint', 'deep_research_sub', 'artifact_save', 'artifact_load']
 * ```
 */
export function getResearchTools(
  baseTools: string[],
  capabilities: ResearchCapabilities
): string[] {
  const tools = [...baseTools];

  for (const [, toolDef] of Object.entries(RESEARCH_EXTENDED_TOOLS)) {
    const cap = toolDef.requiresCapability;
    if (capabilities[cap]) {
      if (!tools.includes(toolDef.name)) {
        tools.push(toolDef.name);
      }
    }
  }

  return tools;
}

/**
 * 获取工具 schema（用于 LLM function calling）
 */
export function getResearchToolSchemas(capabilities: ResearchCapabilities): Array<{
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}> {
  const schemas: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [];

  for (const [, toolDef] of Object.entries(RESEARCH_EXTENDED_TOOLS)) {
    const cap = toolDef.requiresCapability;
    if (capabilities[cap]) {
      schemas.push({
        name: toolDef.name,
        description: toolDef.description,
        parameters: toolDef.parameters,
      });
    }
  }

  return schemas;
}

// ============================================================
// 子 Agent 工厂补丁
// ============================================================

/**
 * 创建增强型研究子 Agent 配置
 * 
 * 补丁方式：在现有 SubAgentFactory.create('research', ...) 的基础上
 * 附加增强能力。
 * 
 * @example
 * ```ts
 * // 在 factory.ts 中的修改
 * import { createEnhancedResearchConfig } from './subagent-types-patch';
 * 
 * class SubAgentFactory {
 *   create(type: string, options: any) {
 *     if (type === 'research' && options.enhanced) {
 *       return createEnhancedResearchConfig(options);
 *     }
 *     // ... 原有逻辑
 *   }
 * }
 * ```
 */
export function createEnhancedResearchConfig(options: {
  name: string;
  aspect?: string;
  parentSessionId?: string;
  capabilities?: Partial<ResearchCapabilities>;
  maxToolCalls?: number;
}): ExtendedResearchSubAgentConfig {
  const capabilities: ResearchCapabilities = {
    ...DEFAULT_RESEARCH_CAPABILITIES,
    ...options.capabilities,
  };

  if (options.maxToolCalls) {
    capabilities.maxToolCalls = options.maxToolCalls;
  }

  const baseTools = [
    'web_search',
    'web_fetch',
    'memory_read',
    'memory_grep',
    'memory_ls',
  ];

  const extendedTools = getResearchTools([], capabilities);

  return {
    type: 'research',
    name: options.name,
    baseTools,
    extendedTools,
    capabilities,
    researchContext: {
      parentSessionId: options.parentSessionId,
      assignedAspect: options.aspect,
    },
  };
}

// ============================================================
// 共享状态管理器
// ============================================================

/**
 * 子 Agent 间的共享状态管理
 * 
 * 允许多个研究子 Agent 共享发现：
 * - 避免重复搜索相同内容
 * - 共享已发现的高质量源
 * - 协调覆盖不同方面
 */
export class SharedResearchState {
  private state: Map<string, string> = new Map();
  private listeners: Map<string, Array<(value: string) => void>> = new Map();

  get(key: string): string | null {
    return this.state.get(key) ?? null;
  }

  set(key: string, value: string, merge: boolean = false): void {
    if (merge && this.state.has(key)) {
      try {
        const existing = JSON.parse(this.state.get(key)!);
        const incoming = JSON.parse(value);

        if (Array.isArray(existing) && Array.isArray(incoming)) {
          this.state.set(key, JSON.stringify([...existing, ...incoming]));
        } else if (typeof existing === 'object' && typeof incoming === 'object') {
          this.state.set(key, JSON.stringify({ ...existing, ...incoming }));
        } else {
          this.state.set(key, value);
        }
      } catch {
        this.state.set(key, value);
      }
    } else {
      this.state.set(key, value);
    }

    // 通知监听者
    const keyListeners = this.listeners.get(key);
    if (keyListeners) {
      const finalValue = this.state.get(key)!;
      for (const listener of keyListeners) {
        listener(finalValue);
      }
    }
  }

  /**
   * 监听某个 key 的变更
   */
  watch(key: string, callback: (value: string) => void): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, []);
    }
    this.listeners.get(key)!.push(callback);

    // 返回取消监听函数
    return () => {
      const arr = this.listeners.get(key);
      if (arr) {
        const idx = arr.indexOf(callback);
        if (idx >= 0) arr.splice(idx, 1);
      }
    };
  }

  /**
   * 获取所有状态的快照
   */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.state);
  }

  /**
   * 从快照恢复
   */
  restore(snapshot: Record<string, string>): void {
    this.state.clear();
    for (const [key, value] of Object.entries(snapshot)) {
      this.state.set(key, value);
    }
  }

  /**
   * 已访问 URL 的共享集合
   * 
   * 防止多个子 Agent 重复抓取相同页面
   */
  markUrlVisited(url: string): void {
    const visited = this.getVisitedUrls();
    visited.add(url);
    this.state.set('__visited_urls__', JSON.stringify([...visited]));
  }

  isUrlVisited(url: string): boolean {
    return this.getVisitedUrls().has(url);
  }

  getVisitedUrls(): Set<string> {
    try {
      const raw = this.state.get('__visited_urls__');
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  }

  /**
   * 清理资源，释放内存
   *
   * 在研究会话结束时调用，防止内存泄漏
   */
  dispose(): void {
    this.listeners.clear();
    this.state.clear();
  }
}
