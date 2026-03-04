# System Prompt v2 Upgrade Record

## Upgrade Date
2026-03-04

## Version
From v1.x → v2.0

## Major Changes

### 1. Enhanced Identity Definition ✅
**Before:**
```
You are a helpful AI assistant with access to various tools.
```

**After:**
```
You are Beeclaw, an AI assistant that learns and evolves with every conversation.

Core Philosophy:
- Remember → Persist learnings across sessions
- Evolve → Improve from every interaction
- Proact → Initiate valuable communication
```

**Improvements:**
- More specific and unique identity
- Emphasizes core capabilities (memory, evolution, proactive)
- Sets clear behavioral expectations

---

### 2. Scenario-Based Tool Organization ✅
**Before:** Tools organized by type (Memory Tools, Skill Tools, Goal Tools)

**After:** Tools organized by usage scenarios:
- When User Shares Information
- When Task Is Repeated
- When User Corrects You
- When Proactive Outreach Is Valuable

**Improvements:**
- Reduces cognitive load
- Provides clear decision trees
- Shows "when to use what"

---

### 3. Mandatory Verification Rules ✅
**Before:** "Always check return value's `success` field"

**After:**
```
CRITICAL: Every Tool Call MUST Be Verified

Rule 1: Every Tool Call MUST Be Verified
Rule 2: No Assumptions
Rule 3: Verify with list/get/read
```

**Improvements:**
- Changed from "should" to "MUST"
- Provides concrete verification patterns
- Shows wrong vs right examples

---

### 4. Complete Decision Framework ✅
Added decision trees for common scenarios:

**Example - When User Shares Information:**
```
User says anything about themselves
  ↓
IMMEDIATELY ask: Is this worth remembering?
  ↓
IF yes → memory_record({key, value, category})
IF no → just acknowledge
```

**Improvements:**
- Clear decision logic
- Reduces tool selection errors
- Provides actionable guidance

---

### 5. Comprehensive Examples ✅
**Before:** Short examples with [Internally] placeholders

**After:** Complete examples with:
- Thinking process: `[Thinking: ...]`
- Action steps: `[Action: ...]`
- Verification: `[Verify: ...]`
- Result checking: `[Result: ...]`
- Error recovery: Shows retry and correction

**Improvements:**
- Shows complete workflow
- Demonstrates error handling
- Includes self-correction examples

---

### 6. Context Management Strategy ✅
Added clear guidance on what to load and when:

```
Session Start (Automatic):
  1. goal_list({state: "active"}) → remind user
  2. memory_read("facts/preferences.md") → load style
  3. STOP (don't load everything!)

What NOT to Load:
- ❌ All conversations (expensive)
- ❌ All facts (irrelevant)
- ❌ All skills (load on demand)
```

**Improvements:**
- Prevents context pollution
- Reduces token usage
- Improves performance

---

### 7. Error Handling Protocol ✅
Added structured error handling guidance:

```
Tool Failure Protocol:
1. READ error message carefully
2. ANALYZE: Wrong params? Missing context?
3. RETRY once with correction
4. IF still fails:
   - Inform user with specific error
   - Suggest alternative
   - Record failure: skill_record({success: false})
```

**Improvements:**
- Provides recovery strategy
- Shows concrete examples
- Ensures learning from failures

---

### 8. Positive Guidance Instead of Negative Constraints ✅
**Before:**
```
❌ Don't:
- Send generic messages without context
- Create tasks recursively
- Overwhelm user with too many messages
```

**After:**
```
Good timing:
- Before important event → reminder
- Goal progress check → weekly
- Morning (9 AM) → greeting with permission

Bad timing:
- Late night (after 10 PM)
- Too frequently (more than 5 times/day)
- Generic "hello" without value
```

**Improvements:**
- Shows what TO do, not just what NOT to do
- Provides concrete examples
- More constructive tone

---

## Three Prompt Versions

### default (Production)
- Complete guidance with all scenarios
- Comprehensive examples
- Full decision frameworks

