import { describe, it, expect, vi } from 'vitest';
import { ParamsMerger } from '../params-merger';

describe('ParamsMerger', () => {
  describe('mergeParams', () => {
    it('should return override when base is undefined', () => {
      const result = ParamsMerger.mergeParams(undefined, { temperature: 0.7 });
      expect(result).toEqual({ temperature: 0.7 });
    });

    it('should return base when override is undefined', () => {
      const result = ParamsMerger.mergeParams({ temperature: 0.5 }, undefined);
      expect(result).toEqual({ temperature: 0.5 });
    });

    it('should return empty object when both are undefined', () => {
      const result = ParamsMerger.mergeParams(undefined, undefined);
      expect(result).toEqual({});
    });

    it('should merge base and override with override taking precedence', () => {
      const result = ParamsMerger.mergeParams(
        { temperature: 0.5, maxTokens: 1000 },
        { temperature: 0.9, topP: 0.8 },
      );
      expect(result).toEqual({ temperature: 0.9, maxTokens: 1000, topP: 0.8 });
    });

    it('should return base when override is empty object', () => {
      const result = ParamsMerger.mergeParams({ temperature: 0.5 }, {});
      expect(result).toEqual({ temperature: 0.5 });
    });

    it('should return override when base is empty object', () => {
      const result = ParamsMerger.mergeParams({}, { temperature: 0.7 });
      expect(result).toEqual({ temperature: 0.7 });
    });
  });

  describe('mergeThreeLayers', () => {
    it('should merge all three layers with correct priority', () => {
      const modelParams = { temperature: 0.5, maxTokens: 1000 };
      const roleParams = { temperature: 0.7, topP: 0.9 };
      const usageParams = { temperature: 0.9 };

      const result = ParamsMerger.mergeThreeLayers(modelParams, roleParams, usageParams);
      expect(result.temperature).toBe(0.9);  // usage wins
      expect(result.topP).toBe(0.9);          // from role
      expect(result.maxTokens).toBe(1000);    // from model
    });

    it('should handle all undefined layers', () => {
      const result = ParamsMerger.mergeThreeLayers(undefined, undefined, undefined);
      expect(result).toEqual({});
    });

    it('should handle only model layer', () => {
      const result = ParamsMerger.mergeThreeLayers(
        { temperature: 0.5 },
        undefined,
        undefined,
      );
      expect(result).toEqual({ temperature: 0.5 });
    });

    it('should handle only role layer', () => {
      const result = ParamsMerger.mergeThreeLayers(
        undefined,
        { temperature: 0.7 },
        undefined,
      );
      expect(result).toEqual({ temperature: 0.7 });
    });

    it('should handle only usage layer', () => {
      const result = ParamsMerger.mergeThreeLayers(
        undefined,
        undefined,
        { temperature: 0.9 },
      );
      expect(result).toEqual({ temperature: 0.9 });
    });

    it('should handle model + usage (skipping role)', () => {
      const result = ParamsMerger.mergeThreeLayers(
        { temperature: 0.5, maxTokens: 1000 },
        undefined,
        { temperature: 0.9 },
      );
      expect(result.temperature).toBe(0.9);
      expect(result.maxTokens).toBe(1000);
    });
  });

  describe('identifyParamSources', () => {
    it('should identify model as source when only model provides params', () => {
      const sources = ParamsMerger.identifyParamSources(
        { temperature: 0.5 },
        undefined,
        undefined,
      );
      expect(sources.temperature).toBe('model');
    });

    it('should identify role as source when role overrides model', () => {
      const sources = ParamsMerger.identifyParamSources(
        { temperature: 0.5 },
        { temperature: 0.7 },
        undefined,
      );
      expect(sources.temperature).toBe('role');
    });

    it('should identify usage as source when usage overrides role and model', () => {
      const sources = ParamsMerger.identifyParamSources(
        { temperature: 0.5 },
        { temperature: 0.7 },
        { temperature: 0.9 },
      );
      expect(sources.temperature).toBe('usage');
    });

    it('should track sources from different layers', () => {
      const sources = ParamsMerger.identifyParamSources(
        { temperature: 0.5, maxTokens: 1000 },
        { topP: 0.9 },
        { frequencyPenalty: 0.5 },
      );
      expect(sources.temperature).toBe('model');
      expect(sources.maxTokens).toBe('model');
      expect(sources.topP).toBe('role');
      expect(sources.frequencyPenalty).toBe('usage');
    });

    it('should return empty object when all layers are undefined', () => {
      const sources = ParamsMerger.identifyParamSources(undefined, undefined, undefined);
      expect(sources).toEqual({});
    });

    it('should handle empty objects', () => {
      const sources = ParamsMerger.identifyParamSources({}, {}, {});
      expect(sources).toEqual({});
    });
  });
});
