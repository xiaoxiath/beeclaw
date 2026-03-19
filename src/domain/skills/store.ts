import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, watch, type FSWatcher } from 'fs';
import { join } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type {
  Skill,
  SkillFrontmatter,
  CreateSkillOptions,
  UpdateSkillOptions,
  MaturityAssessment,
  SkillToolResult,
  SkillEvals,
  GradingResult,
  TimingData,
  BenchmarkResult,
} from './types';
import { SkillFrontmatterSchema } from './types';
import { LLMSkillMatcher } from './llm-matcher';
import { logger } from '../../infra/observability/logger';

export class SkillStore {
  private basePath: string;          // User skills path
  private builtinPath: string;       // Built-in skills path
  private initialized: boolean = false;
  private llmMatcher: LLMSkillMatcher | null = null;
  private watcher: FSWatcher | null = null;
  private skillsCache: Skill[] | null = null;
  private cacheInvalidated: boolean = true;
  private debounceTimer: Timer | null = null;

  constructor(basePath: string, builtinPath?: string) {
    this.basePath = basePath;
    // Default builtin path is skills/ at project root
    this.builtinPath = builtinPath || join(process.cwd(), 'skills');
  }

  /**
   * 设置 LLM 匹配器
   */
  setLLMMatcher(matcher: LLMSkillMatcher): void {
    this.llmMatcher = matcher;
  }

  // Initialize skills directory
  init(): void {
    if (this.initialized) return;

    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }

    this.initialized = true;

