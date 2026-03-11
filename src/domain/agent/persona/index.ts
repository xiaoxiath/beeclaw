/**
 * AIEOS Persona Module
 *
 * Implements the AIEOS (Portable AI Personas) protocol for Beeclaw
 *
 * Features:
 * - Standardized identity files (IDENTITY.md, SOUL.md, USER.md, AGENTS.md)
 * - Trait-driven psychological modeling (MBTI, OCEAN, linguistic style)
 * - Cross-model behavioral integrity
 * - Persona import/export for portability
 */

// Types
export type {
  MBTI,
  OCEAN,
  LinguisticStyle,
  Motivation,
  TraitsProfile,
  Identity,
  Soul,
  AgentGuidelines,
  UserProfile,
  PersonaPackage,
  ExportOptions,
  ImportOptions,
  PersonaToolResult,
} from './types';

// Schemas
export {
  MBTISchema,
  OCEANSchema,
  LinguisticStyleSchema,
  MotivationSchema,
  TraitsProfileSchema,
  IdentitySchema,
  SoulSchema,
  AgentGuidelinesSchema,
  UserProfileSchema,
  PersonaPackageSchema,
} from './types';

// Trait utilities
export {
  MBTI_DIMENSIONS,
  parseMBTI,
  getMBTIDescription,
  mbtiToPromptModifier,
  DEFAULT_OCEAN,
  OCEAN_DESCRIPTIONS,
  getOCEANLevel,
  getOCEANDescription,
  oceanToPromptModifier,
  DEFAULT_LINGUISTIC_STYLE,
  linguisticStyleToPromptModifier,
  traitsToPromptModifier,
  validateTraitsProfile,
  DEFAULT_TRAITS_PROFILE,
} from './traits';

// Store
export {
  PersonaStore,
  getPersonaStore,
  resetPersonaStore,
} from './store';

// Tools
export {
  personaTools,
  executePersonaTool,
  getPersonaToolsForAI,
  getTraitSystemPrompt,
} from './tools';
