#!/bin/bash

# 飞书插件快速启动脚本
# 用法: ./scripts/start-with-feishu-plugin.sh

echo "🐝 Beeclaw - 启动飞书插件集成"
echo "================================"

# 1. 检查环境变量
echo ""
echo "📋 检查配置..."

if [ -z "$LARK_BEECLAW_APPID" ]; then
  echo "❌ 错误: LARK_BEECLAW_APPID 未设置"
  echo "请在 .env 文件中设置:"
  echo "  LARK_BEECLAW_APPID=cli_xxxxxxxxxxxxx"
  exit 1
fi

if [ -z "$LARK_BEECLAW_AS" ]; then
  echo "❌ 错误: LARK_BEECLAW_AS 未设置"
  echo "请在 .env 文件中设置:"
  echo "  LARK_BEECLAW_AS=your_app_secret"
  exit 1
fi

echo "✅ LARK_BEECLAW_APPID: ${LARK_BEECLAW_APPID:0:10}..."
echo "✅ LARK_BEECLAW_AS: ${LARK_BEECLAW_AS:0:10}..."

# 2. 检查插件目录
echo ""
echo "📁 检查插件目录..."

if [ ! -d "plugins/feishu-official" ]; then
  echo "❌ 错误: plugins/feishu-official 目录不存在"
  echo "请先创建插件"
  exit 1
fi

if [ ! -f "plugins/feishu-official/plugin.json" ]; then
  echo "❌ 错误: plugins/feishu-official/plugin.json 不存在"
  exit 1
fi

if [ ! -f "plugins/feishu-official/src/index.ts" ]; then
  echo "❌ 错误: plugins/feishu-official/src/index.ts 不存在"
  exit 1
fi

echo "✅ 插件目录完整"

# 3. 检查配置文件
echo ""
echo "📄 检查配置..."

if ! grep -q '"plugins"' beeclaw.json; then
  echo "⚠️  警告: beeclaw.json 中未找到 plugins 配置"
  echo "建议添加:"
  echo '  "plugins": { "enabled": true, "discovery": { "bundledDir": "./plugins" } }'
fi

echo "✅ 配置检查完成"

# 4. 启动 Bot
echo ""
echo "🚀 启动 Beeclaw Bot..."
echo ""

# 使用 PM2 启动（生产环境）
if command -v pm2 &> /dev/null; then
  echo "使用 PM2 启动..."
  bun run pm2:start

  echo ""
  echo "✅ Bot 已启动"
  echo ""
  echo "📊 查看状态:"
  echo "  bun run pm2:status"
  echo ""
  echo "📋 查看日志:"
  echo "  bun run pm2:logs"
  echo ""
  echo "🔍 监控 Feishu 插件:"
  echo "  tail -f logs/bot-out.log | grep -i feishu"
else
  echo "使用普通模式启动..."
  bun run bot --daemon

  echo ""
  echo "✅ Bot 已启动"
  echo ""
  echo "📋 查看日志:"
  echo "  tail -f logs/bot-out.log"
fi

echo ""
echo "================================"
echo "🎉 飞书插件已启动！"
echo ""
echo "💡 测试工具:"
echo "  bun run cli"
echo "  > feishu_send_message({chatId: 'test', message: 'hello'})"
echo ""
echo "📚 文档:"
echo "  - 使用指南: docs/feishu-plugin-usage-guide.md"
echo "  - 集成指南: docs/feishu-official-plugin-integration.md"
echo ""
