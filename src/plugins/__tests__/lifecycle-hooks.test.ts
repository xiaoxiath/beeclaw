/**
 * Test: Agent and Session lifecycle hooks integration
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { resetPluginRegistry, getPluginRegistry, getOrCreatePluginRegistry } from "../registry";
import { loadPlugins } from "../loader";
import { createHookRunner } from "../hook-runner";

describe("Agent and Session Lifecycle Hooks", () => {
  beforeEach(() => {
    resetPluginRegistry();
  });

  it("should have agent lifecycle hook methods", async () => {
    const result = await loadPlugins({
      discovery: { bundledDir: "./plugins" },
    });

    expect(result.loaded).toContain("test-plugin");

    const registry = getPluginRegistry();
    const hookRunner = createHookRunner(registry);

    expect(hookRunner).toBeDefined();
    expect(typeof hookRunner.runBeforeAgentStart).toBe("function");
    expect(typeof hookRunner.runAgentEnd).toBe("function");
    expect(typeof hookRunner.runSessionStart).toBe("function");
    expect(typeof hookRunner.runSessionEnd).toBe("function");
  });

  it("should trigger agent lifecycle hooks with correct event data", async () => {
    await loadPlugins({
      discovery: { bundledDir: "./plugins" },
    });

    const registry = getPluginRegistry();
    const hookRunner = createHookRunner(registry);

    // Test before_agent_start event data
    const beforeAgentEventData = {
      provider: "openai",
      model: "gpt-4",
      systemPrompt: "Test system prompt",
      timestamp: new Date().toISOString(),
    };

    // Should not throw
    await hookRunner.runBeforeAgentStart(beforeAgentEventData);

    // Test agent_end event data
    const agentEndEventData = {
      provider: "openai",
      model: "gpt-4",
      finalResponse: "Test response",
      totalMessages: 5,
      timestamp: new Date().toISOString(),
    };

    // Should not throw
    await hookRunner.runAgentEnd(agentEndEventData);

    expect(true).toBe(true);
  });

  it("should trigger session lifecycle hooks with correct event data", async () => {
    await loadPlugins({
      discovery: { bundledDir: "./plugins" },
    });

    const registry = getPluginRegistry();
    const hookRunner = createHookRunner(registry);

    // Test session_start event data
    const sessionStartEventData = {
      sessionId: "test-session-123",
      userId: "test-user",
      channel: "cli",
      metadata: { test: true },
      timestamp: new Date().toISOString(),
    };

    // Should not throw
    await hookRunner.runSessionStart(sessionStartEventData);

    // Test session_end event data
    const sessionEndEventData = {
      sessionId: "test-session-123",
      userId: "test-user",
      channel: "cli",
      messageCount: 10,
      timestamp: new Date().toISOString(),
    };

    // Should not throw
    await hookRunner.runSessionEnd(sessionEndEventData);

    expect(true).toBe(true);
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
