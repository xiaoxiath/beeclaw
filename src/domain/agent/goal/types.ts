/**
 * Goal System Types
 *
 * Types for cross-session goal tracking
 */

import { z } from 'zod';
import type { ToolResult, State, Priority } from '../types';

// Re-export for convenience
export type { ToolResult } from '../types';

// Goal state enum (extends common State)
export type GoalState = State;

// Goal priority levels (extends common Priority with 'critical')
export type GoalPriority = Priority | 'critical';

// Checkpoint schema
export const CheckpointSchema = z.object({
  id: z.string().describe('Unique checkpoint ID'),
  title: z.string().describe('Checkpoint title'),
  description: z.string().optional().describe('Checkpoint details'),
  completed: z.boolean().default(false).describe('Whether checkpoint is completed'),
  completedAt: z.string().optional().describe('When checkpoint was completed'),
  createdAt: z.string().describe('When checkpoint was created'),
});

export type Checkpoint = z.infer<typeof CheckpointSchema>;

// Goal context schema
export const GoalContextSchema = z.object({
  why: z.string().describe('Why this goal matters'),
  relatedFacts: z.array(z.string()).optional().default([]).describe('Related memory facts'),
  constraints: z.array(z.string()).optional().default([]).describe('Constraints or limitations'),
});

export type GoalContext = z.infer<typeof GoalContextSchema>;

// Main goal schema
export const GoalSchema = z.object({
  id: z.string().describe('Unique goal ID'),
  title: z.string().describe('Goal title'),
  description: z.string().describe('Detailed goal description'),
  state: z.enum(['active', 'paused', 'completed', 'cancelled']).default('active').describe('Current state'),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium').describe('Priority level'),
  progress: z.number().min(0).max(100).default(0).describe('Progress percentage (0-100)'),
  checkpoints: z.array(CheckpointSchema).optional().default([]).describe('Milestones/checkpoints'),
  subGoals: z.array(z.string()).optional().default([]).describe('Sub-goal IDs'),
  parentGoal: z.string().optional().describe('Parent goal ID if this is a sub-goal'),
  context: GoalContextSchema.optional().describe('Goal context'),
  tags: z.array(z.string()).optional().default([]).describe('Tags for categorization'),
  createdAt: z.string().describe('Creation timestamp'),
  updatedAt: z.string().describe('Last update timestamp'),
  targetDate: z.string().optional().describe('Target completion date'),
  completedAt: z.string().optional().describe('Completion timestamp'),
  completedBy: z.string().optional().describe('How the goal was completed'),
});

export type Goal = z.infer<typeof GoalSchema>;

// Goal index schema
export const GoalIndexSchema = z.object({
  goals: z.record(z.object({
    id: z.string(),
    title: z.string(),
    state: z.enum(['active', 'paused', 'completed', 'cancelled']),
    priority: z.enum(['low', 'medium', 'high', 'critical']),
    progress: z.number(),
    updatedAt: z.string(),
  })).default({}),
  lastUpdated: z.string(),
});

export type GoalIndex = z.infer<typeof GoalIndexSchema>;

// Tool result type - uses unified type with Goal data
export type GoalToolResult = ToolResult<Goal | Goal[] | { [key: string]: unknown }>;

// Create goal options
export const CreateGoalOptionsSchema = z.object({
  title: z.string().min(1).describe('Goal title'),
  description: z.string().optional().default('').describe('Detailed description'),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
  targetDate: z.string().optional().describe('Target completion date (ISO string)'),
  tags: z.array(z.string()).optional().default([]),
  context: z.object({
    why: z.string(),
    relatedFacts: z.array(z.string()).optional().default([]),
    constraints: z.array(z.string()).optional().default([]),
  }).optional(),
});

export type CreateGoalOptions = z.infer<typeof CreateGoalOptionsSchema>;

// Update goal options
export const UpdateGoalOptionsSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  state: z.enum(['active', 'paused', 'completed', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  progress: z.number().min(0).max(100).optional(),
  targetDate: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type UpdateGoalOptions = z.infer<typeof UpdateGoalOptionsSchema>;

// Add checkpoint options
export const AddCheckpointOptionsSchema = z.object({
  goalId: z.string().describe('Goal ID'),
  title: z.string().describe('Checkpoint title'),
  description: z.string().optional().describe('Checkpoint details'),
});

export type AddCheckpointOptions = z.infer<typeof AddCheckpointOptionsSchema>;

// Goal filter for listing
export const GoalFilterSchema = z.object({
  state: z.enum(['active', 'paused', 'completed', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  tags: z.array(z.string()).optional(),
  search: z.string().optional(),
});

export type GoalFilter = z.infer<typeof GoalFilterSchema>;
