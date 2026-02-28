# OpenclawFace

## 项目介绍

OpenclawFace 是一个一体化的 OpenClaw 表情插件，用于把网关事件、UI 交互和表情动作统一到一个插件里，开箱即可通过浏览器访问。

核心功能：

1. 双向 WebSocket 事件桥（默认 `/ws`）
2. 内置 UI 页面托管（默认 `/face`）
3. 交互事件同步（鼠标/触摸 -> 统一 `ui_interaction`）
4. NOMI 风格表达事件（`action_play` / `thought`）
5. 天气驱动状态输入（`weather_update`）

## 安装步骤（从零开始）

1. 获取项目代码：

```bash
cd ~/.openclaw/workspace
git clone https://github.com/Wenzhao299/OpenclawFace.git OpenclawFace
```

2. 安装依赖：

```bash
cd ~/.openclaw/workspace/OpenclawFace
npm i
```

3. 在 `~/.openclaw/openclaw.json` 中配置 `plugins.load.paths` 和 `plugins.entries.OpenclawFace`（完整模板见下文）。

4. 重启 OpenClaw Gateway。

## 使用

1. 打开 UI：

`http://<host>:8787/face/`

2. 若设置了 `token`，使用：
`http://<host>:8787/face/?token=<token>`

3. （可选）直接连接 WS：
`ws://<host>:8787/ws`

## WS 协议格式

服务端和客户端都使用同一消息结构：

```json
{
  "v": 1,
  "type": "ui",
  "name": "ui_interaction",
  "ts": 1700000000000,
  "ctx": {},
  "data": {}
}
```

字段含义：

1. `v`: 协议版本（当前为 `1`）
2. `type`: 事件大类（`gateway/session/message/agent/llm/tool/log/ui/expression`）
3. `name`: 具体事件名
4. `ts`: 服务器事件时间戳（毫秒）
5. `ctx`: 经过 `fields.ctx` 过滤后的上下文字段
6. `data`: 事件数据（按 `fields.*` 和插件逻辑过滤）

## 可监听的 WS 事件与含义（Server -> Client）

### `gateway`

1. `client_connected`: 有客户端连接到 face WS。
2. `client_disconnected`: 某客户端断开连接。
3. `client_error`: 客户端发来的消息非法（JSON 格式、字段不合法等）。
4. `weather_update`: 天气更新（`kind/tempC/time/tz/code/cloudCover`）。
5. `weather_error`: 天气请求失败。
6. `gateway_start`: 网关启动（若在 `events.allow` 中启用）。
7. `gateway_stop`: 网关停止（若在 `events.allow` 中启用）。

### `session`

1. `session_start`: 会话启动。
2. `session_end`: 会话结束。

### `message`

1. `message_received`: 收到用户消息。
2. `message_sending`: 消息准备发送。
3. `message_sent`: 消息已发送。

### `llm`

1. `llm_input`: 进入模型推理阶段。
2. `llm_output`: 模型输出完成。

### `tool`

1. `before_tool_call`: 工具调用开始。
2. `after_tool_call`: 工具调用结束。

### `agent`

1. `before_agent_start`: agent 开始。
2. `agent_end`: agent 结束。
3. `subagent_spawning`: 子 agent 准备启动。
4. `subagent_spawned`: 子 agent 已启动。
5. `subagent_ended`: 子 agent 已结束。

### `ui`

1. `ui_interaction`: 统一后的交互事件（鼠标/触摸）。
2. `data.kind` 支持：`pointer_move/pointer_down/pointer_up/tap/hover/leave`。

### `expression`

1. `thought`: 思考气泡文本（可带 `mood`、`ttlMs`）。
2. `action_play`: 表情动作播放（如 `tap_ack/speak/tool_focus`）。

## 客户端可发送事件（Client -> Server）

### `ui_interaction`

1. 必填：`data.kind`
2. 可选：`x/y`（0..1）、`pointerType`、`button`、`pressure`、`clientTs`、`seq`

### `action_play`

1. 必填：`data.action`
2. 可选：`durationMs`、`intensity`、`style`、`source`

### `thought`

1. 必填：`data.text`
2. 可选：`ttlMs`、`mood`、`source`

## 过滤规则（events / fields）

1. `events.allow` 控制是否发出大部分 OpenClaw hook 事件。
2. `fields.*` 控制每类事件保留哪些字段。
3. 以下事件属于插件内置关键事件，始终会发出：
`client_connected/client_disconnected/client_error/weather_update/weather_error/ui_interaction/action_play/thought`
4. `includeMessageContent` 默认 `false`，不建议面板场景开启。
5. `includeToolParams` 默认 `false`，避免泄露工具参数与结果。

## openclaw.json 插件完整配置参考

把下面片段合并到你的 `~/.openclaw/openclaw.json`：

```json
{
  "plugins": {
    "load": {
      "paths": [
        "/your-path/.openclaw/workspace/OpenclawFace"
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
          "ui": {
            "enabled": true,
            "path": "/face",
            "defaultToUi": true
          },
          "events": {
            "allow": [
              "message_received",
              "message_sending",
              "message_sent",
              "llm_input",
              "llm_output",
              "before_tool_call",
              "after_tool_call",
              "before_agent_start",
              "agent_end",
              "session_start",
              "session_end",
              "subagent_spawning",
              "subagent_spawned",
              "subagent_ended",
              "gateway_start",
              "gateway_stop",
              "ui_interaction",
              "action_play",
              "thought",
              "weather_update",
              "weather_error"
            ]
          },
          "fields": {
            "ctx": [
              "sessionKey"
            ],
            "message": [
              "from",
              "timestamp"
            ],
            "llm_input": [
              "runId",
              "provider",
              "model"
            ],
            "llm_output": [
              "runId",
              "provider",
              "model",
              "usage"
            ],
            "tool": [
              "toolName",
              "durationMs",
              "error"
            ],
            "agent": [],
            "gateway": [
              "kind",
              "tempC",
              "time",
              "tz",
              "code",
              "cloudCover"
            ],
            "session": []
          },
          "includeMessageContent": false,
          "includeToolParams": false,
          "weather": {
            "enabled": true,
            "lat": 31.2304,
            "lon": 121.4737,
            "pollMs": 900000
          },
          "nomi": {
            "autoTouchReact": true,
            "thought": {
              "listening": "I'm listening.",
              "thinking": "Let me think..."
            }
          }
        }
      }
    }
  }
}
```

## 备注

1. UI 和 WS 共用一个 HTTP 服务和同一个端口。
2. 静态资源随插件发布（`ui/*` 和 `ui/vendor/pixi.min.js`）。
3. 入口键名必须与插件 id 一致：`OpenclawFace`。
