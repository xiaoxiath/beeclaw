# Sandbox System - Experimental Feature

## Status: 🧪 Experimental

The sandbox system is currently in **experimental** status and is **not fully implemented**. Use with caution.

## Current Implementation Status

### ✅ Implemented
- Sandbox manager architecture
- Configuration schema
- Path mapping utilities
- Event system

### ⚠️ Not Implemented (Stub Only)
- **LocalSandboxProvider** - Throws error on use
- **DockerSandboxProvider** - Throws error on use
- Sandbox pooling

## Configuration

The sandbox configuration in `beeclaw.json` is present but the providers will not work:

```json
{
  "sandbox": {
    "enabled": true,
    "provider": "auto",
    "local": {
      "enabled": true,
      "defaultTimeout": 30000,
      "blockedCommands": [...]
    },
    "docker": {
      "enabled": false,
      "image": "beeclaw-sandbox:latest"
    }
  }
}
```

## Attempting to Use

If you try to use the sandbox features, you will encounter errors:

```typescript
// This will throw an error:
const sandbox = await manager.acquire({ sessionId: 'test' });
// Error: LocalSandboxProvider not implemented yet. See TODO in src/domain/sandbox/providers/local.ts
```

## Future Plans

The sandbox system is planned for future implementation with:

1. **Local Provider**: Isolated process execution with resource limits
2. **Docker Provider**: Container-based isolation
3. **Pool Management**: Pre-warmed sandbox instances
4. **Security**: Command filtering, resource limits, network isolation

## Recommendation

For now, **disable the sandbox system** in your configuration:

```json
{
  "sandbox": {
    "enabled": false
  }
}
```

## Contributing

If you're interested in implementing sandbox functionality, see:
- `src/domain/sandbox/providers/local.ts` - Local execution
- `src/domain/sandbox/providers/docker.ts` - Docker execution
- `src/domain/sandbox/types.ts` - Type definitions

## Related Issues

See the audit report for details on unimplemented features.
