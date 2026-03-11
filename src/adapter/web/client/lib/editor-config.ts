/**
 * Shared Monaco Editor Configuration
 *
 * Centralizes editor settings to ensure consistency across the app
 * and reduce configuration drift.
 */

import type { editor } from 'monaco-editor';

/**
 * Default Monaco Editor options for code editing
 */
export const DEFAULT_MONACO_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  fontSize: 14,
  lineNumbers: 'on',
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  wordWrap: 'on',
  formatOnPaste: true,
  formatOnType: true,
};

/**
 * Monaco Editor options optimized for JSON editing
 */
export const JSON_MONACO_OPTIONS = DEFAULT_MONACO_OPTIONS;

/**
 * Monaco Editor options optimized for Markdown editing
 */
export const MARKDOWN_MONACO_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  ...DEFAULT_MONACO_OPTIONS,
  lineHeight: 24,
};

/**
 * Monaco Editor options for read-only viewing
 */
export const READONLY_MONACO_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  ...DEFAULT_MONACO_OPTIONS,
  readOnly: true,
};

/**
 * Language detection from file path
 */
export function detectLanguageFromPath(path: string): string {
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.md')) return 'markdown';
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript';
  if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript';
  if (path.endsWith('.py')) return 'python';
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'yaml';
  return 'plaintext';
}
