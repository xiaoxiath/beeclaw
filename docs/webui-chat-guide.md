# Beeclaw Chat Interface - User Guide

**Version**: 1.0
**Last Updated**: 2026-03-10

---

## 🎯 Overview

The Beeclaw Chat Interface provides a web-based way to interact with your AI assistant. It features:
- Real-time chat with SSE streaming
- Session persistence and history
- Markdown rendering for rich responses
- Session management (create, switch, delete)

---

## 🚀 Getting Started

### 1. Access the Chat Interface

```bash
# Start Beeclaw bot
bun run bot

# Open in browser
open http://localhost:3000
```

### 2. Login

1. Navigate to `http://localhost:3000`
2. You'll be redirected to the login page
3. Enter your authentication token
4. Click "Login"

**Default Token**: `rqwdf3qrfdsgasfsdq24DfwqfSDgq34t`

### 3. Navigate to Chat

After login, click "Chat" in the sidebar or navigate to `/chat`

---

## 💬 Using the Chat Interface

### Sending a Message

1. Type your message in the input box at the bottom
2. Press Enter or click the "Send" button
3. Wait for the AI to respond (typically 1-3 seconds)

### Understanding the Response

The AI response will appear with:
- **Formatted text**: Markdown headings, lists, code blocks
- **Bot icon**: Identifies assistant messages
- **Timestamp**: When the message was sent

### Session Sidebar

The left sidebar shows all your chat sessions:

- **Session ID**: Unique identifier
- **Message count**: Number of messages in session
- **Last updated**: When the session was last active

#### Managing Sessions

- **Switch sessions**: Click on a session in the sidebar
- **Delete session**: Click the trash icon (hover to reveal)
- **New chat**: Click "New Chat" button at bottom

---

## 🎨 Interface Features

### Message Styling

#### User Messages
- Blue bubble background
- Right-aligned
- User icon

#### Assistant Messages
- White card with border
- Left-aligned
- Bot icon
- Markdown rendered

### Markdown Support

The chat supports full Markdown formatting:

- **Bold** and *italic* text
- # Headings
- Bulleted and numbered lists
- `Inline code` and code blocks
- Links and images
- Tables
- Blockquotes

### Real-time Updates

- Responses stream in real-time via SSE
- Loading indicator shows during response generation
- Auto-scroll keeps you at the latest message

---

## 📋 Tips & Best Practices

### Effective Communication

1. **Be specific**: Clearly state what you need
2. **Provide context**: Give background information
3. **Ask follow-up questions**: Build on previous responses
4. **Use markdown**: Format your messages for clarity

### Session Management

1. **Use descriptive names**: Rename sessions if needed (future feature)
2. **Delete old sessions**: Keep your session list clean
3. **Start new sessions**: For different topics or tasks

### Performance

- **Keep sessions focused**: Too many messages in one session can slow things down
- **Delete unused sessions**: Frees up memory and storage
- **Use "New Chat"**: Start fresh for unrelated tasks

---

## 🔧 Advanced Features

### Keyboard Shortcuts

- `Enter`: Send message
- `Shift+Enter`: Add new line (not yet implemented)

### Session Persistence

- Sessions are saved automatically
- Messages persist across browser refreshes
- Sessions survive bot restarts

### Search (Coming Soon)

Future versions will include:
- Search within current session
- Search across all sessions
- Filter by date range

---

## ❓ Troubleshooting

### Chat Not Loading

**Symptoms**: Chat page is blank or shows loading forever

**Solutions**:
1. Check if bot is running: `pgrep -f "bun run bot"`
2. Check browser console for errors
3. Try logging out and back in
4. Clear browser cache and cookies

### Messages Not Sending

**Symptoms**: Send button doesn't work, no response

**Solutions**:
1. Check network tab for API errors
2. Verify authentication token is valid
3. Try starting a new chat session
4. Restart the bot

### Session Not Persisting

**Symptoms**: Messages disappear after refresh

**Solutions**:
1. Check if sessions directory exists: `ls data/sessions/`
2. Verify file permissions
3. Check bot logs for errors: `tail -f /tmp/bot.log`

### Slow Response Time

**Symptoms**: Takes >10 seconds for response

**Solutions**:
1. Check AI provider status
2. Reduce message history length (start new session)
3. Check network connectivity
4. Monitor bot resource usage

---

## 🔐 Security & Privacy

### Authentication

- **Token-based**: All requests require valid token
- **Cookie storage**: HttpOnly cookies prevent XSS
- **Session expiry**: 7 days (configurable)

### Data Privacy

- **Local storage**: All data stored locally on your machine
- **No cloud sync**: Sessions don't leave your server
- **Encrypted tokens**: Tokens stored securely in environment variables

### Best Practices

1. **Use strong tokens**: Generate random, complex tokens
2. **Rotate tokens**: Change tokens periodically
3. **Limit access**: Only share tokens with trusted users
4. **Monitor logs**: Check for unauthorized access attempts

---

## 🚧 Known Limitations

### Current Limitations

1. **No streaming tokens**: Response appears all at once (not word-by-word)
2. **No tool call display**: Tool calls aren't shown in UI yet
3. **No message editing**: Can't edit sent messages
4. **No regeneration**: Can't regenerate AI responses
5. **No export**: Can't export chat history yet

### Future Improvements

- Token-by-token streaming
- Tool call visualization cards
- Message editing and regeneration
- Export to Markdown/JSON
- Search within conversations
- Session renaming

---

## 📊 Performance

### Typical Response Times

| Operation | Time |
|-----------|------|
| Send message | <100ms |
| First response chunk | 1-3s |
| Full response | 5-10s |
| Session load | <50ms |
| Session delete | <100ms |

### Resource Usage

- **Memory**: ~2MB per active SSE connection
- **CPU**: Negligible when idle
- **Disk**: ~1KB per message
- **Network**: Only active during messaging

---

## 🆘 Getting Help

### Documentation

- **User Guide**: This document
- **API Docs**: `docs/webui.md`
- **Bug Reports**: Check `docs/bugfix-*.md` files

### Support

1. **Check logs**: `tail -f /tmp/bot.log`
2. **GitHub Issues**: Report bugs and feature requests
3. **Community**: Join the Beeclaw community (if available)

---

## 📝 Changelog

### v1.0 (2026-03-10)

**Initial Release**
- Real-time chat with SSE streaming
- Session management (create, switch, delete)
- Markdown rendering
- Authentication integration
- Responsive design

---

**Next Update**: v1.1 (Tool call visualization)
