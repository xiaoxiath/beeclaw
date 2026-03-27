/**
 * Test: Agent and Session lifecycle hooks integration
 *
 * Fixed: bypass loadPlugins() (jiti path resolution fails in vitest)
 * and directly use getOrCreatePluginRegistry() + createApi() to register hooks.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetPluginRegistry, getOrCreatePluginRegistry } from "../registry";
import { createHookRunner } from "../hook-runner";

describe("Agent and Session Lifecycle Hooks", () => {
  beforeEach(() => {
    resetPluginRegistry();
  });

  it("should have agent lifecycle hook methods", async () => {
    const { registry, createApi } = getOrCreatePluginRegistry();
    const api = createApi("test-plugin");

    // Register lifecycle hooks
    api.on("before_agent_start", async (event: any) => {});
    api.on("agent_end", async (event: any) => {});
    api.on("session_start", async (event: any) => {});
    api.on("session_end", async (event: any) => {});
    registry.plugins.set("test-plugin", { id: "test-plugin" });

    const hookRunner = createHookRunner(registry);

    expect(hookRunner).toBeDefined();
    expect(typeof hookRunner.runBeforeAgentStart).toBe("function");
    expect(typeof hookRunner.runAgentEnd).toBe("function");
    expect(typeof hookRunner.runSessionStart).toBe("function");
    expect(typeof hookRunner.runSessionEnd).toBe("function");
  });

  it("should trigger agent lifecycle hooks with correct event data", async () => {
    const { registry, createApi } = getOrCreatePluginRegistry();
    const api = createApi("test-plugin");

    const beforeAgentCalled = vi.fn();
    const agentEndCalled = vi.fn();

    api.on("before_agent_start", async (event: any) => { beforeAgentCalled(event); });
    api.on("agent_end", async (event: any) => { agentEndCalled(event); });
    registry.plugins.set("test-plugin", { id: "test-plugin" });

    const hookRunner = createHookRunner(registry);

    // Test before_agent_start event data
    const beforeAgentEventData = {
      provider: "openai",
      model: "gpt-4",
      systemPrompt: "Test system prompt",
      timestamp: new Date().toISOString(),
    };

    await hookRunner.runBeforeAgentStart(beforeAgentEventData);
    expect(beforeAgentCalled).toHaveBeenCalledWith(beforeAgentEventData);

    // Test agent_end event data
    const agentEndEventData = {
      provider: "openai",
      model: "gpt-4",
      finalResponse: "Test response",
      totalMessages: 5,
      timestamp: new Date().toISOString(),
    };

    await hookRunner.runAgentEnd(agentEndEventData);
    expect(agentEndCalled).toHaveBeenCalledWith(agentEndEventData);
  });

  it("should trigger session lifecycle hooks with correct event data", async () => {
    const { registry, createApi } = getOrCreatePluginRegistry();
    const api = createApi("test-plugin");

    const sessionStartCalled = vi.fn();
    const sessionEndCalled = vi.fn();

    api.on("session_start", async (event: any) => { sessionStartCalled(event); });
    api.on("session_end", async (event: any) => { sessionEndCalled(event); });
    registry.plugins.set("test-plugin", { id: "test-plugin" });

    const hookRunner = createHookRunner(registry);

    // Test session_start event data
    const sessionStartEventData = {
      sessionId: "test-session-123",
      userId: "test-user",
      channel: "cli",
      metadata: { test: true },
      timestamp: new Date().toISOString(),
    };

    await hookRunner.runSessionStart(sessionStartEventData);
    expect(sessionStartCalled).toHaveBeenCalledWith(sessionStartEventData);

    // Test session_end event data
    const sessionEndEventData = {
      sessionId: "test-session-123",
      userId: "test-user",
      channel: "cli",
      messageCount: 10,
      timestamp: new Date().toISOString(),
    };

    await hookRunner.runSessionEnd(sessionEndEventData);
    expect(sessionEndCalled).toHaveBeenCalledWith(sessionEndEventData);
  });

  it("should handle hooks with no registered handlers", async () => {
    // Initialize registry first
    const { registry } = getOrCreatePluginRegistry();
    const hookRunner = createHookRunner(registry);

    // Execute hooks with no handlers - should not throw
    await hookRunner.runBeforeAgentStart({
      provider: "test",
      model: "test",
      timestamp: new Date().toISOString(),
    });

    await hookRunner.runAgentEnd({
      provider: "test",
      model: "test",
      finalResponse: "",
      totalMessages: 0,
      timestamp: new Date().toISOString(),
    });

    await hookRunner.runSessionStart({
      sessionId: "test",
      userId: "test",
      channel: "test",
      timestamp: new Date().toISOString(),
    });

    await hookRunner.runSessionEnd({
      sessionId: "test",
      userId: "test",
      channel: "test",
      messageCount: 0,
      timestamp: new Date().toISOString(),
    });
  });
});
