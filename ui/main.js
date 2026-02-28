import { createFaceEngine } from './faceEngine.js';
import { createShell } from './uiShell.js';
import { createBehaviorPlanner } from './behaviorPlanner.js';

const qs = new URLSearchParams(location.search);
const BOOT = globalThis.__OPENCLAW_FACE_CONFIG__ || {};
const DEFAULT_WS_PATH = typeof BOOT.wsPath === 'string' && BOOT.wsPath.trim() ? BOOT.wsPath.trim() : '/ws';
const WS_URL = qs.get('ws') || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${DEFAULT_WS_PATH}`;
const WS_TOKEN = qs.get('token') || '';
const WS_RECONNECT_MS = 1000;
const MOVE_SEND_THROTTLE_MS = 40;
const PLANNER_PULSE_MS = 140;
const THOUGHT_TTL_MS = 5000;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function withToken(url, token) {
  if (!token) return url;
  const u = new URL(url);
  u.searchParams.set('token', token);
  return u.toString();
}

function withEventMeta(data = {}) {
  return {
    ...data,
    clientTs: Date.now(),
    source: 'face-ui',
  };
}

function minifyEvent(ev) {
  return {
    name: ev.name,
    type: ev.type,
    ts: ev.ts,
    data: ev.data,
  };
}

function formatTime(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
}

function formatNow() {
  const d = new Date();
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function resolvePlannerHour() {
  if (state.weather?.time) {
    const t = new Date(state.weather.time);
    if (!Number.isNaN(t.getTime())) return t.getHours();
  }
  return new Date().getHours();
}

const url = withToken(WS_URL, WS_TOKEN);
const app = document.querySelector('#app');
const shell = createShell(app, { wsUrl: url });

const planner = createBehaviorPlanner();

let face = null;
let faceReady = false;
let pendingMode = 'idle';
let pendingWeather = 'clear';

let ws = null;
let reconnectTimer = null;
let speakingTimer = null;
let toolIdleTimer = null;
let thoughtTimer = null;
let lastMoveSendAt = 0;
let interactionSeq = 0;
let lastPointerDownAt = 0;

const state = {
  connected: false,
  mode: 'idle',
  toolName: null,
  thought: {
    text: '',
    mood: 'neutral',
    state: 'idle',
    confidence: 0.35,
  },
  cognition: {
    state: 'idle',
    intent: 'idle',
    confidence: 0.35,
  },
  relation: {
    bond: 0.28,
    trust: 0.3,
    curiosity: 0.42,
    engagement: 0.36,
    touchCount: 0,
    messageCount: 0,
  },
  plannerQueueDepth: 0,
  weather: {
    kind: 'clear',
    tempC: null,
    time: null,
    tz: null,
  },
  lastEvent: null,
  lastTs: 0,
  stats: {
    messagesIn: 0,
    tools: 0,
    uiInteractions: 0,
  },
};

if (shell.els.stage) {
  createFaceEngine(shell.els.stage).then((engine) => {
    face = engine;
    faceReady = true;
    face.setMode(pendingMode);
    face.setWeather(pendingWeather);
    face.setAttention?.(0.5, 0.5);
  });
}

function plannerContext() {
  return {
    connected: state.connected,
    mode: state.mode,
    toolName: state.toolName,
    hour: resolvePlannerHour(),
    weatherKind: state.weather.kind || 'clear',
    weatherTempC: Number.isFinite(Number(state.weather.tempC)) ? Number(state.weather.tempC) : null,
  };
}

function setMode(mode, opts = {}) {
  if (!mode || typeof mode !== 'string') return false;
  if (state.mode === mode) return false;
  state.mode = mode;
  if (faceReady && face) face.setMode(mode);
  if (!opts.silent) render();
  return true;
}

function setTool(name, opts = {}) {
  const next = name || null;
  if (state.toolName === next) return false;
  state.toolName = next;
  if (!opts.silent) render();
  return true;
}

function setThought(text, mood = 'neutral', ttlMs = 1600, meta = {}) {
  const clean = typeof text === 'string' ? text.trim() : '';
  const nextMood = mood || 'neutral';
  const nextState = meta.state || state.cognition.state || 'idle';
  const nextConf = clamp(Number(meta.confidence ?? state.cognition.confidence ?? 0.35), 0, 1);

  let dirty = false;
  if (state.thought.text !== clean) {
    state.thought.text = clean;
    dirty = true;
  }
  if (state.thought.mood !== nextMood) {
    state.thought.mood = nextMood;
    dirty = true;
  }
  if (state.thought.state !== nextState) {
    state.thought.state = nextState;
    dirty = true;
  }
  if (state.thought.confidence !== nextConf) {
    state.thought.confidence = nextConf;
    dirty = true;
  }

  clearTimeout(thoughtTimer);
  if (clean) {
    thoughtTimer = setTimeout(() => {
      state.thought.text = '';
      state.thought.mood = 'neutral';
      render();
    }, THOUGHT_TTL_MS);
  }

  if (dirty && !meta.silent) render();
  return dirty;
}

function brieflySpeaking(ms = 900, opts = {}) {
  clearTimeout(speakingTimer);
  const changed = setMode('speaking', { silent: true });
  speakingTimer = setTimeout(() => {
    if (state.toolName) setMode('tool');
    else setMode('idle');
  }, ms);
  if (changed && !opts.silent) render();
  return changed;
}

function toolBumpToIdle(ms = 1400) {
  clearTimeout(toolIdleTimer);
  toolIdleTimer = setTimeout(() => {
    setTool(null, { silent: true });
    if (state.mode === 'tool') setMode('idle');
    else render();
  }, ms);
}

function applyAttention(x, y) {
  if (!faceReady || !face?.setAttention) return;
  face.setAttention(clamp(x, 0, 1), clamp(y, 0, 1));
}

function playAction(data = {}, opts = {}) {
  const action = typeof data.name === 'string' ? data.name.trim() : typeof data.action === 'string' ? data.action.trim() : '';
  if (!action) return false;

  const durationMs = clamp(Number(data.durationMs) || 900, 120, 12000);
  const intensity = clamp(Number(data.intensity) || 0.85, 0, 1);
  const track = typeof data.track === 'string' ? data.track : planner.actionTrackFromName(action);
  const blendInMs = clamp(Number(data.blendInMs) || 90, 16, 1500);
  const blendOutMs = clamp(Number(data.blendOutMs) || 160, 20, 2000);

  face?.playAction?.(action, {
    durationMs,
    intensity,
    track,
    blendInMs,
    blendOutMs,
    replace: data.replace !== false,
  });

  let dirty = false;
  switch (action) {
    case 'speak':
      dirty = brieflySpeaking(durationMs, { silent: true }) || dirty;
      break;
    case 'tool_focus':
      dirty = setMode('tool', { silent: true }) || dirty;
      toolBumpToIdle(durationMs + 280);
      break;
    case 'tap_ack':
      dirty = setMode('listening', { silent: true }) || dirty;
      setTimeout(() => {
        if (state.mode === 'listening') setMode('idle');
      }, Math.min(durationMs, 1600));
      break;
    default:
      break;
  }

  if (dirty && !opts.silent) render();
  return true;
}

function mergePlannerMeta(result) {
  let dirty = false;

  if (result?.cognition) {
    const next = result.cognition;
    if (state.cognition.state !== next.state) {
      state.cognition.state = next.state;
      dirty = true;
    }
    if (state.cognition.intent !== next.intent) {
      state.cognition.intent = next.intent;
      dirty = true;
    }
    const conf = clamp(Number(next.confidence) || 0, 0, 1);
    if (state.cognition.confidence !== conf) {
      state.cognition.confidence = conf;
      dirty = true;
    }
  }

  if (result?.relation) {
    for (const key of ['bond', 'trust', 'curiosity', 'engagement', 'touchCount', 'messageCount']) {
      if (state.relation[key] !== result.relation[key]) {
        state.relation[key] = result.relation[key];
        dirty = true;
      }
    }
  }

  if (typeof result?.queueDepth === 'number' && state.plannerQueueDepth !== result.queueDepth) {
    state.plannerQueueDepth = result.queueDepth;
    dirty = true;
  }

  return dirty;
}

function applyPlannerOps(ops = []) {
  let dirty = false;

  for (const op of ops) {
    switch (op.type) {
      case 'mode': {
        dirty = setMode(op.mode, { silent: true }) || dirty;
        break;
      }
      case 'tool': {
        dirty = setTool(op.name, { silent: true }) || dirty;
        break;
      }
      case 'attention': {
        applyAttention(op.x ?? 0.5, op.y ?? 0.5);
        break;
      }
      case 'thought': {
        dirty = setThought(op.text, op.mood || 'neutral', op.ttlMs || 1600, {
          state: op.state || state.cognition.state,
          confidence: state.cognition.confidence,
          silent: true,
        }) || dirty;
        break;
      }
      case 'thought_clear': {
        dirty = setThought('', 'neutral', 0, {
          state: 'idle',
          confidence: state.cognition.confidence,
          silent: true,
        }) || dirty;
        break;
      }
      case 'action': {
        dirty = playAction(op, { silent: true }) || dirty;
        break;
      }
      default:
        break;
    }
  }

  return dirty;
}

function consumePlannerResult(result, opts = {}) {
  if (!result) return;
  const metaDirty = mergePlannerMeta(result);
  const opDirty = applyPlannerOps(result.ops || []);
  if (metaDirty || opDirty || opts.forceRender) render();
}

function localPlannerFallback(event) {
  if (state.connected) return;
  const result = planner.ingest(event, plannerContext());
  consumePlannerResult(result, { forceRender: true });
}

function handleEvent(ev) {
  state.lastEvent = ev;
  state.lastTs = Date.now();

  switch (ev.name) {
    case 'weather_update': {
      state.weather.kind = ev.data?.kind || state.weather.kind;
      state.weather.tempC = ev.data?.tempC ?? state.weather.tempC;
      state.weather.time = ev.data?.time ?? state.weather.time;
      state.weather.tz = ev.data?.tz ?? state.weather.tz;
      if (faceReady && face) face.setWeather(state.weather.kind);
      render();
      return;
    }
    case 'message_received':
      state.stats.messagesIn += 1;
      break;
    case 'before_tool_call':
      state.stats.tools += 1;
      break;
    case 'ui_interaction': {
      state.stats.uiInteractions += 1;
      const kind = ev.data?.kind;
      const x = Number(ev.data?.x);
      const y = Number(ev.data?.y);
      if (kind === 'pointer_move' && Number.isFinite(x) && Number.isFinite(y)) {
        applyAttention(x, y);
      }
      if (kind === 'leave') {
        applyAttention(0.5, 0.5);
      }
      break;
    }
    default:
      break;
  }

  const result = planner.ingest(ev, plannerContext());
  consumePlannerResult(result, { forceRender: true });
}

function render() {
  shell.setConnected(state.connected);
  shell.setMode(state.mode);
  shell.setTool(state.toolName);
  shell.setThought(state.thought.text, state.thought.mood, state.thought.state, state.thought.confidence);
  shell.setCognition(state.cognition.state, state.cognition.intent, state.cognition.confidence, state.plannerQueueDepth);
  shell.setBond(state.relation.bond, state.relation.trust, state.relation.engagement);
  shell.setWeather(state.weather.kind, state.weather.tempC);
  shell.setWeatherTime(formatTime(state.weather.time) ?? '--:--');
  shell.setNow(formatNow());
  shell.setLast(state.lastEvent ? JSON.stringify(minifyEvent(state.lastEvent)) : '-');

  pendingMode = state.mode;
  pendingWeather = state.weather.kind;
  if (faceReady && face) {
    face.setMode(state.mode);
    face.setWeather(state.weather.kind);
  }
}

function sendClientEvent(name, data = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(
    JSON.stringify({
      v: 1,
      type: 'ui',
      name,
      ts: Date.now(),
      data,
    }),
  );
  return true;
}

function normalizePointer(event) {
  const rect = shell.els.screen?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  };
}

function connect() {
  clearTimeout(reconnectTimer);
  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    state.connected = true;
    if (state.mode === 'error') setMode('idle', { silent: true });
    render();
  });

  ws.addEventListener('close', () => {
    state.connected = false;
    render();
    ws = null;
    reconnectTimer = setTimeout(connect, WS_RECONNECT_MS);
  });

  ws.addEventListener('error', () => {
    state.connected = false;
    setMode('error', { silent: true });
    render();
  });

  ws.addEventListener('message', (msg) => {
    try {
      const ev = JSON.parse(msg.data);
      handleEvent(ev);
    } catch {
      // ignore malformed packets
    }
  });
}

// local clock tick (UI-only)
setInterval(() => {
  shell.setNow(formatNow());
}, 500);

setInterval(() => {
  const result = planner.pulse(plannerContext());
  consumePlannerResult(result);
}, PLANNER_PULSE_MS);

shell.els.screen?.addEventListener('pointermove', (event) => {
  const point = normalizePointer(event);
  if (!point) return;

  applyAttention(point.x, point.y);

  const nowMs = Date.now();
  if (nowMs - lastMoveSendAt < MOVE_SEND_THROTTLE_MS) return;
  lastMoveSendAt = nowMs;

  interactionSeq += 1;
  const payload = withEventMeta({
    kind: 'pointer_move',
    x: point.x,
    y: point.y,
    pointerType: event.pointerType,
    pressure: event.pressure,
    seq: interactionSeq,
  });
  sendClientEvent('ui_interaction', payload);
  localPlannerFallback({ name: 'ui_interaction', data: payload });
});

shell.els.screen?.addEventListener('pointerdown', (event) => {
  const point = normalizePointer(event);
  if (!point) return;

  lastPointerDownAt = Date.now();

  interactionSeq += 1;
  const payload = withEventMeta({
    kind: 'pointer_down',
    x: point.x,
    y: point.y,
    pointerType: event.pointerType,
    pressure: event.pressure,
    button: event.button,
    seq: interactionSeq,
  });
  sendClientEvent('ui_interaction', payload);
  localPlannerFallback({ name: 'ui_interaction', data: payload });
});

shell.els.screen?.addEventListener('pointerup', (event) => {
  const point = normalizePointer(event);
  if (!point) return;

  interactionSeq += 1;
  const payload = withEventMeta({
    kind: 'pointer_up',
    x: point.x,
    y: point.y,
    pointerType: event.pointerType,
    pressure: event.pressure,
    button: event.button,
    seq: interactionSeq,
  });
  sendClientEvent('ui_interaction', payload);
  localPlannerFallback({ name: 'ui_interaction', data: payload });
});

shell.els.screen?.addEventListener('pointerleave', () => {
  // Some browsers emit leave immediately around click/tap; ignore this transient leave.
  if (Date.now() - lastPointerDownAt < 700) return;
  applyAttention(0.5, 0.5);
  interactionSeq += 1;
  const payload = withEventMeta({
    kind: 'leave',
    seq: interactionSeq,
  });
  sendClientEvent('ui_interaction', payload);
  localPlannerFallback({ name: 'ui_interaction', data: payload });
});

window.addEventListener('blur', () => {
  applyAttention(0.5, 0.5);
  interactionSeq += 1;
  const payload = withEventMeta({
    kind: 'leave',
    seq: interactionSeq,
  });
  sendClientEvent('ui_interaction', payload);
  localPlannerFallback({ name: 'ui_interaction', data: payload });
});

window.addEventListener('beforeunload', () => {
  planner.forcePersist();
});

render();
connect();
