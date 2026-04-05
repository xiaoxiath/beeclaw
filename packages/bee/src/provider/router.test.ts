/**
 * Tests for TieredLLMRouter.
 *
 * TDD: Tests written first, then implementation.
 * Extracted from beeclaw's src/infra/ai/tiered-router.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  TieredLLMRouter,
  LLMTier,
  LLMTask,
  LLM_TIER_CONFIGS,
  TASK_TIER_MAP,
  type LLMTierConfig,
} from './router';

describe('LLM Tier Configs', () => {
  it('should define all three tiers', () => {
    expect(LLM_TIER_CONFIGS[LLMTier.FAST]).toBeDefined();
    expect(LLM_TIER_CONFIGS[LLMTier.STANDARD]).toBeDefined();
    expect(LLM_TIER_CONFIGS[LLMTier.ADVANCED]).toBeDefined();
  });

  it('should have models array in each tier', () => {
    for (const tier of Object.values(LLMTier)) {
      expect(LLM_TIER_CONFIGS[tier].models.length).toBeGreaterThan(0);
    }
  });
});

describe('TASK_TIER_MAP', () => {
  it('should map every task to a tier', () => {
    for (const task of Object.values(LLMTask)) {
      expect(TASK_TIER_MAP[task]).toBeDefined();
      expect(Object.values(LLMTier)).toContain(TASK_TIER_MAP[task]);
    }
  });
});

describe('TieredLLMRouter', () => {
  it('should select default model for a task', () => {
    const router = new TieredLLMRouter({});
    const model = router.selectModelForTask(LLMTask.INTENT_RECOGNITION);

    // INTENT_RECOGNITION maps to FAST tier, first model should be selected
    expect(model).toBe(LLM_TIER_CONFIGS[LLMTier.FAST].models[0]);
  });

  it('should select model for a tier directly', () => {
    const router = new TieredLLMRouter({});
    const model = router.selectModelForTier(LLMTier.ADVANCED);

    expect(model).toBe(LLM_TIER_CONFIGS[LLMTier.ADVANCED].models[0]);
  });

  it('should respect user model preferences', () => {
    const router = new TieredLLMRouter({
      modelPreferences: { [LLMTier.FAST]: 'my-custom-fast-model' },
    });

    expect(router.selectModelForTier(LLMTier.FAST)).toBe('my-custom-fast-model');
    // Other tiers should use defaults
    expect(router.selectModelForTier(LLMTier.STANDARD)).toBe(
      LLM_TIER_CONFIGS[LLMTier.STANDARD].models[0],
    );
  });

  it('should return correct task config', () => {
    const router = new TieredLLMRouter({});
    const config = router.getTaskConfig(LLMTask.CODE_GENERATION);

    // CODE_GENERATION maps to ADVANCED tier
    expect(config.tier).toBe(LLMTier.ADVANCED);
    expect(config).toEqual(LLM_TIER_CONFIGS[LLMTier.ADVANCED]);
  });

  it('should execute task and return result', async () => {
    const router = new TieredLLMRouter({});

    const result = await router.execute(
      LLMTask.INTENT_RECOGNITION,
      async (model, config) => {
        return { model, maxTokens: config.maxTokens };
      },
    );

    expect(result.model).toBe(LLM_TIER_CONFIGS[LLMTier.FAST].models[0]);
    expect(result.maxTokens).toBe(LLM_TIER_CONFIGS[LLMTier.FAST].maxTokens);
  });

  it('should force a specific tier with forceTier option', async () => {
    const router = new TieredLLMRouter({});

    const result = await router.execute(
      LLMTask.INTENT_RECOGNITION, // normally FAST
      async (model) => model,
      { forceTier: LLMTier.ADVANCED }, // force ADVANCED
    );

    expect(result).toBe(LLM_TIER_CONFIGS[LLMTier.ADVANCED].models[0]);
  });

  it('should fallback to adjacent tier on failure', async () => {
    const router = new TieredLLMRouter({ fallbackEnabled: true });

    let callCount = 0;
    const result = await router.execute(
      LLMTask.CODE_GENERATION, // ADVANCED tier
      async (model, config) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('ADVANCED model failed');
        }
        return model;
      },
    );

    // Should have tried ADVANCED first, then fallen back
    expect(callCount).toBe(2);
    // First fallback for ADVANCED is STANDARD
    expect(result).toBe(LLM_TIER_CONFIGS[LLMTier.STANDARD].models[0]);
  });

  it('should throw when all fallbacks exhausted', async () => {
    const router = new TieredLLMRouter({ fallbackEnabled: true });

    await expect(
      router.execute(
        LLMTask.INTENT_RECOGNITION,
        async () => {
          throw new Error('Always fails');
        },
      ),
    ).rejects.toThrow('Always fails');
  });

  it('should skip fallback when disabled', async () => {
    const router = new TieredLLMRouter({ fallbackEnabled: false });

    await expect(
      router.execute(
        LLMTask.INTENT_RECOGNITION,
        async () => {
          throw new Error('No fallback');
        },
      ),
    ).rejects.toThrow('No fallback');
  });

  // --------------------------------------------------------------------------
  // Cost tracking
  // --------------------------------------------------------------------------

  it('should track costs when enabled', async () => {
    const router = new TieredLLMRouter({ costTracking: true });

    await router.execute(
      LLMTask.KEYWORD_EXTRACTION, // FAST
      async () => 'ok',
    );

    const stats = router.getCostStats();
    expect(stats.totalCost).toBeGreaterThan(0);
    expect(stats.byTier[LLMTier.FAST]).toBeGreaterThan(0);
  });

  it('should not track costs when disabled', async () => {
    const router = new TieredLLMRouter({ costTracking: false });

    await router.execute(
      LLMTask.KEYWORD_EXTRACTION,
      async () => 'ok',
    );

    const stats = router.getCostStats();
    expect(stats.totalCost).toBe(0);
  });

  it('should clear cost log', async () => {
    const router = new TieredLLMRouter({ costTracking: true });

    await router.execute(LLMTask.CODE_GENERATION, async () => 'ok');
    router.clearCostLog();

    expect(router.getCostStats().totalCost).toBe(0);
  });
});
