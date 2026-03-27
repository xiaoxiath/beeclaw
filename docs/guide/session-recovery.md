# 会话恢复

> 重启后自动恢复未完成的对话

## 概述

会话恢复功能确保 Beeclaw 在意外重启或崩溃后，能够自动恢复未完成的对话，提供连续的用户体验。

## 工作原理

1. **会话持久化**: 每个会话的消息历史存储在 `data/sessions/`
2. **状态跟踪**: 记录会话的完成状态
3. **自动恢复**: 启动时检测未完成会话并恢复

## 会话文件

```jsonl
{"role":"user","content":"帮我分析一下..."}
{"role":"assistant","content":"好的，我来分析..."}
{"role":"tool","name":"web_search","result":"..."}
```

## 配置

在 `beeclaw.json` 中配置：

```json
{
  "session": {
    "enabled": true,
    "recovery": {
      "enabled": true,
      "delay": 10000
    }
  }
}
```

### 参数说明

- `enabled`: 是否启用会话管理
- `recovery.enabled`: 是否启用恢复功能
- `recovery.delay`: 启动后延迟恢复时间（毫秒）

## 使用场景

### 1. 长时间任务
用户发起长时间任务（如深度研究），Beeclaw 意外重启后自动继续

### 2. 崩溃恢复
系统崩溃后，未回复的消息自动处理

### 3. 升级维护
版本升级后，保持对话连续性

## 最佳实践

1. **合理设置延迟**: 给系统足够的启动时间
2. **监控会话状态**: 定期检查 `data/sessions/`
3. **清理旧会话**: 删除已完成的旧会话文件
4. **备份重要会话**: 关键对话应备份

## 故障排查

### 会话未恢复
- 检查 `session.recovery.enabled` 是否为 true
- 查看启动日志是否有恢复记录
- 确认会话文件格式正确

### 重复回复
- 可能是会话 ID 不一致
- 检查消息去重逻辑

## 相关文档

- [飞书集成](./feishu-integration.md)
- [故障排查](../troubleshooting/README.md)
