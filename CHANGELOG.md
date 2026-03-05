# Changelog

All notable changes to the project will be documented in this file.

## [1.1.0] - 2026-03-05

### Added
- **Session Recovery Feature** - 自动恢复未回复对话
  - 新增 `src/session/recovery.ts` - 核心恢复逻辑
  - 新增 `RecoveryConfig` 配置支持
  - 新增 `docs/session-recovery-guide.md` - 完整使用指南
  - 新增 `src/session/__tests__/recovery.test.ts` - 11个单元测试
  - 在 `initApp()` 中集成恢复逻辑
  - Bot 模式默认启用恢复功能
  - 支持 JSON 配置、环境变量禁用、代码级禁用

### Fixed
- **Critical Bug**: 修复 Bot 添加表情反应后重启，recovery 系统无法检测到未回复消息的问题
  - 问题：用户消息在 AI 生成响应后才保存到 session，导致重启时 session 为空
  - 解决：在调用 AI 之前立即保存用户消息，设置 `pendingRecovery` 标记
  - 效果：即使 Bot 在处理过程中重启，recovery 系统也能检测并恢复
- **Critical Bug**: 修复 Recovery 只发送通知消息，不发送 AI 响应的问题
  - 问题：Recovery 调用 `sendProactiveMessage` 生成响应后，只发送了"已重新处理"通知，没有发送实际响应
  - 解决：Recovery 显式发送 AI 生成的响应到 Feishu（使用 `sendPostMessage`）
  - 效果：用户能收到完整的 AI 处理结果，而不只是通知消息

### Changed
- **Session 消息保存时机优化**
  - 用户消息：在调用 AI 之前立即保存（recovery-ready）
  - Assistant 回复：AI 生成后保存
  - 图片消息：先保存占位符 `[图片] text [处理中...]`，AI 识别后更新为完整内容
- **Replay conversation history 优化**
  - 跳过最后一条用户消息（避免重复，因为 agent.chat() 会添加）
- **Recovery 检测逻辑增强**
  - 支持 `pendingRecovery` 标记
  - 对于标记的会话，忽略 `minAge` 限制（立即恢复）

### Features
- 智能检测未回复会话（时间窗口：10秒~5分钟）
- 批量处理避免过载
- Feishu 通道友好通知
- 详细日志输出
- 失败隔离（单个失败不影响其他）

### Configuration
```json
{
  "recovery": {
    "enabled": true,
    "maxAge": 300000,      // 5分钟
    "minAge": 10000,       // 10秒
    "channels": ["feishu"],
    "batchSize": 5,
    "delayMs": 2000,
    "startupDelay": 10000
  }
}
```

### Usage
```bash
# 默认启用（无需配置）
bun run bot --daemon

# 禁用恢复
export ENABLE_RECOVERY=false
bun run bot --daemon
```

### Test Coverage
- ✅ 10/10 单元测试通过
- ✅ 23 个断言全部通过
- ✅ 验证脚本 5/5 检查通过

### Documentation
- [Session Recovery Guide](./docs/session-recovery-guide.md)
- [Implementation Summary](./IMPLEMENTATION_SUMMARY.md)

### Breaking Changes
无破坏性更改。恢复功能默认启用，可通过配置禁用。

### Migration Guide
1. 无需迁移，2. 默认配置即可使用
3. 如需禁用，设置环境变量 `ENABLE_RECOVERY=false`

---

## [1.0.0] - Initial Release

- Core features: Multi-provider AI, Memory System, Skills, Subagents, Feishu Integration
- Self-evolution capabilities
