import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

type WeatherKind = "clear" | "cloudy" | "rain" | "snow" | "fog";
type FaceEventType = "gateway" | "session" | "message" | "agent" | "llm" | "tool" | "log" | "ui" | "expression";

type FaceEvent = {
  v: 1;
  type: FaceEventType;
  name: string;
  ts: number;
  ctx?: Record<string, unknown>;
  data?: Record<string, unknown>;
};

type ClientMessage = {
  v?: number;
  type?: string;
  name?: string;
  ts?: number;
  data?: Record<string, unknown>;
};

const VERSION = 1 as const;
const STATE_KEY = "__openclawFaceWsState";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(__dirname, "ui");
const UI_INDEX_PLACEHOLDER = "__OPENCLAW_FACE_CONFIG__";

const ALWAYS_EMIT_EVENTS = new Set([
  "client_connected",
  "client_disconnected",
  "client_error",
  "weather_update",
  "weather_error",
  "ui_interaction",
  "action_play",
  "thought",
]);

const UI_INTERACTION_KINDS = new Set(["pointer_move", "pointer_down", "pointer_up", "tap", "hover", "leave"]);
const AUTO_TOUCH_THOUGHTS = [
  "Hello.",
  "I noticed you.",
  "I am right here.",
  "Nice to see you.",
  "Let's keep going.",
];

function now() {
  return Date.now();
}

function safeJson(data: unknown) {
  try {
    return JSON.stringify(data);
  } catch {
    return JSON.stringify({ v: VERSION, type: "log", name: "json_error", ts: now() } satisfies FaceEvent);
  }
}

