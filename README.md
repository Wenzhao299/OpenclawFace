# OpenclawFace

语言 / Language: [中文](./README.md) | [English](./README_en.md)

OpenclawFace 是一个一体化 OpenClaw 插件，提供：

1. 双向 WebSocket 事件桥（`/ws`）
2. 根据 OpenClaw 状态实时展示表情 UI（`/face`）
3. NOMI 风格表达事件（`action_play` / `thought`）
4. 天气输入（优先 `weather.city`，备选 `lat/lon`）
5. 可配置调试显示（`debug=true` 显示状态面板，默认隐藏）

## 功能特性

1. 获取 OpenClaw 实时状态。
2. 角色根据 OpenClaw 运行事件（message/llm/tool 等）自动切换状态。
3. 支持外部手动触发表情，便于调试和验收。

## 环境要求

1. OpenClaw Gateway
2. Node.js 18+ 与 npm

## 安装步骤

1. 克隆仓库：

```bash
cd ~/.openclaw/workspace/plugin
git clone https://github.com/Wenzhao299/OpenclawFace.git
```

2. 安装依赖：

```bash
cd ~/.openclaw/workspace/plugin/OpenclawFace
npm i
```

3. 将插件配置写入 `~/.openclaw/openclaw.json`（见下方最小配置）。

4. 重启 OpenClaw Gateway。

## openclaw.json 最小配置

将以下片段合并到 `~/.openclaw/openclaw.json`：

```json
{
  "plugins": {
    "load": {
      "paths": [
        "~/.openclaw/workspace/plugin/OpenclawFace"
      ]
    },
    "entries": {
      "OpenclawFace": {
        "enabled": true,
        "config": {
          "bind": "0.0.0.0",
          "port": 8787,
          "path": "/ws",
          "token": "replace-with-your-token",
          "debug": false,
          "ui": {
            "enabled": true,
            "path": "/face",
            "defaultToUi": true
          },
          "weather": {
            "enabled": true,
            "city": "Shanghai",
            "pollMs": 900000
          },
          "nomi": {
            "autoTouchReact": true
          }
        }
      }
    }
  }
}
```

说明：

1. `weather.city` 优先于 `weather.lat/lon`。
2. 城市解析失败时会发出 `weather_error`，并回退到经纬度。
3. `debug=false` 时 UI 顶部/底部状态信息默认隐藏；设为 `true` 可显示调试状态。

## 使用方式

1. 打开 UI：
`http://<host>:8787/face/`

2. 如果启用了 `token`：
`http://<host>:8787/face/?token=<token>`

3. WS 连接地址：
`ws://<host>:8787/ws?token=<token>`

4. Debug 显示开关：
在 `openclaw.json` 中设置 `config.debug`（`true` 显示状态，`false` 隐藏）。

## 协议结构

消息通用结构：

```json
{
  "v": 1,
  "type": "ui",
  "name": "action_play",
  "ts": 1700000000000,
  "data": {}
}
```

字段含义：

1. `v`: 协议版本
2. `type`: 事件分组（`gateway/session/message/agent/llm/tool/log/ui/expression`）
3. `name`: 事件名
4. `ts`: 时间戳（毫秒）
5. `ctx`: 过滤后的上下文（可选）
6. `data`: 事件数据

## WS 事件（Server -> Client）

始终会发出的事件：

1. `client_connected`
2. `client_disconnected`
3. `client_error`
4. `weather_update`
5. `weather_error`
6. `ui_interaction`
7. `action_play`
8. `thought`

受 `events.allow` 控制的 OpenClaw Hook 事件：

1. `message_received`, `message_sending`, `message_sent`
2. `llm_input`, `llm_output`
3. `before_tool_call`, `after_tool_call`
4. `before_agent_start`, `agent_end`, `subagent_spawning`, `subagent_spawned`, `subagent_ended`
5. `session_start`, `session_end`, `gateway_start`, `gateway_stop`

## 客户端可发送事件（Client -> Server）

1. `ui_interaction`
2. `action_play`
3. `thought`

## 手动测试不同状态

### A. 浏览器控制台快速测试

打开 `http://<host>:8787/face/?token=<token>`，执行：

```js
const ws = new WebSocket(`ws://${location.host}/ws?token=<token>`);
const send = (name, data) => ws.send(JSON.stringify({ v: 1, type: 'ui', name, ts: Date.now(), data }));
```

然后依次测试动作：

```js
send('action_play', { action: 'tap_ack', durationMs: 1400, intensity: 0.9 }); // listening
send('action_play', { action: 'tool_focus', durationMs: 1400, intensity: 0.8 }); // tool
send('action_play', { action: 'speak', durationMs: 1200, intensity: 0.9 }); // speaking
send('action_play', { action: 'happy', durationMs: 1600, intensity: 0.9 });
send('action_play', { action: 'angry', durationMs: 1600, intensity: 0.9 });
send('action_play', { action: 'sad', durationMs: 1800, intensity: 0.9 });
send('action_play', { action: 'sleep', durationMs: 2200, intensity: 0.9 });
send('thought', { text: 'Manual thought test', mood: 'thinking', ttlMs: 5000 });
```

### B. 通过 OpenClaw 运行事件触发

1. `listening`: `message_received` 或 pointer down/tap
2. `thinking`: `llm_input`
3. `tool`: `before_tool_call`
4. `speaking`: `message_sent`
5. `error`: `client_error` 或 `weather_error`
6. `idle`: 默认状态或临时状态超时后恢复

### C. 天气输入测试

1. 在插件配置中设置 `"weather.city"`。
2. 重启插件。
3. 在 WS 数据流中确认 `weather_update` 负载。

## 故障排查

1. UI 显示不是最新：
打开 `http://<host>:8787/face/` 后 `Ctrl+F5` 强刷，并检查启动日志是否打印：
`[openclaw-face] ui directory: .../OpenclawFace/ui`

2. 插件未加载：
确认 `plugins.entries` 的键名是 `OpenclawFace`（必须与 manifest 的 `id` 完全一致）。

3. WS 无法连接：
检查 `bind/port/path/token` 与网络防火墙配置。

## 安全建议

1. 局域网暴露时建议启用 `token`。
2. `includeMessageContent` 与 `includeToolParams` 默认关闭，建议保持默认。

## License

见 [LICENSE](./LICENSE)。
