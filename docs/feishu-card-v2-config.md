# Feishu Card V2 Configuration Example

This example shows how to enable Card Schema 2.0 for enhanced Feishu message experience with streaming updates.

## Configuration

Add the following to your `beeclaw.json`:

```json
{
  "feishu": {
    "enabled": true,
    "appId": "cli_a1b2c3d4e5f6g7h8",
    "appSecret": "your-app-secret-here",
    "logLevel": "error",
    "useCardV2": true
  }
}
```

## What Changes with Card V2

### Before (Traditional Mode)
```
User: Search for recent AI news

Bot: (30 seconds silence...)
     I found several recent AI news articles...
```

### After (Card V2 Mode)
```
User: Search for recent AI news

Bot: 🤖 Agent reasoning (3 steps) ▼
     1. 🔍 Searching for "recent AI news"
     2. 📄 Reading https://example.com/ai-news
     3. 🔍 Searching for "AI news 2026"

     ─────────────────────────

     I found several recent AI news articles...
     [Full markdown-formatted response with code blocks, tables, etc.]
```

## Features

1. **Real-time Progress**: See tool calls as they happen
2. **Collapsible Steps**: Tool panels collapse after completion
3. **Better Markdown**: Proper code highlighting, tables, lists
4. **Streaming Updates**: Card updates every 500ms during processing

## Disabling Card V2

To use traditional text messages instead:

```json
{
  "feishu": {
    "enabled": true,
    "appId": "...",
    "appSecret": "...",
    "useCardV2": false
  }
}
```

Or simply omit the `useCardV2` field (defaults to `false`).

## Implementation Details

When Card V2 is enabled:

1. **Session** creates `StreamingMessageController` for Feishu messages
2. **Agent** generates `ContentBlock` objects during execution
3. **Controller** debounces updates (500ms) to avoid API spam
4. **Renderer** converts blocks to Card Schema 2.0 JSON
5. **FeishuWSClient** sends initial card and patches updates

## Troubleshooting

### Cards not updating?
- Check Feishu API logs for rate limiting
- Verify `message.patch` API permissions
- Check console for "Message withdrawn" warnings

### Cards showing errors?
- Check for error codes 230011, 231003 (message withdrawn)
- Verify Card JSON schema is valid
- Check Feishu API documentation for schema changes

### Performance issues?
- Increase debounce interval (default 500ms)
- Check network latency to Feishu API
- Monitor memory usage with long conversations
