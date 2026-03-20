/**
 * HITL Renderer Tests
 */

import { describe, test, expect } from 'bun:test';
import {
  renderConfirmationRequestCard,
  renderUserInputRequestCard,
} from '../hitl-renderer';
import type { ContentBlock } from '../../../../types/content-block';

describe('HITL Renderer', () => {
  describe('Confirmation Request Card', () => {
    test('should render card with interactive buttons', () => {
      const block: ContentBlock = {
        type: 'confirmation_request',
        toolName: 'shell_exec',
        toolCallId: 'call_123',
        params: { command: 'ls -la' },
        message: 'Test confirmation',
        riskLevel: 'medium',
        sessionId: 'session_456',
      };

      const card = renderConfirmationRequestCard(block);

      // Verify card structure
      expect(card).toBeDefined();
      expect(card.type).toBe('card');
      expect(card.header).toBeDefined();
      expect(card.header.template).toBe('yellow'); // medium risk

      // Find buttons directly in elements (no action wrapper in Card V2)
      const buttons = card.elements.filter(Boolean).filter((el: any) => el.tag === 'button');
      expect(buttons).toHaveLength(2);

      // Verify APPROVED button
      const approveButton = buttons.find((btn: any) => btn.type === 'primary');
      expect(approveButton).toBeDefined();
      expect(approveButton.text.content).toContain('批准');
      expect(approveButton.behaviors[0].value.action).toBe('hitl_callback');
      expect(approveButton.behaviors[0].value.hitlType).toBe('confirmation');
      expect(approveButton.behaviors[0].value.decision).toBe('APPROVED');
      expect(approveButton.behaviors[0].value.toolCallId).toBe('call_123');
      expect(approveButton.behaviors[0].value.sessionId).toBe('session_456');

      // Verify DENIED button
      const denyButton = buttons.find((btn: any) => btn.type === 'danger');
      expect(denyButton).toBeDefined();
      expect(denyButton.text.content).toContain('拒绝');
      expect(denyButton.behaviors[0].value.decision).toBe('DENIED');
    });

    test('should use correct colors for risk levels', () => {
      const riskColors = {
        low: 'blue',
        medium: 'yellow',
        high: 'orange',
        critical: 'red',
      };

      for (const [risk, color] of Object.entries(riskColors)) {
        const block: ContentBlock = {
          type: 'confirmation_request',
          toolName: 'test_tool',
          toolCallId: 'call_test',
          params: {},
          message: 'Test message',
          riskLevel: risk as any,
        };

        const card = renderConfirmationRequestCard(block);
        expect(card.header.template).toBe(color);
      }
    });
  });

  describe('User Input Request Card', () => {
    test('should render confirmation buttons for confirmation input type', () => {
      const block: ContentBlock = {
        type: 'user_input_request',
        question: 'Do you want to continue?',
        inputType: 'confirmation',
        requestId: 'req_123',
        sessionId: 'session_456',
      };

      const card = renderUserInputRequestCard(block);

      expect(card).toBeDefined();
      expect(card.type).toBe('card');
      expect(card.header.template).toBe('blue');

      // Find buttons directly in elements (no action wrapper in Card V2)
      const buttons = card.elements.filter(Boolean).filter((el: any) => el.tag === 'button');
      expect(buttons).toHaveLength(2);

      // Verify YES button
      const yesButton = buttons.find((btn: any) =>
        btn.text.content.includes('是')
      );
      expect(yesButton).toBeDefined();
      expect(yesButton.behaviors[0].value.action).toBe('hitl_callback');
      expect(yesButton.behaviors[0].value.hitlType).toBe('user_input');
      expect(yesButton.behaviors[0].value.inputType).toBe('confirmation');
      expect(yesButton.behaviors[0].value.value).toBe('YES');

      // Verify NO button
      const noButton = buttons.find((btn: any) =>
        btn.text.content.includes('否')
      );
      expect(noButton).toBeDefined();
      expect(noButton.behaviors[0].value.value).toBe('NO');
    });

    test('should render select menu for choice input type', () => {
      const block: ContentBlock = {
        type: 'user_input_request',
        question: 'Choose an option',
        inputType: 'choice',
        options: ['Option 1', 'Option 2', 'Option 3'],
        requestId: 'req_123',
        sessionId: 'session_456',
      };

      const card = renderUserInputRequestCard(block);

      // Find select_static directly in elements (no action wrapper in Card V2)
      const selectElement = card.elements.filter(Boolean).find((el: any) => el.tag === 'select_static');
      expect(selectElement).toBeDefined();
      expect(selectElement.multiple).toBeFalsy();
      expect(selectElement.options).toHaveLength(3);
      expect(selectElement.options[0].text.content).toBe('Option 1');
      expect(selectElement.options[0].value).toBe('1');
      expect(selectElement.behaviors[0].value.action).toBe('hitl_callback');
    });

    test('should render text prompt for multi_choice input type (temporarily)', () => {
      const block: ContentBlock = {
        type: 'user_input_request',
        question: 'Select multiple options',
        inputType: 'multi_choice',
        options: ['A', 'B', 'C'],
        requestId: 'req_123',
        sessionId: 'session_456',
      };

      const card = renderUserInputRequestCard(block);

      // Multi-choice currently uses text prompt (needs form container for proper support)
      const selectElement = card.elements.filter(Boolean).find((el: any) => el.tag === 'select_static');
      expect(selectElement).toBeUndefined();

      // Should have note element with instructions
      const noteElement = card.elements.filter(Boolean).find((el: any) => el.tag === 'note');
      expect(noteElement).toBeDefined();
      expect(noteElement.elements[0].content).toContain('可多选');
    });

    test('should render text prompt for text input type', () => {
      const block: ContentBlock = {
        type: 'user_input_request',
        question: 'Enter your name',
        inputType: 'text',
        requestId: 'req_123',
        sessionId: 'session_456',
      };

      const card = renderUserInputRequestCard(block);

      // Should not have action element (text input uses note for prompt)
      const actionElement = card.elements.filter(Boolean).find((el: any) => el.tag === 'action');
      expect(actionElement).toBeUndefined();

      // Should have note element
      const noteElement = card.elements.filter(Boolean).find((el: any) => el.tag === 'note');
      expect(noteElement).toBeDefined();
      expect(noteElement.elements[0].content).toContain('输入');
    });
  });
});
