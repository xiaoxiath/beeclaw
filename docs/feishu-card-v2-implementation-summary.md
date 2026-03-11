# Feishu Card V2 Implementation Summary

## Overview

This document summarizes the implementation of Feishu Card Schema 2.0 streaming messages in Beeclaw.

**Implementation Date**: 2026-03-11
**Status**: Complete
**Test Coverage**: 125 tests passing

## What Was Implemented

### Phase 1: Core Infrastructure (Days 1-3) ✅

1. **ContentBlock Types** (`src/types/content-block.ts`)
   - Defined `ContentBlock` union type with Zod validation
   - Types: `ThinkingBlock`, `ToolUseBlock`, `ToolResultBlock`, `TextBlock`, `ImageBlock`
   - Helper functions for type guards and factory functions
   - Tests: 26 passing

2. **Card Schema 2.0 Types** (`src/feishu/card-v2/types/`)
   - `card.ts`: `Card`, `CardConfig`, `CardBody` types
   - `elements.ts`: `CollapsiblePanel`, `MarkdownElement`, `DivElement`, etc.
   - `styles.ts`: Color palette, icon tokens, text sizes
   - Tests: 16 passing

3. **ToolIconRegistry** (`src/feishu/card-v2/tool-icon-registry.ts`)
   - Maps 20+ Beeclaw tools to Feishu standard icons
   - Generates step descriptions from tool inputs
   - Extensible for custom tool icons
   - Tests: 21 passing

4. **MessageCardRenderer** (`src/feishu/card-v2/message-renderer.ts`)
   - Renders ContentBlocks to Card JSON
   - Creates collapsible step panels for tool calls
   - Supports streaming mode (expanded) and completion mode (collapsed)
   - Tests: 26 passing

### Phase 2: Streaming Controller (Days 4-6) ✅

5. **StreamingMessageController** (`src/feishu/card-v2/streaming-controller.ts`)
   - Manages streaming message lifecycle
   - Debounced updates (500ms default)
   - Handles message withdrawal errors (230011, 231003)
   - Tests: 17 passing

6. **FeishuWSClient Card Methods** (`src/feishu/ws-client.ts`)
   - `replyCard()`: Send initial card, returns message ID
   - `patchCard()`: Update existing card for streaming
   - Error handling for withdrawn messages
   - Tests: 14 passing

7. **Configuration** (`src/config/schema.ts`)
   - Added `useCardV2` option to `FeishuConfig`
   - Defaults to `false` for backward compatibility
   - Tests: 5 passing

### Phase 3: Agent Integration (Days 7-8) ✅

8. **Agent.chat() Callback** (`src/agent/index.ts`)
   - Added `onContentBlock` callback parameter
   - Generates `ToolUseBlock` when tools are called
   - Generates `TextBlock` for final response
   - Backward compatible (optional callback)

9. **Session Integration** (`src/session/index.ts`)
   - Creates `StreamingMessageController` when Card V2 enabled
   - Passes `onContentBlock` callback to Agent
   - Calls `finish()` after Agent completes
   - Handles errors and cleanup properly

### Phase 4: Channel and Testing (Days 9-10) ✅

10. **FeishuChannel Updates** (`src/channel/feishu.ts`)
    - Added comments explaining Card V2 bypasses channel
    - Card updates handled directly by StreamingMessageController
    - No breaking changes to existing functionality

11. **Documentation** (Various)
    - Updated `CLAUDE.md` with Card V2 section
    - Created configuration example doc
    - Created this implementation summary

## File Structure

