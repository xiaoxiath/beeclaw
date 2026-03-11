/**
 * Onboarding Wizard - Interactive initialization for SOUL.md and USER.md
 *
 * Guides users through creating their AI personality and user profile
 */

import { createInterface } from 'readline';
import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../infra/observability/logger';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

/**
 * Check if core memory files need to be created
 */
export function needsOnboarding(memoryPath: string): boolean {
  const soulPath = join(memoryPath, 'SOUL.md');
  const userPath = join(memoryPath, 'USER.md');

  // If either file doesn't exist, we need onboarding
  if (!existsSync(soulPath) || !existsSync(userPath)) {
    return true;
  }

  // If files exist but are nearly empty (just templates), we should still onboard
  // This is optional - you can comment this out if you prefer to skip for template files
  return false;
}

/**
 * Interactive wizard for creating SOUL.md
 */
async function createSoulWizard(memoryPath: string): Promise<void> {
  console.log('\n🎭 Let\'s define your AI assistant\'s personality (SOUL.md)');
  console.log('━'.repeat(60));
  console.log('This will shape how the AI behaves and interacts with you.\n');

  const answers: string[] = [];

  // Question 1: Core values
  console.log('❓ What core values should the AI have?');
  console.log('   Examples: helpful, honest, creative, concise, thorough');
  const values = await prompt('   Your answer (press Enter for default): ');
  answers.push(values || 'helpful, honest, clear, practical');

  // Question 2: Communication style
  console.log('\n❓ How should the AI communicate?');
  console.log('   Examples: casual, formal, friendly, professional, detailed, concise');
  const style = await prompt('   Your answer (press Enter for default): ');
  answers.push(style || 'clear, friendly, concise');

  // Question 3: Expertise areas
  console.log('\n❓ What expertise areas should the AI focus on?');
  console.log('   Examples: programming, writing, analysis, brainstorming, planning');
  const expertise = await prompt('   Your answer (press Enter for default): ');
  answers.push(expertise || 'general assistance, problem-solving, learning');

  // Question 4: Behavioral guidelines
  console.log('\n❓ Any specific behavioral guidelines?');
  console.log('   Examples: "Be proactive", "Ask before acting", "Explain reasoning"');
  const guidelines = await prompt('   Your answer (press Enter for default): ');
  answers.push(guidelines || 'Be proactive but ask before important actions');

  // Generate SOUL.md content
  const soulContent = `# SOUL

## Core Values

${answers[0].split(',').map((v: string) => `- ${v.trim()}`).join('\n')}

## Communication Style

${answers[1].split(',').map((s: string) => `- ${s.trim()}`).join('\n')}

## Expertise Areas

${answers[2].split(',').map((e: string) => `- ${e.trim()}`).join('\n')}

## Behavioral Guidelines

${answers[3]}

## Identity

I am Beeclaw, your personal AI assistant. I learn from our interactions and adapt to your preferences over time.

---

_This file defines my personality and behavior. Feel free to edit it to customize my responses._
`;

  const soulPath = join(memoryPath, 'SOUL.md');
  writeFileSync(soulPath, soulContent, 'utf-8');
  console.log('\n✅ SOUL.md created successfully!\n');
}

/**
 * Interactive wizard for creating USER.md
 */
