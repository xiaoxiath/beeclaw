# Beeclaw Sandbox Base Image
# Provides a secure, minimal environment for executing user code in Docker sandboxes.
#
# Build:  docker build -t beeclaw-sandbox:latest -f src/sandbox/image/Dockerfile .
# Test:   docker run --rm -it beeclaw-sandbox:latest bash

FROM oven/bun:1.1-debian AS base

# Install essential tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    curl \
    git \
    jq \
    tree \
    python3 \
    python3-pip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create sandbox user (non-root)
RUN groupadd -g 1000 sandbox && \
    useradd -u 1000 -g sandbox -m -s /bin/bash sandbox

# Create workspace directory
RUN mkdir -p /workspace /tmp/sandbox && \
    chown -R sandbox:sandbox /workspace /tmp/sandbox

# Set resource limits via ulimit defaults
# (actual enforcement is via Docker --memory and --cpus flags)

# Security: remove dangerous binaries
RUN rm -f /usr/bin/passwd /usr/bin/chsh /usr/bin/chfn /usr/bin/newgrp \
    /usr/sbin/adduser /usr/sbin/useradd /usr/sbin/userdel \
    /usr/sbin/groupadd /usr/sbin/groupdel 2>/dev/null || true

# Default environment
ENV HOME=/workspace \
    SANDBOX=true \
    NODE_ENV=production \
    TERM=xterm-256color

WORKDIR /workspace
USER sandbox

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD echo "ok" || exit 1

CMD ["sleep", "infinity"]