```
src/
├── types/
│   ├── content-block.ts                    # [NEW] ContentBlock types
│   └── __tests__/content-block.test.ts     # [NEW] 26 tests
│
├── feishu/
│   ├── card-v2/                            # [NEW] Card V2 module
│   │   ├── types/
│   │   │   ├── card.ts                     # Card root structure
│   │   │   ├── elements.ts                 # Card elements
│   │   │   ├── styles.ts                   # Styling constants
│   │   │   └── index.ts                    # Types export
│   │   ├── tool-icon-registry.ts           # Tool icon mapping
│   │   ├── message-renderer.ts             # Render to Card JSON
│   │   ├── streaming-controller.ts         # Streaming lifecycle
│   │   ├── index.ts                        # Module export
│   │   └── __tests__/                      # 90 tests total
│   │       ├── card-v2.test.ts             # Card types tests
│   │       ├── tool-icon-registry.test.ts  # Registry tests
│   │       ├── message-renderer.test.ts    # Renderer tests
│   │       └── streaming-controller.test.ts # Controller tests
│   │
│   ├── ws-client.ts                        # [MODIFIED] Added Card methods
│   └── __tests__/
│       ├── config.test.ts                  # [NEW] Config tests (5)
│       └── ws-client-card.test.ts          # [NEW] Card methods tests (14)
│
├── agent/
│   └── index.ts                            # [MODIFIED] Added onContentBlock
│
├── session/
│   └── index.ts                            # [MODIFIED] Integrated streaming
│
├── channel/
│   └── feishu.ts                           # [MODIFIED] Added comments
│
└── config/
    └── schema.ts                           # [MODIFIED] Added useCardV2

docs/
└── feishu-card-v2-config.md                # [NEW] Configuration guide
```

## Test Summary

- **Total Tests**: 125
- **Passing**: 125 (100%)
- **Coverage Areas**:
  - ContentBlock types and validation
  - Card Schema 2.0 structure
  - Tool icon registry
  - Message rendering
  - Streaming controller lifecycle
  - FeishuWSClient Card methods
  - Configuration schema

## Key Design Decisions

1. **Debounced Updates**: 500ms default to avoid Feishu API rate limits
2. **Collapsible Panels**: Expanded during streaming, collapsed after completion
3. **Error Handling**: Graceful handling of message withdrawal (codes 230011, 231003)
4. **Backward Compatibility**: `useCardV2` defaults to `false`, existing code continues to work
5. **Separation of Concerns**: StreamingController bypasses FeishuChannel for direct FeishuWSClient access

## Performance Considerations

- **Debounce Interval**: 500ms (configurable)
- **Streaming Updates**: Only for Feishu + Card V2 enabled
- **Memory**: ContentBlocks accumulated in controller, cleared on finish
- **Network**: Patch API calls debounced to reduce API load

## Known Limitations

1. **Thread Support**: Not yet implemented (Card V2 supports threads, but Session doesn't use them yet)
2. **Custom Icons**: ToolIconRegistry extensible but requires code changes
3. **Error Display**: Tool errors shown but not highlighted differently (future enhancement)
4. **Image Support**: ImageBlock type defined but not fully integrated

## Future Enhancements

- [ ] Thread-based conversations (Card V2 supports threads)
- [ ] Custom Card templates (user-configurable styles)
- [ ] Tool execution time display (show duration per step)
- [ ] Error highlighting (red background for failed steps)
- [ ] Multi-language support (i18n for step descriptions)
- [ ] Image upload and display in cards

## Migration Guide

### For Users

1. Add `useCardV2: true` to `beeclaw.json` feishu config
2. Restart bot
3. Send message to Feishu bot
4. Observe streaming card updates

### For Developers

No code changes required unless you want to:

1. **Add custom tool icons**: Register in `ToolIconRegistry`
2. **Customize rendering**: Modify `MessageCardRenderer`
3. **Adjust debounce interval**: Pass `debounceMs` to `StreamingMessageController`

## References

- Feishu Card Schema 2.0 Documentation: https://open.feishu.cn/document/client-docs/bot-v3/card-v2/create
- Agentara Reference Implementation: https://github.com/MagicCube/agentara/tree/main/src/community/feishu/messaging
- Design Document: `docs/future/beeclaw-feishu-message-optimization.md`

## Conclusion

The Feishu Card V2 implementation provides a significantly improved user experience with:
- Real-time progress feedback
- Better markdown rendering
- Professional card-based UI
- Streaming updates

All 125 tests passing, code compiles cleanly, and backward compatibility maintained.
