/**
 * Test: Remaining core hooks (before_reset, before_model_resolve, tool_result_persist, before_message_write)
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { resetPluginRegistry, getPluginRegistry, getOrCreatePluginRegistry } from "../registry";
import { loadPlugins } from "../loader";
import { createHookRunner } from "../hook-runner";

describe("Remaining Core Hooks", () => {
  beforeEach(() => {
    resetPluginRegistry();
  });

  it("should have before_reset hook method", async () => {
    const result = await loadPlugins({
      discovery: { bundledDir: "./plugins" },
    });

    expect(result.loaded).toContain("test-plugin");

    const registry = getPluginRegistry();
    const hookRunner = createHookRunner(registry);

    expect(hookRunner).toBeDefined();
    expect(typeof hookRunner.runBeforeReset).toBe("function");
  });

  it("should have before_model_resolve hook method", async () => {
    const result = await loadPlugins({
      discovery: { bundledDir: "./plugins" },
    });

    expect(result.loaded).toContain("test-plugin");

    const registry = getPluginRegistry();
    const hookRunner = createHookRunner(registry);

    expect(hookRunner).toBeDefined();
    expect(typeof hookRunner.runBeforeModelResolve).toBe("function");
  });

  it("should have tool_result_persist hook method", async () => {
    const result = await loadPlugins({
      discovery: { bundledDir: "./plugins" },
    });

    expect(result.loaded).toContain("test-plugin");

    const registry = getPluginRegistry();
    const hookRunner = createHookRunner(registry);

    expect(hookRunner).toBeDefined();
    expect(typeof hookRunner.runToolResultPersist).toBe("function");
  });

  it("should have before_message_write hook method", async () => {
    const result = await loadPlugins({
      discovery: { bundledDir: "./plugins" },
    });

    expect(result.loaded).toContain("test-plugin");

    const registry = getPluginRegistry();
    const hookRunner = createHookRunner(registry);

    expect(hookRunner).toBeDefined();
    expect(typeof hookRunner.runBeforeMessageWrite).toBe("function");
  });

  it("should trigger before_reset hook with correct event data", async () => {
    await loadPlugins({
      discovery: { bundledDir: "./plugins" },
    });

    const registry = getPluginRegistry();
    const hookRunner = createHookRunner(registry);

    const eventData = {
      messageCount: 10,
      tokenCount: 5000,
      timestamp: new Date().toISOString(),
    };

    // Should not throw
    await hookRunner.runBeforeReset(eventData);

    expect(true).toBe(true);
  });

  it("should trigger before_model_resolve hook with correct event data", async () => {
    await loadPlugins({
      discovery: { bundledDir: "./plugins" },
    });

    const registry = getPluginRegistry();
    const hookRunner = createHookRunner(registry);

    const eventData = {
      requestedModel: "gpt-4",
      requestedProvider: { type: "openai", name: "OpenAI" },
      taskContext: {
        systemPrompt: "Test prompt",
        tools: [],
      },
      timestamp: new Date().toISOString(),
    };

    // Should not throw and can return modified data
    const result = await hookRunner.runBeforeModelResolve(eventData);

    // Result can be undefined or modified event data
    expect(result === undefined || typeof result === "object").toBe(true);
  });

  it("should trigger tool_result_persist hook with correct event data", async () => {
    await loadPlugins({
      discovery: { bundledDir: "./plugins" },
    });

    const registry = getPluginRegistry();
    const hookRunner = createHookRunner(registry);

    const eventData = {
      toolName: "memory_read",
      result: { success: true, data: "test data" },
      toolCallId: "call_123",
      timestamp: new Date().toISOString(),
    };

    // Should not throw and can return modified result
    const result = hookRunner.runToolResultPersist(eventData);

    // Result should be the same or modified
    expect(result).toBeDefined();
  });

  it("should trigger before_message_write hook with correct event data", async () => {
    await loadPlugins({
      discovery: { bundledDir: "./plugins" },
    });

    const registry = getPluginRegistry();
    const hookRunner = createHookRunner(registry);

    const eventData = {
      sessionId: "test-session-123",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ],
      timestamp: new Date().toISOString(),
    };

    // Should not throw and can return modified messages
    const result = hookRunner.runBeforeMessageWrite(eventData);

    // Result should be the same or modified
    expect(result).toBeDefined();
    expect(result.messages).toBeDefined();
  });

  it("should handle all hooks with no registered handlers", async () => {
    // Initialize registry first
    const { registry } = getOrCreatePluginRegistry();
    const hookRunner = createHookRunner(registry);

    // Execute all hooks with no handlers - should not throw
    await hookRunner.runBeforeReset({
      messageCount: 0,
      tokenCount: 0,
      timestamp: new Date().toISOString(),
    });

    const modelResult = await hookRunner.runBeforeModelResolve({
      requestedModel: "test",
      requestedProvider: { type: "test" },
      taskContext: {},
      timestamp: new Date().toISOString(),
    });

    const toolResult = hookRunner.runToolResultPersist({
      toolName: "test",
      result: {},
      toolCallId: "test",
      timestamp: new Date().toISOString(),
    });

    const messageResult = hookRunner.runBeforeMessageWrite({
      sessionId: "test",
      messages: [],
      timestamp: new Date().toISOString(),
    });

    expect(modelResult).toBeDefined();
    expect(toolResult).toBeDefined();
    expect(messageResult).toBeDefined();
  });
});
