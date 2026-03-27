import { describe, it, expect, vi } from 'vitest';

describe('domain/ports/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    expect(typeof mod.registerPorts).toBe('function');
    expect(typeof mod.getMCPManagerPort).toBe('function');
    expect(typeof mod.getPluginRegistryPort).toBe('function');
    expect(typeof mod.getHookRunnerPort).toBe('function');
    expect(typeof mod.getChannelClientPort).toBe('function');
    expect(typeof mod.getMessageControllerFactory).toBe('function');
    expect(typeof mod.registerHealthMonitorPort).toBe('function');
    expect(typeof mod.getHealthMonitorPort).toBe('function');
  });
});
