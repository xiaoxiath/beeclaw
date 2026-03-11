#!/bin/bash
# Fix remaining imports in adapter layer

set -e

echo "🔧 Fixing adapter layer imports..."

# ============================================
# adapter/plugins/__tests__/ (depth 3)
# ============================================
find src/adapter/plugins/__tests__ -name "*.ts" -exec sed -i '' "s|from '\.\./\.\./agent'|from '../../../domain/agent'|g" {} \;
find src/adapter/plugins/__tests__ -name "*.ts" -exec sed -i '' "s|from '\.\./\.\./config'|from '../../../infra/config'|g" {} \;

# ============================================
# adapter/plugins/hooks/types.ts (depth 3)
# ============================================
sed -i '' "s|from '\.\./\.\./domain/agent/types'|from '../../../domain/agent/types'|g" src/adapter/plugins/hooks/types.ts

# ============================================
# adapter/web/server/routes/* (depth 4)
# ============================================
find src/adapter/web/server/routes -name "*.ts" -exec sed -i '' "s|from '\.\./\.\./\.\./skills/store'|from '../../../../../domain/skills/store'|g" {} \;
find src/adapter/web/server/routes -name "*.ts" -exec sed -i '' "s|from '\.\./\.\./\.\./skills/types'|from '../../../../../domain/skills/types'|g" {} \;
find src/adapter/web/server/routes -name "*.ts" -exec sed -i '' "s|from '\.\./\.\./\.\./app'|from '../../../../../app'|g" {} \;
find src/adapter/web/server/routes -name "*.ts" -exec sed -i '' "s|from '\.\./\.\./\.\./memory'|from '../../../../../domain/memory'|g" {} \;
find src/adapter/web/server/routes -name "*.ts" -exec sed -i '' "s|from '\.\./\.\./\.\./session'|from '../../../../../domain/session'|g" {} \;
find src/adapter/web/server/routes -name "*.ts" -exec sed -i '' "s|from '\.\./\.\./\.\./agent'|from '../../../../../domain/agent'|g" {} \;

echo "✅ Adapter imports fixed!"
echo ""
echo "Checking TypeScript errors..."
bunx tsc --noEmit 2>&1 | grep -c "error TS" || echo "0"
