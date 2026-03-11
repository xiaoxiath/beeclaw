#!/bin/bash
# Batch Import Fixer
# Fixes common import path patterns after directory restructuring

set -e

echo "🔧 Fixing import paths..."

# Helper function to fix imports in files at a specific depth
fix_imports_at_depth() {
    local depth=$1
    local prefix=""
    for ((i=0; i<depth; i++)); do
        prefix+="../"
    done

    echo "  Fixing files at depth $depth (prefix: $prefix)"
}

# ============================================
# adapter/feishu/* (depth 2 from src/)
# ============================================
echo "📦 Fixing adapter/feishu imports..."

# ../utils/logger -> ../../infra/observability/logger
find src/adapter/feishu -maxdepth 1 -name "*.ts" -exec sed -i '' "s|from '../utils/logger'|from '../../infra/observability/logger'|g" {} \;

# ../config -> ../../infra/config
find src/adapter/feishu -maxdepth 1 -name "*.ts" -exec sed -i '' "s|from '../config|from '../../infra/config|g" {} \;

# ../types -> ../../types
find src/adapter/feishu -maxdepth 1 -name "*.ts" -exec sed -i '' "s|from '../types'|from '../../types'|g" {} \;

# ============================================
# adapter/feishu/tools/* (depth 3 from src/)
# ============================================
echo "📦 Fixing adapter/feishu/tools imports..."

# ../../utils/logger -> ../../../infra/observability/logger
find src/adapter/feishu/tools -name "*.ts" -exec sed -i '' "s|from '../../utils/logger'|from '../../../infra/observability/logger'|g" {} \;

# ============================================
# adapter/feishu/card-v2/* (depth 3 from src/)
# ============================================
echo "📦 Fixing adapter/feishu/card-v2 imports..."

# ../../types/content-block -> ../../../types/content-block
find src/adapter/feishu/card-v2 -maxdepth 1 -name "*.ts" -exec sed -i '' "s|from '../../types/|from '../../../types/|g" {} \;

# ============================================
# adapter/mcp/* (depth 2 from src/)
# ============================================
echo "📦 Fixing adapter/mcp imports..."

# ../agent -> ../../domain/agent
find src/adapter/mcp -name "*.ts" -exec sed -i '' "s|from '../agent|from '../../domain/agent|g" {} \;

# ../config -> ../../infra/config
find src/adapter/mcp -name "*.ts" -exec sed -i '' "s|from '../config|from '../../infra/config|g" {} \;

# ============================================
# adapter/cli/* (depth 2 from src/)
# ============================================
echo "📦 Fixing adapter/cli imports..."

# ./types -> ../../types
find src/adapter/cli -name "*.ts" -exec sed -i '' "s|from './types'|from '../../types'|g" {} \;

# ============================================
# domain/* (depth 1 from src/)
# ============================================
echo "📦 Fixing domain imports..."

# ../config -> ../infra/config
find src/domain -name "*.ts" -exec sed -i '' "s|from '../config|from '../infra/config|g" {} \;

# ../utils/logger -> ../infra/observability/logger
find src/domain -name "*.ts" -exec sed -i '' "s|from '../utils/logger'|from '../infra/observability/logger'|g" {} \;

# ../feishu -> ../adapter/feishu
find src/domain -name "*.ts" -exec sed -i '' "s|from '../feishu|from '../adapter/feishu|g" {} \;

# ============================================
# domain/agent/* (depth 2 from src/)
# ============================================
echo "📦 Fixing domain/agent imports..."

# ../../config -> ../../infra/config
find src/domain/agent -maxdepth 1 -name "*.ts" -exec sed -i '' "s|from '../../config|from '../../infra/config|g" {} \;

# ../../utils -> ../../infra/...
find src/domain/agent -maxdepth 1 -name "*.ts" -exec sed -i '' "s|from '../../utils/logger'|from '../../infra/observability/logger'|g" {} \;

# ../persona -> ./persona
find src/domain/agent -maxdepth 1 -name "*.ts" -exec sed -i '' "s|from '../persona'|from './persona'|g" {} \;

# ../evolution -> ./evolution
find src/domain/agent -maxdepth 1 -name "*.ts" -exec sed -i '' "s|from '../evolution'|from './evolution'|g" {} \;

# ../goal -> ./goal
find src/domain/agent -maxdepth 1 -name "*.ts" -exec sed -i '' "s|from '../goal'|from './goal'|g" {} \;

# ============================================
# domain/session/* (depth 2 from src/)
# ============================================
echo "📦 Fixing domain/session imports..."

# ../app -> ../../app
find src/domain/session -name "*.ts" -exec sed -i '' "s|from '../app'|from '../../app'|g" {} \;

# ============================================
# domain/tools/* (depth 2 from src/)
# ============================================
echo "📦 Fixing domain/tools imports..."

# ../../utils/weather -> ./weather
find src/domain/tools -maxdepth 1 -name "*.ts" -exec sed -i '' "s|from '../../utils/weather'|from './weather'|g" {} \;

# ../../utils/holiday -> ./holiday
find src/domain/tools -maxdepth 1 -name "*.ts" -exec sed -i '' "s|from '../../utils/holiday'|from './holiday'|g" {} \;

# ../../utils/timezone -> ./timezone
find src/domain/tools -maxdepth 1 -name "*.ts" -exec sed -i '' "s|from '../../utils/timezone'|from './timezone'|g" {} \;

# ============================================
# app/* (depth 1 from src/)
# ============================================
echo "📦 Fixing app imports..."

# ../config -> ../infra/config
find src/app -name "*.ts" -exec sed -i '' "s|from '../config|from '../infra/config|g" {} \;

# ../services/session -> ../domain/session/service
find src/app -name "*.ts" -exec sed -i '' "s|from '../services/session'|from '../domain/session/service'|g" {} \;

# ============================================
# Fix providers access imports
# ============================================
echo "📦 Fixing providers imports..."

# Any file importing from providers should use the new location
find src -name "*.ts" -exec sed -i '' "s|from '\.\./providers'|from '../domain/providers'|g" {} \;
find src -name "*.ts" -exec sed -i '' "s|from '\.\./\.\./providers'|from '../../domain/providers'|g" {} \;

echo "✅ Import fixing complete!"
echo ""
echo "Running TypeScript check..."
bunx tsc --noEmit 2>&1 | grep -c "error TS" || echo "0 errors"
