#!/usr/bin/env bun
/**
 * Test Script: View System Prompt Content
 *
 * 运行: bun run scripts/test-system-prompt.ts
 *
 * 用于检查：
 * 1. Skills 是否被正确注入
 * 2. System prompt 的完整结构
 * 3. 各层的 token 预算分配
 */

import { join } from 'path';
import { writeFileSync } from 'fs';
import { initApp } from '../src/app';
import { getSkillStore } from '../src/domain/skills/store';
import { getMemoryStore } from '../src/domain/memory';
import { buildSystemPromptWithBudget, SYSTEM_PROMPTS, formatSkillsForPrompt } from '../src/domain/agent/tools';

async function main() {
  console.log('🔍 System Prompt Inspector\n');
  console.log('='.repeat(80));

  // 1. Initialize app
  console.log('\n📦 Step 1: Initializing app...');
  const { config, provider, model } = await initApp({
    daemon: false,
    enableRecovery: false,
  });

  // 2. Load skills
  console.log('\n📚 Step 2: Loading skills...');
  const skillStore = getSkillStore();
  const skills = skillStore.list();

  console.log(`   Found ${skills.length} skills`);
  if (skills.length > 0) {
    console.log('\n   First 3 skills:');
    skills.slice(0, 3).forEach((s, i) => {
      console.log(`   ${i + 1}. ${s.name}`);
      console.log(`      - Description: ${s.description.substring(0, 60)}...`);
      console.log(`      - Triggers: ${s.triggers.slice(0, 3).join(', ')}`);
      console.log(`      - Maturity: ${s.maturityScore}%`);
    });
  }

  // 3. Format skills for prompt
  console.log('\n🎯 Step 3: Formatting skills for prompt...');
  const skillsForPrompt = skills.map(s => ({
    name: s.name,
    description: s.description,
    triggers: s.triggers,
  }));

  const skillsPrompt = formatSkillsForPrompt(skillsForPrompt);

  console.log(`   Skills prompt length: ${skillsPrompt.length} chars`);
  console.log('\n   Skills XML Preview:');
  console.log('   ' + '-'.repeat(76));
  console.log('   ' + skillsPrompt.split('\n').slice(0, 20).join('\n   '));
  console.log('   ' + '-'.repeat(76));

  // 4. Load memory context
  console.log('\n🧠 Step 4: Loading memory context...');
  const memoryStore = getMemoryStore();
  const coreContext = memoryStore.getCoreContext();

  console.log(`   User context: ${coreContext.user.length} chars`);
  console.log(`   Soul context: ${coreContext.soul.length} chars`);
  console.log(`   Facts context: ${coreContext.facts?.length || 0} chars`);

  // 5. Build system prompt with skills
  console.log('\n🏗️  Step 5: Building system prompt with budget...');
  const contextWithSkills = {
    ...coreContext,
    skills: skillsPrompt,
  };

  const result = buildSystemPromptWithBudget(
    SYSTEM_PROMPTS.default,
    contextWithSkills,
    undefined, // no session
    undefined, // no recent messages
    128000,    // context window
  );

  console.log(`\n   ✅ Prompt built successfully:`);
  console.log(`   - Total tokens: ${result.totalTokens}`);
  console.log(`   - Budget: 32000 tokens (25% of 128k)`);
  console.log(`   - Layers: ${result.droppedLayers.length === 0 ? 'All kept' : `Dropped: ${result.droppedLayers.join(', ')}`}`);
  console.log(`   - Examples selected: ${result.selectedExamples}`);
  console.log(`   - Skills dropped: ${result.droppedLayers.includes('skills') ? '❌ YES' : '✅ NO'}`);

  // 6. Check if skills section exists
  console.log('\n🔎 Step 6: Checking for skills section...');
  const hasSkillsSection = result.prompt.includes('<available_skills>');
  const hasSkillTag = result.prompt.includes('<skill>');
  const hasSkillsHeader = result.prompt.includes('# Available Skills');

  console.log(`   - Has <available_skills> tag: ${hasSkillsSection ? '✅' : '❌'}`);
  console.log(`   - Has <skill> tag: ${hasSkillTag ? '✅' : '❌'}`);
  console.log(`   - Has "# Available Skills" header: ${hasSkillsHeader ? '✅' : '❌'}`);

  if (hasSkillsSection) {
    const skillsStart = result.prompt.indexOf('# Available Skills');
    const skillsEnd = result.prompt.indexOf('\n---\n', skillsStart + 100);
    const skillsSection = result.prompt.substring(skillsStart, skillsEnd > 0 ? skillsEnd : skillsStart + 500);

    console.log('\n   Skills Section Preview:');
    console.log('   ' + '='.repeat(76));
    console.log('   ' + skillsSection.split('\n').slice(0, 30).join('\n   '));
    console.log('   ' + '='.repeat(76));
  }

  // 7. Save full prompt to file
  const outputPath = join(process.cwd(), 'system-prompt-debug.txt');
  const report = [
    '='.repeat(80),
    'SYSTEM PROMPT INSPECTION REPORT',
    '='.repeat(80),
    '',
    `Generated: ${new Date().toISOString()}`,
    `Total Tokens: ${result.totalTokens}`,
    `Budget: 32000`,
    `Dropped Layers: ${result.droppedLayers.join(', ') || 'None'}`,
    `Truncated Layers: ${result.truncatedLayers.join(', ') || 'None'}`,
    `Skills Injected: ${hasSkillsSection ? 'YES' : 'NO'}`,
    '',
    '='.repeat(80),
    'SKILLS METADATA',
    '='.repeat(80),
    '',
    `Total Skills: ${skills.length}`,
    '',
    'Skills List:',
    ...skills.map((s, i) => `  ${i + 1}. ${s.name} - ${s.triggers.length} triggers, ${s.maturityScore}% maturity`),
    '',
    '='.repeat(80),
    'FULL SYSTEM PROMPT',
    '='.repeat(80),
    '',
    result.prompt,
  ].join('\n');

  writeFileSync(outputPath, report, 'utf-8');

  console.log(`\n💾 Step 7: Full prompt saved to:`);
  console.log(`   ${outputPath}`);
  console.log('\n   You can open this file to see the complete system prompt.');

  // 8. Layer breakdown
  console.log('\n📊 Step 8: Prompt Structure Analysis...');
  const sections = result.prompt.split('\n---\n');
  console.log(`\n   Total sections: ${sections.length}`);
  sections.forEach((section, i) => {
    const firstLine = section.split('\n')[0];
    const tokens = Math.ceil(section.length / 3);
    console.log(`   ${i + 1}. ${firstLine.substring(0, 50)}... (${tokens} tokens, ${section.length} chars)`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('✅ Inspection Complete!');
  console.log('='.repeat(80));
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
