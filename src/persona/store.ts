/**
 * Persona Store
 *
 * Manages AIEOS persona files and provides import/export functionality
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import type {
  Identity,
  Soul,
  AgentGuidelines,
  UserProfile,
  TraitsProfile,
  PersonaPackage,
  ExportOptions,
  ImportOptions,
} from './types';
import {
  IdentitySchema,
  SoulSchema,
  AgentGuidelinesSchema,
  UserProfileSchema,
  TraitsProfileSchema,
  PersonaPackageSchema,
} from './types';
import { validateTraitsProfile, DEFAULT_TRAITS_PROFILE } from './traits';

// ============================================================
// File Names
// ============================================================

const PERSONA_FILES = {
  identity: 'IDENTITY.md',
  soul: 'SOUL.md',
  agents: 'AGENTS.md',
  user: 'USER.md',
  traits: 'traits.json',
} as const;

// ============================================================
// Markdown Parsing Utilities
// ============================================================

/**
 * Parse markdown frontmatter
 */
function parseFrontmatter<T>(content: string, schema: z.ZodSchema<T>): T | null {
  try {
    // Check for YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (frontmatterMatch) {
      const yaml = frontmatterMatch[1];
      const body = frontmatterMatch[2].trim();

      // Simple YAML parsing for common fields
      const data: Record<string, unknown> = {};

      for (const line of yaml.split('\n')) {
        const match = line.match(/^(\w+):\s*(.*)$/);
        if (match) {
          const key = match[1];
          let value: unknown = match[2].trim();

          // Parse arrays
          if (typeof value === 'string' && value.startsWith('[')) {
            try {
              value = JSON.parse(value as string);
            } catch {
              // Keep as string
            }
          }

          // Parse numbers
          if (typeof value === 'string' && !isNaN(Number(value))) {
            value = Number(value);
          }

          data[key] = value;
        }
      }

      // Add body content
      data.content = body;

      return schema.parse(data);
    }

    // No frontmatter - treat entire content as description/content
    return schema.parse({ content: content.trim() });
  } catch {
    return null;
  }
}

/**
 * Generate markdown with frontmatter
 */
