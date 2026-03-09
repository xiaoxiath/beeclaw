# 用户配置

`user` 配置段用于配置用户相关的设置,包括地理位置、时区和语言环境。

## 配置示例

```json
{
  "user": {
    "location": "北京",
    "timezone": "Asia/Shanghai",
    "locale": "zh-CN"
  }
}
```

## 配置字段

### location (可选)

用户所在的地理位置(城市名称)。该字段用于:

- 自动推导时区信息
- 为天气和时间显示提供位置上下文
- 启用基于位置的功能

**示例值:**
- `"北京"`
- `"上海"`
- `"New York"`
- `"London"`
- `"Tokyo"`

### timezone (可选)

用户的时区(IANA 格式)。如果未指定,将从 `location` 字段使用天气 API 自动推导。

**示例值:**
- `"Asia/Shanghai"`
- `"America/New_York"`
- `"Europe/London"`
- `"Asia/Tokyo"`

**注意:** 如果同时配置了 `location` 和 `timezone`,则 `timezone` 配置优先级更高。

### locale (可选,默认: "zh-CN")

用户的语言环境设置。

**示例值:**
- `"zh-CN"` - 简体中文
- `"en-US"` - 美式英语
- `"ja-JP"` - 日语

## 优先级规则

### 位置解析优先级

1. `user.location` (最高优先级)
2. `weather.defaultLocation` (向后兼容)
3. 默认值: `"北京"`

### 时区解析优先级

1. `user.timezone` (最高优先级)
2. 从 `user.location` 自动推导
3. 默认值: `"Asia/Shanghai"`

## 通过对话更新设置

用户可以通过对话方式更新位置和时区设置。Beeclaw 提供了 `update_user_settings` 工具来支持这一功能。

**示例对话:**

```
用户: 请将我的位置设置为上海
AI: 好的,我来更新您的位置设置。
[调用 update_user_settings 工具]
✅ 位置已更新为: 上海
✅ 时区已更新为: Asia/Shanghai

配置已保存到 beeclaw.json 文件,重启后生效。
```

```
用户: 我现在在纽约,请更新我的时区
AI: 好的,我来更新您的位置和时区。
[调用 update_user_settings 工具]
✅ 位置已更新为: New York
✅ 时区已更新为: America/New_York

配置已保存到 beeclaw.json 文件,重启后生效。
```

## 运行时上下文

位置和时区信息会在系统提示的运行时上下文中显示,让 AI 了解用户的当前环境:

```
**Location**: 北京 | **Date**: 2026年3月6日 星期五 | **Time**: 15:30 | **Timezone**: Asia/Shanghai | **Beeclaw**: v0.2.0
```

## 启动时时区推导

如果配置了 `user.location` 但未配置 `user.timezone`,Beeclaw 会在启动时自动调用天气 API 推导时区并缓存。这个过程:

- 在应用初始化时异步执行
- 不会阻塞应用启动
- 推导结果会被缓存,运行时无需再次查询
- 如果推导失败,会使用默认时区 `"Asia/Shanghai"`

## 与天气功能的集成

如果配置了 `user.location`,天气功能会优先使用它来获取天气信息,而不是 `weather.defaultLocation`。这确保了位置信息的一致性。

## 配置文件示例

完整的配置文件示例:

```json
{
  "user": {
    "location": "北京",
    "locale": "zh-CN"
  },
  "weather": {
    "apiHost": "devapi.qweather.com",
    "apiKey": "${QWEATHER_API_KEY}",
    "defaultLocation": "北京"
  }
}
```

在这个示例中:
- `user.location` 设置为 "北京"
- `user.timezone` 未设置,会从 "北京" 自动推导为 "Asia/Shanghai"
- `weather.defaultLocation` 作为备用位置
