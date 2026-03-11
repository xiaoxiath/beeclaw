#!/bin/bash
# Final Import Fix - Round 4
# Fix remaining specific import issues

set -e

echo "🔧 Round 4: Final import fixes..."

# ============================================
# adapter/web/server/middleware/* (depth 4)
# ============================================
echo "📦 Fixing adapter/web/server/middleware imports..."

find src/adapter/web/server/middleware -name "*.ts" -exec sed -i '' "s|from '\.\./\.\./\.\./config|from '../../../../infra/config|g" {} \;

# ============================================
# adapter/web/server/routes/* (depth 4)
# ============================================
echo "📦 Fixing adapter/web/server/routes imports..."

find src/adapter/web/server/routes -name "*.ts" | while read file; do
    # ../../config -> ../../../../infra/config
    sed -i '' "s|from '\.\./\.\./\.\./config|from '../../../../infra/config|g" "$file"

    # ../../agent -> ../../../../domain/agent
    sed -i '' "s|from '\.\./\.\./\.\./agent|from '../../../../domain/agent|g" "$file"

    # ../../memory -> ../../../../domain/memory
    sed -i '' "s|from '\.\./\.\./\.\./memory|from '../../../../domain/memory|g" "$file"

    # ../../session -> ../../../../domain/session
    sed -i '' "s|from '\.\./\.\./\.\./session|from '../../../../domain/session|g" "$file"

    # ../../skills -> ../../../../domain/skills
    sed -i '' "s|from '\.\./\.\./\.\./skills|from '../../../../domain/skills|g" "$file"

    # ../../app -> ../../../../app
    sed -i '' "s|from '\.\./\.\./\.\./app|from '../../../../app|g" "$file"

    # ../schemas -> ../../schemas
    sed -i '' "s|from '\./schemas'|from '../schemas'|g" "$file"
done

# ============================================
# adapter/plugins/* (fix registry references)
# ============================================
echo "📦 Fixing adapter/plugins registry references..."

# All files in adapter/plugins should reference ./registry not ../registry
find src/adapter/plugins -name "*.ts" | while read file; do
    sed -i '' "s|from '\.\./registry'|from './registry'|g" "$file"
    sed -i '' "s|from '\./registry/index'|from './registry'|g" "$file"
    sed -i '' "s|from '\.\./runtime-shim'|from './runtime-shim'|g" "$file"
done

# Fix hooks/types.ts - it's at depth 3
sed -i '' "s|from '\.\./\.\./domain/agent/types'|from '../../../domain/agent/types'|g" src/adapter/plugins/hooks/types.ts

# ============================================
# Fix any double slashes
# ============================================
echo "📦 Fixing double slashes in imports..."

find src -name "*.ts" -exec sed -i '' "s|//|/|g" {} \;

# ============================================
# Fix domain/search deep imports
# ============================================
echo "📦 Fixing domain/search imports..."

find src/domain/search -name "*.ts" | while read file; do
    # Fix providers imports
    sed -i '' "s|from '\.\./types'|from './types'|g" "$file"
    sed -i '' "s|from '\.\./base'|from './base'|g" "$file"
done

# Fix domain/search/providers/* (depth 3)
find src/domain/search/providers -name "*.ts" | while read file; do
    sed -i '' "s|from '\.\./types'|from '../../types'|g" "$file"
    sed -i '' "s|from '\.\./base'|from '../../base'|g" "$file"
done

echo "✅ Round 4 complete!"
echo ""
echo "Running final TypeScript check..."
bunx tsc --noEmit 2>&1 | grep -c "error TS" || echo "0"
