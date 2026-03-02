import { PluginType, type ChannelPlugin, type ToolPlugin } from './types';

// Plugin types
export { PluginType };
export type { ChannelPlugin, ToolPlugin, PluginConfig, ChannelConfig, ToolConfig } from './types';

// Plugin loader
import { loadChannelPlugin, loadToolPlugin } from './loader';

export async function loadPlugins(config: {
  channels: Record<string, import('./types').ChannelConfig>;
  tools: Record<string, import('./types').ToolConfig>;
}): Promise<{
  channels: Map<string, ChannelPlugin>;
  tools: Map<string, ToolPlugin>;
}> {
  const channels = new Map<string, ChannelPlugin>();
  const tools = new Map<string, ToolPlugin>();

  // Load channel plugins
  for (const [id, channelConfig] of Object.entries(config.channels)) {
    if (!channelConfig.enabled) continue;

    try {
      const plugin = await loadChannelPlugin(id, channelConfig);
      channels.set(id, plugin);
      console.log(`Loaded channel plugin: ${id}`);
    } catch (error) {
      console.error(`Failed to load channel plugin ${id}:`, error);
    }
  }

  // Load tool plugins
  for (const [id, toolConfig] of Object.entries(config.tools)) {
    if (!toolConfig.enabled) continue;

    try {
      const plugin = await loadToolPlugin(id, toolConfig);
      tools.set(id, plugin);
      console.log(`Loaded tool plugin: ${id}`);
    } catch (error) {
      console.error(`Failed to load tool plugin ${id}:`, error);
    }
  }

  return { channels, tools };
}