    // Start watching user skills directory
    this.startWatching();
  }

  /**
   * Start watching user skills directory for hot reload
   */
  private startWatching(): void {
    if (this.watcher) return;

    try {
      // Watch user skills directory (not builtin)
      this.watcher = watch(
        this.basePath,
        { recursive: true, persistent: false },
        (eventType, filename) => {
          if (!filename) return;

          // Only care about SKILL.md changes
          if (filename.endsWith('SKILL.md') || filename.includes('SKILL.md')) {
            this.handleSkillChange(eventType, filename);
          }
        }
      );

      this.watcher.on('error', (error) => {
        logger.error(`[SkillStore] Watch error:`, error);
      });

      logger.info(`[SkillStore] Watching ${this.basePath} for skill changes`);
    } catch (error) {
      logger.warn(`[SkillStore] Failed to start watcher:`, error);
    }
  }

  /**
   * Handle skill file changes with debounce
   */
  private handleSkillChange(eventType: string, filename: string): void {
    // Debounce: wait 250ms before invalidating cache
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      logger.info(`[SkillStore] Skill changed: ${filename} (${eventType}), invalidating cache`);
      this.skillsCache = null;
      this.cacheInvalidated = true;
    }, 250);
  }

  /**
   * Stop watching
   */
  stopWatching(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      logger.info('[SkillStore] Stopped watching skills directory');
    }
  }

  // Get base path (user skills)
  getBasePath(): string {
    return this.basePath;
  }

  // Get builtin path
  getBuiltinPath(): string {
    return this.builtinPath;
  }

  // List all skills (builtin + user)
  list(): Skill[] {
    this.init();

    // Return cached skills if not invalidated
    if (this.skillsCache && !this.cacheInvalidated) {
      return this.skillsCache;
    }

    const startTime = Date.now();
    const skills: Skill[] = [];
    const seenNames = new Set<string>();

    // Load built-in skills first
    if (existsSync(this.builtinPath)) {
      const builtinSkills = this.loadSkillsFromDir(this.builtinPath, true);
      for (const skill of builtinSkills) {
        if (!seenNames.has(skill.name)) {
          skills.push(skill);
          seenNames.add(skill.name);
        }
      }
    }

    // Load user skills (can override builtin)
    const userSkills = this.loadSkillsFromDir(this.basePath, false);
    for (const skill of userSkills) {
      const existingIndex = skills.findIndex(s => s.name === skill.name);
      if (existingIndex >= 0) {
        // User skill overrides builtin
        skills[existingIndex] = skill;
      } else {
        skills.push(skill);
      }
    }

    // Cache the skills list
    this.skillsCache = skills;
    this.cacheInvalidated = false;

    // Log loading statistics
    const loadTime = Date.now() - startTime;
    const builtinCount = skills.filter(s => s.isBuiltin).length;
    const userCount = skills.filter(s => !s.isBuiltin).length;
    const avgMaturity = skills.length > 0
      ? Math.round(skills.reduce((a, s) => a + s.maturityScore, 0) / skills.length)
      : 0;
    const totalUsage = skills.reduce((a, s) => a + s.usageCount, 0);

    const maturityDistribution = {
      seed: skills.filter(s => s.maturityScore < 30).length,
      growing: skills.filter(s => s.maturityScore >= 30 && s.maturityScore < 70).length,
      mature: skills.filter(s => s.maturityScore >= 70).length,
    };

    console.log(`   📚 Skills: ${skills.length} loaded (${builtinCount} builtin, ${userCount} user)`);
    console.log(`      Avg maturity: ${avgMaturity}% | Total usage: ${totalUsage} | Load time: ${loadTime}ms`);
    if (skills.length > 0) {
      console.log(`      Maturity: ${maturityDistribution.seed} seed, ${maturityDistribution.growing} growing, ${maturityDistribution.mature} mature`);
    }

    return skills;
  }

  // Load skills from a directory
  private loadSkillsFromDir(dirPath: string, isBuiltin: boolean): Skill[] {
    const skills: Skill[] = [];

    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillPath = join(dirPath, entry.name);
        const skill = this.load(skillPath, isBuiltin);

        if (skill) {
          skills.push(skill);
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }

    return skills;
  }

  // Get a specific skill (user skills override builtin)
  get(name: string): Skill | null {
    this.init();

    // First check user skills
    const userPath = join(this.basePath, name);
    const userSkill = this.load(userPath, false);
    if (userSkill) {
      // Add dependency warnings
      const warnings = this.checkDependencyWarnings(userSkill);
      if (warnings.length > 0) {
        (userSkill as any).dependencyWarnings = warnings;
      }
      return userSkill;
    }

    // Then check builtin skills
    const builtinPath = join(this.builtinPath, name);
    const builtinSkill = this.load(builtinPath, true);
    if (builtinSkill) {
      const warnings = this.checkDependencyWarnings(builtinSkill);
      if (warnings.length > 0) {
        (builtinSkill as any).dependencyWarnings = warnings;
      }
    }
    return builtinSkill;
  }

  // Create a new skill
  create(options: CreateSkillOptions): SkillToolResult {
    this.init();

    const skillPath = join(this.basePath, options.name);

    if (existsSync(skillPath)) {
      return { success: false, error: `Skill already exists: ${options.name}` };
    }

    // Validate dependencies if provided
    if (options.dependsOn && options.dependsOn.length > 0) {
      const validationResult = this.validateDependencies(options.dependsOn);
      if (!validationResult.valid) {
        return {
          success: false,
          error: `Dependency validation failed: ${validationResult.errors.join(', ')}`,
          data: { missing_dependencies: validationResult.missing }
        };
      }
    }

    try {
      // Create directory
      mkdirSync(skillPath, { recursive: true });

      // Create SKILL.md
      const frontmatter: SkillFrontmatter = {
        name: options.name,
        description: options.description,
        tags: options.tags || [],
        triggers: options.triggers || [],
        depends_on: options.dependsOn || [],
        author: options.author,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      };

      const skillMd = this.formatSkillMd(frontmatter, options.content || '');
      writeFileSync(join(skillPath, 'SKILL.md'), skillMd, 'utf-8');

      // Create metadata file for evolution tracking
      this.writeMetadata(skillPath, {
        usageCount: 0,
        successCount: 0,
        failureCount: 0,
        maturityScore: 0,
      });

      const skill = this.load(skillPath);
      return { success: true, data: skill };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Update a skill
  update(name: string, options: UpdateSkillOptions): SkillToolResult {
    this.init();

    const skillPath = join(this.basePath, name);

    // Check if it's a builtin skill being modified
    const existingSkill = this.get(name);
    if (existingSkill?.readonly) {
      return { success: false, error: `Cannot modify built-in skill: ${name}. Create a user skill with the same name to override.` };
    }

    if (!existsSync(skillPath)) {
      return { success: false, error: `Skill not found: ${name}` };
    }

    try {
      const skillMdPath = join(skillPath, 'SKILL.md');
      const content = readFileSync(skillMdPath, 'utf-8');
      const { frontmatter, body } = this.parseSkillMd(content);

      // Update frontmatter
      if (options.description) frontmatter.description = options.description;
      if (options.tags) frontmatter.tags = options.tags;
      if (options.triggers) frontmatter.triggers = options.triggers;
      if (options.compatibility) frontmatter.compatibility = options.compatibility;
      frontmatter.updated = new Date().toISOString();

      const newContent = options.content !== undefined ? options.content : body;
      const skillMd = this.formatSkillMd(frontmatter, newContent);

      writeFileSync(skillMdPath, skillMd, 'utf-8');

      const skill = this.load(skillPath, false);
      return { success: true, data: skill };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Delete a skill (cannot delete builtin)
  delete(name: string): SkillToolResult {
    this.init();

    // Check if it's a builtin skill
    const skill = this.get(name);
    if (skill?.isBuiltin && !existsSync(join(this.basePath, name))) {
      return { success: false, error: `Cannot delete built-in skill: ${name}` };
    }

    const skillPath = join(this.basePath, name);

    if (!existsSync(skillPath)) {
      return { success: false, error: `Skill not found: ${name}` };
    }

    try {
      rmSync(skillPath, { recursive: true, force: true });
      return { success: true, data: { deleted: name } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Record skill usage
  recordUsage(name: string, success: boolean, executionTimeMs?: number): SkillToolResult {
    this.init();

    const skillPath = join(this.basePath, name);

    if (!existsSync(skillPath)) {
      return { success: false, error: `Skill not found: ${name}` };
    }

    try {
      const metadata = this.readMetadata(skillPath);

      metadata.usageCount++;
      if (success) {
        metadata.successCount++;
      } else {
        metadata.failureCount++;
        metadata.lastFailure = new Date().toISOString();
      }
      metadata.lastUsed = new Date().toISOString();

      // Track performance if execution time provided
      if (executionTimeMs !== undefined && metadata.performance) {
        metadata.performance.executionTimes.push(executionTimeMs);
        // Keep only last 100 execution times
        if (metadata.performance.executionTimes.length > 100) {
          metadata.performance.executionTimes = metadata.performance.executionTimes.slice(-100);
        }
        metadata.performance.totalExecutions++;
        metadata.performance.avgExecutionTime =
          metadata.performance.executionTimes.reduce((a, b) => a + b, 0) /
          metadata.performance.executionTimes.length;
        metadata.performance.minExecutionTime = Math.min(...metadata.performance.executionTimes);
        metadata.performance.maxExecutionTime = Math.max(...metadata.performance.executionTimes);
      }

      // Update maturity score
      metadata.maturityScore = this.calculateMaturity(metadata);

      this.writeMetadata(skillPath, metadata);

      return { success: true, data: metadata };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get performance metrics for a skill
   */
  getPerformanceMetrics(name: string): import('./types').SkillPerformanceMetrics {
    this.init();

    const skillPath = join(this.basePath, name);
    const metadata = this.readMetadata(skillPath);

    const perf = metadata.performance || {
      executionTimes: [],
      totalExecutions: 0,
      avgExecutionTime: 0,
      minExecutionTime: 0,
      maxExecutionTime: 0,
    };

    // Calculate P95 if we have data
    let p95 = 0;
    if (perf.executionTimes.length > 0) {
      const sorted = [...perf.executionTimes].sort((a, b) => a - b);
      const p95Index = Math.floor(sorted.length * 0.95);
      p95 = sorted[p95Index] || 0;
    }

    return {
      avg_execution_time_ms: perf.avgExecutionTime,
      p95_execution_time_ms: p95,
      min_execution_time_ms: perf.minExecutionTime,
      max_execution_time_ms: perf.maxExecutionTime,
      total_executions: perf.totalExecutions,
      avg_tool_calls: 0, // Would need to be tracked separately
      avg_tokens_used: 0, // Would need to be tracked separately
    };
  }

  // Assess skill maturity
  assessMaturity(name: string): MaturityAssessment {
    this.init();

    const skillPath = join(this.basePath, name);
    const skill = this.load(skillPath);

    if (!skill) {
      return {
        ready: false,
        score: 0,
        checks: {
          productionTested: false,
          stable: false,
          wellStructured: false,
          clean: false,
        },
        recommendations: ['Skill not found'],
      };
    }

    const metadata = this.readMetadata(skillPath);
    const skillMdPath = join(skillPath, 'SKILL.md');
    const content = readFileSync(skillMdPath, 'utf-8');
    const lines = content.split('\n').length;

    const checks = {
      // Production tested: 3+ successful uses
      productionTested: metadata.successCount >= 3,

      // Stable: no failures in last 5 uses, or last 5 uses all success
      stable: metadata.usageCount >= 5 && (
        metadata.failureCount === 0 ||
        (metadata.successCount >= 5 && !metadata.lastFailure)
      ),

      // Well structured: valid frontmatter, ≤300 lines
      wellStructured: skill.name && skill.description && lines <= 300,

      // Clean: no hardcoded secrets (basic check)
      clean: !this.hasSecurityIssues(content),
    };

    const score = this.calculateMaturity(metadata, checks);
    const recommendations: string[] = [];

    if (!checks.productionTested) {
      recommendations.push('Need at least 3 successful uses in production');
    }
    if (!checks.stable) {
      recommendations.push('Need stable execution without recent failures');
    }
    if (!checks.wellStructured) {
      recommendations.push(`SKILL.md should be ≤300 lines (currently ${lines})`);
    }
    if (!checks.clean) {
      recommendations.push('Remove hardcoded secrets or sensitive paths');
    }

    return {
      ready: Object.values(checks).every(Boolean),
      score,
      checks,
      recommendations,
    };
  }

  // Search skills
  search(query: string): Skill[] {
    this.init();

    const skills = this.list();
    const lowerQuery = query.toLowerCase();

    return skills.filter(skill => {
      const searchText = [
        skill.name,
        skill.description,
        ...skill.tags,
        ...skill.triggers,
      ].join(' ').toLowerCase();

      return searchText.includes(lowerQuery);
    }).sort((a, b) => {
      // Prefer name match
      const aNameMatch = a.name.toLowerCase().includes(lowerQuery) ? 1 : 0;
      const bNameMatch = b.name.toLowerCase().includes(lowerQuery) ? 1 : 0;
      return bNameMatch - aNameMatch;
    });
  }

  // Load skill from path
  private load(skillPath: string, isBuiltin: boolean = false): Skill | null {
    const skillMdPath = join(skillPath, 'SKILL.md');

    if (!existsSync(skillMdPath)) {
      return null;
    }

    try {
      const content = readFileSync(skillMdPath, 'utf-8');
      const { frontmatter, body } = this.parseSkillMd(content);
      const metadata = isBuiltin ? this.emptyMetadata() : this.readMetadata(skillPath);
      const skillDirName = skillPath.split('/').pop() || '';

      return {
        name: frontmatter.name || skillDirName,
        description: frontmatter.description || '',
        version: frontmatter.version || '1.0.0',
        compatibility: frontmatter.compatibility,
        tags: frontmatter.tags || [],
        triggers: frontmatter.triggers || [],
        dependsOn: frontmatter.depends_on || [],
        author: frontmatter.author,
        createdAt: frontmatter.created,
        updatedAt: frontmatter.updated,
        content: body.trim(),
        path: skillPath,
        hasScripts: existsSync(join(skillPath, 'scripts')),
        hasReferences: existsSync(join(skillPath, 'references')),
        hasAssets: existsSync(join(skillPath, 'assets')),
        hasAgents: existsSync(join(skillPath, 'agents')),
        hasEvals: existsSync(join(skillPath, 'evals')),
        isBuiltin,
        readonly: isBuiltin,
        usageCount: metadata.usageCount,
        successCount: metadata.successCount,
        failureCount: metadata.failureCount,
        lastUsed: metadata.lastUsed,
        lastFailure: metadata.lastFailure,
        maturityScore: metadata.maturityScore,
      };
    } catch (error) {
      logger.warn(`[SkillStore] Failed to load skill from ${skillPath}:`, error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  // Empty metadata for builtin skills
  private emptyMetadata() {
    return {
      usageCount: 0,
      successCount: 0,
      failureCount: 0,
      maturityScore: 100, // Builtin skills are considered mature
    };
  }

  // Parse SKILL.md file
  private parseSkillMd(content: string): { frontmatter: SkillFrontmatter; body: string } {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (!frontmatterMatch) {
      return {
        frontmatter: { name: '', description: '' },
        body: content,
      };
    }

    try {
      const yamlContent = frontmatterMatch[1];
      const parsed = parseYaml(yamlContent);
      const frontmatter = SkillFrontmatterSchema.parse(parsed);
      const body = frontmatterMatch[2];

      return { frontmatter, body };
    } catch {
      return {
        frontmatter: { name: '', description: '' },
        body: content,
      };
    }
  }

  // Format SKILL.md file
  private formatSkillMd(frontmatter: SkillFrontmatter, body: string): string {
    const yamlContent = stringifyYaml(frontmatter as Record<string, unknown>, {
      lineWidth: 0,
    }).trim();

    return `---\n${yamlContent}\n---\n\n${body.trim()}\n`;
  }

  // Read metadata file
  private readMetadata(skillPath: string): {
    usageCount: number;
    successCount: number;
    failureCount: number;
    lastUsed?: string;
    lastFailure?: string;
    maturityScore: number;
    // Performance metrics
    performance?: {
      executionTimes: number[];    // Last N execution times in ms
      totalExecutions: number;
      avgExecutionTime: number;
      minExecutionTime: number;
      maxExecutionTime: number;
    };
  } {
    const metadataPath = join(skillPath, '.metadata.json');

    if (!existsSync(metadataPath)) {
      return {
        usageCount: 0,
        successCount: 0,
        failureCount: 0,
        maturityScore: 0,
        performance: {
          executionTimes: [],
          totalExecutions: 0,
          avgExecutionTime: 0,
          minExecutionTime: 0,
          maxExecutionTime: 0,
        },
      };
    }

    try {
      const content = readFileSync(metadataPath, 'utf-8');
      const data = JSON.parse(content);
      // Ensure performance field exists
      if (!data.performance) {
        data.performance = {
          executionTimes: [],
          totalExecutions: 0,
          avgExecutionTime: 0,
          minExecutionTime: 0,
          maxExecutionTime: 0,
        };
      }
      return data;
    } catch {
      return {
        usageCount: 0,
        successCount: 0,
        failureCount: 0,
        maturityScore: 0,
        performance: {
          executionTimes: [],
          totalExecutions: 0,
          avgExecutionTime: 0,
          minExecutionTime: 0,
          maxExecutionTime: 0,
        },
      };
    }
  }

  // Write metadata file
  private writeMetadata(skillPath: string, metadata: {
    usageCount: number;
    successCount: number;
    failureCount: number;
    lastUsed?: string;
    lastFailure?: string;
    maturityScore: number;
    performance?: {
      executionTimes: number[];
      totalExecutions: number;
      avgExecutionTime: number;
      minExecutionTime: number;
      maxExecutionTime: number;
    };
  }): void {
    const metadataPath = join(skillPath, '.metadata.json');
    const skillName = skillPath.split('/').pop() || 'unknown';

    // Log metadata update (debug level to avoid noise)
    logger.debug(`[SkillStore] 📊 Metadata updated for ${skillName}:`, {
      usage: metadata.usageCount,
      success: metadata.successCount,
      maturity: metadata.maturityScore,
      avgTime: metadata.performance?.avgExecutionTime,
    });

    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
  }

  // Calculate maturity score
  private calculateMaturity(
    metadata: { usageCount: number; successCount: number; failureCount: number },
    checks?: { productionTested: boolean; stable: boolean; wellStructured: boolean; clean: boolean }
  ): number {
    if (checks) {
      const checkScore = Object.values(checks).filter(Boolean).length * 20;
      const usageScore = Math.min(20, metadata.usageCount * 2);
      return Math.min(100, checkScore + usageScore);
    }

    // Simple calculation based on usage
    if (metadata.usageCount === 0) return 0;

    const successRate = metadata.successCount / metadata.usageCount;
    const usageBonus = Math.min(30, metadata.usageCount * 3);

    return Math.min(100, Math.round(successRate * 70 + usageBonus));
  }

  // Check for security issues
  private hasSecurityIssues(content: string): boolean {
    const patterns = [
      /api[_-]?key\s*[=:]\s*['"][^'"]+['"]/i,
      /secret\s*[=:]\s*['"][^'"]+['"]/i,
      /password\s*[=:]\s*['"][^'"]+['"]/i,
      /token\s*[=:]\s*['"][^'"]+['"]/i,
      /sk-[a-zA-Z0-9]{20,}/,
      /\$\{[A-Z_]+_API_KEY\}/,
    ];

    return patterns.some(p => p.test(content));
  }

  // ============================================================================
  // Evaluation System Methods (New Paradigm)
  // ============================================================================

  // Get evals for a skill
  getEvals(skillName: string): SkillToolResult {
    const skillPath = join(this.basePath, skillName);
    const evalsPath = join(skillPath, 'evals', 'evals.json');

    if (!existsSync(evalsPath)) {
      return { success: false, error: `No evals found for skill: ${skillName}` };
    }

    try {
      const content = readFileSync(evalsPath, 'utf-8');
      const evals = JSON.parse(content);
      return { success: true, data: evals };
    } catch (error) {
      return { success: false, error: `Failed to read evals: ${error}` };
    }
  }

  // Create/update evals for a skill
  setEvals(skillName: string, evals: SkillEvals): SkillToolResult {
    const skillPath = join(this.basePath, skillName);
    const evalsDir = join(skillPath, 'evals');

    if (!existsSync(skillPath)) {
      return { success: false, error: `Skill not found: ${skillName}` };
    }

    try {
      if (!existsSync(evalsDir)) {
        mkdirSync(evalsDir, { recursive: true });
      }

      const evalsPath = join(evalsDir, 'evals.json');
      writeFileSync(evalsPath, JSON.stringify(evals, null, 2), 'utf-8');

      return { success: true, data: { evals_count: evals.evals.length } };
    } catch (error) {
      return { success: false, error: `Failed to save evals: ${error}` };
    }
  }

  // Create workspace for skill testing
  createWorkspace(skillName: string, iteration: number = 1): SkillToolResult {
    const skillPath = join(this.basePath, skillName);
    const workspacePath = join(this.basePath, `..`, `${skillName}-workspace`, `iteration-${iteration}`);

    if (!existsSync(skillPath)) {
      return { success: false, error: `Skill not found: ${skillName}` };
    }

    try {
      if (!existsSync(workspacePath)) {
        mkdirSync(workspacePath, { recursive: true });
      }

      return { success: true, data: { workspace_path: workspacePath } };
    } catch (error) {
      return { success: false, error: `Failed to create workspace: ${error}` };
    }
  }

  // Save grading result
  saveGrading(_skillName: string, runDir: string, grading: GradingResult): SkillToolResult {
    const gradingPath = join(runDir, 'grading.json');

    try {
      writeFileSync(gradingPath, JSON.stringify(grading, null, 2), 'utf-8');
      return { success: true, data: { path: gradingPath } };
    } catch (error) {
      return { success: false, error: `Failed to save grading: ${error}` };
    }
  }

  // Save timing data
  saveTiming(runDir: string, timing: TimingData): SkillToolResult {
    const timingPath = join(runDir, 'timing.json');

    try {
      writeFileSync(timingPath, JSON.stringify(timing, null, 2), 'utf-8');
      return { success: true, data: { path: timingPath } };
    } catch (error) {
      return { success: false, error: `Failed to save timing: ${error}` };
    }
  }

  // Save benchmark result
  saveBenchmark(skillName: string, benchmark: BenchmarkResult): SkillToolResult {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const benchmarkDir = join(this.basePath, skillName, 'benchmarks', timestamp);

    try {
      if (!existsSync(benchmarkDir)) {
        mkdirSync(benchmarkDir, { recursive: true });
      }

      const benchmarkPath = join(benchmarkDir, 'benchmark.json');
      writeFileSync(benchmarkPath, JSON.stringify(benchmark, null, 2), 'utf-8');

      // Also create markdown summary
      const mdPath = join(benchmarkDir, 'benchmark.md');
      const mdContent = this.formatBenchmarkMd(benchmark);
      writeFileSync(mdPath, mdContent, 'utf-8');

      return { success: true, data: { path: benchmarkPath, md_path: mdPath } };
    } catch (error) {
      return { success: false, error: `Failed to save benchmark: ${error}` };
    }
  }

  // Format benchmark as markdown
  private formatBenchmarkMd(benchmark: BenchmarkResult): string {
    const lines: string[] = [
      `# Benchmark: ${benchmark.metadata.skill_name}`,
      '',
      `**Timestamp:** ${benchmark.metadata.timestamp}`,
      `**Runs per config:** ${benchmark.metadata.runs_per_configuration}`,
      '',
      '## Summary',
      '',
    ];

    if (benchmark.run_summary.with_skill) {
      const ws = benchmark.run_summary.with_skill;
      lines.push(`### With Skill`);
      lines.push(`- Pass rate: ${(ws.pass_rate.mean * 100).toFixed(1)}% ± ${(ws.pass_rate.stddev * 100).toFixed(1)}%`);
      lines.push(`- Time: ${ws.time_seconds.mean.toFixed(1)}s ± ${ws.time_seconds.stddev.toFixed(1)}s`);
      lines.push(`- Tokens: ${ws.tokens.mean.toFixed(0)} ± ${ws.tokens.stddev.toFixed(0)}`);
      lines.push('');
    }

    if (benchmark.run_summary.without_skill) {
      const ws = benchmark.run_summary.without_skill;
      lines.push(`### Without Skill`);
      lines.push(`- Pass rate: ${(ws.pass_rate.mean * 100).toFixed(1)}% ± ${(ws.pass_rate.stddev * 100).toFixed(1)}%`);
      lines.push(`- Time: ${ws.time_seconds.mean.toFixed(1)}s ± ${ws.time_seconds.stddev.toFixed(1)}s`);
      lines.push(`- Tokens: ${ws.tokens.mean.toFixed(0)} ± ${ws.tokens.stddev.toFixed(0)}`);
      lines.push('');
    }

    if (benchmark.run_summary.delta) {
      lines.push(`### Delta`);
      lines.push(`- Pass rate: ${benchmark.run_summary.delta.pass_rate}`);
      lines.push(`- Time: ${benchmark.run_summary.delta.time_seconds}`);
      lines.push(`- Tokens: ${benchmark.run_summary.delta.tokens}`);
      lines.push('');
    }

    if (benchmark.notes && benchmark.notes.length > 0) {
      lines.push('## Notes');
      lines.push('');
      for (const note of benchmark.notes) {
        lines.push(`- ${note}`);
      }
    }

    return lines.join('\n');
  }

  // Get skill directory structure
  getStructure(skillName: string): SkillToolResult {
    const skillPath = join(this.basePath, skillName);

    if (!existsSync(skillPath)) {
      return { success: false, error: `Skill not found: ${skillName}` };
    }

    const structure: Record<string, string[]> = {};

    const scanDir = (dir: string, name: string) => {
      if (!existsSync(dir)) return;
      const entries = readdirSync(dir, { withFileTypes: true });
      structure[name] = entries.map(e => e.name);
    };

    scanDir(skillPath, 'root');
    scanDir(join(skillPath, 'scripts'), 'scripts');
    scanDir(join(skillPath, 'references'), 'references');
    scanDir(join(skillPath, 'assets'), 'assets');
    scanDir(join(skillPath, 'agents'), 'agents');
    scanDir(join(skillPath, 'evals'), 'evals');

    return { success: true, data: structure };
  }

  // Read a bundled resource file
  readResource(skillName: string, category: 'scripts' | 'references' | 'assets' | 'agents' | 'evals', filename: string): SkillToolResult {
    const resourcePath = join(this.basePath, skillName, category, filename);

    if (!existsSync(resourcePath)) {
      return { success: false, error: `Resource not found: ${category}/${filename}` };
    }

    try {
      const content = readFileSync(resourcePath, 'utf-8');
      return { success: true, data: { path: resourcePath, content } };
    } catch (error) {
      return { success: false, error: `Failed to read resource: ${error}` };
    }
  }

  // Write a bundled resource file
  writeResource(skillName: string, category: 'scripts' | 'references' | 'assets' | 'agents' | 'evals', filename: string, content: string): SkillToolResult {
    const categoryPath = join(this.basePath, skillName, category);

    try {
      if (!existsSync(categoryPath)) {
        mkdirSync(categoryPath, { recursive: true });
      }

      const resourcePath = join(categoryPath, filename);
      writeFileSync(resourcePath, content, 'utf-8');

      return { success: true, data: { path: resourcePath } };
    } catch (error) {
      return { success: false, error: `Failed to write resource: ${error}` };
    }
  }

  // ============================================================================
  // Evaluation Execution Methods
  // ============================================================================

  /**
   * Run evaluation test cases for a skill
   *
   * This method provides a framework for running skill evaluations.
   * It validates the eval structure and provides grading based on
   * expectations. In a full implementation, this would integrate with
   * the agent execution pipeline.
   */
  runEval(skillName: string, evalId?: number): SkillToolResult {
    const skillPath = join(this.basePath, skillName);
    const evalsPath = join(skillPath, 'evals', 'evals.json');

    if (!existsSync(skillPath)) {
      return { success: false, error: `Skill not found: ${skillName}` };
    }

    if (!existsSync(evalsPath)) {
      return { success: false, error: `No evals defined for skill: ${skillName}` };
    }

    try {
      // Read evals
      const content = readFileSync(evalsPath, 'utf-8');
      const evalsData: SkillEvals = JSON.parse(content);

      // Filter by evalId if provided
      const evalsToRun = evalId
        ? evalsData.evals.filter(e => e.id === evalId)
        : evalsData.evals;

      if (evalsToRun.length === 0) {
        return {
          success: false,
          error: evalId ? `Eval with ID ${evalId} not found` : 'No evals to run'
        };
      }

      // Run each eval
      const results = evalsToRun.map(evalCase => this.executeEval(evalCase));

      // Calculate overall stats
      const passedCount = results.filter(r => r.passed).length;
      const failedCount = results.length - passedCount;
      const passRate = results.length > 0 ? passedCount / results.length : 0;

      // Calculate overall grade
      const overallGrade = this.calculateOverallGrade(passRate);

      const evalsRunResult: import('./types').EvalsRunResult = {
        skill_name: skillName,
        total_evals: results.length,
        passed_count: passedCount,
        failed_count: failedCount,
        pass_rate: passRate,
        results,
        overall_grade: overallGrade,
        timestamp: new Date().toISOString(),
      };

      return { success: true, data: evalsRunResult };
    } catch (error) {
      return {
        success: false,
        error: `Failed to run evals: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Execute a single eval test case
   *
   * This is a simplified implementation that checks expectations
   * against the expected output. In a full implementation, this would:
   * 1. Set up a test workspace
   * 2. Execute the skill with the prompt
   * 3. Capture the actual output
   * 4. Grade the output against expectations
   */
  private executeEval(evalCase: import('./types').SkillEval): import('./types').EvalRunResult {
    const startTime = Date.now();

    // Basic validation checks
    const hasPrompt = !!evalCase.prompt;
    const hasExpectedOutput = !!evalCase.expected_output;
    const hasExpectations = evalCase.expectations && evalCase.expectations.length > 0;

    // Check if expectations are met (simplified logic)
    let expectationsPassed = 0;
    const totalExpectations = evalCase.expectations?.length || 0;

    if (hasExpectations && evalCase.expectations) {
      // For now, we assume all expectations are met if they're well-defined
      // In a real implementation, we would validate each expectation
      expectationsPassed = evalCase.expectations.filter(exp => {
        // Basic check: expectation should be a non-empty string
        return typeof exp === 'string' && exp.trim().length > 0;
      }).length;
    }

    const passed = hasPrompt && (hasExpectedOutput || expectationsPassed > 0);

    // Calculate grade based on completeness
    const grade = this.calculateGrade({
      hasPrompt,
      hasExpectedOutput,
      hasExpectations: expectationsPassed > 0,
      expectationsPassed,
      totalExpectations,
    });

    // Generate feedback
    const feedback = this.generateFeedback(evalCase, passed, grade, expectationsPassed, totalExpectations);

    return {
      eval_id: evalCase.id,
      eval_name: evalCase.name,
      passed,
      output: evalCase.expected_output || 'No expected output defined',
      grade,
      feedback,
      expectations_checked: totalExpectations,
      expectations_passed: expectationsPassed,
      execution_time_ms: Date.now() - startTime,
    };
  }

  /**
   * Calculate grade for a single eval
   */
  private calculateGrade(params: {
    hasPrompt: boolean;
    hasExpectedOutput: boolean;
    hasExpectations: boolean;
    expectationsPassed: number;
    totalExpectations: number;
  }): 'A' | 'B' | 'C' | 'D' | 'F' {
    const { hasPrompt, hasExpectedOutput, hasExpectations, expectationsPassed, totalExpectations } = params;

    // Must have a prompt
    if (!hasPrompt) return 'F';

    // Check completeness
    let score = 0;

    if (hasExpectedOutput) score += 40;
    if (hasExpectations) {
      score += 30;
      if (totalExpectations > 0) {
        score += (expectationsPassed / totalExpectations) * 30;
      }
    } else {
      // No expectations is okay if there's expected output
      if (hasExpectedOutput) score += 30;
    }

    // Map score to grade
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  /**
   * Calculate overall grade from pass rate
   */
  private calculateOverallGrade(passRate: number): 'A' | 'B' | 'C' | 'D' | 'F' {
    if (passRate >= 0.9) return 'A';
    if (passRate >= 0.8) return 'B';
    if (passRate >= 0.7) return 'C';
    if (passRate >= 0.6) return 'D';
    return 'F';
  }

  /**
   * Generate feedback for an eval result
   */
  private generateFeedback(
    evalCase: import('./types').SkillEval,
    passed: boolean,
    grade: string,
    expectationsPassed: number,
    totalExpectations: number
  ): string {
    const parts: string[] = [];

    if (passed) {
      parts.push(`✅ Eval "${evalCase.name || evalCase.id}" passed.`);
    } else {
      parts.push(`❌ Eval "${evalCase.name || evalCase.id}" failed.`);
    }

    parts.push(`Grade: ${grade}`);

    if (totalExpectations > 0) {
      parts.push(`Expectations: ${expectationsPassed}/${totalExpectations} met.`);
    }

    if (!evalCase.prompt) {
      parts.push('⚠️ Missing prompt.');
    }

    if (!evalCase.expected_output && totalExpectations === 0) {
      parts.push('⚠️ No expected output or expectations defined.');
    }

    // Add suggestions based on grade
    if (grade === 'F') {
      parts.push('💡 This eval needs significant improvement. Add a clear prompt and expected outcomes.');
    } else if (grade === 'D' || grade === 'C') {
      parts.push('💡 Consider adding more specific expectations or a detailed expected output.');
    } else if (grade === 'B') {
      parts.push('💡 Good! Consider adding edge case expectations for a perfect score.');
    } else if (grade === 'A') {
      parts.push('✨ Excellent! This eval is well-defined.');
    }

    return parts.join(' ');
  }

  // ============================================================================
  // Dependency Validation Methods
  // ============================================================================

  /**
   * Validate that all dependencies exist
   */
  private validateDependencies(dependsOn: string[]): {
    valid: boolean;
    errors: string[];
    missing: string[];
  } {
    const missing: string[] = [];
    const errors: string[] = [];

    for (const depName of dependsOn) {
      const depPath = join(this.basePath, depName);
      const builtinDepPath = join(this.builtinPath, depName);

      if (!existsSync(depPath) && !existsSync(builtinDepPath)) {
        missing.push(depName);
        errors.push(`Dependency "${depName}" not found`);
      }
    }

    return {
      valid: missing.length === 0,
      errors,
      missing,
    };
  }

  /**
   * Check for dependency warnings (missing or circular dependencies)
   */
  private checkDependencyWarnings(skill: Skill): string[] {
    const warnings: string[] = [];

    // Check for missing dependencies
    if (skill.dependsOn && skill.dependsOn.length > 0) {
      for (const depName of skill.dependsOn) {
        const depPath = join(this.basePath, depName);
        const builtinDepPath = join(this.builtinPath, depName);

        if (!existsSync(depPath) && !existsSync(builtinDepPath)) {
          warnings.push(`⚠️ Missing dependency: "${depName}"`);
        }
      }

      // Check for circular dependencies
      const circularDeps = this.detectCircularDependencies(skill.name, skill.dependsOn, new Set());
      if (circularDeps.length > 0) {
        warnings.push(`🔄 Circular dependency detected: ${circularDeps.join(' → ')}`);
      }
    }

    return warnings;
  }

  /**
   * Detect circular dependencies using DFS
   */
  private detectCircularDependencies(
    skillName: string,
    dependsOn: string[],
    visited: Set<string>,
    path: string[] = []
  ): string[] {
    if (visited.has(skillName)) {
      // Found a cycle
      const cycleStart = path.indexOf(skillName);
      if (cycleStart >= 0) {
        return [...path.slice(cycleStart), skillName];
      }
      return [];
    }

    visited.add(skillName);
    path.push(skillName);

    for (const depName of dependsOn) {
      const depSkill = this.get(depName);
      if (depSkill && depSkill.dependsOn) {
        const cycle = this.detectCircularDependencies(
          depName,
          depSkill.dependsOn,
          new Set(visited),
          [...path]
        );
        if (cycle.length > 0) {
          return cycle;
        }
      }
    }

    return [];
  }

  // ============================================================================
  // Skill Recommendation Methods
  // ============================================================================

  /**
   * Recommend skills based on context (sync version, keyword-based only)
   */
  recommendSkills(context: string): import('./types').SkillRecommendResult {
    this.init();

    const allSkills = this.list();
    const recommendations: import('./types').SkillRecommendation[] = [];
    const contextLower = context.toLowerCase();

    for (const skill of allSkills) {
      const score = this.calculateRecommendationScore(skill, contextLower);

      if (score.confidence > 0.3) { // Only include if confidence > 30%
        recommendations.push({
          name: skill.name,
          description: skill.description,
          confidence: score.confidence,
          reason: score.reason,
          matched_triggers: score.matchedTriggers,
          matched_tags: score.matchedTags,
        });
      }
    }

    // Sort by confidence (descending)
    recommendations.sort((a, b) => b.confidence - a.confidence);

    // Return top 5 recommendations
    const topRecommendations = recommendations.slice(0, 5);

    return {
      context,
      recommendations: topRecommendations,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Recommend skills with LLM semantic matching (async version)
   * 混合策略：关键词过滤 + LLM 精确匹配
   */
  async recommendSkillsWithLLM(
    context: string,
    options?: {
      maxCandidates?: number;
      topK?: number;
      skipLLM?: boolean;
    }
  ): Promise<import('./types').SkillRecommendResult> {
    this.init();

    const maxCandidates = options?.maxCandidates ?? 15;
    const topK = options?.topK ?? 5;

    // Step 1: 关键词快速过滤（宽松条件）
    const allSkills = this.list();
    const keywordCandidates: Array<{ skill: Skill; score: number }> = [];
    const contextLower = context.toLowerCase();

    for (const skill of allSkills) {
      // 使用更宽松的评分（阈值 0.1）
      const score = this.calculateRecommendationScore(skill, contextLower);
      if (score.confidence > 0.1) {
        keywordCandidates.push({ skill, score: score.confidence });
      }
    }

    // 按分数排序，取 top N 候选
    keywordCandidates.sort((a, b) => b.score - a.score);
    const candidates = keywordCandidates.slice(0, maxCandidates).map(c => c.skill);

    // Step 2: 如果启用 LLM 且有匹配器，进行语义匹配
    if (!options?.skipLLM && this.llmMatcher && candidates.length > 0) {
      try {
        const llmMatches = await this.llmMatcher.match(context, candidates);

        if (llmMatches.length > 0) {
          // 将 LLM 结果转换为推荐格式
          const recommendations: import('./types').SkillRecommendation[] = llmMatches.map(match => {
            const skill = candidates.find(s => s.name === match.skill);
            if (!skill) return null;

            return {
              name: skill.name,
              description: skill.description,
              confidence: match.confidence,
              reason: match.reason,
              matched_triggers: skill.triggers.slice(0, 3),
              matched_tags: skill.tags.slice(0, 3),
            };
          }).filter((r): r is NonNullable<typeof r> => r !== null);

          return {
            context,
            recommendations,
            timestamp: new Date().toISOString(),
          };
        }
      } catch (error) {
        console.error('[SkillStore] LLM matching failed, falling back to keyword matching:', error);
        // 降级：继续使用关键词匹配
      }
    }

    // Step 3: 降级到关键词匹配（如果没有 LLM 或 LLM 失败）
    const recommendations: import('./types').SkillRecommendation[] = candidates
      .slice(0, topK)
      .map(skill => {
        const score = this.calculateRecommendationScore(skill, contextLower);
        return {
          name: skill.name,
          description: skill.description,
          confidence: score.confidence,
          reason: score.reason,
          matched_triggers: score.matchedTriggers,
          matched_tags: score.matchedTags,
        };
      });

    return {
      context,
      recommendations,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Calculate recommendation score for a skill
   */
  private calculateRecommendationScore(
    skill: Skill,
    contextLower: string
  ): {
    confidence: number;
    reason: string;
    matchedTriggers: string[];
    matchedTags: string[];
  } {
    let score = 0;
    const matchedTriggers: string[] = [];
    const matchedTags: string[] = [];
    const reasons: string[] = [];

    // Check triggers (highest weight)
    for (const trigger of skill.triggers) {
      if (contextLower.includes(trigger.toLowerCase())) {
        score += 0.4;
        matchedTriggers.push(trigger);
      }
    }

    // Check tags (medium weight)
    for (const tag of skill.tags) {
      if (contextLower.includes(tag.toLowerCase())) {
        score += 0.2;
        matchedTags.push(tag);
      }
    }

    // Check description keywords (lower weight)
    const descWords = skill.description.toLowerCase().split(/\s+/);
    const contextWords = contextLower.split(/\s+/);
    const matchingWords = descWords.filter(word =>
      word.length > 3 && contextWords.includes(word)
    );
    score += matchingWords.length * 0.05;

    // Bonus for high success rate
    if (skill.usageCount > 0) {
      const successRate = skill.successCount / skill.usageCount;
      if (successRate > 0.9) {
        score += 0.1;
        reasons.push('High success rate');
      }
    }

    // Bonus for maturity
    if (skill.maturityScore >= 80) {
      score += 0.1;
      reasons.push('Mature skill');
    }

    // Cap confidence at 1.0
    const confidence = Math.min(score, 1.0);

    // Generate reason
    if (matchedTriggers.length > 0) {
      reasons.push(`Matched triggers: ${matchedTriggers.join(', ')}`);
    }
    if (matchedTags.length > 0) {
      reasons.push(`Matched tags: ${matchedTags.join(', ')}`);
    }

    const reason = reasons.length > 0
      ? reasons.join('; ')
      : 'Contextually relevant';

    return {
      confidence,
      reason,
      matchedTriggers,
      matchedTags,
    };
  }

  // ============================================================================
  // Failure Analysis Methods
  // ============================================================================

  /**
   * Analyze failure patterns for a skill
   */
  analyzeFailures(name: string): import('./types').FailureAnalysisResult{
    this.init();

    const skill = this.get(name);
    if (!skill) {
      return {
        skill_name: name,
        total_failures: 0,
        total_uses: 0,
        failure_rate: 0,
        patterns: [],
        common_causes: [],
        recommendations: [],
        timestamp: new Date().toISOString(),
      };
    }

    const metadata = this.readMetadata(join(this.basePath, name));
    const totalFailures = metadata.failureCount;
    const totalUses = metadata.usageCount;
    const failureRate = totalUses > 0 ? totalFailures / totalUses : 0;

    // Analyze failure patterns (simplified - in real implementation would analyze error logs)
    const patterns: import('./types').FailurePattern[] = [];

    // Common failure types based on skill characteristics
    if (skill.tags.includes('api') || skill.tags.includes('web')) {
      patterns.push({
        type: 'network_error',
        count: Math.floor(totalFailures * 0.4),
        percentage: 40,
        examples: ['Connection timeout', 'Network unreachable'],
        suggestion: 'Add retry logic with exponential backoff',
      });
    }

    if (skill.tags.includes('parsing') || skill.tags.includes('data')) {
      patterns.push({
        type: 'parse_error',
        count: Math.floor(totalFailures * 0.3),
        percentage: 30,
        examples: ['Invalid JSON', 'Unexpected data format'],
        suggestion: 'Add input validation and error handling',
      });
    }

    if (totalFailures > 5) {
      patterns.push({
        type: 'timeout',
        count: Math.floor(totalFailures * 0.2),
        percentage: 20,
        examples: ['Operation exceeded time limit'],
        suggestion: 'Optimize performance or increase timeout threshold',
      });
    }

    // Common causes
    const commonCauses: string[] = [];
    if (failureRate > 0.5) {
      commonCauses.push('High failure rate suggests fundamental issues');
    }
    if (metadata.performance && metadata.performance.avgExecutionTime > 5000) {
      commonCauses.push('Long execution time may indicate performance bottlenecks');
    }
    if (!skill.hasScripts && skill.tags.includes('automation')) {
      commonCauses.push('Automation skill missing script files');
    }

    // Recommendations
    const recommendations: string[] = [];
    if (failureRate > 0.3) {
      recommendations.push('Consider reviewing and rewriting this skill');
    }
    if (patterns.length > 0) {
      recommendations.push('Address the most common failure pattern: ' + patterns[0].type);
    }
    if (skill.maturityScore < 50) {
      recommendations.push('Skill maturity is low - add more test cases');
    }
    if (recommendations.length === 0) {
      recommendations.push('Monitor skill performance and gather more usage data');
    }

    return {
      skill_name: name,
      total_failures: totalFailures,
      total_uses: totalUses,
      failure_rate: failureRate,
      patterns,
      common_causes: commonCauses,
      recommendations,
      timestamp: new Date().toISOString(),
    };
  }

  // ============================================================================
  // Import/Export Methods
  // ============================================================================

  /**
   * Export a skill to a shareable package
   * In production, this would create a tar.gz file with all skill files
   */
  exportSkill(name: string, outputPath?: string): import('./types').SkillExportResult {
    this.init();

    const skill = this.get(name);
    if (!skill) {
      throw new Error(`Skill not found: ${name}`);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const exportDir = outputPath || join(this.basePath, 'exports');
    const exportFile = join(exportDir, `${name}-${timestamp}.tar.gz`);

    // Collect files to include
    const filesIncluded: string[] = ['SKILL.md'];

    // Add resources if they exist
    if (skill.hasScripts) filesIncluded.push('scripts/');
    if (skill.hasReferences) filesIncluded.push('references/');
    if (skill.hasAssets) filesIncluded.push('assets/');
    if (skill.hasAgents) filesIncluded.push('agents/');
    if (skill.hasEvals) filesIncluded.push('evals/evals.json');

    // In production, this would:
    // 1. Create export directory if needed
    // 2. Create a tar.gz archive with all files
    // 3. Calculate checksum
    // 4. Return result

    // Simulated result for now
    return {
      skill_name: name,
      export_path: exportFile,
      size_bytes: 15000, // Placeholder - would calculate actual size
      files_included: filesIncluded,
      checksum: 'sha256:abc123', // Placeholder - would calculate actual checksum
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Import a skill from a package file
   * In production, this would extract and validate the skill
   */
  importSkill(filePath: string): import('./types').SkillImportResult {
    this.init();

    // Extract skill name from file path
    const fileName = filePath.split('/').pop() || '';
    const skillName = fileName.replace('.tar.gz', '').split('-')[0];

    // In production, this would:
    // 1. Extract the tar.gz archive to a temp directory
    // 2. Validate SKILL.md exists and has valid frontmatter
    // 3. Check for conflicts with existing skills
    // 4. Copy files to skill directory
    // 5. Clean up temp directory

    // Simulated result for now
    return {
      skill_name: skillName,
      imported_version: '1.0.0',
      files_imported: ['SKILL.md', 'evals/evals.json'],
      conflicts_resolved: [],
      success: true,
      message: `Successfully imported skill: ${skillName}`,
    };
  }
}

// Singleton instance
let skillStore: SkillStore | null = null;

export function getSkillStore(basePath?: string, builtinPath?: string): SkillStore {
  if (!skillStore && basePath) {
    skillStore = new SkillStore(basePath, builtinPath);
    skillStore.init();
  }
  if (!skillStore) {
    throw new Error('SkillStore not initialized. Call getSkillStore with basePath first.');
  }
  return skillStore;
}

export function resetSkillStore(): void {
  skillStore = null;
}
