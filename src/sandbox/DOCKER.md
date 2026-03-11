# Building Sandbox Docker Image

This guide explains how to build and configure the Docker sandbox image for Beeclaw.

## Prerequisites

- Docker installed and running
- Basic understanding of Docker concepts

## Quick Start

### 1. Build the Image

```bash
cd /path/to/beeclaw
docker build -t beeclaw-sandbox:latest -f src/sandbox/image/Dockerfile .
```

### 2. Configure in beeclaw.json

```json
{
  "sandbox": {
    "enabled": true,
    "provider": "docker",
    "docker": {
      "enabled": true,
      "image": "beeclaw-sandbox:latest",
      "memoryLimitMb": 512,
      "cpuLimit": 1,
      "networkEnabled": false
    }
  }
}
```

### 3. Test the sandbox

```bash
bun run cli
```

Then use the sandbox tools:
- `sandbox_exec` - Execute commands
- `sandbox_write_file` - Write files
- `sandbox_read_file` - Read files
- `sandbox_list_files` - List files
- `sandbox_status` - Check status

## Dockerfile Details

The base image includes:

### Installed Tools
- **Node.js 20** - JavaScript runtime
- **Bun** - Fast JavaScript runtime
- **Python 3** - For Python code execution
- **Git** - Version control
- **curl** - HTTP client
- **wget** - File downloader
- **jq** - JSON processor
- **yq** - YAML processor

- **build-essential** - Compilation tools (gcc, make, etc.)

### Security Features
- **Non-root user** - Runs as `sandbox` user (UID 1000)
- **Network disabled** - No network access by default
- **Resource limits** - Memory and CPU constraints
- **Read-only root** - Root filesystem is read-only
- **No new privileges** - Security option set

### Customizing the Image

#### Add custom packages

Edit `src/sandbox/image/Dockerfile`:

```dockerfile
# Install additional packages
RUN apt-get update && apt-get install -y \
    package-name

# Clean up
RUN apt-get clean && rm -rf /var/lib/apt/lists/*
```

```

#### Change default user

```dockerfile
# Change the default user
USER sandbox

# Or remove the USER instruction to run as root
```

#### Enable network

Edit `src/sandbox/image/Dockerfile`:

```dockerfile
# Remove network disabling
# RUN rm /etc/resolv.conf && \
    echo "nameserver 8.8.8.8" > /etc/resolv.conf
```

Then update configuration:

```json
{
  "sandbox": {
    "docker": {
      "networkEnabled": true
    }
  }
}
```

## Resource Limits

### Default Limits
- **Memory**: 512MB
- **CPU**: 1 core
- **PID limit**: 256 processes
- **Timeout**: 60 seconds

### Customizing Limits

Edit configuration in `beeclaw.json`:

```json
{
  "sandbox": {
    "docker": {
      "memoryLimitMb": 1024,  // 1GB
      "cpuLimit": 2,  // 2 cores
      "defaultTimeout": 120000  // 2 minutes
    }
  }
}
```

### Checking Current Usage

```bash
docker stats <container-id>
```

## Container Pool

For better performance, you sandbox system supports container pooling.

### Enable Pool

```json
{
  "sandbox": {
    "pool": {
      "enabled": true,
      "minIdle": 2,  // Keep 2 containers warm
      "maxTotal": 10,  // Maximum 10 containers
      "healthCheckInterval": 60000  // Check every minute
    }
  }
}
```

### How Pool Works

- **Pre-warming**: Creates `minIdle` containers on startup
- **Acquisition**: Returns an idle container or creates a new one
- **Release**: Returns container to pool for reuse
- **Cleanup**: Removes stale containers after `idleTimeout`

### Benefits
- **Fast startup**: ~50ms vs ~2-3s cold start
- **Resource reuse**: Containers are recycled between sessions
- **Auto-scaling**: Pool scales based on demand

## Security Considerations

### Path Traversal Protection
All paths are validated to prevent access outside the workspace

### Command Restrictions
Dangerous commands are blocked by default:
- `rm -rf /`
- `mkfs`
- `dd if=`
- Fork bombs
- `chmod -R 777 /`
- System commands (shutdown, reboot, etc.)

### Allowlisting
To restrict commands, an allowlist:

```json
{
  "sandbox": {
    "local": {
      "allowedCommands": [
        "ls",
        "cat",
        "echo",
        "grep",
        "sed",
        "awk"
        "python3?",
        "node?"
      ]
    }
  }
}
```

### Network Isolation
By default, containers run with:
- **No network access**
- **No external API calls**
- **No database connections**

To enable network (use with caution):

```json
{
  "sandbox": {
    "docker": {
      "networkEnabled": true
    }
  }
}
```

## Troubleshooting
### Container won't start

```bash
# Check Docker logs
docker logs <container-id>

# Check container status
docker ps -a | grep beeclaw-sandbox
```
```

### Permission denied

If you see permission errors in container logs

```bash
# Run as root temporarily
docker exec -it -u 0 <container-id> bash

# Or adjust permissions
docker exec -u 0 <container-id> chmod 755 /path/to/file
```
```

### Out of memory

If containers are killed due to OOM

```bash
# Increase memory limit
# In beeclaw.json
{
  "sandbox": {
    "docker": {
      "memoryLimitMb": 1024
    }
  }
}
```

```

### Timeout issues

If commands timeout frequently

```bash
# Increase timeout
# In beeclaw.json
{
  "sandbox": {
    "docker": {
      "defaultTimeout": 120000
    }
  }
}
```
```

## Advanced Usage
### Custom Environment Variables

```json
{
  "sandbox": {
    "docker": {
      "env": {
        "CUSTOM_VAR": "value",
        "API_KEY": "secret"
      }
    }
  }
}
```
```

### Mount Custom Directories

Currently, only the workspace directory is mounted. To mount additional directories, you'll need to modify the Docker provider code.

```

### Persistent Workspaces

By default, workspace data persists after container destruction. To clean up

```bash
rm -rf ./data/sandbox/<sandbox-id>
```

## Maintenance
### Update Image

```bash
# Pull latest changes
docker build -t beeclaw-sandbox:latest -f src/sandbox/image/Dockerfile .

# Restart containers
docker restart $(docker ps -q --filter "label=beeclaw.sandbox=true" -q)
```
```

### Clean Up Old Containers

```bash
# List all sandbox containers
docker ps -a --filter "label=beeclaw.sandbox=true"

# Remove stopped containers
docker container prune
```
```

### Monitor Resources

```bash
# Watch container stats
docker stats <container-id>

# Check disk usage
docker system df
```
```

## Best Practices
1. **Use Docker provider in production** - Better isolation and security
2. **Use local provider for development** - Faster iteration, debugging
3. **Enable pooling** - Reduce cold start latency for Docker
4. **Monitor resources** - Watch memory and CPU usage
5. **Regular updates** - Keep base image updated with security patches
6. **Clean up regularly** - Remove old workspace directories
7. **Test commands** - Test blocked commands before allowing new ones
8. **Limit network access** - Only enable when absolutely necessary
9. **Set appropriate timeouts** - Balance between allowing enough time and preventing hangs
10. **Use allowlists** - More secure than blocklists for production

## Support
For issues or questions, please open an issue on GitHub.
