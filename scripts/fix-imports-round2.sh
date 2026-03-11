#!/bin/bash
# Batch Import Fixer - Round 2
# Fixes imports in newly moved test files and other files

set -e

echo "🔧 Round 2: Fixing imports in moved files..."

# ============================================
# infra/resilience/__tests__ (depth 3)
# ============================================
echo "📦 Fixing infra/resilience/__tests__ imports..."

# ../circuit-breaker -> ../../circuit-breaker
find src/infra/resilience/__tests__ -name "*.test.ts" -exec sed -i '' "s|from '../circuit-breaker'|from '../../circuit-breaker'|g" {} \;
find src/infra/resilience/__tests__ -name "*.test.ts" -exec sed -i '' "s|from '../retry'|from '../../retry'|g" {} \;
find src/infra/resilience/__tests__ -name "*.test.ts" -exec sed -i '' "s|from '../retry-strategy'|from '../../retry-strategy'|g" {} \;
find src/infra/resilience/__tests__ -name "*.test.ts" -exec sed -i '' "s|from '../timeout-hierarchy'|from '../../timeout-hierarchy'|g" {} \;
find src/infra/resilience/__tests__ -name "*.test.ts" -exec sed -i '' "s|from '../loop-detector'|from '../../loop-detector'|g" {} \;

# ../error-handler -> ../../observability/error-handler
find src/infra/resilience/__tests__ -name "*.test.ts" -exec sed -i '' "s|from '../error-handler'|from '../../observability/error-handler'|g" {} \;

# ============================================
# infra/observability/__tests__ (depth 3)
# ============================================
echo "📦 Fixing infra/observability/__tests__ imports..."

find src/infra/observability/__tests__ -name "*.test.ts" -exec sed -i '' "s|from '../logger'|from '../../logger'|g" {} \;
find src/infra/observability/__tests__ -name "*.test.ts" -exec sed -i '' "s|from '../error-handler'|from '../../error-handler'|g" {} \;
find src/infra/observability/__tests__ -name "*.test.ts" -exec sed -i '' "s|from '../errors'|from '../../errors'|g" {} \;

# ============================================
# infra/utils/__tests__ (depth 3)
# ============================================
echo "📦 Fixing infra/utils/__tests__ imports..."

find src/infra/utils/__tests__ -name "*.test.ts" -exec sed -i '' "s|from '../budget-manager'|from '../../budget-manager'|g" {} \;

# ============================================
# domain/tools/__tests__ (depth 3)
# ============================================
echo "📦 Fixing domain/tools/__tests__ imports..."

find src/domain/tools/__tests__ -name "*.test.ts" -exec sed -i '' "s|from '../weather'|from '../../weather'|g" {} \;
find src/domain/tools/__tests__ -name "*.test.ts" -exec sed -i '' "s|from '../holiday'|from '../../holiday'|g" {} \;
find src/domain/tools/__tests__ -name "*.test.ts" -exec sed -i '' "s|from '../timezone'|from '../../timezone'|g" {} \;

# ============================================
# infra/db/store.ts (depth 2)
# ============================================
echo "📦 Fixing infra/db/store.ts imports..."

# ../memory -> ../../domain/memory
sed -i '' "s|from '../memory|from '../../domain/memory|g" src/infra/db/store.ts

# ../persona -> ../../domain/agent/persona
sed -i '' "s|from '../persona|from '../../domain/agent/persona|g" src/infra/db/store.ts

# ../goal -> ../../domain/agent/goal
sed -i '' "s|from '../goal|from '../../domain/agent/goal|g" src/infra/db/store.ts

# ../proactive -> ../../domain/proactive
sed -i '' "s|from '../proactive|from '../../domain/proactive|g" src/infra/db/store.ts

# ../skills -> ../../domain/skills
sed -i '' "s|from '../skills|from '../../domain/skills|g" src/infra/db/store.ts

# ============================================
# domain/search/providers/* (depth 3)
# ============================================
echo "📦 Fixing domain/search/providers imports..."

# ../types -> ../../types
find src/domain/search/providers -name "*.ts" -exec sed -i '' "s|from '../types'|from '../../types'|g" {} \;

# ../base -> ../../base
find src/domain/search/providers -name "*.ts" -exec sed -i '' "s|from '../base'|from '../../base'|g" {} \;

# ============================================
# Additional fixes for deep imports
# ============================================
echo "📦 Fixing additional deep imports..."

# Fix any remaining ../utils that should go to infra
find src/domain -name "*.ts" -exec sed -i '' "s|from '\.\./\.\./utils/logger'|from '../../infra/observability/logger'|g" {} \;
find src/domain -name "*.ts" -exec sed -i '' "s|from '\.\./\.\./utils/|from '../../infra/utils/|g" {} \;

# Fix types imports
find src/adapter -name "*.ts" -exec sed -i '' "s|from '\.\./\.\./types/|from '../../types/|g" {} \;

echo "✅ Round 2 import fixing complete!"
echo ""
echo "Running TypeScript check..."
bunx tsc --noEmit 2>&1 | grep -c "error TS" || echo "0"
