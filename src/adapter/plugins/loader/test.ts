/**
 * Plugin System Integration Test
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { loadPlugins } from "../loader";
import { resetPluginRegistry } from "../registry";

describe("Plugin System Integration", () => {
  beforeEach(() => {
    // 重置 Registry
    resetPluginRegistry();
  });

  it("should load test plugin successfully", async () => {
    const result = await loadPlugins({
      discovery: {
      bundledDir: "./plugins",
      },
    });

    expect(result.loaded).toContain("test-plugin");
    expect(result.failed).toHaveLength(0);
    expect(result.registry.plugins.has("test-plugin")).toBe(true);
  });

  it("should register tool from plugin", async () => {
    const result = await loadPlugins({
      discovery: {
        bundledDir: "./plugins",
      },
    });

    expect(result.registry.tools.has("hello_world")).toBe(true);
    const tool = result.registry.tools.get("hello_world");
    expect(tool?.name).toBe("hello_world");
    expect(tool?.pluginId).toBe("test-plugin");
  });

  it("should execute tool", async () => {
    const result = await loadPlugins({
      discovery: {
    bundledDir: "./plugins",
    },
  });

    const tool = result.registry.tools.get("hello_world");
    expect(tool).toBeDefined();

    const executionResult = await tool.execute({ name: "Beeclaw" });
    expect(executionResult.success).toBe(true);
    expect(executionResult.message).toContain("Beeclaw");
  });

  it("should handle plugin errors gracefully", async () => {
    const result = await loadPlugins({
      discovery: {
    bundledDir: "./non-existent",
    },
    });

    expect(result.loaded).toHaveLength(0);
    expect(result.failed).toBeInstanceOf(Array);
  });
});
