import type { OpenClawPluginApi, PluginRuntime } from "openclaw/plugin-sdk";

export default {
  id: "test-plugin",
  name: "Test Plugin",
  description: "A simple test plugin for Beeclaw",
  version: "1.0.0",
  kind: "tool" as const,

  register(api: OpenClawPluginApi, runtime: PluginRuntime) {
    // 注册一个简单的工具
    api.registerTool({
      name: "hello_world",
      description: "Say hello to the world",
      parameters: {
        type: "object",
        properties: {
        name: {
          type: "string",
          description: "Name to greet"
        }
      },
      required: ["name"]
    },
      execute: async (params: any) => {
        const name = params.name || "World";
        runtime.logging.info(`[TestPlugin] Hello, ${name}!`);
        return {
          success: true,
          message: `Hello, ${name}!`
        };
      }
    });

    // 注册一个生命周期钩子
    api.on("message_received", async (event) => {
      runtime.logging.info(`[TestPlugin] Message received:`, event);
    });
  },

  activate() {
    console.log("[TestPlugin] Activated!");
  }
};
