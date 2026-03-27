/**
 * Tests for Plugin Runtime Shim
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';

import {
  createPluginRuntimeCore,
  createPluginRuntimeShim,
  createChannelRuntimeStub,
} from '../runtime-shim/index';

describe('Plugin Runtime Shim', () => {
  describe('createPluginRuntimeCore', () => {
    it('creates a runtime with default options', () => {
      const core = createPluginRuntimeCore();
      expect(core).toBeDefined();
      expect(core.config).toBeDefined();
      expect(core.system).toBeDefined();
      expect(core.media).toBeDefined();
      expect(core.tools).toBeDefined();
      expect(core.events).toBeDefined();
      expect(core.logging).toBeDefined();
      expect(core.state).toBeDefined();
    });

    describe('config', () => {
      it('uses default configLoader returning empty object', () => {
        const core = createPluginRuntimeCore();
        expect(core.config.loadConfig()).toEqual({});
      });

      it('uses custom configLoader', () => {
        const loader = () => ({ key: 'value' });
        const core = createPluginRuntimeCore({ configLoader: loader });
        expect(core.config.loadConfig()).toEqual({ key: 'value' });
      });

      it('uses default configWriter (no-op)', () => {
        const core = createPluginRuntimeCore();
        // Should not throw
        core.config.writeConfigFile({ patch: true });
      });

      it('uses custom configWriter', () => {
        const writer = mock(() => {});
        const core = createPluginRuntimeCore({ configWriter: writer });
        core.config.writeConfigFile({ x: 1 });
        expect(writer).toHaveBeenCalledWith({ x: 1 });
      });
    });

    describe('system', () => {
      it('emits system-event via enqueueSystemEvent', () => {
        const core = createPluginRuntimeCore();
        const handler = mock(() => {});
        core.events.on('system-event', handler);
        core.system.enqueueSystemEvent({ type: 'test' });
        expect(handler).toHaveBeenCalledWith({ type: 'test' });
      });

      it('emits heartbeat-request via requestHeartbeatNow', () => {
        const core = createPluginRuntimeCore();
        const handler = mock(() => {});
        core.events.on('heartbeat-request', handler);
        core.system.requestHeartbeatNow();
        expect(handler).toHaveBeenCalledTimes(1);
      });

      it('default runCommandWithTimeout throws', async () => {
        const core = createPluginRuntimeCore();
        await expect(core.system.runCommandWithTimeout('ls', 5000)).rejects.toThrow(
          'Command execution not supported'
        );
      });

      it('uses custom commandRunner', async () => {
        const runner = mock(async () => 'output');
        const core = createPluginRuntimeCore({ commandRunner: runner });
        const result = await core.system.runCommandWithTimeout('ls', 5000);
        expect(result).toBe('output');
        expect(runner).toHaveBeenCalledWith('ls', 5000);
      });
    });

    describe('media', () => {
      it('default loadWebMedia throws', async () => {
        const core = createPluginRuntimeCore();
        await expect(core.media.loadWebMedia('http://example.com/img.png')).rejects.toThrow(
          'Media loading not supported'
        );
      });

      it('uses custom mediaLoader', async () => {
        const loader = mock(async () => Buffer.from('image'));
        const core = createPluginRuntimeCore({ mediaLoader: loader });
        const result = await core.media.loadWebMedia('http://test.com');
        expect(result).toEqual(Buffer.from('image'));
      });

      it('detects PNG mime type', () => {
        const core = createPluginRuntimeCore();
        const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        expect(core.media.detectMime(buf)).toBe('image/png');
      });

      it('detects JPEG mime type', () => {
        const core = createPluginRuntimeCore();
        const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
        expect(core.media.detectMime(buf)).toBe('image/jpeg');
      });

      it('detects GIF mime type', () => {
        const core = createPluginRuntimeCore();
        const buf = Buffer.from([0x47, 0x49, 0x46, 0x38]);
        expect(core.media.detectMime(buf)).toBe('image/gif');
      });

      it('detects WAV mime type', () => {
        const core = createPluginRuntimeCore();
        const buf = Buffer.from([0x52, 0x49, 0x46, 0x46]);
        expect(core.media.detectMime(buf)).toBe('audio/wav');
      });

      it('detects PDF mime type', () => {
        const core = createPluginRuntimeCore();
        const buf = Buffer.from([0x25, 0x50, 0x44, 0x46]);
        expect(core.media.detectMime(buf)).toBe('application/pdf');
      });

      it('returns octet-stream for unknown data', () => {
        const core = createPluginRuntimeCore();
        const buf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
        expect(core.media.detectMime(buf)).toBe('application/octet-stream');
      });

      it('returns octet-stream for tiny buffer', () => {
        const core = createPluginRuntimeCore();
        expect(core.media.detectMime(Buffer.from([0x89]))).toBe('application/octet-stream');
      });
    });

    describe('tools', () => {
      it('createMemoryGetTool returns a valid tool definition', () => {
        const core = createPluginRuntimeCore();
        const tool = core.tools.createMemoryGetTool();
        expect(tool.name).toBe('memory_get');
        expect(tool.description).toBeTruthy();
        expect(tool.parameters).toBeDefined();
      });

      it('createMemoryGetTool execute returns null result', async () => {
        const core = createPluginRuntimeCore();
        const tool = core.tools.createMemoryGetTool();
        const result = await tool.execute({ key: 'test' });
        expect(result).toEqual({ result: null });
      });

      it('createMemorySearchTool returns a valid tool definition', () => {
        const core = createPluginRuntimeCore();
        const tool = core.tools.createMemorySearchTool();
        expect(tool.name).toBe('memory_search');
        expect(tool.description).toBeTruthy();
        expect(tool.parameters).toBeDefined();
      });

      it('createMemorySearchTool execute returns empty results', async () => {
        const core = createPluginRuntimeCore();
        const tool = core.tools.createMemorySearchTool();
        const result = await tool.execute({ query: 'hello' });
        expect(result).toEqual({ results: [] });
      });
    });

    describe('state', () => {
      it('set and get values', () => {
        const core = createPluginRuntimeCore();
        core.state.set('key1', 'value1');
        expect(core.state.get('key1')).toBe('value1');
      });

      it('get returns undefined for missing key', () => {
        const core = createPluginRuntimeCore();
        expect(core.state.get('missing')).toBeUndefined();
      });

      it('delete removes a key', () => {
        const core = createPluginRuntimeCore();
        core.state.set('k', 'v');
        expect(core.state.delete('k')).toBe(true);
        expect(core.state.get('k')).toBeUndefined();
      });

      it('delete returns false for non-existent key', () => {
        const core = createPluginRuntimeCore();
        expect(core.state.delete('nope')).toBe(false);
      });

      it('clear removes all state', () => {
        const core = createPluginRuntimeCore();
        core.state.set('a', 1);
        core.state.set('b', 2);
        core.state.clear();
        expect(core.state.get('a')).toBeUndefined();
        expect(core.state.get('b')).toBeUndefined();
      });
    });

    describe('tts/stt stubs', () => {
      it('tts proxy returns undefined for any method', () => {
        const core = createPluginRuntimeCore();
        expect(core.tts.someMethod()).toBeUndefined();
      });

      it('stt proxy returns undefined for any method', () => {
        const core = createPluginRuntimeCore();
        expect(core.stt.anotherMethod()).toBeUndefined();
      });
    });
  });

  describe('createChannelRuntimeStub', () => {
    it('creates stubs for known channel adapters', () => {
      const loggerMock = {
        info: mock(() => {}),
        warn: mock(() => {}),
        error: mock(() => {}),
        debug: mock(() => {}),
      };
      const stub = createChannelRuntimeStub(loggerMock);

      expect(stub.text).toBeDefined();
      expect(stub.reply).toBeDefined();
      expect(stub.routing).toBeDefined();
      expect(stub.media).toBeDefined();
      expect(stub.session).toBeDefined();
    });

    it('stub methods return undefined and log warnings', () => {
      const loggerMock = {
        info: mock(() => {}),
        warn: mock(() => {}),
        error: mock(() => {}),
        debug: mock(() => {}),
      };
      const stub = createChannelRuntimeStub(loggerMock);

      const result = stub.text.send('hello');
      expect(result).toBeUndefined();
      expect(loggerMock.warn).toHaveBeenCalled();
    });
  });

  describe('createPluginRuntimeShim', () => {
    it('returns combined core and channel', () => {
      const shim = createPluginRuntimeShim();
      // Core properties
      expect(shim.config).toBeDefined();
      expect(shim.system).toBeDefined();
      expect(shim.media).toBeDefined();
      expect(shim.tools).toBeDefined();
      expect(shim.state).toBeDefined();
      expect(shim.events).toBeDefined();
      // Channel
      expect(shim.channel).toBeDefined();
      expect(shim.channel.text).toBeDefined();
    });
  });
});