function generateMarkdown<T extends Record<string, unknown>>(
  data: T,
  contentField: string = 'content'
): string {
  const { [contentField]: content, ...frontmatter } = data;
  const lines: string[] = ['---'];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else if (typeof value === 'object') {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(String(content || ''));

  return lines.join('\n');
}

// ============================================================
// Persona Store Class
// ============================================================

export class PersonaStore {
  private basePath: string;
  private initialized = false;

  // Cached data
  private identity: Identity | null = null;
  private soul: Soul | null = null;
  private agents: AgentGuidelines | null = null;
  private user: UserProfile | null = null;
  private traits: TraitsProfile | null = null;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  /**
   * Initialize the persona store
   */
  init(): void {
    if (this.initialized) return;

    // Ensure directory exists
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }

    // Load existing files
    this.loadAll();

    // Create defaults if not exists
    if (!this.identity) {
      this.createDefaultIdentity();
    }

    if (!this.traits) {
      this.traits = DEFAULT_TRAITS_PROFILE;
      this.saveTraits();
    }

    this.initialized = true;
  }

  /**
   * Load all persona files
   */
  private loadAll(): void {
    this.identity = this.loadIdentity();
    this.soul = this.loadSoul();
    this.agents = this.loadAgents();
    this.user = this.loadUser();
    this.traits = this.loadTraits();
  }

  // ============================================================
  // Load Methods
  // ============================================================

  private loadIdentity(): Identity | null {
    const path = join(this.basePath, PERSONA_FILES.identity);
    if (!existsSync(path)) return null;

    try {
      const content = readFileSync(path, 'utf-8');
      return parseFrontmatter(content, IdentitySchema) as Identity | null;
    } catch {
      return null;
    }
  }

  private loadSoul(): Soul | null {
    const path = join(this.basePath, PERSONA_FILES.soul);
    if (!existsSync(path)) return null;

    try {
      const content = readFileSync(path, 'utf-8');
      // Parse soul content into structured format
      const soul = this.parseSoulContent(content);
      return soul;
    } catch {
      return null;
    }
  }

  private parseSoulContent(content: string): Soul {
    const soul: Soul = {
      essence: '',
      values: [],
      communicationStyle: '',
      growthGoals: [],
      lessonsLearned: [],
      boundaries: [],
    };

    const sections = content.split(/^#+ /m);

    for (const section of sections) {
      if (!section.trim()) continue;

      const lines = section.split('\n');
      const title = lines[0].toLowerCase().trim();
      const body = lines.slice(1).join('\n').trim();

      if (title.includes('identity') || title.includes('本质')) {
        soul.essence = body;
      } else if (title.includes('trait') || title.includes('核心') || title.includes('价值观')) {
        // Extract bullet points
        const bullets = body.split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('•'));
        soul.values = bullets.map(b => b.replace(/^[-•]\s*/, '').trim());
      } else if (title.includes('communication') || title.includes('沟通')) {
        soul.communicationStyle = body;
      } else if (title.includes('growth') || title.includes('成长')) {
        const bullets = body.split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('•'));
        soul.growthGoals = bullets.map(b => b.replace(/^[-•]\s*/, '').trim());
      } else if (title.includes('lesson') || title.includes('教训')) {
        const bullets = body.split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('•') || l.trim().startsWith('_'));
        soul.lessonsLearned = bullets.map(b => b.replace(/^[-•_]\s*/, '').trim());
      }
    }

    // If no structured content, treat entire content as essence
    if (!soul.essence && content.trim()) {
      soul.essence = content.trim();
    }

    return soul;
  }

  private loadAgents(): AgentGuidelines | null {
    const path = join(this.basePath, PERSONA_FILES.agents);
    if (!existsSync(path)) return null;

    try {
      const content = readFileSync(path, 'utf-8');
      return this.parseAgentsContent(content);
    } catch {
      return null;
    }
  }

  private parseAgentsContent(content: string): AgentGuidelines {
    const agents: AgentGuidelines = {
      taskExecution: [],
      decisionMaking: '',
      toolUsage: [],
      errorHandling: '',
      escalationRules: [],
      prohibitedActions: [],
    };

    const sections = content.split(/^## /m);

    for (const section of sections) {
      if (!section.trim()) continue;

      const lines = section.split('\n');
      const title = lines[0].toLowerCase().trim();
      const body = lines.slice(1).join('\n').trim();
      const bullets = body.split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('•'));
      const items = bullets.map(b => b.replace(/^[-•]\s*/, '').trim());

      if (title.includes('task') || title.includes('任务')) {
        agents.taskExecution = items;
      } else if (title.includes('decision') || title.includes('决策')) {
        agents.decisionMaking = body;
      } else if (title.includes('tool') || title.includes('工具')) {
        agents.toolUsage = items;
      } else if (title.includes('error') || title.includes('错误')) {
        agents.errorHandling = body;
      } else if (title.includes('escalat') || title.includes('升级')) {
        agents.escalationRules = items;
      } else if (title.includes('prohibit') || title.includes('禁止')) {
        agents.prohibitedActions = items;
      }
    }

    return agents;
  }

  private loadUser(): UserProfile | null {
    const path = join(this.basePath, PERSONA_FILES.user);
    if (!existsSync(path)) return null;

    try {
      const content = readFileSync(path, 'utf-8');
      return this.parseUserContent(content);
    } catch {
      return null;
    }
  }

  private parseUserContent(content: string): UserProfile {
    const user: UserProfile = {
      name: '',
      nickname: '',
      background: '',
      preferences: {},
      goals: [],
      communicationPreferences: {},
      contextNotes: [],
    };

    const sections = content.split(/^## /m);

    for (const section of sections) {
      if (!section.trim()) continue;

      const lines = section.split('\n');
      const title = lines[0].toLowerCase().trim();
      const body = lines.slice(1).join('\n').trim();

      if (title.includes('personal') || title.includes('个人') || title.includes('name')) {
        // Try to extract name
        const nameMatch = body.match(/\*\*Name\*\*[：:]\s*(.+)/i) ||
                          body.match(/^[-•]\s*\*\*Name\*\*[：:]\s*(.+)/im);
        if (nameMatch) {
          user.name = nameMatch[1].trim();
        }
      } else if (title.includes('background') || title.includes('背景')) {
        user.background = body;
      } else if (title.includes('goal') || title.includes('目标')) {
        const bullets = body.split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('•'));
        user.goals = bullets.map(b => b.replace(/^[-•]\s*/, '').trim());
      }
    }

    // Store entire content as background if nothing specific found
    if (!user.background && content.trim()) {
      user.background = content.trim();
    }

    return user;
  }

  private loadTraits(): TraitsProfile | null {
    const path = join(this.basePath, PERSONA_FILES.traits);
    if (!existsSync(path)) return null;

    try {
      const content = readFileSync(path, 'utf-8');
      const data = JSON.parse(content);
      const parsed = TraitsProfileSchema.safeParse(data);

      if (parsed.success) {
        return parsed.data;
      }
      return null;
    } catch {
      return null;
    }
  }

  // ============================================================
  // Save Methods
  // ============================================================

  private createDefaultIdentity(): void {
    this.identity = {
      name: 'Beeclaw',
      version: '1.0.0',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      creator: 'Beeclaw System',
      description: 'A helpful AI assistant with persistent memory and goal tracking',
      tags: ['assistant', 'productivity', 'memory'],
      compatibleModels: ['gpt-4', 'claude-3', 'glm-4', 'qwen'],
    };

    this.saveIdentity();
  }

  saveIdentity(): void {
    if (!this.identity) return;

    const path = join(this.basePath, PERSONA_FILES.identity);
    const content = generateMarkdown(this.identity, 'description');

    writeFileSync(path, content, 'utf-8');
  }

  saveTraits(): void {
    if (!this.traits) return;

    const path = join(this.basePath, PERSONA_FILES.traits);
    writeFileSync(path, JSON.stringify(this.traits, null, 2), 'utf-8');
  }

  // ============================================================
  // Getters
  // ============================================================

  getIdentity(): Identity | null {
    return this.identity;
  }

  getSoul(): Soul | null {
    return this.soul;
  }

  getAgents(): AgentGuidelines | null {
    return this.agents;
  }

  getUser(): UserProfile | null {
    return this.user;
  }

  getTraits(): TraitsProfile {
    return this.traits || DEFAULT_TRAITS_PROFILE;
  }

  // ============================================================
  // Setters
  // ============================================================

  setIdentity(identity: Partial<Identity>): void {
    this.identity = {
      ...this.identity,
      ...identity,
      modified: new Date().toISOString(),
    } as Identity;

    this.saveIdentity();
  }

  setTraits(traits: Partial<TraitsProfile>): void {
    const validation = validateTraitsProfile(traits);

    if (!validation.valid) {
      throw new Error(`Invalid traits: ${validation.errors.join(', ')}`);
    }

    this.traits = {
      ...this.traits,
      ...traits,
    } as TraitsProfile;

    this.saveTraits();
  }

  // ============================================================
  // Export/Import
  // ============================================================

  /**
   * Export persona as a portable package
   */
  exportPersona(options: Partial<ExportOptions> = {}): PersonaPackage {
    const opts: ExportOptions = {
      includeMemories: true,
      includeSkills: true,
      includeConversations: false,
      includeGoals: true,
      format: 'json',
      ...options,
    };

    const pkg: PersonaPackage = {
      schema: 'aieos/v1',
      exportedAt: new Date().toISOString(),
      sourceSystem: 'Beeclaw',
      identity: this.identity!,
      soul: (this.soul || { essence: '' }) as Soul,
      agents: this.agents || undefined,
      user: this.user || undefined,
      traits: this.traits || undefined,
    };

    // Add memories if requested
    if (opts.includeMemories) {
      pkg.memories = this.loadCoreMemories();
    }

    // Add goals if requested
    if (opts.includeGoals) {
      pkg.skills = this.loadGoalSkills();
    }

    return pkg;
  }

  private loadCoreMemories(): Array<{ category: string; content: string; importance?: number }> {
    const memories: Array<{ category: string; content: string; importance?: number }> = [];
    const factsPath = join(this.basePath, '..', 'facts');

    if (existsSync(factsPath)) {
      const files = readdirSync(factsPath).filter(f => f.endsWith('.md'));

      for (const file of files) {
        const content = readFileSync(join(factsPath, file), 'utf-8');
        memories.push({
          category: file.replace('.md', ''),
          content,
          importance: 0.7,
        });
      }
    }

    return memories;
  }

  private loadGoalSkills(): Array<{ name: string; description: string; triggers?: string[] }> {
    // This would integrate with the skills store
    return [];
  }

  /**
   * Import persona from a package
   */
  importPersona(pkg: PersonaPackage, options: Partial<ImportOptions> = {}): {
    success: boolean;
    errors: string[];
    imported: string[];
  } {
    const opts: ImportOptions = {
      merge: false,
      mergeStrategy: 'merge-smart',
      validateOnly: false,
      ...options,
    };

    const errors: string[] = [];
    const imported: string[] = [];

    // Validate package
    const validation = PersonaPackageSchema.safeParse(pkg);
    if (!validation.success) {
      return {
        success: false,
        errors: validation.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
        imported: [],
      };
    }

    if (opts.validateOnly) {
      return { success: true, errors: [], imported: [] };
    }

    // Import identity
    if (pkg.identity) {
      this.identity = pkg.identity;
      this.saveIdentity();
      imported.push('identity');
    }

    // Import traits
    if (pkg.traits) {
      const traitsValidation = validateTraitsProfile(pkg.traits);
      if (traitsValidation.valid) {
        this.traits = pkg.traits;
        this.saveTraits();
        imported.push('traits');
      } else {
        errors.push(...traitsValidation.errors);
      }
    }

    // Import memories
    if (pkg.memories && opts.merge) {
      // Would merge with existing memories
      imported.push('memories');
    }

    return {
      success: errors.length === 0,
      errors,
      imported,
    };
  }

  /**
   * Get complete system prompt from persona
   */
  getSystemPrompt(): string {
    const parts: string[] = [];

    // Add identity
    if (this.identity) {
      parts.push(`# Identity\n\nName: ${this.identity.name}`);
      if (this.identity.description) {
        parts.push(`Description: ${this.identity.description}`);
      }
      parts.push('');
    }

    // Add soul (personality)
    if (this.soul) {
      parts.push('# Personality\n');
      if (this.soul.essence) {
        parts.push(this.soul.essence);
      }
      if (this.soul.values.length > 0) {
        parts.push('\nCore Values:');
        for (const value of this.soul.values) {
          parts.push(`- ${value}`);
        }
      }
      parts.push('');
    }

    // Add user info
    if (this.user) {
      parts.push('# About the User\n');
      if (this.user.background) {
        parts.push(this.user.background);
      }
      parts.push('');
    }

    // Add behavior guidelines
    if (this.agents) {
      parts.push('# Behavior Guidelines\n');
      if (this.agents.taskExecution.length > 0) {
        parts.push('Task Execution:');
        for (const rule of this.agents.taskExecution) {
          parts.push(`- ${rule}`);
        }
      }
      if (this.agents.prohibitedActions.length > 0) {
        parts.push('\nProhibited Actions:');
        for (const action of this.agents.prohibitedActions) {
          parts.push(`- ${action}`);
        }
      }
      parts.push('');
    }

    return parts.join('\n');
  }
}

// ============================================================
// Singleton Instance
// ============================================================

let storeInstance: PersonaStore | null = null;

export function getPersonaStore(basePath?: string): PersonaStore {
  if (!storeInstance && basePath) {
    storeInstance = new PersonaStore(basePath);
    storeInstance.init();
  }

  if (!storeInstance) {
    throw new Error('PersonaStore not initialized. Call getPersonaStore with basePath first.');
  }

  return storeInstance;
}

export function resetPersonaStore(): void {
  storeInstance = null;
}
