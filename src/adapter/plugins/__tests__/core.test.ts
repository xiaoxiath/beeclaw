/**
 * Plugin System Core Tests
 *
 * This test validates the core plugin system functionality
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { discoverPlugins } from "../discovery/index";
import { loadPluginManifest, validatePluginConfig } from "../manifest/index";
import {
  getOrCreatePluginRegistry,
  resetPluginRegistry,
} from "../registry/index";

describe("Plugin System Core", () => {
  beforeEach(() => {
    resetPluginRegistry();
  });

  describe("Discovery Engine", () => {
    it("should discover bundled plugins", () => {
      const plugins = discoverPlugins({
        bundledDir: "./plugins",
      });

      expect(plugins).toBeInstanceOf(Array);
      expect(plugins.length).toBeGreaterThan(0);

      const testPlugin = plugins.find((p) => p.id === "test-plugin");
      expect(testPlugin).toBeDefined();
      expect(testPlugin?.origin).toBe("bundled");
    });

    it("should handle non-existent directory", () => {
      const plugins = discoverPlugins({
        bundledDir: "./non-existent",
      });

      expect(plugins).toHaveLength(0);
    });
  });

  describe("Manifest Parser", () => {
    it("should load test plugin manifest", () => {
      const result = loadPluginManifest("./plugins/test-plugin");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.manifest.id).toBe("test-plugin");
        expect(result.manifest.name).toBe("Test Plugin");
        expect(result.manifest.kind).toBe("tool");
        expect(result.manifest.version).toBe("1.0.0");
      }
    });

    it("should reject invalid manifest", () => {
      const result = loadPluginManifest("./non-existent");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Manifest not found");
      }
    });

    it("should validate plugin config", () => {
      const manifest = {
        id: "test",
        configSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
          },
        },
      };

      const result = validatePluginConfig(manifest, { name: "Beeclaw" });
      expect(result.valid).toBe(true);
    });

    it("should reject invalid config", () => {
      const manifest = {
        id: "test",
        configSchema: {
          type: "object",
          properties: {
            count: { type: "number", minimum: 0 },
          },
          required: ["count"],
        },
      };

      const result = validatePluginConfig(manifest, { count: -1 });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toBeDefined();
      }
    });
  });

  describe("Plugin Registry", () => {
    it("should create global singleton", () => {
      const factory1 = getOrCreatePluginRegistry();
      const factory2 = getOrCreatePluginRegistry();

      // 应该返回同一个实例
      expect(factory1).toBe(factory2);
    });

    it("should create isolated API instances", () => {
      const { registry, createApi } = getOrCreatePluginRegistry();

      const api1 = createApi("plugin1");
      const api2 = createApi("plugin2");

      expect(api1.id).toBe("plugin1");
      expect(api2.id).toBe("plugin2");
    });

    it("should allow tool registration", () => {
      const { registry, createApi } = getOrCreatePluginRegistry();
      const api = createApi("test-plugin");

      api.registerTool({
        name: "test_tool",
        description: "A test tool",
        parameters: { type: "object" },
        execute: async () => ({ success: true }),
      });

      expect(registry.tools.has("test_tool")).toBe(true);
      const tool = registry.tools.get("test_tool");
      expect(tool?.pluginId).toBe("test-plugin");
    });

    it("should allow hook registration", () => {
      const { registry, createApi } = getOrCreatePluginRegistry();
      const api = createApi("test-plugin");

      api.on("message_received", async (event: any) => {
        console.log("Message received:", event);
      });

      expect(registry.typedHooks.has("message_received")).toBe(true);
      const hooks = registry.typedHooks.get("message_received");
      expect(hooks).toHaveLength(1);
      expect(hooks?.[0]?.pluginId).toBe("test-plugin");
    });
  });
});
