/**
 * Example Plugin
 *
 * 演示如何使用统一插件系统
 */

import type { PluginDefinition, PluginApi } from './registry';
import { z } from 'zod';

// 插件配置 schema
const ExamplePluginConfigSchema = z.object({
  apiKey: z.string().optional(),
  maxItems: z.number().default(10),
  enabledFeatures: z.array(z.string()).default(['all']),
});

type ExamplePluginConfig = z.infer<typeof ExamplePluginConfigSchema>;

// Helper to get typed config
function getConfig(api: PluginApi): ExamplePluginConfig {
  return api.config as ExamplePluginConfig;
}

// 插件定义
const examplePlugin: PluginDefinition = {
  id: 'example-plugin',
  name: 'Example Plugin',
  version: '1.0.0',
  description: 'A sample plugin demonstrating the unified plugin system',

  configSchema: ExamplePluginConfigSchema as z.ZodSchema<Record<string, unknown>>,

  // 初始化阶段
  async init(api: PluginApi) {
    const config = getConfig(api);
    api.logger.info('Initializing example plugin...');
    api.logger.info(`Config: maxItems=${config.maxItems}`);

    // 设置初始状态
    api.setState('initialized', true);
    api.setState('callCount', 0);
  },

  // 注册阶段 - 注册工具、钩子、命令等
  async register(api: PluginApi) {
    api.logger.info('Registering example plugin resources...');

    // 注册工具
    api.registerTool({
      type: 'function',
      function: {
        name: 'example_hello',
        description: 'Say hello from the example plugin',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Name to greet',
            },
          },
          required: ['name'],
        },
      },
    });

    // 注册钩子
    api.on('message_received', async (event, ctx) => {
      api.logger.debug(`Message received: ${(event as any).content?.substring(0, 50)}...`);

      // 更新调用计数
      const count = api.getState<number>('callCount') || 0;
      api.setState('callCount', count + 1);
    });

    // 注册命令
    api.registerCommand({
      name: 'example',
      description: 'Example plugin command',
      usage: '/example [args...]',
      examples: ['/example test', '/example --help'],
      handler: async (ctx) => {
        api.logger.info(`Command executed with args: ${ctx.args.join(' ')}`);

        const count = api.getState<number>('callCount') || 0;

        return {
          success: true,
          output: `Example plugin executed!\nArgs: ${ctx.args.join(' ')}\nCall count: ${count}`,
        };
      },
    });

    // 注册服务
    api.registerService({
      id: 'example-background',
      name: 'Example Background Service',
      description: 'A background service that runs periodically',
      start: async () => {
        api.logger.info('Background service started');
      },
      stop: async () => {
        api.logger.info('Background service stopped');
      },
      healthCheck: async () => ({
        healthy: true,
        message: 'Service is running',
      }),
    });

    // 注册 HTTP 路由
    api.registerRoute({
      method: 'GET',
      path: '/api/example/status',
      handler: async (request) => {
        const count = api.getState<number>('callCount') || 0;
        const config = getConfig(api);

        return {
          status: 200,
          body: {
            plugin: 'example-plugin',
            version: '1.0.0',
            callCount: count,
            config: {
              maxItems: config.maxItems,
            },
          },
        };
      },
    });
  },

  // 激活阶段
  async activate(api: PluginApi) {
    api.logger.info('Example plugin activated!');
  },

  // 停用阶段
  async deactivate() {
    console.log('[ExamplePlugin] Deactivated');
  },

  // 销毁阶段
  async destroy() {
    console.log('[ExamplePlugin] Destroyed');
  },
};

export default examplePlugin;
