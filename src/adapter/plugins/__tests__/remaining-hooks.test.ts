/**
 * Test: Remaining core hooks (before_reset, before_model_resolve, tool_result_persist, before_message_write)
 *
 * Fixed: bypass loadPlugins() (jiti path resolution fails in vitest)
 * and directly use getOrCreatePluginRegistry() + createApi() to register hooks.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetPluginRegistry, getOrCreatePluginRegistry } from "../registry";
import { createHookRunner } from "../hook-runner";

describe("Remaining Core Hooks", () => {
  beforeEach(() => {
    resetPluginRegistry();
  });

  it("should have before_reset hook method", async () => {
    const { registry, createApi } = getOrCreatePluginRegistry();
    const api = createApi("test-plugin");
    api.on("before_reset", async (event: any) => {});
    registry.plugins.set("test-plugin", { id: "test-plugin" });

    const hookRunner = createHookRunner(registry);

    expect(hookRunner).toBeDefined();
    expect(typeof hookRunner.runBeforeReset).toBe("function");
  });

  it("should have before_model_resolve hook method", async () => {
    const { registry, createApi } = getOrCreatePluginRegistry();
    const api = createApi("test-plugin");
    api.on("before_model_resolve", async (event: any) => event);
    registry.plugins.set("test-plugin", { id: "test-plugin" });

    const hookRunner = createHookRunner(registry);

    expect(hookRunner).toBeDefined();
    expect(typeof hookRunner.runBeforeModelResolve).toBe("function");
  });

  it("should have tool_result_persist hook method", async () => {
    const { registry, createApi } = getOrCreatePluginRegistry();
    const api = createApi("test-plugin");
    api.on("tool_result_persist", (event: any) => event);
    registry.plugins.set("test-plugin", { id: "test-plugin" });

    const hookRunner = createHookRunner(registry);

    expect(hookRunner).toBeDefined();
    expect(typeof hookRunner.runToolResultPersist).toBe("function");
  });

  it("should have before_message_write hook method", async () => {
    const { registry, createApi } = getOrCreatePluginRegistry();
    const api = createApi("test-plugin");
    api.on("before_message_write", (event: any) => event);
    registry.plugins.set("test-plugin", { id: "test-plugin" });

    const hookRunner = createHookRunner(registry);

    expect(hookRunner).toBeDefined();
    expect(typeof hookRunner.runBeforeMessageWrite).toBe("function");
  });

  it("should trigger before_reset hook with correct event data", async () => {
    const { registry, createApi } = getOrCreatePluginRegistry();
    const api = createApi("test-plugin");

    const hookCalled = vi.fn();
    api.on("before_reset", async (event: any) => { hookCalled(event); });
    registry.plugins.set("test-plugin", { id: "test-plugin" });

    const hookRunner = createHookRunner(registry);

    const eventData = {
      messageCount: 10,
      tokenCount: 5000,
      timestamp: new Date().toISOString(),
    };

    await hookRunner.runBeforeReset(eventData);
    expect(hookCalled).toHaveBeenCalledWith(eventData);
  });

  it("should trigger before_model_resolve hook with correct event data", async () => {
    const { registry, createApi } = getOrCreatePluginRegistry();
    const api = createApi("test-plugin");

    const hookCalled = vi.fn();
    api.on("before_model_resolve", async (event: any) => {
      hookCalled(event);
      return event;
    });
    registry.plugins.set("test-plugin", { id: "test-plugin" });

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

    expect(hookCalled).toHaveBeenCalledWith(eventData);
    // Result can be undefined or modified event data
    expect(result === undefined || typeof result === "object").toBe(true);
  });

  it("should trigger tool_result_persist hook with correct event data", async () => {
    const { registry, createApi } = getOrCreatePluginRegistry();
    const api = createApi("test-plugin");

    const hookCalled = vi.fn();
    api.on("tool_result_persist", (event: any) => {
      hookCalled(event);
      return event;
    });
    registry.plugins.set("test-plugin", { id: "test-plugin" });

    const hookRunner = createHookRunner(registry);

    const eventData = {
      toolName: "memory_read",
      result: { success: true, data: "test data" },
      toolCallId: "call_123",
      timestamp: new Date().toISOString(),
    };

    // Should not throw and can return modified result
    const result = hookRunner.runToolResultPersist(eventData);

    expect(hookCalled).toHaveBeenCalledWith(eventData);
    expect(result).toBeDefined();
  });

  it("should trigger before_message_write hook with correct event data", async () => {
    const { registry, createApi } = getOrCreatePluginRegistry();
    const api = createApi("test-plugin");

    api.on("before_message_write", (event: any) => {
      return event;
    });
    registry.plugins.set("test-plugin", { id: "test-plugin" });

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
