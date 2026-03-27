/**
 * Plugin System Integration Tests
 *
 * Tests the integration of plugins with the Agent system
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetPluginRegistry } from "../registry";
import { loadPlugins } from "../loader";
import { getAllToolsForAI, createDefaultToolExecutor } from "../../agent";

describe("Plugin Integration with Agent", () => {
  beforeEach(() => {
    resetPluginRegistry();
  });

  it("should load test plugin and register its tool", async () => {
    const result = await loadPlugins({
      discovery: {
        bundledDir: "./plugins",
      },
    });

    expect(result.loaded).toContain("test-plugin");
    expect(result.failed).toHaveLength(0);
  });

  it("should include plugin tools in getAllToolsForAI()", async () => {
    // Load plugins first
    await loadPlugins({
      discovery: {
        bundledDir: "./plugins",
      },
    });

    // Get all tools
    const tools = getAllToolsForAI();

    // Check that the plugin tool is included
    const helloWorldTool = tools.find(t => t.function.name === "hello_world");
    expect(helloWorldTool).toBeDefined();
    expect(helloWorldTool?.function.description).toBe("Say hello to the world");
    expect(helloWorldTool?.function.parameters).toMatchObject({
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name to greet"
        }
      },
      required: ["name"]
    });
  });

  it("should execute plugin tools through tool executor", async () => {
    // Load plugins first
    await loadPlugins({
      discovery: {
        bundledDir: "./plugins",
      },
    });

    // Create tool executor
    const executor = createDefaultToolExecutor();

    // Execute the plugin tool
    const result = await executor("hello_world", { name: "Beeclaw" });

    expect(result).toMatchObject({
      success: true,
      message: "Hello, Beeclaw!"
    });
  });

  it("should give plugin tools priority over other tools", async () => {
    // Load plugins
    await loadPlugins({
      discovery: {
        bundledDir: "./plugins",
      },
    });

    // Create tool executor
    const executor = createDefaultToolExecutor();

    // Execute the plugin tool
    const result = await executor("hello_world", { name: "Test" });

    // Should successfully execute the plugin tool
    expect(result.success).toBe(true);
    expect((result as any).message).toBe("Hello, Test!");
  });
});
