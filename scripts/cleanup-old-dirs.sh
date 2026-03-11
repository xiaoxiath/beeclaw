#!/bin/bash
# Clean up old directories after migration

set -e

echo "🧹 Cleaning up old directories..."

# ============================================
# Remove old files that were copied (not moved)
# ============================================

echo "📦 Removing copied feishu/tools files..."
rm -rf src/feishu

echo "📦 Removing copied plugins files..."
rm -rf src/plugins

echo "📦 Removing copied providers files..."
rm -rf src/providers

echo "📦 Removing copied queue files (tests will be moved)..."
# Keep tests for now, remove other queue files
rm -f src/queue/*.ts 2>/dev/null || true

echo "📦 Removing copied sandbox files..."
rm -rf src/sandbox/providers
rm -f src/sandbox/README.md src/sandbox/DOCKER.md

echo "📦 Removing copied search files..."
rm -rf src/search

# ============================================
# Remove empty directories
# ============================================

echo "📦 Removing empty directories..."
rmdir src/channel 2>/dev/null || true
rmdir src/finance 2>/dev/null || true
rmdir src/store 2>/dev/null || true
rmdir src/tools 2>/dev/null || true
rmdir src/utils 2>/dev/null || true
rmdir src/queue 2>/dev/null || true
rmdir src/sandbox 2>/dev/null || true

echo "✅ Cleanup complete!"
echo ""
echo "Remaining directories in src/:"
ls -d src/*/ 2>/dev/null | xargs -n1 basename | sort
