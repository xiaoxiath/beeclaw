/**
 * Test: Compaction hooks integration
 *
 * Fixed: bypass loadPlugins() (jiti path resolution fails in vitest)
 * and directly use getOrCreatePluginRegistry() + createApi() to register hooks.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetPluginRegistry, getOrCreatePluginRegistry } from "../registry";
import { createHookRunner } from "../hook-runner";

describe("Compaction Hooks Integration", () => {
  beforeEach(() => {
    resetPluginRegistry();
  });

  it("should have before_compaction hook method", async () => {
    const { registry, createApi } = getOrCreatePluginRegistry();
    const api = createApi("test-plugin");

    // Register a before_compaction hook
    api.on("before_compaction", async (event: any) => event);
    registry.plugins.set("test-plugin", { id: "test-plugin" });

    const hookRunner = createHookRunner(registry);

    expect(hookRunner).toBeDefined();
    expect(typeof hookRunner.runBeforeCompaction).toBe("function");
  });

  it("should have after_compaction hook method", async () => {
    const { registry, createApi } = getOrCreatePluginRegistry();
    const api = createApi("test-plugin");

    // Register an after_compaction hook
    api.on("after_compaction", async (event: any) => {});
    registry.plugins.set("test-plugin", { id: "test-plugin" });

    const hookRunner = createHookRunner(registry);

    expect(hookRunner).toBeDefined();
    expect(typeof hookRunner.runAfterCompaction).toBe("function");
  });

  it("should trigger compaction hooks with correct event data", async () => {
    const { registry, createApi } = getOrCreatePluginRegistry();
    const api = createApi("test-plugin");

    const beforeCalled = vi.fn();
    const afterCalled = vi.fn();

    api.on("before_compaction", async (event: any) => {
      beforeCalled(event);
      return event;
    });
    api.on("after_compaction", async (event: any) => {
      afterCalled(event);
    });
    registry.plugins.set("test-plugin", { id: "test-plugin" });

    const hookRunner = createHookRunner(registry);

    // Test before_compaction event data
    const beforeEventData = {
      oldMessages: [{ role: "user", content: "test" }],
      recentMessages: [{ role: "assistant", content: "recent" }],
      systemMessage: { role: "system", content: "system" },
      currentTokens: 5000,
      maxTokens: 10000,
      timestamp: new Date().toISOString(),
    };

    // Should not throw
    await hookRunner.runBeforeCompaction(beforeEventData);
    expect(beforeCalled).toHaveBeenCalledWith(beforeEventData);

    // Test after_compaction event data
    const afterEventData = {
      summary: "Summary text",
      originalTokens: 5000,
      compressedTokens: 2000,
      compressionRatio: 0.4,
      timestamp: new Date().toISOString(),
    };

    // Should not throw
    await hookRunner.runAfterCompaction(afterEventData);
    expect(afterCalled).toHaveBeenCalledWith(afterEventData);
  });
});
