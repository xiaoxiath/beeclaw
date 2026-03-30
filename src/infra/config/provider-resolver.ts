/**
 * Provider Resolver - Resolve provider and role configurations (v6)
 *
 * Features:
 * - Resolve provider by name
 * - Resolve role from global roles
 * - Two-layer parameter merging (Role → Usage)
 * - Support for v6 flat configuration structure
 */

import type {
  AIProvider,
  ModelParams,
  RoleDefinition,
  ModelDefinition,
} from './schema';
import { ParamsMerger } from './params-merger';

export class ProviderResolver {
  constructor(
    private providers: AIProvider[],
    private roles: Record<string, RoleDefinition>
  ) {}

  /**
   * Get default provider (first one marked as default, or first in list)
   */
  getDefaultProvider(): AIProvider | undefined {
    const defaultProvider = this.providers.find(p => p.default);
    return defaultProvider || this.providers[0];
  }

  /**
   * Get provider by name
   */
  getProvider(name: string): AIProvider | undefined {
    return this.providers.find(p => p.name === name);
  }

  /**
   * Get model definition from provider
   */
  private getModelDefinition(
    provider: AIProvider,
    modelName: string
  ): ModelDefinition | undefined {
    return provider.models?.[modelName];
  }

  /**
   * Resolve role from global roles (v6)
   *
   * @param roleName - Name of the role in global roles
   * @param usageParams - Optional params to override role params
   */
  resolveRole(
    roleName: string,
    usageParams?: ModelParams
  ): {
    provider: AIProvider;
    model: string;
    params: ModelParams;
  } {
    // Get role definition from global roles
    const roleDef = this.roles[roleName];
    if (!roleDef) {
      throw new Error(
        `Role "${roleName}" not found in global roles`
      );
    }

    // Get provider from role definition
    const provider = this.getProvider(roleDef.provider);
    if (!provider) {
      throw new Error(
        `Provider "${roleDef.provider}" referenced by role "${roleName}" not found`
      );
    }

    // v6: Two-layer merge (Role → Usage)
    // Model metadata (contextWindow, maxTokens) is not merged into params
    const model = roleDef.model;
    this.getModelDefinition(provider, model);
    const mergedParams = ParamsMerger.mergeParams(
      roleDef.params || {},
      usageParams || {}
    );

    return {
      provider,
      model,
      params: mergedParams,
    };
  }

  /**
   * Get role definition by name
   */
  getRole(roleName: string): RoleDefinition | undefined {
    return this.roles[roleName];
  }

  /**
   * Resolve tier configuration (v6)
   */
  resolveTier(tier: { role: string; params?: ModelParams }): {
    provider: AIProvider;
    models: string[];
    params: ModelParams;
  } {
    const roleDef = this.getRole(tier.role);
    if (!roleDef) {
      throw new Error(`Role "${tier.role}" not found`);
    }

    const { provider, model, params } = this.resolveRole(tier.role, tier.params);
    return {
      provider,
      models: [model],
      params,
    };
  }

  /**
   * Resolve compression configuration (v6)
   */
  resolveCompression(config: { role: string; params?: ModelParams }): {
    provider: AIProvider;
    model: string;
    params: ModelParams;
  } {
    return this.resolveRole(config.role, config.params);
  }
}
