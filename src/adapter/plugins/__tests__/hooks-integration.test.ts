/**
 * Plugin Hooks Integration Tests
 *
 * Fixed: bypass loadPlugins() (jiti path resolution fails in vitest)
 * and directly use getOrCreatePluginRegistry() + createApi() to register hooks.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetPluginRegistry, getOrCreatePluginRegistry } from "../registry";
import { createHookRunner } from "../hook-runner";

describe("Plugin Hooks Integration", () => {
  beforeEach(() => {
    resetPluginRegistry();
  });

  it("should register plugins with hooks", async () => {
    const { registry, createApi } = getOrCreatePluginRegistry();
    const api = createApi("test-plugin");

    // Register a message_received hook (mimics what the test-plugin does)
    api.on("message_received", async (event: any) => {});
    registry.plugins.set("test-plugin", { id: "test-plugin" });

    // Check that hooks were registered
    expect(registry.typedHooks.has("message_received")).toBe(true);

    const hooks = registry.typedHooks.get("message_received");
    expect(hooks).toHaveLength(1);
    expect(hooks?.[0]?.pluginId).toBe("test-plugin");
  });

  it("should get hook statistics from registry", async () => {
    const { registry, createApi } = getOrCreatePluginRegistry();
    const api = createApi("test-plugin");

    // Register a hook
    api.on("message_received", async (event: any) => {});
    registry.plugins.set("test-plugin", { id: "test-plugin" });

    // Check hook statistics from registry
    expect(registry.typedHooks.size).toBeGreaterThan(0);
    expect(registry.typedHooks.has("message_received")).toBe(true);
  });

  it("should execute void hooks in parallel", async () => {
    const { registry, createApi } = getOrCreatePluginRegistry();
    const api = createApi("test-plugin");

    const hookCalled = vi.fn();
    api.on("message_received", async (event: any) => {
      hookCalled(event);
    });
    registry.plugins.set("test-plugin", { id: "test-plugin" });

    const hookRunner = createHookRunner(registry);

    // Execute message_received hook (void/parallel)
    const testEvent = {
      from: "test-user",
      content: "test message",
      timestamp: new Date().toISOString(),
    };

    // This should not throw - use the specific hook method
    await hookRunner.runMessageReceived(testEvent);
    expect(hookCalled).toHaveBeenCalledWith(testEvent);
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