### concise (Fast Response)
- Minimal guidance
- Quick reference format
- For simple tasks

### verbose (Complex Tasks)
- Detailed capability overview
- Full file structure documentation
- Extended guidelines

---

## Issues Fixed (From Analysis Document)

✅ **Problem 1:** Role definition too generic → Now specific and unique
✅ **Problem 2:** Tool guidance scattered → Organized by scenarios
✅ **Problem 3:** Examples not specific enough → Complete with thinking process
✅ **Problem 4:** Too many negative constraints → Positive guidance with examples
✅ **Problem 5:** Missing decision trees → Added clear decision frameworks
✅ **Problem 6:** Unclear priorities → Added CRITICAL markers and rule hierarchy
✅ **Problem 7:** Verification not enforced → Changed to MUST with examples
✅ **Problem 8:** No error handling guidance → Added structured protocol
✅ **Problem 9:** Reflection not automated → Added automatic triggers
✅ **Problem 10:** No context management → Added clear loading strategy

---

## Expected Improvements

### Error Rate Reduction
| Error Type | Before | After (Expected) |
|-----------|--------|------------------|
| Tool calls not verified | High | Low (Mandatory verification) |
| Reflections not recorded | High | Low (Automatic triggers) |
| Wrong tool selection | Medium | Low (Decision trees) |
| Context pollution | Medium | Low (Clear strategy) |

### User Experience
- ✅ More consistent AI behavior
- ✅ Fewer errors, faster recovery
- ✅ More obvious learning (user can see improvements)
- ✅ More natural interaction (scenario-based)

---

## Testing Recommendations

### Phase 1: Testing (1-2 weeks)
1. Deploy `concise` version first (lowest risk)
2. Monitor error rates and user feedback
3. Compare with v1 metrics

### Phase 2: Rollout (1-2 weeks)
1. Deploy `default` version for production
2. A/B test against v1
3. Collect quantitative metrics:
   - Tool verification rate
   - Recording rate after corrections
   - Context size reduction
   - User satisfaction

### Phase 3: Optimization (Ongoing)
1. Analyze failure cases
2. Iterate on prompt based on data
3. Update examples with real user interactions

---

## Monitoring Metrics

Track these metrics to measure improvement:

### Verification Metrics
- [ ] % of tool calls verified with list/get
- [ ] % of proactive operations verified
- [ ] Error detection rate (caught vs uncaught)

### Learning Metrics
- [ ] % of user corrections followed by recording
- [ ] Time from correction to recording
- [ ] Skill creation rate for repeated tasks

### Context Metrics
- [ ] Average context size (tokens)
- [ ] Context load time
- [ ] Unnecessary memory loads

### User Experience Metrics
- [ ] User satisfaction scores
- [ ] Task completion rate
- [ ] Error recovery success rate

---

## Rollback Plan

If issues arise:
1. Keep v1 prompts in backup
2. Can switch back via config change
3. No database migrations required
4. Zero downtime rollback

---

## Next Steps

1. ✅ Upgrade system prompts (Completed)
2. ⏳ Update tests to verify new behavior
3. ⏳ Deploy to staging environment
4. ⏳ Monitor and collect metrics
5. ⏳ Iterate based on feedback

---

## References

- [System Prompt Analysis](./system-prompt-analysis.md) - Detailed problem analysis
- [System Prompt v2 Example](./system-prompt-v2-example.md) - Example implementation
- [System Prompt Lessons](./system-prompt-lessons.md) - Production lessons learned
- [Proactive Capabilities Guide](./proactive-capabilities-guide.md) - Proactive system details

---

## Changelog

### v2.0 (2026-03-04)
- Complete rewrite of all three prompt versions
- Added decision frameworks and scenarios
- Mandatory verification rules
- Comprehensive examples with thinking process
- Error handling protocol
- Context management strategy

---

**Remember: Prompts are living documents. Continuous iteration based on real usage is key to improvement!**
