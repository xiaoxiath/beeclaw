/**
 * Plugin Hook Integration with Agent System
 * 
 * 在 Agent 关键位置触发生命周期钩子
 */

import { getPluginRegistry } from './registry';
import type { PluginHookName } from './types';

/**
 * Hook integration helper class
 */
export class PluginHookManager {
  /**
   * Trigger hooks at specific points in Agent lifecycle
   */
  
  /**
   * Trigger before_tool_call hook
   */
  static async triggerBeforeToolCall(toolName: string, params: Record<string, unknown>): Promise<void> {
    try {
      const registry = getPluginRegistry();
      const hooks = registry.typedHooks.get('before_tool_call');
      
      if (!hooks || hooks.length === 0) {
        return;
      }

      for (const hook of hooks) {
        try {
          await hook.handler({
            toolName,
            params,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          console.error(`[Hook Error] before_tool_call (${toolName}):`, error);
        }
      }
    } catch (error) {
      console.error('[Hook Error] triggerBeforeToolCall:', error);
    }
  }

  /**
   * Trigger after_tool_call hook
   */
  static async triggerAfterToolCall(toolName: string, result: any): Promise<void> {
    try {
      const registry = getPluginRegistry();
      const hooks = registry.typedHooks.get('after_tool_call');
      
      if (!hooks || hooks.length === 0) {
        return;
      }

      for (const hook of hooks) {
        try {
          await hook.handler({
            toolName,
            result,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          console.error(`[Hook Error] after_tool_call (${toolName}):`, error);
        }
      }
    } catch (error) {
      console.error('[Hook Error] triggerAfterToolCall:', error);
    }
  }

  /**
   * Trigger message_received hook
   */
  static async triggerMessageReceived(event: any): Promise<void> {
    try {
      const registry = getPluginRegistry();
      const hooks = registry.typedHooks.get('message_received');
      
      if (!hooks || hooks.length === 0) {
        return;
      }

      for (const hook of hooks) {
        try {
          await hook.handler(event);
        } catch (error) {
          console.error(`[Hook Error] message_received:`, error);
        }
      }
    } catch (error) {
      console.error('[Hook Error] triggerMessageReceived:', error);
    }
  }

  /**
   * Trigger message_sent hook
   */
  static async triggerMessageSent(event: any): Promise<void> {
    try {
      const registry = getPluginRegistry();
      const hooks = registry.typedHooks.get('message_sent');
      
      if (!hooks || hooks.length === 0) {
        return;
      }

      for (const hook of hooks) {
        try {
          await hook.handler(event);
        } catch (error) {
          console.error(`[Hook Error] message_sent:`, error);
        }
      }
    } catch (error) {
      console.error('[Hook Error] triggerMessageSent:', error);
    }
  }

  /**
   * Trigger before_prompt_build hook (modifying)
   */
  static async triggerBeforePromptBuild(context: any): Promise<any> {
    try {
      const registry = getPluginRegistry();
      const hooks = registry.typedHooks.get('before_prompt_build');
      
      if (!hooks || hooks.length === 0) {
        return context;
      }

      let modifiedContext = context;
      for (const hook of hooks) {
        try {
          const result = await hook.handler(modifiedContext);
          if (result !== undefined) {
            modifiedContext = { ...modifiedContext, ...result };
          }
        } catch (error) {
          console.error(`[Hook Error] before_prompt_build:`, error);
        }
      }

      return modifiedContext;
    } catch (error) {
      console.error('[Hook Error] triggerBeforePromptBuild:', error);
      return context;
    }
  }

  /**
   * Get hook statistics
   */
  static getHookStats(): Record<PluginHookName, number> {
    try {
      const registry = getPluginRegistry();
      const stats: Record<PluginHookName, number> = {} as any;
      
      for (const [name, hooks] of registry.typedHooks.entries()) {
        stats[name] = hooks.length;
      }
      
      return stats;
    } catch {
      return {};
    }
  }
}