function pickRandom(list: string[]) {
  if (!Array.isArray(list) || list.length === 0) return "";
  return list[Math.floor(Math.random() * list.length)] ?? "";
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeHttpPath(input: unknown, fallback: string) {
  const raw = typeof input === "string" && input.trim() ? input.trim() : fallback;
  let out = raw.startsWith("/") ? raw : `/${raw}`;
  out = out.replace(/\/{2,}/g, "/");
  if (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

function contentTypeFor(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

function toFiniteNumber(input: unknown): number | undefined {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string") {
    const n = Number(input);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function toBoundedString(input: unknown, maxLen = 80): string | undefined {
  if (typeof input !== "string") return undefined;
  const text = input.trim();
  if (!text) return undefined;
  return text.slice(0, maxLen);
}

function pickFields(obj: any, allow: string[] | undefined): Record<string, unknown> | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  if (!allow || allow.length === 0) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of allow) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return Object.keys(out).length ? out : undefined;
}

function toCtx(obj: any, allow: string[] | undefined): Record<string, unknown> | undefined {
  return pickFields(obj, allow);
}

function normalizeClientRaw(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  if (ArrayBuffer.isView(raw)) return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString("utf8");
  return undefined;
}

function normalizeUiInteraction(data: Record<string, unknown>, clientId: string) {
  const kind = toBoundedString(data.kind, 24);
  if (!kind || !UI_INTERACTION_KINDS.has(kind)) return undefined;

  const payload: Record<string, unknown> = {
    kind,
    clientId,
    source: toBoundedString(data.source, 24) ?? "ui",
  };

  const x = toFiniteNumber(data.x);
  const y = toFiniteNumber(data.y);
  if (x !== undefined) payload.x = clamp(x, 0, 1);
  if (y !== undefined) payload.y = clamp(y, 0, 1);

  const pointerType = toBoundedString(data.pointerType, 16);
  if (pointerType) payload.pointerType = pointerType;

  const button = toFiniteNumber(data.button);
  if (button !== undefined) payload.button = Math.round(button);

  const pressure = toFiniteNumber(data.pressure);
  if (pressure !== undefined) payload.pressure = clamp(pressure, 0, 1);

  const clientTs = toFiniteNumber(data.clientTs);
  if (clientTs !== undefined) payload.clientTs = Math.round(clientTs);

  const seq = toFiniteNumber(data.seq);
  if (seq !== undefined) payload.seq = Math.round(seq);

  return payload;
}

function normalizeActionPlay(data: Record<string, unknown>, clientId: string) {
  const action = toBoundedString(data.action, 48);
  if (!action) return undefined;

  const durationMs = clamp(Math.round(toFiniteNumber(data.durationMs) ?? 900), 120, 12000);
  const intensity = clamp(toFiniteNumber(data.intensity) ?? 0.85, 0, 1);

  const payload: Record<string, unknown> = {
    action,
    durationMs,
    intensity,
    clientId,
    source: toBoundedString(data.source, 24) ?? "ui",
  };

  const style = toBoundedString(data.style, 24);
  if (style) payload.style = style;

  return payload;
}

function normalizeThought(data: Record<string, unknown>, clientId: string) {
  const text = toBoundedString(data.text, 180);
  if (!text) return undefined;

  const ttlMs = clamp(Math.round(toFiniteNumber(data.ttlMs) ?? 1800), 300, 15000);

  const payload: Record<string, unknown> = {
    text,
    ttlMs,
    clientId,
    source: toBoundedString(data.source, 24) ?? "ui",
  };

  const mood = toBoundedString(data.mood, 24);
  if (mood) payload.mood = mood;

  return payload;
}

// OpenClaw loads TS via jiti. Keep dependencies pure JS/TS.
export default function register(api: any) {
  const pluginCfg = (api.pluginConfig ?? {}) as {
    enabled?: boolean;
    bind?: string;
    port?: number;
    path?: string;
    token?: string;
    includeMessageContent?: boolean;
    includeToolParams?: boolean;
    events?: { allow?: string[] };
    fields?: {
      ctx?: string[];
      message?: string[];
      llm_input?: string[];
      llm_output?: string[];
      tool?: string[];
      agent?: string[];
      gateway?: string[];
      session?: string[];
    };
    weather?: {
      enabled?: boolean;
      lat?: number;
      lon?: number;
      pollMs?: number;
    };
    ui?: {
      enabled?: boolean;
      path?: string;
      defaultToUi?: boolean;
    };
    nomi?: {
      autoTouchReact?: boolean;
      thought?: {
        listening?: string;
        thinking?: string;
      };
    };
  };

  api.registerService({
    id: "openclaw-face-ws",
    start: async (ctx: any) => {
      if (pluginCfg.enabled === false) {
        ctx.logger.info("[openclaw-face] disabled");
        return;
      }

      const bind = pluginCfg.bind ?? "127.0.0.1";
      const port = pluginCfg.port ?? 8787;
      const wsPath = normalizeHttpPath(pluginCfg.path, "/ws");
      const token = (pluginCfg.token ?? "").trim() || undefined;
      const uiCfg = pluginCfg.ui ?? {};
      const uiEnabled = uiCfg.enabled !== false;
      const uiPathCandidate = normalizeHttpPath(uiCfg.path, "/face");
      const uiPath = uiPathCandidate === "/" ? "/face" : uiPathCandidate;

      const nomiCfg = pluginCfg.nomi ?? {};
      const autoTouchReact = nomiCfg.autoTouchReact !== false;
      const thoughtListening = nomiCfg.thought?.listening?.trim() || "I'm listening.";
      const thoughtThinking = nomiCfg.thought?.thinking?.trim() || "Let me think...";

      const server = http.createServer((req, res) => {
        const respond = (status: number, body: string) => {
          res.statusCode = status;
          res.setHeader("content-type", "text/plain; charset=utf-8");
          res.end(body);
        };

        const serveIndex = async (pathname: string) => {
          try {
            const htmlRaw = await fs.promises.readFile(path.join(UI_DIR, "index.html"), "utf8");
            const html = htmlRaw.replace(
              UI_INDEX_PLACEHOLDER,
              safeJson({
                wsPath,
              }),
            );
            res.statusCode = 200;
            res.setHeader("content-type", "text/html; charset=utf-8");
            res.setHeader("cache-control", "no-cache");
            res.end(html);
          } catch {
            respond(500, `openclaw-face ui missing: ${pathname}\n`);
          }
        };

        const serveStatic = async (pathname: string) => {
          const rel = pathname.slice(uiPath.length + 1);
          const safeRel = path.posix.normalize(rel).replace(/^\/+/, "");
          if (!safeRel || safeRel.startsWith("..")) {
            respond(403, "forbidden\n");
            return;
          }

          const abs = path.join(UI_DIR, safeRel);
          if (!abs.startsWith(UI_DIR)) {
            respond(403, "forbidden\n");
            return;
          }

          try {
            const stat = await fs.promises.stat(abs);
            if (!stat.isFile()) {
              respond(404, "not found\n");
              return;
            }
            const buf = await fs.promises.readFile(abs);
            res.statusCode = 200;
            res.setHeader("content-type", contentTypeFor(abs));
            res.setHeader("cache-control", "public, max-age=600");
            res.end(buf);
          } catch {
            respond(404, "not found\n");
          }
        };

        void (async () => {
          try {
            const host = req.headers.host || "localhost";
            const url = new URL(req.url ?? "/", `http://${host}`);
            const pathname = decodeURIComponent(url.pathname || "/");

            if (uiEnabled && uiCfg.defaultToUi !== false && pathname === "/") {
              res.statusCode = 302;
              res.setHeader("location", `${uiPath}/`);
              res.end();
              return;
            }

            if (uiEnabled && (pathname === uiPath || pathname === `${uiPath}/`)) {
              await serveIndex(pathname);
              return;
            }

            if (uiEnabled && pathname.startsWith(`${uiPath}/`)) {
              await serveStatic(pathname);
              return;
            }

            respond(
              200,
              [
                "openclaw-face ws/ui server",
                `ws: ${wsPath}`,
                uiEnabled ? `ui: ${uiPath}` : "ui: disabled",
                "",
              ].join("\n"),
            );
          } catch (e) {
            respond(500, e instanceof Error ? `${e.message}\n` : "internal error\n");
          }
        })();
      });

      const wss = new WebSocketServer({ noServer: true });
      const clients = new Set<any>();

      let clientSeq = 0;

      // cache state so reconnect can restore visual continuity quickly
      let lastWeatherRaw: Record<string, unknown> | undefined;
      let lastUiInteractionRaw: Record<string, unknown> | undefined;
      let lastActionRaw: Record<string, unknown> | undefined;
      let lastThoughtRaw: Record<string, unknown> | undefined;

      function sendTo(ws: any, ev: FaceEvent) {
        if (ws.readyState === ws.OPEN) ws.send(safeJson(ev));
      }

      function broadcast(ev: FaceEvent) {
        const payload = safeJson(ev);
        for (const ws of clients) {
          if (ws.readyState === ws.OPEN) ws.send(payload);
        }
      }

      const allowEvents = new Set<string>(pluginCfg.events?.allow ?? []);

      const fields = {
        ctx: pluginCfg.fields?.ctx ?? ["sessionKey"],
        message: pluginCfg.fields?.message ?? ["from", "timestamp"],
        llm_input: pluginCfg.fields?.llm_input ?? ["runId", "provider", "model"],
        llm_output: pluginCfg.fields?.llm_output ?? ["runId", "provider", "model", "usage"],
        tool: pluginCfg.fields?.tool ?? ["toolName", "durationMs", "error"],
        agent: pluginCfg.fields?.agent ?? [],
        gateway: pluginCfg.fields?.gateway ?? [],
        session: pluginCfg.fields?.session ?? [],
      };

      function shouldEmit(name: string) {
        if (ALWAYS_EMIT_EVENTS.has(name)) return true;
        // If allowlist is empty/undefined, keep backward-compatible behavior: emit everything.
        if (!pluginCfg.events?.allow || pluginCfg.events.allow.length === 0) return true;
        return allowEvents.has(name);
      }

      async function fetchWeather(lat: number, lon: number) {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,cloud_cover&timezone=Asia%2FShanghai`;
        return await new Promise<any>((resolve, reject) => {
          const req = https.get(url, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c) => chunks.push(Buffer.from(c)));
            res.on("end", () => {
              try {
                const text = Buffer.concat(chunks).toString("utf8");
                resolve(JSON.parse(text));
              } catch (e) {
                reject(e);
              }
            });
          });
          req.on("error", reject);
          req.end();
        });
      }

      function mapWeather(code: number, cloudCover?: number): WeatherKind {
        // Open-Meteo weather codes: https://open-meteo.com/en/docs
        if (code === 0) return "clear";
        if (code === 1 || code === 2) return "cloudy";
        if (code === 3) return "cloudy";
        if (code === 45 || code === 48) return "fog";
        if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
        if (code >= 71 && code <= 77) return "snow";
        if (code >= 85 && code <= 86) return "snow";
        // fallback by clouds
        if (typeof cloudCover === "number" && cloudCover >= 70) return "cloudy";
        return "clear";
      }

      function emit(
        type: FaceEventType,
        name: string,
        rawData?: Record<string, unknown>,
        hookCtx?: any,
        targetWs?: any,
      ) {
        if (!shouldEmit(name)) return;

        const group =
          type === "message"
            ? "message"
            : type === "llm"
              ? name
              : type === "tool"
                ? "tool"
                : type === "agent"
                  ? "agent"
                  : type === "gateway"
                    ? "gateway"
                    : type === "session"
                      ? "session"
                      : undefined;

        let data: Record<string, unknown> | undefined;
        if (rawData && typeof rawData === "object") {
          if (ALWAYS_EMIT_EVENTS.has(name)) data = rawData;
          else if (group === "message") data = pickFields(rawData, fields.message);
          else if (group === "tool") data = pickFields(rawData, fields.tool);
          else if (group === "agent") data = pickFields(rawData, fields.agent);
          else if (group === "gateway") data = pickFields(rawData, fields.gateway);
          else if (group === "session") data = pickFields(rawData, fields.session);
          else if (name === "llm_input") data = pickFields(rawData, fields.llm_input);
          else if (name === "llm_output") data = pickFields(rawData, fields.llm_output);
          else data = rawData;
        }

        const ev: FaceEvent = {
          v: VERSION,
          type,
          name,
          ts: now(),
          ctx: toCtx(hookCtx, fields.ctx),
          data,
        };

        if (targetWs) {
          sendTo(targetWs, ev);
          return;
        }
        broadcast(ev);
      }

      function clientError(ws: any, reason: string) {
        emit("gateway", "client_error", { reason }, undefined, ws);
      }

      function handleClientMessage(ws: any, raw: unknown) {
        const text = normalizeClientRaw(raw);
        if (!text) {
          clientError(ws, "unsupported_payload");
          return;
        }

        let msg: ClientMessage;
        try {
          msg = JSON.parse(text);
        } catch {
          clientError(ws, "invalid_json");
          return;
        }

        if (!msg || typeof msg !== "object") {
          clientError(ws, "invalid_message");
          return;
        }

        const name = typeof msg.name === "string" ? msg.name : "";
        const data = msg.data && typeof msg.data === "object" ? msg.data : {};
        const clientId = ws.__faceClientId ?? "client_unknown";

        if (name === "ui_interaction") {
          const payload = normalizeUiInteraction(data, clientId);
          if (!payload) {
            clientError(ws, "invalid_ui_interaction");
            return;
          }

          lastUiInteractionRaw = payload;
          emit("ui", "ui_interaction", payload);

          if (autoTouchReact && (payload.kind === "pointer_down" || payload.kind === "tap")) {
            const thought = {
              text: pickRandom(AUTO_TOUCH_THOUGHTS) || "Hello.",
              mood: "warm",
              ttlMs: 5000,
              source: "auto_touch",
              clientId,
            };
            const action = {
              action: "tap_ack",
              durationMs: 1400,
              intensity: 0.9,
              source: "auto_touch",
              clientId,
            };
            lastThoughtRaw = thought;
            lastActionRaw = action;
            emit("expression", "thought", thought);
            emit("expression", "action_play", action);
          }
          return;
        }

        if (name === "action_play") {
          const payload = normalizeActionPlay(data, clientId);
          if (!payload) {
            clientError(ws, "invalid_action_play");
            return;
          }
          lastActionRaw = payload;
          emit("expression", "action_play", payload);
          return;
        }

        if (name === "thought") {
          const payload = normalizeThought(data, clientId);
          if (!payload) {
            clientError(ws, "invalid_thought");
            return;
          }
          lastThoughtRaw = payload;
          emit("expression", "thought", payload);
          return;
        }

        clientError(ws, `unsupported_message:${name || "unknown"}`);
      }

      server.on("upgrade", (req, socket, head) => {
        try {
          const host = req.headers.host || "localhost";
          const url = new URL(req.url ?? "", `http://${host}`);
          if (url.pathname !== wsPath) {
            socket.destroy();
            return;
          }
          if (token && url.searchParams.get("token") !== token) {
            socket.destroy();
            return;
          }

          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
          });
        } catch {
          socket.destroy();
        }
      });

      wss.on("connection", (ws) => {
        const clientId = `client_${++clientSeq}`;
        ws.__faceClientId = clientId;
        clients.add(ws);

        sendTo(
          ws,
          {
            v: VERSION,
            type: "gateway",
            name: "client_connected",
            ts: now(),
            data: { clients: clients.size, clientId },
          } satisfies FaceEvent,
        );

        // replay last known context to this one client only
        if (lastWeatherRaw) emit("gateway", "weather_update", lastWeatherRaw, undefined, ws);
        if (lastUiInteractionRaw) emit("ui", "ui_interaction", lastUiInteractionRaw, undefined, ws);
        if (lastActionRaw) emit("expression", "action_play", lastActionRaw, undefined, ws);
        if (lastThoughtRaw) emit("expression", "thought", lastThoughtRaw, undefined, ws);

        ws.on("message", (raw: unknown) => {
          handleClientMessage(ws, raw);
        });

        ws.on("close", () => {
          clients.delete(ws);
          emit("gateway", "client_disconnected", { clients: clients.size, clientId });
        });
      });

      server.listen(port, bind, () => {
        ctx.logger.info(`[openclaw-face] ws listening on ws://${bind}:${port}${wsPath}`);
        if (uiEnabled) {
          ctx.logger.info(`[openclaw-face] ui available at http://${bind}:${port}${uiPath}/`);
        }
      });

      // ---- Weather polling (panel-friendly env event)
      const weatherCfg = pluginCfg.weather ?? {};
      const weatherEnabled = weatherCfg.enabled !== false;
      const weatherLat = weatherCfg.lat ?? 31.2304;
      const weatherLon = weatherCfg.lon ?? 121.4737;
      const weatherPollMs = Math.max(60000, weatherCfg.pollMs ?? 900000);
      let weatherTimer: NodeJS.Timeout | undefined;

      async function tickWeather() {
        try {
          const json = await fetchWeather(weatherLat, weatherLon);
          const cur = json?.current;
          if (!cur) return;
          const kind = mapWeather(cur.weather_code, cur.cloud_cover);
          const payload = {
            kind,
            code: cur.weather_code,
            tempC: cur.temperature_2m,
            cloudCover: cur.cloud_cover,
            // Open-Meteo uses ISO timestamps
            time: cur.time,
            tz: json?.timezone,
          };
          lastWeatherRaw = payload;
          emit("gateway", "weather_update", payload);
        } catch (e) {
          emit("gateway", "weather_error", {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      if (weatherEnabled) {
        void tickWeather();
        weatherTimer = setInterval(tickWeather, weatherPollMs);
      }

      // ---- Typed plugin hooks
      api.on("gateway_start", (event: any) => emit("gateway", "gateway_start", event));
      api.on("gateway_stop", (event: any) => emit("gateway", "gateway_stop", event));

      api.on("session_start", (event: any, hookCtx: any) => emit("session", "session_start", event, hookCtx));
      api.on("session_end", (event: any, hookCtx: any) => emit("session", "session_end", event, hookCtx));

      api.on("message_received", (event: any, hookCtx: any) => {
        const data: any = { ...event };
        if (!pluginCfg.includeMessageContent) delete data.content;
        emit("message", "message_received", data, hookCtx);

        const thought = {
          text: thoughtListening,
          mood: "listening",
          ttlMs: 5000,
          source: "hook",
        };
        lastThoughtRaw = thought;
        emit("expression", "thought", thought, hookCtx);
      });

      api.on("message_sending", (event: any, hookCtx: any) => {
        const data: any = { ...event };
        if (!pluginCfg.includeMessageContent) delete data.content;
        emit("message", "message_sending", data, hookCtx);
      });

      api.on("message_sent", (event: any, hookCtx: any) => {
        const data: any = { ...event };
        if (!pluginCfg.includeMessageContent) delete data.content;
        emit("message", "message_sent", data, hookCtx);

        const action = {
          action: "speak",
          durationMs: 900,
          intensity: 0.85,
          source: "hook",
        };
        lastActionRaw = action;
        emit("expression", "action_play", action, hookCtx);
      });

      api.on("before_agent_start", (event: any, hookCtx: any) => emit("agent", "before_agent_start", event, hookCtx));
      api.on("llm_input", (event: any, hookCtx: any) => {
        emit("llm", "llm_input", event, hookCtx);

        const thought = {
          text: thoughtThinking,
          mood: "thinking",
          ttlMs: 5000,
          source: "hook",
        };
        lastThoughtRaw = thought;
        emit("expression", "thought", thought, hookCtx);
      });
      api.on("llm_output", (event: any, hookCtx: any) => emit("llm", "llm_output", event, hookCtx));
      api.on("agent_end", (event: any, hookCtx: any) => emit("agent", "agent_end", event, hookCtx));

      api.on("before_tool_call", (event: any, hookCtx: any) => {
        const data = pluginCfg.includeToolParams ? event : { toolName: event.toolName };
        emit("tool", "before_tool_call", data, hookCtx);

        const action = {
          action: "tool_focus",
          durationMs: 1200,
          intensity: 0.7,
          source: "hook",
          toolName: event?.toolName,
        };
        lastActionRaw = action;
        emit("expression", "action_play", action, hookCtx);
      });
      api.on("after_tool_call", (event: any, hookCtx: any) => {
        const data = pluginCfg.includeToolParams
          ? event
          : { toolName: event.toolName, durationMs: event.durationMs, error: event.error };
        emit("tool", "after_tool_call", data, hookCtx);
      });

      api.on("subagent_spawning", (event: any, hookCtx: any) => emit("agent", "subagent_spawning", event, hookCtx));
      api.on("subagent_spawned", (event: any, hookCtx: any) => emit("agent", "subagent_spawned", event, hookCtx));
      api.on("subagent_ended", (event: any, hookCtx: any) => emit("agent", "subagent_ended", event, hookCtx));

      // Save state for stop()
      (globalThis as any)[STATE_KEY] = { server, wss, clients, weatherTimer };
    },
    stop: async (ctx: any) => {
      const state = (globalThis as any)[STATE_KEY];
      if (!state) return;
      try {
        for (const ws of state.clients ?? []) {
          try {
            ws.close();
          } catch {}
        }
        try {
          state.wss?.close();
        } catch {}
        try {
          state.server?.close();
        } catch {}
        try {
          if (state.weatherTimer) clearInterval(state.weatherTimer);
        } catch {}
      } finally {
        ctx.logger.info("[openclaw-face] stopped");
        delete (globalThis as any)[STATE_KEY];
      }
    },
  });
}
