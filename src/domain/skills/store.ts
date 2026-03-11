import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type {
  Skill,
  SkillFrontmatter,
  CreateSkillOptions,
  UpdateSkillOptions,
  MaturityAssessment,
  SkillToolResult,
} from './types';
import { SkillFrontmatterSchema } from './types';

export class SkillStore {
  private basePath: string;          // User skills path
  private builtinPath: string;       // Built-in skills path
  private initialized: boolean = false;

  constructor(basePath: string, builtinPath?: string) {
    this.basePath = basePath;
    // Default builtin path is skills/ at project root
    this.builtinPath = builtinPath || join(process.cwd(), 'skills');
  }

  // Initialize skills directory
  init(): void {
    if (this.initialized) return;

    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }

    this.initialized = true;
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
      return userSkill;
    }

    // Then check builtin skills
    const builtinPath = join(this.builtinPath, name);
    return this.load(builtinPath, true);
  }

  // Create a new skill
  create(options: CreateSkillOptions): SkillToolResult {
    this.init();

    const skillPath = join(this.basePath, options.name);

    if (existsSync(skillPath)) {
      return { success: false, error: `Skill already exists: ${options.name}` };
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
  recordUsage(name: string, success: boolean): SkillToolResult {
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

      // Update maturity score
      metadata.maturityScore = this.calculateMaturity(metadata);

      this.writeMetadata(skillPath, metadata);

      return { success: true, data: metadata };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
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
    } catch {
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
  } {
    const metadataPath = join(skillPath, '.metadata.json');

    if (!existsSync(metadataPath)) {
      return {
        usageCount: 0,
        successCount: 0,
        failureCount: 0,
        maturityScore: 0,
      };
    }

    try {
      const content = readFileSync(metadataPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {
        usageCount: 0,
        successCount: 0,
        failureCount: 0,
        maturityScore: 0,
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
  }): void {
    const metadataPath = join(skillPath, '.metadata.json');
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
  setEvals(skillName: string, evals: import('./types').SkillEvals): SkillToolResult {
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
  saveGrading(skillName: string, runDir: string, grading: import('./types').GradingResult): SkillToolResult {
    const gradingPath = join(runDir, 'grading.json');

    try {
      writeFileSync(gradingPath, JSON.stringify(grading, null, 2), 'utf-8');
      return { success: true, data: { path: gradingPath } };
    } catch (error) {
      return { success: false, error: `Failed to save grading: ${error}` };
    }
  }

  // Save timing data
  saveTiming(runDir: string, timing: import('./types').TimingData): SkillToolResult {
    const timingPath = join(runDir, 'timing.json');

    try {
      writeFileSync(timingPath, JSON.stringify(timing, null, 2), 'utf-8');
      return { success: true, data: { path: timingPath } };
    } catch (error) {
      return { success: false, error: `Failed to save timing: ${error}` };
    }
  }

  // Save benchmark result
  saveBenchmark(skillName: string, benchmark: import('./types').BenchmarkResult): SkillToolResult {
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
  private formatBenchmarkMd(benchmark: import('./types').BenchmarkResult): string {
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
