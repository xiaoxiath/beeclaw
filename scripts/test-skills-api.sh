#!/bin/bash

TOKEN="test-token-123"
BASE_URL="http://localhost:3000"

echo "🧪 Testing Beeclaw Web UI - Skills Management"
echo "==============================================="
echo ""

# Test 1: List skills
echo "1️⃣  Testing: List all skills..."
SKILLS=$(curl -s $BASE_URL/api/skills -H "Cookie: auth_token=$TOKEN")
TOTAL=$(echo $SKILLS | jq -r '.total')
BUILTIN=$(echo $SKILLS | jq -r '.builtin')
USER=$(echo $SKILLS | jq -r '.user')

if [ "$TOTAL" -gt 0 ]; then
  echo "   ✅ Skills listed successfully"
  echo "   📊 Total: $TOTAL | Built-in: $BUILTIN | User: $USER"
else
  echo "   ❌ No skills found"
fi
echo ""

# Test 2: Create skill
echo "2️⃣  Testing: Create new skill..."
CREATE_RESULT=$(curl -s -X POST $BASE_URL/api/skills \
  -H "Cookie: auth_token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-api-skill",
    "description": "Test skill from API",
    "content": "# Test Skill\n\nThis is a test.",
    "triggers": ["test", "api"],
    "maturity": "seed"
  }')

CREATE_SUCCESS=$(echo $CREATE_RESULT | jq -r '.skill.name // empty')
if [ "$CREATE_SUCCESS" = "test-api-skill" ]; then
  echo "   ✅ Skill created successfully"
  echo "   📝 Name: $CREATE_SUCCESS"
else
  echo "   ❌ Failed to create skill"
  echo $CREATE_RESULT | jq .
fi
echo ""

# Test 3: Get skill
echo "3️⃣  Testing: Get skill details..."
GET_RESULT=$(curl -s $BASE_URL/api/skills/test-api-skill \
  -H "Cookie: auth_token=$TOKEN")

GET_SUCCESS=$(echo $GET_RESULT | jq -r '.skill.name // empty')
if [ "$GET_SUCCESS" = "test-api-skill" ]; then
  echo "   ✅ Skill retrieved successfully"
  echo "   📄 Description: $(echo $GET_RESULT | jq -r '.skill.description')"
else
  echo "   ❌ Failed to get skill"
fi
echo ""

# Test 4: Update skill
echo "4️⃣  Testing: Update skill..."
UPDATE_RESULT=$(curl -s -X PUT $BASE_URL/api/skills/test-api-skill \
  -H "Cookie: auth_token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Updated test skill description",
    "maturity": "growing"
  }')

UPDATE_SUCCESS=$(echo $UPDATE_RESULT | jq -r '.skill.description // empty')
if [ "$UPDATE_SUCCESS" = "Updated test skill description" ]; then
  echo "   ✅ Skill updated successfully"
  echo "   📝 New description: $UPDATE_SUCCESS"
else
  echo "   ❌ Failed to update skill"
fi
echo ""

# Test 5: Toggle skill
echo "5️⃣  Testing: Toggle skill status..."
TOGGLE_RESULT=$(curl -s -X POST $BASE_URL/api/skills/test-api-skill/toggle \
  -H "Cookie: auth_token=$TOKEN")

TOGGLE_MSG=$(echo $TOGGLE_RESULT | jq -r '.message // empty')
if [ -n "$TOGGLE_MSG" ]; then
  echo "   ✅ Skill toggled successfully"
  echo "   🔄 $TOGGLE_MSG"
else
  echo "   ❌ Failed to toggle skill"
fi
echo ""

# Test 6: Toggle again (re-enable)
echo "6️⃣  Testing: Toggle skill back..."
TOGGLE_RESULT2=$(curl -s -X POST $BASE_URL/api/skills/test-api-skill/toggle \
  -H "Cookie: auth_token=$TOKEN")

TOGGLE_MSG2=$(echo $TOGGLE_RESULT2 | jq -r '.message // empty')
if [ -n "$TOGGLE_MSG2" ]; then
  echo "   ✅ Skill toggled back successfully"
  echo "   🔄 $TOGGLE_MSG2"
else
  echo "   ❌ Failed to toggle skill"
fi
echo ""

# Test 7: Delete skill
echo "7️⃣  Testing: Delete skill..."
DELETE_RESULT=$(curl -s -X DELETE $BASE_URL/api/skills/test-api-skill \
  -H "Cookie: auth_token=$TOKEN")

DELETE_SUCCESS=$(echo $DELETE_RESULT | jq -r '.success // false')
if [ "$DELETE_SUCCESS" = "true" ]; then
  echo "   ✅ Skill deleted successfully"
  echo "   🗑️  $(echo $DELETE_RESULT | jq -r '.message')"
else
  echo "   ❌ Failed to delete skill"
fi
echo ""

# Test 8: Verify deletion
echo "8️⃣  Testing: Verify skill deleted..."
VERIFY_RESULT=$(curl -s -o /dev/null -w "%{http_code}" $BASE_URL/api/skills/test-api-skill \
  -H "Cookie: auth_token=$TOKEN")

if [ "$VERIFY_RESULT" = "404" ]; then
  echo "   ✅ Skill successfully deleted (404 Not Found)"
else
  echo "   ❌ Skill still exists ($VERIFY_RESULT)"
fi
echo ""

echo "==============================================="
echo "✅ All Skills Management tests completed!"
echo ""
echo "🌐 Open http://localhost:3000/skills to manage skills in the UI"
echo "🔑 Login token: $TOKEN"
