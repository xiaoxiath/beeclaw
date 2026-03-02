/**
 * Feishu Integration Example
 *
 * This example shows how to configure and use Feishu bot integration with Beeclaw.
 * Supports two modes:
 * 1. WebSocket (Long Connection) - Recommended, no public IP needed
 * 2. Webhook - Traditional mode, requires public domain
 */

// ============================================================
// Mode 1: WebSocket Long Connection (Recommended)
// ============================================================
/**
 * Advantages:
 * - No public IP or domain required
 * - No ngrok or port forwarding needed
 * - Encrypted transmission, no extra crypto handling
 * - 5-minute setup vs 1-week for webhook
 *
 * Configuration in beeclaw.config.json:
 *
 * {
 *   "feishu": {
 *     "enabled": true,
 *     "mode": "websocket",
 *     "appId": "cli_xxxxxxxxxxxx",
 *     "appSecret": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
 *     "logLevel": "error"
 *   }
 * }
 *
 * Code to initialize:
 *
 * import { loadConfig } from './config';
 * import { initProactiveApi, initFeishuWSIntegration } from './routes/proactive';
 *
 * async function main() {
 *   const config = await loadConfig();
 *
 *   // Initialize proactive API with AI provider
 *   const defaultProvider = config.providers.find(p => p.default);
 *   if (defaultProvider) {
 *     initProactiveApi({
 *       provider: defaultProvider,
 *       model: config.agents[0]?.model || 'glm-4',
 *       systemPrompt: config.agents[0]?.systemPrompt,
 *       useTools: true,
 *     });
 *   }
 *
 *   // Initialize Feishu WebSocket integration
 *   if (config.feishu?.enabled && config.feishu.mode === 'websocket') {
 *     await initFeishuWSIntegration(config.feishu);
 *   }
 * }
 */

// ============================================================
// Mode 2: Webhook (Traditional)
// ============================================================
/**
 * Requires:
 * - Public domain or ngrok
 * - Event subscription configuration in Feishu app
 *
 * Configuration in beeclaw.config.json:
 *
 * {
 *   "feishu": {
 *     "enabled": true,
 *     "mode": "webhook",
 *     "appId": "cli_xxxxxxxxxxxx",
 *     "appSecret": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
 *     "encryptKey": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
 *     "verificationToken": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
 *   }
 * }
 *
 * Code to initialize:
 *
 * import { initFeishuIntegration } from './routes/proactive';
 *
 * if (config.feishu?.enabled && config.feishu.mode === 'webhook') {
 *   initFeishuIntegration(config.feishu);
 * }
 */

// ============================================================
// Step 1: Create a Feishu App
// ============================================================
/**
 * 1. Go to Feishu Open Platform: https://open.feishu.cn/
 * 2. Create a new app (企业自建应用)
 * 3. Enable bot capability (机器人能力)
 * 4. Configure permissions:
 *    - im:message (获取与发送单聊、群组消息)
 *    - im:message:send_as_bot (以应用身份发送消息)
 *    - contact:user.base:readonly (获取用户基本信息)
 *
 * 5. Get credentials:
 *    - App ID (App ID)
 *    - App Secret (App Secret)
 */

// ============================================================
// Step 2: Configure Event Subscription (Webhook mode only)
// ============================================================
/**
 * For Webhook mode:
 * - Request URL: https://your-domain.com/api/proactive/feishu/webhook
 * - Subscribe to events: 接收消息 (im.message.receive_v1)
 *
 * For WebSocket mode:
 * - No event subscription configuration needed!
 * - Just configure appId and appSecret
 */

// ============================================================
// Step 3: Test the integration
// ============================================================
/**
 * WebSocket mode:
 * 1. Start Beeclaw: bun run src/index.ts
 * 2. Send a message to your bot in Feishu
 * 3. The bot should respond automatically
 *
 * Webhook mode (local testing with ngrok):
 * 1. Start ngrok: ngrok http 3000
 * 2. Copy the HTTPS URL to Feishu event subscription
 * 3. Start Beeclaw: bun run src/index.ts
 * 4. Send a message to your bot in Feishu
 */

// ============================================================
// API Endpoints (Webhook mode)
// ============================================================

/**
 * POST /api/proactive/message
 * Send a proactive message to a user
 *
 * Body: {
 *   "message": "Hello!",
 *   "userId": "user-open-id",
 *   "channel": "feishu"
 * }
 */

/**
 * POST /api/proactive/feishu/webhook
 * Feishu webhook endpoint (configured in Feishu app settings)
 *
 * Handles:
 * - URL verification (challenge response)
 * - Message events (receives and responds to messages)
 */

/**
 * GET /api/proactive/sessions
 * List active sessions
 */

// Export empty object for TypeScript compatibility
export {};
