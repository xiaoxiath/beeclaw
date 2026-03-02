/**
 * Persona Tools
 *
 * AI tools for managing AIEOS personas
 */

import type { TraitsProfile, PersonaPackage } from './types';
import { getPersonaStore } from './store';
import { traitsToPromptModifier, validateTraitsProfile, getMBTIDescription, getOCEANDescription } from './traits';

// Tool type definition - matches OpenAITool format
interface PersonaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

// ============================================================
// Tool Definitions
// ============================================================

export const personaTools: PersonaTool[] = [
  {
    type: 'function',
    function: {
      name: 'persona_get',
      description: 'Get the current AI persona configuration including identity, traits, and behavior settings',
      parameters: {
        type: 'object',
        properties: {
          section: {
            type: 'string',
            description: 'Which section to retrieve: identity, soul, agents, user, traits, or all (default: all)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'persona_update_traits',
      description: 'Update the AI personality traits (MBTI, OCEAN, linguistic style). Use this to adjust AI behavior.',
      parameters: {
        type: 'object',
        properties: {
          mbti: {
            type: 'string',
            description: 'MBTI personality type (INTJ, INTP, ENTJ, ENTP, INFJ, INFP, ENFJ, ENFP, ISTJ, ISFJ, ESTJ, ESFJ, ISTP, ISFP, ESTP, ESFP)',
          },
          openness: {
            type: 'number',
            description: 'OCEAN openness - curiosity and creativity (0-1)',
          },
          conscientiousness: {
            type: 'number',
            description: 'OCEAN conscientiousness - organization and reliability (0-1)',
          },
          extraversion: {
            type: 'number',
            description: 'OCEAN extraversion - social engagement (0-1)',
          },
          agreeableness: {
            type: 'number',
            description: 'OCEAN agreeableness - cooperation and empathy (0-1)',
          },
          neuroticism: {
            type: 'number',
            description: 'OCEAN neuroticism - emotional sensitivity (0-1)',
          },
          formality: {
            type: 'number',
            description: 'Language formality level (0=casual, 1=formal)',
          },
          humor: {
            type: 'number',
            description: 'Humor level in responses (0=serious, 1=playful)',
          },
          directness: {
            type: 'number',
            description: 'Communication directness (0=indirect, 1=direct)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'persona_export',
      description: 'Export the current persona as a portable AIEOS package that can be imported in other systems',
      parameters: {
        type: 'object',
        properties: {
          includeMemories: {
            type: 'boolean',
            description: 'Include core memories in export (default: true)',
          },
          includeSkills: {
            type: 'boolean',
            description: 'Include skills in export (default: true)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'persona_import',
      description: 'Import a persona package to replace or merge with current persona',
      parameters: {
        type: 'object',
        properties: {
          packageJson: {
            type: 'string',
            description: 'The persona package to import as JSON string',
          },
          merge: {
            type: 'boolean',
            description: 'Merge with existing persona instead of replacing (default: false)',
          },
        },
        required: ['packageJson'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'persona_explain_traits',
      description: 'Explain what the current trait values mean in terms of AI behavior',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
];

// ============================================================
// Tool Execution
// ============================================================

export function executePersonaTool(
  name: string,
  params: Record<string, unknown>
): { success: boolean; data?: unknown; error?: string } {
  try {
    const store = getPersonaStore();

    switch (name) {
      case 'persona_get': {
        const section = (params.section as string) || 'all';

        switch (section) {
          case 'identity':
            return { success: true, data: store.getIdentity() };
          case 'soul':
            return { success: true, data: store.getSoul() };
          case 'agents':
            return { success: true, data: store.getAgents() };
          case 'user':
            return { success: true, data: store.getUser() };
          case 'traits':
            return { success: true, data: store.getTraits() };
          default:
            return {
              success: true,
              data: {
                identity: store.getIdentity(),
                soul: store.getSoul(),
                agents: store.getAgents(),
                user: store.getUser(),
                traits: store.getTraits(),
              },
            };
        }
      }

      case 'persona_update_traits': {
        const updates: Partial<TraitsProfile> = {};

        // MBTI
        if (params.mbti) {
          updates.mbti = params.mbti as TraitsProfile['mbti'];
        }

        // OCEAN
        const oceanKeys = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'] as const;
        const hasOcean = oceanKeys.some(k => params[k] !== undefined);

        if (hasOcean) {
          const current = store.getTraits();
          updates.ocean = {
            ...(current.ocean || {}),
            ...Object.fromEntries(
              oceanKeys
                .filter(k => params[k] !== undefined)
                .map(k => [k, Number(params[k])])
            ),
          } as any;
        }

        // Linguistic style
        const styleKeys = ['formality', 'humor', 'directness'] as const;
        const hasStyle = styleKeys.some(k => params[k] !== undefined);

        if (hasStyle) {
          const current = store.getTraits();
          updates.linguisticStyle = {
            ...(current.linguisticStyle || {}),
            ...Object.fromEntries(
              styleKeys
                .filter(k => params[k] !== undefined)
                .map(k => [k, Number(params[k])])
            ),
          } as any;
        }

        store.setTraits(updates);

        return {
          success: true,
          data: {
            message: 'Traits updated successfully',
            traits: store.getTraits(),
          },
        };
      }

      case 'persona_export': {
        const pkg = store.exportPersona({
          includeMemories: params.includeMemories !== false,
          includeSkills: params.includeSkills !== false,
        });

        return {
          success: true,
          data: pkg,
        };
      }

      case 'persona_import': {
        const packageParam = params.packageJson || params.package;
        if (!packageParam) {
          return { success: false, error: 'Missing package parameter' };
        }

        // Parse JSON string if needed
        let pkg: PersonaPackage;
        try {
          pkg = typeof packageParam === 'string'
            ? JSON.parse(packageParam)
            : (packageParam as PersonaPackage);
        } catch {
          return { success: false, error: 'Invalid JSON in package parameter' };
        }

        const result = store.importPersona(pkg, {
          merge: params.merge as boolean,
        });

        return {
          success: result.success,
          data: {
            imported: result.imported,
            errors: result.errors,
          },
          error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
        };
      }

      case 'persona_explain_traits': {
        const traits = store.getTraits();
        const explanations: string[] = [];

        if (traits.mbti) {
          explanations.push(`**MBTI: ${traits.mbti}**`);
          explanations.push(getMBTIDescription(traits.mbti));
          explanations.push('');
        }

        if (traits.ocean) {
          explanations.push('**OCEAN (Big Five) Traits:**');
          for (const [key, value] of Object.entries(traits.ocean)) {
            const desc = getOCEANDescription(key as keyof typeof traits.ocean, value);
            explanations.push(`- ${key}: ${(value * 100).toFixed(0)}% - ${desc}`);
          }
          explanations.push('');
        }

        if (traits.linguisticStyle) {
          explanations.push('**Linguistic Style:**');
          explanations.push(`- Formality: ${(traits.linguisticStyle.formality * 100).toFixed(0)}%`);
          explanations.push(`- Humor: ${(traits.linguisticStyle.humor * 100).toFixed(0)}%`);
          explanations.push(`- Directness: ${(traits.linguisticStyle.directness * 100).toFixed(0)}%`);
          explanations.push(`- Verbosity: ${(traits.linguisticStyle.verbosity * 100).toFixed(0)}%`);
          explanations.push('');
        }

        if (traits.motivation) {
          explanations.push('**Core Motivations:**');
          if (traits.motivation.primary.length > 0) {
            explanations.push(`- Primary: ${traits.motivation.primary.join(', ')}`);
          }
          if (traits.motivation.secondary.length > 0) {
            explanations.push(`- Secondary: ${traits.motivation.secondary.join(', ')}`);
          }
          if (traits.motivation.avoided.length > 0) {
            explanations.push(`- Avoided: ${traits.motivation.avoided.join(', ')}`);
          }
        }

        return {
          success: true,
          data: explanations.join('\n'),
        };
      }

      default:
        return { success: false, error: `Unknown persona tool: ${name}` };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get persona tools for AI
 */
export function getPersonaToolsForAI(): PersonaTool[] {
  return personaTools;
}

/**
 * Get trait-based system prompt modifier
 */
export function getTraitSystemPrompt(): string {
  try {
    const store = getPersonaStore();
    const traits = store.getTraits();
    return traitsToPromptModifier(traits);
  } catch {
    // Store not initialized, return empty
    return '';
  }
}
