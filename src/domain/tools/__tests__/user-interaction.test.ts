import { describe, it, expect } from 'bun:test';
import { askUserQuestionTool, executeAskUserQuestion } from '../user-interaction';

describe('user-interaction', () => {
  describe('askUserQuestionTool', () => {
    it('has correct name and required fields', () => {
      expect(askUserQuestionTool.name).toBe('ask_user_question');
      expect(askUserQuestionTool.parameters.required).toContain('question');
      expect(askUserQuestionTool.description).toBeTruthy();
    });

    it('defines all parameter properties', () => {
      const props = askUserQuestionTool.parameters.properties;
      expect(props.question).toBeDefined();
      expect(props.options).toBeDefined();
      expect(props.context).toBeDefined();
      expect(props.inputType).toBeDefined();
    });
  });

  describe('executeAskUserQuestion', () => {
    it('returns error for empty question', async () => {
      const result = await executeAskUserQuestion({ question: '' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('returns error for whitespace-only question', async () => {
      const result = await executeAskUserQuestion({ question: '   ' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('returns error for empty options array', async () => {
      const result = await executeAskUserQuestion({ question: 'Pick one', options: [] });
      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('returns error when choice inputType has no options', async () => {
      const result = await executeAskUserQuestion({ question: 'Pick', inputType: 'choice' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('requires options');
    });

    it('returns error when multi_choice inputType has no options', async () => {
      const result = await executeAskUserQuestion({ question: 'Pick', inputType: 'multi_choice' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('requires options');
    });

    it('returns HITL signal for valid text question', async () => {
      const result = await executeAskUserQuestion({ question: 'What is your name?' });
      expect(result.success).toBe(false);
      expect(result.needsUserInput).toBe(true);
      expect(result.question).toBe('What is your name?');
      expect(result.inputType).toBe('text');
      expect(result.message).toContain('Waiting for user input');
    });

    it('returns HITL signal for choice question with options', async () => {
      const result = await executeAskUserQuestion({
        question: 'Which color?',
        options: ['Red', 'Blue', 'Green'],
        inputType: 'choice',
      });
      expect(result.success).toBe(false);
      expect(result.needsUserInput).toBe(true);
      expect(result.options).toEqual(['Red', 'Blue', 'Green']);
      expect(result.inputType).toBe('choice');
    });

    it('passes context through', async () => {
      const result = await executeAskUserQuestion({
        question: 'Confirm?',
        context: 'This is important',
        inputType: 'confirmation',
      });
      expect(result.needsUserInput).toBe(true);
      expect(result.context).toBe('This is important');
      expect(result.inputType).toBe('confirmation');
    });

    it('defaults inputType to text when not specified', async () => {
      const result = await executeAskUserQuestion({
        question: 'Tell me more',
        options: ['A', 'B'],
      });
      expect(result.inputType).toBe('text');
    });
  });
});
