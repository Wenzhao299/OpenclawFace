# OpenclawFace

Language / 语言: [中文](./README.md) | [English](./README_en.md)

OpenclawFace is an all-in-one OpenClaw plugin that provides:

1. A bidirectional WebSocket event bridge (`/ws`)
2. A real-time face UI (`/face`) that reflects OpenClaw runtime state
3. NOMI-style expression events (`action_play` / `thought`)
4. Weather input (prefer `weather.city`, fallback `lat/lon`)
5. Configurable debug visibility (`debug=true` shows status panels, hidden by default)

## Features

1. Reads OpenClaw runtime state in real time.
2. Character state switches automatically based on OpenClaw events (message/llm/tool, etc.).
3. Supports external manual expression triggering for debugging and validation.

## Requirements

1. OpenClaw Gateway
2. Node.js 18+ and npm

## Installation

1. Clone repository:

```bash
cd ~/.openclaw/workspace/plugin
git clone https://github.com/Wenzhao299/OpenclawFace.git
```

2. Install dependencies:

```bash
cd ~/.openclaw/workspace/plugin/OpenclawFace
npm i
```

3. Add plugin config into `~/.openclaw/openclaw.json` (see minimal config below).

4. Restart OpenClaw Gateway.

## openclaw.json Minimal Config

Merge the following snippet into `~/.openclaw/openclaw.json`:

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

Notes:

1. `weather.city` takes priority over `weather.lat/lon`.
2. If city resolution fails, plugin emits `weather_error` and falls back to coordinates.
3. When `debug=false`, top/bottom runtime status blocks are hidden by default; set `debug=true` to show them.

## Usage

1. Open UI:
`http://<host>:8787/face/`

2. If `token` is enabled:
`http://<host>:8787/face/?token=<token>`

3. WS endpoint:
`ws://<host>:8787/ws?token=<token>`

4. Debug visibility:
Set `config.debug` in `openclaw.json` (`true` to show status, `false` to hide).

## Protocol

Common message envelope:

```json
{
  "v": 1,
  "type": "ui",
  "name": "action_play",
  "ts": 1700000000000,
  "data": {}
}
```

Field meanings:

1. `v`: protocol version
2. `type`: event group (`gateway/session/message/agent/llm/tool/log/ui/expression`)
3. `name`: event name
4. `ts`: timestamp (milliseconds)
5. `ctx`: filtered context (optional)
6. `data`: event payload

## WS Events (Server -> Client)

Always emitted events:

1. `client_connected`
2. `client_disconnected`
3. `client_error`
4. `weather_update`
5. `weather_error`
6. `ui_interaction`
7. `action_play`
8. `thought`

OpenClaw hook events controlled by `events.allow`:

1. `message_received`, `message_sending`, `message_sent`
2. `llm_input`, `llm_output`
3. `before_tool_call`, `after_tool_call`
4. `before_agent_start`, `agent_end`, `subagent_spawning`, `subagent_spawned`, `subagent_ended`
5. `session_start`, `session_end`, `gateway_start`, `gateway_stop`

## Client Events (Client -> Server)

1. `ui_interaction`
2. `action_play`
3. `thought`

## Manual Testing Different States

### A. Fast test from browser console

Open `http://<host>:8787/face/?token=<token>`, then run:

```js
const ws = new WebSocket(`ws://${location.host}/ws?token=<token>`);
const send = (name, data) => ws.send(JSON.stringify({ v: 1, type: 'ui', name, ts: Date.now(), data }));
```

Then run these test actions:

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

### B. Trigger via OpenClaw runtime events

1. `listening`: `message_received` or pointer down/tap
2. `thinking`: `llm_input`
3. `tool`: `before_tool_call`
4. `speaking`: `message_sent`
5. `error`: `client_error` or `weather_error`
6. `idle`: default state or after temporary state timeout

### C. Weather input test

1. Set `"weather.city"` in plugin config.
2. Restart plugin.
3. Verify `weather_update` payload in WS stream.

## Troubleshooting

1. UI is not the latest:
Hard refresh (`Ctrl+F5`) at `http://<host>:8787/face/`, then check startup log:
`[openclaw-face] ui directory: .../OpenclawFace/ui`

2. Plugin is not loaded:
Ensure `plugins.entries` key is exactly `OpenclawFace` (must match manifest `id`).

3. WS cannot connect:
Check `bind/port/path/token` and firewall settings.

## Security Recommendations

1. Enable `token` when exposed on LAN.
2. Keep `includeMessageContent` and `includeToolParams` disabled unless required.

## License

See [LICENSE](./LICENSE).
