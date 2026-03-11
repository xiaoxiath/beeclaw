# Beeclaw Sandbox System

## Overview

The sandbox system provides isolated execution environments for AI agent code execution. It supports multiple isolation levels:

| Level | Provider | Isolation | Performance | Use Case |
|-------|----------|-----------|-------------|----------|
| **Local** | Bun subprocess | Process-level | ~10ms cold start | Development, trusted code |
| **Docker** | Container | Full filesystem + resource | ~2-3s cold start | Production, untrusted code |

## Architecture

```
┌─────────────────────────────────────┐
│          SandboxManager             │  ← Singleton orchestrator
│  ┌──────────┐  ┌─────────────────┐  │
│  │  Local    │  │    Docker       │  │  ← Provider abstraction
│  │ Provider  │  │   Provider      │  │
│  └──────────┘  └─────────────────┘  │
│       ↑              ↑              │
│       └──── auto-select ────┘       │
│                                     │
│  ┌──────────────────────────────┐   │
│  │     VirtualPathMapper        │   │  ← Path rewriting
│  │  /sandbox/workspace ↔ host   │   │
│  └──────────────────────────────┘   │
│                                     │
│  ┌──────────────────────────────┐   │
│  │     ContainerPool            │   │  ← Pre-warm containers
│  │  (Docker only)               │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
          ↕
┌─────────────────────────────────────┐
│        Agent Tool Layer             │
│  sandbox_exec | sandbox_write_file  │
│  sandbox_read_file | sandbox_list   │
│  sandbox_status                     │
└─────────────────────────────────────┘
```

## Files

| File | Description |
|------|-------------|
| `types.ts` | Core interfaces, config schema, event types |
| `manager.ts` | SandboxManager singleton (create/acquire/release) |
| `path-mapper.ts` | Bidirectional virtual ↔ real path rewriting |
| `providers/local.ts` | Local provider (Bun.spawn subprocess) |
| `providers/docker.ts` | Docker provider (dockerode containers) |
| `pool.ts` | Container pool for pre-warming Docker containers |
| `tools.ts` | Agent tool definitions and executors |
| `index.ts` | Barrel exports |
| `image/Dockerfile` | Sandbox Docker base image |

## Configuration

Add to `beeclaw.json`:

```json
{
  "sandbox": {
    "enabled": true,
    "provider": "auto",
    "workspaceBase": "./data/sandbox",
    "local": {
      "enabled": true,
      "defaultTimeout": 30000,
      "maxOutputSize": 1048576,
      "blockedCommands": ["rm\\s+-rf\\s+/", "mkfs", ":(){ :|:& };:"]
    },
    "docker": {
      "enabled": false,
      "image": "beeclaw-sandbox:latest",
      "memoryLimitMb": 512,
      "cpuLimit": 1,
      "networkEnabled": false,
      "defaultTimeout": 60000
    },
    "pool": {
      "enabled": false,
      "minIdle": 1,
      "maxTotal": 5
    }
  }
}
```

## Agent Tools

The sandbox exposes 5 tools to the AI agent:

### `sandbox_exec`
Execute shell commands in the sandbox.
```json
{ "command": "echo hello && ls -la", "timeout": 30000 }
```

### `sandbox_write_file`
Write files to the sandbox workspace.
```json
{ "path": "script.py", "content": "print('hello')" }
```

### `sandbox_read_file`
Read files from the sandbox workspace.
```json
{ "path": "output.txt", "startLine": 1, "maxLines": 50 }
```

### `sandbox_list_files`
List files in a directory.
```json
{ "path": ".", "recursive": true }
```

### `sandbox_status`
Get sandbox status and execution statistics.

## Security

### Local Provider
- Command blocklist (configurable regex patterns)
- Path traversal prevention (resolved path must be within workspace)
- Output size limits (default 1MB)
- Execution timeout enforcement
- Virtual path mapping (real paths never exposed to AI)

### Docker Provider
- Full filesystem isolation (only workspace bind-mounted)
- Memory limits (default 512MB)
- CPU limits (default 1 core)
- Network disabled by default
- PID limit (256, prevents fork bombs)
- Dropped Linux capabilities
- `no-new-privileges` security option
- Non-root user inside container

## Building the Docker Image

```bash
docker build -t beeclaw-sandbox:latest -f src/sandbox/image/Dockerfile .
```

## Integration Points

The sandbox system integrates with beeclaw through:

1. **Config schema** (`src/config/schema.ts`) — `sandbox` field in AppConfigSchema
2. **App startup** (`src/app/index.ts`) — SandboxManager.initialize() during boot
3. **Tool registry** (`src/tools/builtin.ts`) — sandbox tools registered alongside builtins
4. **Tool collection** (`src/agent/tools.ts`) — sandbox tools included in getAllTools()
5. **Graceful shutdown** — registered cleanup handler via GracefulShutdown
