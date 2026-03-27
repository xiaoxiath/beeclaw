/**
 * Tests for Tiered LLM Router
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  TieredLLMRouter,
  LLMTier,
  LLMTask,
  TASK_TIER_MAP,
  LLM_TIER_CONFIGS,
} from '../tiered-router';

// Mock provider
const mockProvider = {
  name: 'test-provider',
  type: 'openai',
  apiKey: 'test-key',
};

describe('TieredLLMRouter', () => {
  let router: TieredLLMRouter;

  beforeEach(() => {
    router = new TieredLLMRouter({
      provider: mockProvider,
      fallbackEnabled: true,
      costTracking: true,
    });
  });

  test('should map tasks to correct tiers', () => {
    // Level 1 - Fast
    expect(TASK_TIER_MAP[LLMTask.INTENT_RECOGNITION]).toBe(LLMTier.FAST);
    expect(TASK_TIER_MAP[LLMTask.MESSAGE_ROUTING]).toBe(LLMTier.FAST);
    expect(TASK_TIER_MAP[LLMTask.CONTENT_CATEGORIZATION]).toBe(LLMTier.FAST);

    // Level 2 - Standard
    expect(TASK_TIER_MAP[LLMTask.SKILL_MATCHING]).toBe(LLMTier.STANDARD);
    expect(TASK_TIER_MAP[LLMTask.KNOWLEDGE_EXTRACTION]).toBe(LLMTier.STANDARD);
    expect(TASK_TIER_MAP[LLMTask.QUERY_GENERATION]).toBe(LLMTier.STANDARD);

    // Level 3 - Advanced
    expect(TASK_TIER_MAP[LLMTask.SKILL_CREATION]).toBe(LLMTier.ADVANCED);
    expect(TASK_TIER_MAP[LLMTask.COMPLEX_REASONING]).toBe(LLMTier.ADVANCED);
    expect(TASK_TIER_MAP[LLMTask.CODE_GENERATION]).toBe(LLMTier.ADVANCED);
  });

  test('should select models for tasks', () => {
    const fastModel = router.selectModelForTask(LLMTask.INTENT_RECOGNITION);
    const standardModel = router.selectModelForTask(LLMTask.SKILL_MATCHING);
    const advancedModel = router.selectModelForTask(LLMTask.SKILL_CREATION);

    expect(fastModel).toBeTruthy();
    expect(standardModel).toBeTruthy();
    expect(advancedModel).toBeTruthy();
  });

  test('should select models for tiers', () => {
    const fastModel = router.selectModelForTier(LLMTier.FAST);
    const standardModel = router.selectModelForTier(LLMTier.STANDARD);
    const advancedModel = router.selectModelForTier(LLMTier.ADVANCED);

    expect(fastModel).toBe(LLM_TIER_CONFIGS[LLMTier.FAST].models[0]);
    expect(standardModel).toBe(LLM_TIER_CONFIGS[LLMTier.STANDARD].models[0]);
    expect(advancedModel).toBe(LLM_TIER_CONFIGS[LLMTier.ADVANCED].models[0]);
  });

  test('should respect model preferences', () => {
    const customRouter = new TieredLLMRouter({
      provider: mockProvider,
      modelPreferences: {
        [LLMTier.FAST]: 'custom-fast-model',
        [LLMTier.STANDARD]: 'custom-standard-model',
      },
    });

    expect(customRouter.selectModelForTier(LLMTier.FAST)).toBe('custom-fast-model');
    expect(customRouter.selectModelForTier(LLMTier.STANDARD)).toBe('custom-standard-model');
    expect(customRouter.selectModelForTier(LLMTier.ADVANCED)).toBe(
      LLM_TIER_CONFIGS[LLMTier.ADVANCED].models[0]
    );
  });

  test('should execute tasks successfully', async () => {
    const result = await router.execute(
      LLMTask.INTENT_RECOGNITION,
      async (model, config) => {
        expect(model).toBeTruthy();
        expect(config.tier).toBe(LLMTier.FAST);
        return 'intent-result';
      }
    );

    expect(result).toBe('intent-result');
  });

  test('should track costs', async () => {
    // Execute multiple tasks
    await router.execute(LLMTask.INTENT_RECOGNITION, async () => 'result1');
    await router.execute(LLMTask.SKILL_MATCHING, async () => 'result2');
    await router.execute(LLMTask.SKILL_CREATION, async () => 'result3');

    const stats = router.getCostStats();

    expect(stats.totalCost).toBeGreaterThan(0);
    expect(stats.byTier[LLMTier.FAST]).toBeGreaterThan(0);
    expect(stats.byTier[LLMTier.STANDARD]).toBeGreaterThan(0);
    expect(stats.byTier[LLMTier.ADVANCED]).toBeGreaterThan(0);
  });

  test('should handle fallback on failure', async () => {
    let attempts = 0;

    const result = await router.execute(
      LLMTask.SKILL_CREATION,  // ADVANCED tier
      async (model, config) => {
        attempts++;

        if (config.tier === LLMTier.ADVANCED) {
          throw new Error('Advanced model failed');
        }

        // Fallback to STANDARD should succeed
        expect(config.tier).toBe(LLMTier.STANDARD);
        return 'fallback-result';
      }
    );

    expect(result).toBe('fallback-result');
    expect(attempts).toBe(2);  // ADVANCED attempt + STANDARD fallback
  });

  test('should skip fallback when disabled', async () => {
    const noFallbackRouter = new TieredLLMRouter({
      provider: mockProvider,
      fallbackEnabled: false,
    });

    let attempts = 0;

    try {
      await noFallbackRouter.execute(
        LLMTask.SKILL_CREATION,
        async () => {
          attempts++;
          throw new Error('Model failed');
        }
      );

      // Should not reach here
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.message).toBe('Model failed');
      expect(attempts).toBe(1);  // Only one attempt
    }
  });

  test('should force specific tier', async () => {
    const result = await router.execute(
      LLMTask.SKILL_MATCHING,  // Default STANDARD
      async (model, config) => {
        expect(config.tier).toBe(LLMTier.FAST);  // Forced to FAST
        return 'fast-result';
      },
      { forceTier: LLMTier.FAST }
    );

    expect(result).toBe('fast-result');
  });

  test('should get task config', () => {
    const fastConfig = router.getTaskConfig(LLMTask.INTENT_RECOGNITION);
    const standardConfig = router.getTaskConfig(LLMTask.SKILL_MATCHING);
    const advancedConfig = router.getTaskConfig(LLMTask.SKILL_CREATION);

    expect(fastConfig.tier).toBe(LLMTier.FAST);
    expect(standardConfig.tier).toBe(LLMTier.STANDARD);
    expect(advancedConfig.tier).toBe(LLMTier.ADVANCED);
  });

  test('should clear cost log', async () => {
    await router.execute(LLMTask.INTENT_RECOGNITION, async () => 'result');

    let stats = router.getCostStats();
    expect(stats.totalCost).toBeGreaterThan(0);

    router.clearCostLog();

    stats = router.getCostStats();
    expect(stats.totalCost).toBe(0);
  });

  test('should calculate tier costs correctly', async () => {
    // Execute task in each tier
    await router.execute(LLMTask.INTENT_RECOGNITION, async () => 'fast');
    await router.execute(LLMTask.SKILL_MATCHING, async () => 'standard');
    await router.execute(LLMTask.SKILL_CREATION, async () => 'advanced');

    const stats = router.getCostStats();

    // Verify cost hierarchy
    const fastCost = stats.byTier[LLMTier.FAST];
    const standardCost = stats.byTier[LLMTier.STANDARD];
    const advancedCost = stats.byTier[LLMTier.ADVANCED];

    expect(fastCost).toBeLessThan(standardCost);
    expect(standardCost).toBeLessThan(advancedCost);
  });
});
