# Configuration Guide

This document explains the configuration options in `beeclaw.json`.

## Sandbox Configuration ⚠️ Experimental

The sandbox system is **experimental and not fully implemented**. The Local and Docker providers are stubs that will throw errors if used.

```json
{
  "sandbox": {
    "enabled": false,  // RECOMMENDED: Keep disabled until implementation is complete
    "provider": "auto",
    "workspaceBase": "./data/sandbox",
    "local": {
      "enabled": true,
      "defaultTimeout": 30000,
      "maxOutputSize": 1048576,
      "blockedCommands": [
        "rm\\s+-rf\\s+/",
        "mkfs",
        "dd\\s+if=",
        ":(){ :|:& };:",
        "chmod\\s+-R\\s+777\\s+/",
        "shutdown",
        "reboot",
        "halt",
        "init\\s+0"
      ]
    },
    "docker": {
      "enabled": false,  // NOT IMPLEMENTED - Will not work
      "image": "beeclaw-sandbox:latest",
      "memoryLimitMb": 512,
      "cpuLimit": 1,
      "networkEnabled": false,
      "defaultTimeout": 60000
    },
    "pool": {
      "enabled": false,  // NOT IMPLEMENTED
      "minIdle": 1,
      "maxTotal": 5
    }
  }
}
```

### Status

- ✅ **Configuration Schema**: Defined and validated
- ⚠️ **Local Provider**: Stub only - throws `Error('LocalSandboxProvider not implemented yet')`
- ⚠️ **Docker Provider**: Stub only - throws `Error('DockerSandboxProvider not implemented yet')`
- ⚠️ **Pool System**: Not implemented

### Recommendation

**Disable sandbox in production**:

```json
{
  "sandbox": {
    "enabled": false
  }
}
```

See `docs/experimental/sandbox-system.md` for more details.

---

## Other Configuration Sections

For other configuration options, see the inline comments in `beeclaw.example.json`.
