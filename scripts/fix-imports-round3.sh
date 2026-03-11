#!/bin/bash
# Systematic Import Fixer - Round 3
# Target specific modules with precise fixes

set -e

echo "🔧 Round 3: Systematic import fixing..."

# ============================================
# adapter/plugins/* (depth 2)
# ============================================
echo "📦 Fixing adapter/plugins imports..."

# Fix all relative imports in plugins
find src/adapter/plugins -name "*.ts" -not -path "*/__tests__/*" | while read file; do
    # ../agent -> ../../domain/agent
    sed -i '' "s|from '../agent|from '../../domain/agent|g" "$file"

    # ../config -> ../../infra/config
    sed -i '' "s|from '../config|from '../../infra/config|g" "$file"

    # ../hooks -> ./hooks
    sed -i '' "s|from '../hooks'|from './hooks'|g" "$file"

    # ../plugins/types -> ./types (same directory)
    sed -i '' "s|from '\./types'|from './types'|g" "$file"
done

# Fix plugins subdirectories (depth 3)
find src/adapter/plugins -mindepth 2 -name "*.ts" | while read file; do
    # ../../agent -> ../../../domain/agent
    sed -i '' "s|from '../../agent|from '../../../domain/agent|g" "$file"

    # ../../config -> ../../../infra/config
    sed -i '' "s|from '../../config|from '../../../infra/config|g" "$file"

    # ../types -> ../../types
    sed -i '' "s|from '../types'|from '../../types'|g" "$file"

    # ../index -> ../../index
    sed -i '' "s|from '../index'|from '../../index'|g" "$file"
done

# ============================================
# adapter/web/* (depth 2-3)
# ============================================
echo "📦 Fixing adapter/web imports..."

find src/adapter/web -name "*.ts" | while read file; do
    # Calculate depth
    depth=$(echo "$file" | tr -cd '/' | wc -c)
    rel_path=""
    for ((i=0; i<depth-2; i++)); do
        rel_path+="../"
    done

    # ../agent -> ../../domain/agent or ../../../domain/agent
    if [[ "$file" == *"/server/"* ]]; then
        sed -i '' "s|from '../agent|from '../../../domain/agent|g" "$file"
        sed -i '' "s|from '../config|from '../../../infra/config|g" "$file"
        sed -i '' "s|from '../memory|from '../../../domain/memory|g" "$file"
        sed -i '' "s|from '../session|from '../../../domain/session|g" "$file"
        sed -i '' "s|from '../skills|from '../../../domain/skills|g" "$file"
        sed -i '' "s|from '../app|from '../../../app|g" "$file"
    else
        sed -i '' "s|from '../agent|from '../../domain/agent|g" "$file"
        sed -i '' "s|from '../config|from '../../infra/config|g" "$file"
    fi
done

# ============================================
# adapter/feishu/* (already mostly fixed, just tests)
# ============================================
echo "📦 Fixing adapter/feishu test imports..."

find src/adapter/feishu/__tests__ -name "*.ts" | while read file; do
    sed -i '' "s|from '../../config|from '../../../infra/config|g" "$file"
    sed -i '' "s|from '../../types|from '../../../types|g" "$file"
done

find src/adapter/feishu/card-v2/__tests__ -name "*.ts" | while read file; do
    sed -i '' "s|from '../../../types|from '../../../../types|g" "$file"
done

# ============================================
# domain/agent/* (depth 2)
# ============================================
echo "📦 Fixing domain/agent imports..."

find src/domain/agent -maxdepth 1 -name "*.ts" | while read file; do
    # ../feishu -> ../../adapter/feishu
    sed -i '' "s|from '../feishu|from '../../adapter/feishu|g" "$file"

    # ../mcp -> ../../adapter/mcp
    sed -i '' "s|from '../mcp|from '../../adapter/mcp|g" "$file"

    # ../plugins -> ../../adapter/plugins
    sed -i '' "s|from '../plugins|from '../../adapter/plugins|g" "$file"

    # ../hooks -> ../../adapter/plugins/hooks
    sed -i '' "s|from '../hooks|from '../../adapter/plugins/hooks|g" "$file"
done

# ============================================
# domain/session/* (depth 2)
# ============================================
echo "📦 Fixing domain/session imports..."

find src/domain/session -name "*.ts" | while read file; do
    # ../feishu -> ../../adapter/feishu
    sed -i '' "s|from '../feishu|from '../../adapter/feishu|g" "$file"

    # ../app -> ../../app
    sed -i '' "s|from '../app|from '../../app|g" "$file"

    # ../plugins -> ../../adapter/plugins
    sed -i '' "s|from '../plugins|from '../../adapter/plugins|g" "$file"

    # ../extraction -> ../extraction (should be correct)
    sed -i '' "s|from '../../extraction|from '../extraction|g" "$file"
done

# ============================================
# domain/subagent/* (depth 2)
# ============================================
echo "📦 Fixing domain/subagent imports..."

find src/domain/subagent -name "*.ts" | while read file; do
    # ../hooks -> ../../adapter/plugins/hooks
    sed -i '' "s|from '../hooks|from '../../adapter/plugins/hooks|g" "$file"

    # ../plugins -> ../../adapter/plugins
    sed -i '' "s|from '../plugins|from '../../adapter/plugins|g" "$file"
done

# ============================================
# Fix any remaining deep utils references
# ============================================
echo "📦 Fixing remaining deep utils imports..."

# Any file still referencing ../utils should go to correct infra location
find src/domain -name "*.ts" -exec grep -l "from '../utils/" {} \; | while read file; do
    # Determine the module and redirect
    sed -i '' "s|from '\.\./\.\./utils/logger'|from '../../infra/observability/logger'|g" "$file"
    sed -i '' "s|from '\.\./\.\./utils/errors'|from '../../infra/observability/errors'|g" "$file"
    sed -i '' "s|from '\.\./\.\./utils/|from '../../infra/utils/|g" "$file"
done

echo "✅ Round 3 complete!"
echo ""
echo "Checking TypeScript errors..."
bunx tsc --noEmit 2>&1 | grep -c "error TS" || echo "0"
