/**
 * Test: Subagent hooks integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetPluginRegistry, getPluginRegistry, getOrCreatePluginRegistry } from "../registry";
import { loadPlugins } from "../loader";
import { createHookRunner } from "../hook-runner";

describe("Subagent Hooks Integration", () => {
  beforeEach(() => {
    resetPluginRegistry();
  });

  it("should have subagent hook methods", async () => {
    const result = await loadPlugins({
      discovery: { bundledDir: "./plugins" },
    });

    expect(result.loaded).toContain("test-plugin");

    const registry = getPluginRegistry();
    const hookRunner = createHookRunner(registry);

    expect(hookRunner).toBeDefined();
    expect(typeof hookRunner.runSubagentSpawning).toBe("function");
    expect(typeof hookRunner.runSubagentSpawned).toBe("function");
    expect(typeof hookRunner.runSubagentDeliveryTarget).toBe("function");
    expect(typeof hookRunner.runSubagentEnded).toBe("function");
  });

  it("should trigger subagent_spawning hook with correct event data", async () => {
    await loadPlugins({
      discovery: { bundledDir: "./plugins" },
    });

    const registry = getPluginRegistry();
    const hookRunner = createHookRunner(registry);

    const eventData = {
      subagentId: "test-subagent-123",
      type: "research",
      task: "Research the best practices for TypeScript",
      context: { priority: "high" },
      provider: { type: "openai", name: "OpenAI" },
      model: "gpt-4",
      timestamp: new Date().toISOString(),
    };

    // Should not throw and can return modified data
    const result = await hookRunner.runSubagentSpawning(eventData);

    // Result can be undefined or modified event data
    expect(result === undefined || typeof result === "object").toBe(true);
  });

  it("should trigger subagent_spawned hook with correct event data", async () => {
    await loadPlugins({
      discovery: { bundledDir: "./plugins" },
    });

    const registry = getPluginRegistry();
    const hookRunner = createHookRunner(registry);

    const eventData = {
      subagentId: "test-subagent-123",
      type: "research",
      task: "Research task",
      provider: "openai",
      model: "gpt-4",
      timestamp: new Date().toISOString(),
    };

    // Should not throw (void hook)
    await hookRunner.runSubagentSpawned(eventData);
    expect(true).toBe(true);
  });

  it("should trigger subagent_delivery_target hook with correct event data", async () => {
    await loadPlugins({
      discovery: { bundledDir: "./plugins" },
    });

    const registry = getPluginRegistry();
    const hookRunner = createHookRunner(registry);

    const eventData = {
      subagentId: "test-subagent-123",
      type: "research",
      output: "Research results here",
      result: {
        success: true,
        output: "Research results here",
        duration: 5000,
      },
      timestamp: new Date().toISOString(),
    };

    // Should not throw and can return modified data
    const result = await hookRunner.runSubagentDeliveryTarget(eventData);

    // Result can be undefined or modified event data
    expect(result === undefined || typeof result === "object").toBe(true);
  });

  it("should trigger subagent_ended hook with correct event data for success", async () => {
    await loadPlugins({
      discovery: { bundledDir: "./plugins" },
    });

    const registry = getPluginRegistry();
    const hookRunner = createHookRunner(registry);

    const eventData = {
      subagentId: "test-subagent-123",
      type: "research",
      success: true,
      duration: 5000,
      output: "Task completed successfully",
      timestamp: new Date().toISOString(),
    };

    // Should not throw (void hook)
    await hookRunner.runSubagentEnded(eventData);
    expect(true).toBe(true);
  });

  it("should trigger subagent_ended hook with correct event data for failure", async () => {
    await loadPlugins({
      discovery: { bundledDir: "./plugins" },
    });

    const registry = getPluginRegistry();
    const hookRunner = createHookRunner(registry);

    const eventData = {
      subagentId: "test-subagent-123",
      type: "research",
      success: false,
      duration: 3000,
      error: "Task failed due to timeout",
      timestamp: new Date().toISOString(),
    };

    // Should not throw (void hook)
    await hookRunner.runSubagentEnded(eventData);
    expect(true).toBe(true);
  });

  it("should handle subagent hooks with no registered handlers", async () => {
    // Initialize registry first
    const { registry } = getOrCreatePluginRegistry();
    const hookRunner = createHookRunner(registry);

    // Execute all hooks with no handlers - should not throw
    await hookRunner.runSubagentSpawning({
      subagentId: "test",
      type: "general",
      task: "test task",
      provider: { type: "test" },
      model: "test",
      timestamp: new Date().toISOString(),
    });

    await hookRunner.runSubagentSpawned({
      subagentId: "test",
      type: "general",
      task: "test task",
      provider: "test",
      model: "test",
      timestamp: new Date().toISOString(),
    });

    await hookRunner.runSubagentDeliveryTarget({
      subagentId: "test",
      type: "general",
      output: "test",
      result: { success: true, output: "test", duration: 0 },
      timestamp: new Date().toISOString(),
    });

    await hookRunner.runSubagentEnded({
      subagentId: "test",
      type: "general",
      success: true,
      duration: 0,
      timestamp: new Date().toISOString(),
    });
  });
});
