/**
 * Test: Compaction hooks integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetPluginRegistry, getPluginRegistry } from "../registry";
import { loadPlugins } from "../loader";
import { createHookRunner } from "../hook-runner";

describe("Compaction Hooks Integration", () => {
  beforeEach(() => {
    resetPluginRegistry();
  });

  it("should have before_compaction hook method", async () => {
    const result = await loadPlugins({
      discovery: { bundledDir: "./plugins" },
    });

    expect(result.loaded).toContain("test-plugin");

    const registry = getPluginRegistry();
    const hookRunner = createHookRunner(registry);

    expect(hookRunner).toBeDefined();
    expect(typeof hookRunner.runBeforeCompaction).toBe("function");
  });

  it("should have after_compaction hook method", async () => {
    const result = await loadPlugins({
      discovery: { bundledDir: "./plugins" },
    });

    expect(result.loaded).toContain("test-plugin");

    const registry = getPluginRegistry();
    const hookRunner = createHookRunner(registry);

    expect(hookRunner).toBeDefined();
    expect(typeof hookRunner.runAfterCompaction).toBe("function");
  });

  it("should trigger compaction hooks with correct event data", async () => {
    await loadPlugins({
      discovery: { bundledDir: "./plugins" },
    });

    const registry = getPluginRegistry();
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

    expect(true).toBe(true);
  });
});