async function createUserWizard(memoryPath: string): Promise<void> {
  console.log('\n👤 Now let\'s create your profile (USER.md)');
  console.log('━'.repeat(60));
  console.log('This helps the AI understand your background and preferences.\n');

  const answers: string[] = [];

  // Question 1: Name and role
  console.log('❓ What\'s your name and role/profession?');
  const name = await prompt('   Your answer: ');
  answers.push(name || 'User');

  // Question 2: Background
  console.log('\n❓ What\'s your background? (skills, experience, interests)');
  const background = await prompt('   Your answer: ');
  answers.push(background || 'Not specified');

  // Question 3: Goals
  console.log('\n❓ What are your main goals for using this AI assistant?');
  console.log('   Examples: productivity, learning, coding, writing, research');
  const goals = await prompt('   Your answer: ');
  answers.push(goals || 'General assistance');

  // Question 4: Preferences
  console.log('\n❓ Any specific preferences for AI responses?');
  console.log('   Examples: "Prefer code examples", "Like detailed explanations", "Keep it brief"');
  const preferences = await prompt('   Your answer (press Enter for default): ');
  answers.push(preferences || 'Clear and practical responses');

  // Question 5: Communication preference
  console.log('\n❓ Preferred language for communication?');
  const language = await prompt('   Your answer (press Enter for 中文): ');
  answers.push(language || '中文');

  // Generate USER.md content
  const userContent = `# USER

## Basic Information

- **Name/Role**: ${answers[0]}
- **Language**: ${answers[4]}

## Background

${answers[1]}

## Goals

${answers[2].split(',').map((g: string) => `- ${g.trim()}`).join('\n')}

## Preferences

${answers[3]}

## Context

This profile helps the AI assistant provide more personalized and relevant assistance.

---

_This file describes you. Update it anytime to help the AI better understand your needs._
`;

  const userPath = join(memoryPath, 'USER.md');
  writeFileSync(userPath, userContent, 'utf-8');
  console.log('\n✅ USER.md created successfully!\n');
}

/**
 * Run the complete onboarding wizard
 */
export async function runOnboardingWizard(memoryPath: string): Promise<void> {
  console.log('\n');
  console.log('╔' + '═'.repeat(58) + '╗');
  console.log('║' + ' 🎉 Welcome to Beeclaw! '.padEnd(58) + '║');
  console.log('║' + ''.padEnd(58) + '║');
  console.log('║' + ' Let\'s set up your personal AI assistant. '.padEnd(58) + '║');
  console.log('║' + ' This will only take a few minutes. '.padEnd(58) + '║');
  console.log('╚' + '═'.repeat(58) + '╝');
  console.log('\n');

  try {
    // Create SOUL.md
    await createSoulWizard(memoryPath);

    // Create USER.md
    await createUserWizard(memoryPath);

    console.log('╔' + '═'.repeat(58) + '╗');
    console.log('║' + ' ✅ Setup Complete! '.padEnd(58) + '║');
    console.log('║' + ''.padEnd(58) + '║');
    console.log('║' + ' Your AI assistant is ready to use. '.padEnd(58) + '║');
    console.log('║' + ''.padEnd(58) + '║');
    console.log('║' + ' 💡 Tip: You can edit SOUL.md and USER.md '.padEnd(58) + '║');
    console.log('║' + '    anytime to customize your experience. '.padEnd(58) + '║');
    console.log('╚' + '═'.repeat(58) + '╝');
    console.log('\n');
  } catch (error) {
    logger.error('Onboarding wizard failed:', error);
    console.log('\n⚠️  Setup encountered an issue. Default files will be created.\n');
    throw error;
  } finally {
    rl.close();
  }
}

/**
 * Quick setup with minimal interaction
 */
export async function quickSetup(memoryPath: string): Promise<void> {
  const soulPath = join(memoryPath, 'SOUL.md');
  const userPath = join(memoryPath, 'USER.md');

  if (!existsSync(soulPath)) {
    const defaultSoul = `# SOUL

## Core Values

- Helpful and supportive
- Honest and transparent
- Clear and concise
- Practical and solution-oriented

## Communication Style

- Friendly but professional
- Adapts to user's needs
- Provides explanations when helpful
- Direct and efficient

## Expertise

- General assistance and problem-solving
- Learning and research
- Task automation and productivity
- Programming and technical help

## Behavioral Guidelines

- Be proactive but ask before important actions
- Provide context and reasoning when helpful
- Respect user's time with concise responses
- Learn from interactions to improve over time

---

_This file defines my personality and behavior. Feel free to edit it to customize my responses._
`;
    writeFileSync(soulPath, defaultSoul, 'utf-8');
  }

  if (!existsSync(userPath)) {
    const defaultUser = `# USER

## Basic Information

- **Language**: 中文

## Background

This is a new user profile. Update this file to help the AI better understand your background, skills, and interests.

## Goals

- Get helpful assistance with various tasks
- Learn and improve productivity
- Automate repetitive work

## Preferences

- Clear and practical responses
- Explanations when learning new concepts
- Efficient solutions

---

_This file describes you. Update it anytime to help the AI better understand your needs._
`;
    writeFileSync(userPath, defaultUser, 'utf-8');
  }
}
