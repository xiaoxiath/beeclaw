#!/bin/bash
# Final Cleanup Script - Remove SDK Dependencies

set -e

echo "=== Feishu SDK Cleanup Script ==="
echo ""

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 1. Remove SDK imports
echo "Step 1: Removing SDK imports..."
find src/adapter/feishu -name "*.ts" -type f -exec sh -c '
  for file; do
    if grep -q "@larksuiteoapi/node-sdk" "$file" 2>/dev/null; then
      echo "  - Cleaning $file"
      sed -i "" "/@larksuiteoapi\/node-sdk/d" "$file"
    fi
  done
' sh {} +

echo -e "${GREEN}✓ SDK imports removed${NC}"
echo ""

# 2. Remove SDK client files
echo "Step 2: Removing SDK client files..."
if [ -f "src/adapter/feishu/client.ts" ]; then
  mv src/adapter/feishu/client.ts src/adapter/feishu/client.ts.backup
  echo -e "${YELLOW}⚠ SDK client backed up to client.ts.backup${NC}"
fi

echo -e "${GREEN}✓ SDK client files handled${NC}"
echo ""

# 3. Update package.json
echo "Step 3: Checking package.json for SDK dependency..."
if grep -q "@larksuiteoapi/node-sdk" package.json; then
  echo -e "${YELLOW}⚠ Found @larksuiteoapi/node-sdk in package.json${NC}"
  echo "  Run: bun remove @larksuiteoapi/node-sdk"
else
  echo -e "${GREEN}✓ No SDK dependency in package.json${NC}"
fi
echo ""

# 4. Verify CLI runner imports
echo "Step 4: Verifying CLI runner imports..."
FILES_WITHOUT_CLI=$(find src/adapter/feishu/tools -name "*.ts" -type f -exec sh -c '
  for file; do
    if ! grep -q "FeishuCLIRunner" "$file" 2>/dev/null; then
      echo "$file"
    fi
  done
' sh {} +)

if [ -n "$FILES_WITHOUT_CLI" ]; then
  echo -e "${YELLOW}⚠ Files missing CLI runner import:${NC}"
  echo "$FILES_WITHOUT_CLI"
else
  echo -e "${GREEN}✓ All tool files have CLI runner imports${NC}"
fi
echo ""

# 5. Check for Client references
echo "Step 5: Checking for remaining Client references..."
CLIENT_REFS=$(find src/adapter/feishu/tools -name "*.ts" -type f -exec sh -c '
  for file; do
    if grep -q "client: Client" "$file" 2>/dev/null; then
      echo "$file"
    fi
  done
' sh {} +)

if [ -n "$CLIENT_REFS" ]; then
  echo -e "${RED}✗ Files still have Client parameter:${NC}"
  echo "$CLIENT_REFS"
  echo ""
  echo "Run the following commands to fix:"
  echo "$CLIENT_REFS" | while read file; do
    echo "  sed -i '' 's/client: Client/runner: FeishuCLIRunner/g' $file"
  done
else
  echo -e "${GREEN}✓ No Client parameters found${NC}"
fi
echo ""

# 6. Run tests
echo "Step 6: Running tests..."
if bun test src/adapter/feishu/__tests__/cli-runner.test.ts 2>&1 | grep -q "0 fail"; then
  echo -e "${GREEN}✓ CLI runner tests passing${NC}"
else
  echo -e "${RED}✗ CLI runner tests failing${NC}"
fi
echo ""

# 7. Summary
echo "=== Cleanup Summary ==="
echo ""
echo "Next steps:"
echo "1. Review and fix any files with Client references (see above)"
echo "2. Run: bun remove @larksuiteoapi/node-sdk"
echo "3. Update imports in any remaining files"
echo "4. Run full test suite: bun test"
echo "5. Commit changes"
echo ""
echo -e "${GREEN}✅ Cleanup script complete!${NC}"
