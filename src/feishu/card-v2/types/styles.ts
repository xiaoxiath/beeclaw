/**
 * Card Schema 2.0 - Styling Constants
 *
 * Color palette and styling constants for Card elements
 */

// ============================================
// Color Palette
// ============================================

/**
 * Standard colors for Card elements
 * Based on Feishu/Lark design system
 */
export const Color = {
  // Primary colors
  Blue: 'blue',
  Green: 'green',
  Red: 'red',
  Orange: 'orange',
  Purple: 'purple',

  // Neutral colors
  Grey: 'grey',
  Black: 'black',
  White: 'white',

  // Text colors
  TextPrimary: 'text_primary',
  TextSecondary: 'text_secondary',
  TextTertiary: 'text_tertiary',

  // Background colors
  BgPrimary: 'bg_primary',
  BgSecondary: 'bg_secondary',
} as const;

export type ColorType = (typeof Color)[keyof typeof Color];

// ============================================
// Text Colors (Hex)
// ============================================

/**
 * Text colors in hex format
 * Used when specific hex values are needed
 */
export const TextColor = {
  // Standard text colors
  Default: '#1f2329',
  Secondary: '#646a73',
  Tertiary: '#8f959e',
  Disabled: '#bbbfc4',

  // Semantic colors
  Success: '#00b42a',
  Warning: '#ff7d00',
  Error: '#f53f3f',
  Info: '#2f6fec',
} as const;

// ============================================
// Icon Tokens
// ============================================

/**
 * Common standard icon tokens
 * Reference: https://open.feishu.cn/document/client-docs/bot-v3/card-v2/icon
 */
export const IconToken = {
  // Actions
  Play: 'play_outlined',
  Pause: 'pause_outlined',
  Stop: 'stop_outlined',

  // Status
  Success: 'success_outlined',
  Error: 'error_outlined',
  Warning: 'warning_outlined',
  Info: 'info_outlined',

  // Tools
  Search: 'search_outlined',
  Edit: 'edit_outlined',
  Code: 'code_outlined',
  Terminal: 'terminal_outlined',
  Settings: 'settings_outlined',

  // Data
  Database: 'database_outlined',
  File: 'file_outlined',
  Folder: 'folder_outlined',

  // Communication
  Chat: 'chat_outlined',
  Email: 'email_outlined',
  Notification: 'notification_outlined',

  // Navigation
  ArrowRight: 'arrow_right_outlined',
  ArrowDown: 'arrow_down_outlined',
  ChevronRight: 'chevron_right_outlined',
  ChevronDown: 'chevron_down_outlined',

  // AI/Robot
  Robot: 'robot_outlined',
  Brain: 'brain_outlined',
  Sparkles: 'sparkles_outlined',

  // Other
  Globe: 'globe_outlined',
  Link: 'link_outlined',
  Copy: 'copy_outlined',
  Refresh: 'refresh_outlined',
  Clock: 'clock_outlined',
  Calendar: 'calendar_outlined',
} as const;

export type IconTokenType = (typeof IconToken)[keyof typeof IconToken];

// ============================================
// Text Sizes
// ============================================

/**
 * Standard text sizes
 */
export const TextSizeValue = {
  Small: 'small',
  Normal: 'normal',
  Large: 'large',
  Heading: 'heading',
  Markup: 'markup',
} as const;

// ============================================
// Element Size
// ============================================

/**
 * Element sizes (for icons, etc.)
 */
export const ElementSize = {
  Small: 'small',
  Medium: 'medium',
  Large: 'large',
} as const;
