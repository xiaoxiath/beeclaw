#!/usr/bin/env bun
/**
 * Test onboarding wizard
 */

import { needsOnboarding, quickSetup } from '../src/app/onboarding';
import { rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const TEST_DIR = '/tmp/test-onboarding-' + Date.now();

async function main() {
  console.log('Testing Onboarding Wizard\n');
  console.log('='.repeat(60));

  // Setup test directory
  console.log('\n1. Setting up test directory:', TEST_DIR);
  mkdirSync(TEST_DIR, { recursive: true });

  // Test 1: needsOnboarding returns true for empty directory
  console.log('\n2. Test needsOnboarding (empty dir):');
  const needsIt = needsOnboarding(TEST_DIR);
  console.log('   Needs onboarding:', needsIt);
  console.log('   Expected: true');
  console.log('   Result:', needsIt === true ? '✅ PASS' : '❌ FAIL');

  // Test 2: quickSetup creates files
  console.log('\n3. Test quickSetup:');
  await quickSetup(TEST_DIR);

  const soulPath = join(TEST_DIR, 'SOUL.md');
  const userPath = join(TEST_DIR, 'USER.md');

  console.log('   SOUL.md exists:', existsSync(soulPath));
  console.log('   USER.md exists:', existsSync(userPath));
  console.log('   Result:', existsSync(soulPath) && existsSync(userPath) ? '✅ PASS' : '❌ FAIL');

  // Test 3: needsOnboarding returns false after setup
  console.log('\n4. Test needsOnboarding (after setup):');
  const stillNeedsIt = needsOnboarding(TEST_DIR);
  console.log('   Needs onboarding:', stillNeedsIt);
  console.log('   Expected: false');
  console.log('   Result:', stillNeedsIt === false ? '✅ PASS' : '❌ FAIL');

  // Show created files
  console.log('\n5. Created files preview:');
  if (existsSync(soulPath)) {
    const soulContent = require('fs').readFileSync(soulPath, 'utf-8');
    console.log('\n   SOUL.md (first 200 chars):');
    console.log('   ' + soulContent.substring(0, 200).replace(/\n/g, '\n   '));
  }

  if (existsSync(userPath)) {
    const userContent = require('fs').readFileSync(userPath, 'utf-8');
    console.log('\n   USER.md (first 200 chars):');
    console.log('   ' + userContent.substring(0, 200).replace(/\n/g, '\n   '));
  }

  // Cleanup
  console.log('\n6. Cleanup:');
  rmSync(TEST_DIR, { recursive: true, force: true });
  console.log('   Test directory removed');

  console.log('\n' + '='.repeat(60));
  console.log('✅ All tests completed!\n');
}

main().catch(console.error);
