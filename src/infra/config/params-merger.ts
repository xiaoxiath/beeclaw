/**
 * Params Merger - Three-layer parameter configuration merger
 *
 * Layer 1: Model default params
 * Layer 2: Role params override
 * Layer 3: Usage scenario params override
 */

import type { ModelParams } from './schema';

export class ParamsMerger {
  /**
   * Deep merge two parameter objects
   * Later parameters override earlier ones
   */
  static mergeParams(
    base: ModelParams | undefined,
    override: ModelParams | undefined
  ): ModelParams {
    if (!base) return override || {};
    if (!override) return base;

    return {
      ...base,
      ...override,
    };
  }

  /**
   * Three-layer merge: Model → Role → Usage
   *
   * @param modelParams - Model default params (Layer 1)
   * @param roleParams - Role params override (Layer 2)
   * @param usageParams - Usage scenario params override (Layer 3)
   * @returns Merged params
   */
  static mergeThreeLayers(
    modelParams: ModelParams | undefined,
    roleParams: ModelParams | undefined,
    usageParams: ModelParams | undefined
  ): ModelParams {
    let result = modelParams || {};
    result = this.mergeParams(result, roleParams);
    result = this.mergeParams(result, usageParams);
    return result;
  }

  /**
   * Identify the source of each parameter
   * Returns a map of param -> source ('model' | 'role' | 'usage')
   */
  static identifyParamSources(
    modelParams: ModelParams | undefined,
    roleParams: ModelParams | undefined,
    usageParams: ModelParams | undefined
  ): Record<string, 'model' | 'role' | 'usage'> {
    const sources: Record<string, 'model' | 'role' | 'usage'> = {};

    // Check model params
    if (modelParams) {
      Object.keys(modelParams).forEach(key => {
        sources[key] = 'model';
      });
    }

    // Check role params (override model)
    if (roleParams) {
      Object.keys(roleParams).forEach(key => {
        sources[key] = 'role';
      });
    }

    // Check usage params (override role)
    if (usageParams) {
      Object.keys(usageParams).forEach(key => {
        sources[key] = 'usage';
      });
    }

    return sources;
  }
}
