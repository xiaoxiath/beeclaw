/**
 * Plugin Hooks Integration Tests
 *
 * Tests the integration of plugin hooks with the Agent system
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetPluginRegistry, getPluginRegistry, getOrCreatePluginRegistry } from "../registry";
import { loadPlugins } from "../loader";
import { createHookRunner } from "../hook-runner";

describe("Plugin Hooks Integration", () => {
  beforeEach(() => {
    resetPluginRegistry();
  });

  it("should load plugins with hooks registered", async () => {
    const result = await loadPlugins({
      discovery: {
        bundledDir: "./plugins",
      },
    });

    expect(result.loaded).toContain("test-plugin");
    expect(result.failed).toHaveLength(0);

    // Check that hooks were registered
    const registry = getPluginRegistry();
    expect(registry.typedHooks.has("message_received")).toBe(true);

    const hooks = registry.typedHooks.get("message_received");
    expect(hooks).toHaveLength(1);
    expect(hooks?.[0]?.pluginId).toBe("test-plugin");
  });

  it("should get hook statistics from registry", async () => {
    // Load plugins
    await loadPlugins({
      discovery: {
        bundledDir: "./plugins",
      },
    });

    const registry = getPluginRegistry();

    // Check hook statistics from registry
    expect(registry.typedHooks.size).toBeGreaterThan(0);
    expect(registry.typedHooks.has("message_received")).toBe(true);
  });

  it("should execute void hooks in parallel", async () => {
    // Load plugins
    await loadPlugins({
      discovery: {
        bundledDir: "./plugins",
      },
    });

    const registry = getPluginRegistry();
    const hookRunner = createHookRunner(registry);

    // Execute message_received hook (void/parallel)
    const testEvent = {
      from: "test-user",
      content: "test message",
      timestamp: new Date().toISOString(),
    };

    // This should not throw - use the specific hook method
    await hookRunner.runMessageReceived(testEvent);
  });

  it("should handle hooks with no registered handlers", async () => {
    // Initialize registry first
    const { registry } = getOrCreatePluginRegistry();
    const hookRunner = createHookRunner(registry);

    // Execute hook with no handlers - should not throw
    await hookRunner.runBeforeToolCall({
      toolName: "test_tool",
      params: {},
    });
  });
});
