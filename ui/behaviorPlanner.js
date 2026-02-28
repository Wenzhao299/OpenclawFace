const RELATION_STORAGE_KEY = 'openclaw-face.relation.v1';

const DEFAULT_RELATION = {
  bond: 0.28,
  trust: 0.3,
  curiosity: 0.42,
  engagement: 0.36,
  touchCount: 0,
  messageCount: 0,
  lastSeenAt: 0,
};

const DEFAULT_COGNITION = {
  state: 'idle',
  intent: 'idle',
  confidence: 0.35,
  updatedAt: 0,
};

const INTENT_PRIORITY = {
  error: 98,
  user_touch: 86,
  external_action: 84,
  external_thought: 82,
  tool_start: 78,
  thinking_start: 70,
  message_in: 66,
  message_out: 64,
  tool_end: 60,
  thinking_done: 56,
  user_leave: 42,
  user_focus: 38,
  idle: 10,
};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function pickOne(list, rand) {
  if (!Array.isArray(list) || list.length === 0) return '';
  return list[Math.floor(rand() * list.length)] || '';
}

function pickWeighted(list, rand) {
  if (!Array.isArray(list) || list.length === 0) return null;

  let total = 0;
  for (const item of list) {
    total += Math.max(0, Number(item?.weight) || 0);
  }
  if (total <= 0) return list[0];

  let cursor = rand() * total;
  for (const item of list) {
    cursor -= Math.max(0, Number(item?.weight) || 0);
    if (cursor <= 0) return item;
  }
  return list[list.length - 1];
}

function normalizeHour(hour) {
  const n = Number(hour);
  if (!Number.isFinite(n)) return new Date().getHours();
  return clamp(Math.floor(n), 0, 23);
}

function dayPartByHour(hour) {
  const h = normalizeHour(hour);
  if (h < 6) return 'night';
  if (h < 11) return 'morning';
  if (h < 17) return 'day';
  if (h < 22) return 'evening';
  return 'night';
}

function normalizeWeatherKind(kind) {
  const value = typeof kind === 'string' ? kind.trim().toLowerCase() : '';
  if (!value) return 'clear';
  return value;
}

function safeLoadRelation(storage, key) {
  if (!storage) return { ...DEFAULT_RELATION };
  try {
    const raw = storage.getItem(key);
    if (!raw) return { ...DEFAULT_RELATION };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_RELATION };
    return {
      ...DEFAULT_RELATION,
      ...parsed,
      bond: clamp(Number(parsed.bond) || DEFAULT_RELATION.bond, 0, 1),
      trust: clamp(Number(parsed.trust) || DEFAULT_RELATION.trust, 0, 1),
      curiosity: clamp(Number(parsed.curiosity) || DEFAULT_RELATION.curiosity, 0, 1),
      engagement: clamp(Number(parsed.engagement) || DEFAULT_RELATION.engagement, 0, 1),
      touchCount: Math.max(0, Math.round(Number(parsed.touchCount) || 0)),
      messageCount: Math.max(0, Math.round(Number(parsed.messageCount) || 0)),
      lastSeenAt: Math.max(0, Math.round(Number(parsed.lastSeenAt) || 0)),
    };
  } catch {
    return { ...DEFAULT_RELATION };
  }
}

function safeSaveRelation(storage, key, relation) {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(relation));
  } catch {
    // ignore storage quota/security errors
  }
}

function mapIntent(event) {
  if (!event || typeof event !== 'object') return 'idle';
  const name = event.name;

  if (name === 'client_error' || name === 'weather_error') return 'error';

  if (name === 'ui_interaction') {
    const kind = event.data?.kind;
    if (kind === 'pointer_down' || kind === 'tap') return 'user_touch';
    if (kind === 'pointer_move') return 'user_focus';
    if (kind === 'leave') return 'user_leave';
    return 'user_focus';
  }

  if (name === 'action_play') return 'external_action';
  if (name === 'thought') return 'external_thought';

  if (name === 'message_received') return 'message_in';
  if (name === 'llm_input') return 'thinking_start';
  if (name === 'before_tool_call') return 'tool_start';
  if (name === 'after_tool_call') return 'tool_end';
  if (name === 'llm_output') return 'thinking_done';
  if (name === 'message_sent') return 'message_out';

  return 'idle';
}

function cognitionForIntent(intent) {
  switch (intent) {
    case 'error':
      return { state: 'alert', confidence: 0.92 };
    case 'user_touch':
      return { state: 'social', confidence: 0.88 };
    case 'user_focus':
      return { state: 'attentive', confidence: 0.66 };
    case 'user_leave':
      return { state: 'idle', confidence: 0.5 };
    case 'message_in':
      return { state: 'listening', confidence: 0.78 };
    case 'thinking_start':
      return { state: 'reasoning', confidence: 0.82 };
    case 'tool_start':
      return { state: 'executing', confidence: 0.86 };
    case 'tool_end':
      return { state: 'reasoning', confidence: 0.74 };
    case 'thinking_done':
      return { state: 'resolving', confidence: 0.7 };
    case 'message_out':
      return { state: 'social', confidence: 0.72 };
    case 'external_action':
      return { state: 'expressing', confidence: 0.8 };
    case 'external_thought':
      return { state: 'reflecting', confidence: 0.76 };
    default:
      return { state: 'idle', confidence: 0.35 };
  }
}

function actionTrackFromName(actionName) {
  switch (actionName) {
    case 'nod':
    case 'nod_yes':
      return 'head';
    case 'wink':
    case 'curious':
    case 'tool_focus':
      return 'eyes';
    case 'speak':
      return 'mouth';
    case 'wave':
    case 'greet':
    case 'happy':
    case 'tap_ack':
      return 'core';
    default:
      return 'core';
  }
}

function touchThoughtByBond(relation, ctx, rand) {
  const dayPart = dayPartByHour(ctx?.hour);
  const weatherKind = normalizeWeatherKind(ctx?.weatherKind);

  let base = '';
  if (relation.bond >= 0.7) {
    base = pickOne(['Nice to see you again.', 'I am right here.', 'I like this interaction.'], rand);
  } else if (relation.bond >= 0.45) {
    base = pickOne(['Hi, I am with you.', 'I am listening.', 'Let us keep going.'], rand);
  } else {
    base = pickOne(['Hello.', 'I noticed you.', 'I am awake.'], rand);
  }

  if (dayPart === 'night' && rand() < 0.45) {
    base += ' Quiet mode feels right now.';
  } else if (dayPart === 'morning' && rand() < 0.45) {
    base += ' Fresh start.';
  }

  if ((weatherKind === 'rain' || weatherKind === 'fog' || weatherKind === 'snow') && rand() < 0.52) {
    base += ' The weather feels calm.';
  }

  return base;
}

function proactiveThoughtByBond(relation, ctx, rand) {
  const dayPart = dayPartByHour(ctx?.hour);
  const weatherKind = normalizeWeatherKind(ctx?.weatherKind);

  let base = '';
  if (relation.bond >= 0.72) {
    base = pickOne(['Still here with you.', 'Any new task for me?', 'I can continue when you are ready.'], rand);
  } else if (relation.bond >= 0.45) {
    base = pickOne(['I am on standby.', 'Ready for the next step.', 'I can help with more.'], rand);
  } else {
    base = pickOne(['I am waiting.', 'Need anything else?', 'Standing by.'], rand);
  }

  const timeExtras =
    dayPart === 'night'
      ? ['It is late, I will keep things gentle.', 'Night rhythm detected.']
      : dayPart === 'morning'
        ? ['Good morning pace.', 'Morning energy is online.']
        : dayPart === 'evening'
          ? ['Evening mood is steady.', 'A quiet evening flow.']
          : [];
  const weatherExtras =
    weatherKind === 'rain'
      ? ['Rainy vibe noted.']
      : weatherKind === 'fog'
        ? ['Foggy mood, staying focused.']
        : weatherKind === 'snow'
          ? ['Snowy and calm.']
          : weatherKind === 'clear'
            ? ['Clear skies, ready to move.']
            : [];

  const extraPool = [...timeExtras, ...weatherExtras];
  if (extraPool.length > 0 && rand() < 0.65) {
    base += ` ${pickOne(extraPool, rand)}`;
  }

  return base;
}

function pickTouchFollowupAction(relation, ctx, rand) {
  const dayPart = dayPartByHour(ctx?.hour);
  const weatherKind = normalizeWeatherKind(ctx?.weatherKind);
  const calm = dayPart === 'night' || weatherKind === 'rain' || weatherKind === 'fog' || weatherKind === 'snow';

  if (calm) {
    if (relation.bond >= 0.62) return rand() < 0.5 ? 'nod_yes' : 'curious';
    return 'nod_yes';
  }

  if (relation.bond >= 0.7) return rand() < 0.56 ? 'happy' : 'wave';
  if (relation.bond >= 0.48) return rand() < 0.55 ? 'happy' : 'nod_yes';
  return rand() < 0.52 ? 'nod_yes' : 'curious';
}

function pickIdleExpressionProfile(relation, ctx, rand) {
  const dayPart = dayPartByHour(ctx?.hour);
  const weatherKind = normalizeWeatherKind(ctx?.weatherKind);
  const tempC = Number(ctx?.weatherTempC);

  const isNight = dayPart === 'night';
  const isCalmWeather = weatherKind === 'rain' || weatherKind === 'fog' || weatherKind === 'snow';
  const isCold = Number.isFinite(tempC) && tempC <= 3;
  const isHot = Number.isFinite(tempC) && tempC >= 32;

  const baseIntensity = isNight ? 0.48 : 0.58;
  const weatherScale = isCalmWeather ? 0.9 : 1;
  const tempScale = isCold || isHot ? 0.92 : 1;

  const pool = [
    {
      name: 'curious',
      weight: 3.2 + (isCalmWeather ? 1.1 : 0),
      durationMs: isNight ? 980 : 860,
      intensity: baseIntensity * weatherScale * tempScale,
      mood: isCalmWeather ? 'calm' : 'neutral',
      state: isCalmWeather ? 'weather_idle' : 'idle_scan',
    },
    {
      name: 'nod_yes',
      weight: 2.5 + (isNight ? 1 : 0.2),
      durationMs: isNight ? 760 : 620,
      intensity: (baseIntensity - 0.05) * weatherScale * tempScale,
      mood: 'neutral',
      state: isNight ? 'quiet_idle' : 'idle',
    },
    {
      name: 'wink',
      weight: isNight ? 0.75 : 1.8,
      durationMs: isNight ? 700 : 620,
      intensity: (baseIntensity - 0.03) * weatherScale * tempScale,
      mood: relation.bond >= 0.6 ? 'warm' : 'neutral',
      state: 'social_idle',
    },
    {
      name: 'happy',
      weight: relation.bond >= 0.45 ? (isNight ? 0.8 : 2.1) : 0.45,
      durationMs: isNight ? 820 : 760,
      intensity: (baseIntensity + 0.08) * (isNight ? 0.85 : 1) * weatherScale * tempScale,
      mood: 'warm',
      state: 'proactive',
    },
    {
      name: 'wave',
      weight: relation.bond >= 0.65 && !isCalmWeather && !isNight ? 1.25 : 0.25,
      durationMs: 760,
      intensity: (baseIntensity + 0.04) * tempScale,
      mood: 'warm',
      state: 'social_idle',
    },
  ];

  const picked = pickWeighted(pool, rand) || pool[0];
  return {
    name: picked.name,
    track: actionTrackFromName(picked.name),
    durationMs: clamp(Math.round(picked.durationMs), 280, 2200),
    intensity: clamp(picked.intensity, 0.3, 0.88),
    mood: picked.mood,
    state: picked.state,
  };
}

function sequenceStep(delayMs, type, data) {
  return {
    at: Math.max(0, Math.round(delayMs || 0)),
    type,
    data: data || {},
  };
}

export function createBehaviorPlanner(opts = {}) {
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const rand = typeof opts.random === 'function' ? opts.random : Math.random;
  const storage = opts.storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  const storageKey = opts.storageKey || RELATION_STORAGE_KEY;

  const relation = safeLoadRelation(storage, storageKey);
  const cognition = {
    ...DEFAULT_COGNITION,
    updatedAt: now(),
  };

  let seqId = 0;
  let activeSequence = null;
  const pending = [];

  let lastEventAt = now();
  let lastTouchAt = 0;
  let lastTouchRelAt = 0;
  let lastTouchPlanAt = 0;
  let lastProactiveAt = 0;
  let lastExternalExpressionAt = 0;
  let lastPersistAt = 0;
  let lastDecayAt = now();

  function updateCognition(intent, ts) {
    const next = cognitionForIntent(intent);
    cognition.state = next.state;
    cognition.intent = intent;
    cognition.confidence = next.confidence;
    cognition.updatedAt = ts;
  }

  function decayRelation(ts) {
    const idleMs = relation.lastSeenAt > 0 ? ts - relation.lastSeenAt : 0;
    if (idleMs < 90000) {
      lastDecayAt = ts;
      return;
    }
    const deltaMs = Math.max(0, ts - lastDecayAt);
    if (deltaMs < 5000) return;
    const decay = clamp(deltaMs / (1000 * 60 * 70), 0, 0.03);
    relation.engagement = clamp(relation.engagement - decay * 0.45, 0, 1);
    relation.curiosity = clamp(relation.curiosity - decay * 0.2, 0, 1);

    if (idleMs > 1000 * 60 * 8) {
      const intimacyScale = clamp((idleMs - 1000 * 60 * 8) / (1000 * 60 * 80), 0.2, 1.7);
      relation.bond = clamp(relation.bond - decay * 0.26 * intimacyScale, 0, 1);
      relation.trust = clamp(relation.trust - decay * 0.18 * intimacyScale, 0, 1);
    }

    lastDecayAt = ts;
  }

  function updateRelation(intent, ts) {
    switch (intent) {
      case 'user_touch':
        if (ts - lastTouchRelAt < 260) break;
        relation.touchCount += 1;
        relation.bond = clamp(relation.bond + 0.009, 0, 1);
        relation.trust = clamp(relation.trust + 0.005, 0, 1);
        relation.engagement = clamp(relation.engagement + 0.012, 0, 1);
        relation.curiosity = clamp(relation.curiosity + 0.004, 0, 1);
        relation.lastSeenAt = ts;
        lastTouchRelAt = ts;
        lastTouchAt = ts;
        break;
      case 'user_focus':
        relation.engagement = clamp(relation.engagement + 0.002, 0, 1);
        relation.lastSeenAt = ts;
        break;
      case 'message_in':
        relation.messageCount += 1;
        relation.engagement = clamp(relation.engagement + 0.005, 0, 1);
        relation.lastSeenAt = ts;
        break;
      case 'message_out':
        relation.trust = clamp(relation.trust + 0.004, 0, 1);
        relation.bond = clamp(relation.bond + 0.0025, 0, 1);
        relation.lastSeenAt = ts;
        break;
      case 'error':
        relation.trust = clamp(relation.trust - 0.03, 0, 1);
        relation.engagement = clamp(relation.engagement - 0.012, 0, 1);
        break;
      case 'user_leave':
        relation.engagement = clamp(relation.engagement - 0.008, 0, 1);
        break;
      default:
        break;
    }
  }

  function buildSequence(intent, event, ctx, ts) {
    const priority = INTENT_PRIORITY[intent] ?? 10;
    const steps = [];
    let interruptible = true;

    if (intent === 'user_touch') {
      if (ts - lastTouchPlanAt < 260) return null;
      lastTouchPlanAt = ts;

      // Connected mode: keep local reaction lightweight and let server-side
      // expression/thought be the single source to avoid duplicate bubbles.
      if (ctx?.connected) {
        steps.push(sequenceStep(0, 'mode', { mode: 'listening' }));
        steps.push(sequenceStep(180, 'attention', { x: 0.5, y: 0.5 }));
        interruptible = false;
        return {
          id: ++seqId,
          intent,
          priority,
          interruptible,
          createdAt: ts,
          startedAt: 0,
          cursor: 0,
          steps,
        };
      }

      const thoughtText = touchThoughtByBond(relation, ctx, rand);
      const followAction = pickTouchFollowupAction(relation, ctx, rand);
      steps.push(sequenceStep(0, 'mode', { mode: 'listening' }));
      steps.push(sequenceStep(0, 'thought', {
        text: thoughtText,
        mood: 'warm',
        ttlMs: 5000,
        state: 'affection',
      }));
      steps.push(sequenceStep(20, 'action', {
        name: 'tap_ack',
        track: 'core',
        durationMs: 1200,
        intensity: clamp(0.75 + relation.bond * 0.3, 0.75, 1),
        blendInMs: 90,
        blendOutMs: 220,
      }));
      steps.push(sequenceStep(340, 'action', {
        name: followAction,
        track: actionTrackFromName(followAction),
        durationMs: followAction === 'happy' ? 820 : followAction === 'wave' ? 760 : 620,
        intensity: followAction === 'happy' || followAction === 'wave' ? 0.7 : 0.58,
        blendInMs: 120,
        blendOutMs: 220,
      }));
      interruptible = false;
    } else if (intent === 'user_leave') {
      // Ignore transient leave noise right after tap/click.
      if (ts - lastTouchPlanAt < 900) return null;
      steps.push(sequenceStep(0, 'attention', { x: 0.5, y: 0.5 }));
      steps.push(sequenceStep(180, 'mode', { mode: 'idle' }));
    } else if (intent === 'message_in') {
      steps.push(sequenceStep(0, 'mode', { mode: 'listening' }));
    } else if (intent === 'thinking_start') {
      steps.push(sequenceStep(0, 'mode', { mode: 'thinking' }));
    } else if (intent === 'tool_start') {
      const toolName = event?.data?.toolName;
      steps.push(sequenceStep(0, 'mode', { mode: 'tool' }));
      if (toolName) steps.push(sequenceStep(0, 'tool', { name: String(toolName) }));
    } else if (intent === 'tool_end') {
      steps.push(sequenceStep(40, 'action', {
        name: 'nod_yes',
        track: 'head',
        durationMs: 460,
        intensity: 0.55,
        blendInMs: 80,
        blendOutMs: 120,
      }));
      steps.push(sequenceStep(520, 'tool', { name: null }));
      if (ctx?.mode === 'tool') {
        steps.push(sequenceStep(560, 'mode', { mode: 'thinking' }));
      }
    } else if (intent === 'thinking_done') {
      if (ctx?.mode !== 'tool') steps.push(sequenceStep(160, 'mode', { mode: 'idle' }));
    } else if (intent === 'message_out') {
      if (ts - lastExternalExpressionAt > 320) {
        steps.push(sequenceStep(0, 'mode', { mode: 'speaking' }));
        steps.push(sequenceStep(0, 'action', {
          name: 'speak',
          track: 'mouth',
          durationMs: 900,
          intensity: 0.82,
          blendInMs: 70,
          blendOutMs: 120,
        }));
      }
    } else if (intent === 'external_action') {
      const name = typeof event?.data?.action === 'string' ? event.data.action : '';
      if (!name) return null;
      steps.push(sequenceStep(0, 'action', {
        name,
        track: event?.data?.track || actionTrackFromName(name),
        durationMs: clamp(Number(event?.data?.durationMs) || 900, 120, 12000),
        intensity: clamp(Number(event?.data?.intensity) || 0.85, 0, 1),
        blendInMs: clamp(Number(event?.data?.blendInMs) || 90, 16, 1500),
        blendOutMs: clamp(Number(event?.data?.blendOutMs) || 160, 20, 2000),
      }));
      lastExternalExpressionAt = ts;
    } else if (intent === 'external_thought') {
      const text = typeof event?.data?.text === 'string' ? event.data.text.trim() : '';
      if (!text) return null;
      steps.push(sequenceStep(0, 'thought', {
        text,
        mood: typeof event?.data?.mood === 'string' ? event.data.mood : 'neutral',
        ttlMs: clamp(Number(event?.data?.ttlMs) || 1600, 300, 15000),
        state: cognition.state,
      }));
      lastExternalExpressionAt = ts;
    } else if (intent === 'error') {
      steps.push(sequenceStep(0, 'mode', { mode: 'error' }));
      steps.push(sequenceStep(0, 'thought', {
        text: 'Something went wrong. Recovering.',
        mood: 'error',
        ttlMs: 5000,
        state: 'alert',
      }));
      interruptible = false;
    } else {
      return null;
    }

    if (steps.length === 0) return null;

    return {
      id: ++seqId,
      intent,
      priority,
      interruptible,
      createdAt: ts,
      startedAt: 0,
      cursor: 0,
      steps,
    };
  }

  function enqueueSequence(seq) {
    if (!seq) return;
    if (!activeSequence) {
      activeSequence = seq;
      return;
    }

    if (seq.priority > activeSequence.priority && (activeSequence.interruptible || seq.priority >= 95)) {
      activeSequence = seq;
      return;
    }

    pending.push(seq);
    pending.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.createdAt - b.createdAt;
    });
  }

  function maybeStartNext(ts) {
    if (activeSequence || pending.length === 0) return;
    activeSequence = pending.shift();
    activeSequence.startedAt = ts;
  }

  function drainSequence(ts) {
    const ops = [];
    if (!activeSequence) return ops;

    if (!activeSequence.startedAt) activeSequence.startedAt = ts;
    const elapsed = ts - activeSequence.startedAt;

    while (activeSequence.cursor < activeSequence.steps.length) {
      const step = activeSequence.steps[activeSequence.cursor];
      if (step.at > elapsed) break;
      ops.push({
        type: step.type,
        ...step.data,
      });
      activeSequence.cursor += 1;
    }

    if (activeSequence.cursor >= activeSequence.steps.length) {
      activeSequence = null;
    }

    return ops;
  }

  function maybeInjectProactive(ctx, ts) {
    if (ctx.mode !== 'idle') return;
    if (activeSequence || pending.length > 0) return;

    const quietMs = ts - lastEventAt;
    const sinceTouchMs = ts - lastTouchAt;
    const sinceProactiveMs = ts - lastProactiveAt;

    const quietThresholdMs = relation.engagement >= 0.58 ? 7800 : 9400;
    const proactiveGapMs = relation.engagement >= 0.58 ? 11800 : 15600;

    if (quietMs < quietThresholdMs) return;
    if (sinceTouchMs < 3200) return;
    if (sinceProactiveMs < proactiveGapMs) return;
    if (rand() < 0.08) return;

    const profile = pickIdleExpressionProfile(relation, ctx, rand);
    const withThought = rand() < 0.46;
    const steps = [];

    if (withThought) {
      steps.push(sequenceStep(0, 'thought', {
        text: proactiveThoughtByBond(relation, ctx, rand),
        mood: profile.mood,
        ttlMs: 5000,
        state: profile.state,
      }));
    }

    steps.push(sequenceStep(withThought ? 40 : 0, 'action', {
      name: profile.name,
      track: profile.track,
      durationMs: profile.durationMs,
      intensity: profile.intensity,
      blendInMs: 120,
      blendOutMs: 220,
    }));

    if (rand() < 0.26) {
      const tail = profile.name === 'wink' ? 'nod_yes' : rand() < 0.55 ? 'curious' : 'wink';
      steps.push(sequenceStep((withThought ? 40 : 0) + 340, 'action', {
        name: tail,
        track: actionTrackFromName(tail),
        durationMs: tail === 'curious' ? 760 : 560,
        intensity: tail === 'curious' ? 0.5 : 0.46,
        blendInMs: 100,
        blendOutMs: 180,
      }));
    }

    const seq = {
      id: ++seqId,
      intent: 'proactive_idle',
      priority: 24,
      interruptible: true,
      createdAt: ts,
      startedAt: 0,
      cursor: 0,
      steps,
    };

    enqueueSequence(seq);
    lastProactiveAt = ts;
  }

  function persistMaybe(ts, force = false) {
    if (!force && ts - lastPersistAt < 5000) return;
    safeSaveRelation(storage, storageKey, relation);
    lastPersistAt = ts;
  }

  function advance(ctx, ts) {
    decayRelation(ts);
    maybeInjectProactive(ctx, ts);
    maybeStartNext(ts);

    const ops = drainSequence(ts);
    if (!activeSequence) maybeStartNext(ts);

    persistMaybe(ts);

    return {
      ops,
      cognition: {
        state: cognition.state,
        intent: cognition.intent,
        confidence: cognition.confidence,
      },
      relation: {
        bond: relation.bond,
        trust: relation.trust,
        curiosity: relation.curiosity,
        engagement: relation.engagement,
        touchCount: relation.touchCount,
        messageCount: relation.messageCount,
      },
      queueDepth: pending.length + (activeSequence ? 1 : 0),
    };
  }

  function ingest(event, ctx = {}) {
    const ts = now();
    const intent = mapIntent(event);
    lastEventAt = ts;

    updateCognition(intent, ts);
    updateRelation(intent, ts);

    const seq = buildSequence(intent, event, ctx, ts);
    enqueueSequence(seq);

    return {
      intent,
      ...advance(ctx, ts),
    };
  }

  function pulse(ctx = {}) {
    const ts = now();
    return {
      intent: cognition.intent,
      ...advance(ctx, ts),
    };
  }

  function snapshot() {
    return {
      cognition: {
        state: cognition.state,
        intent: cognition.intent,
        confidence: cognition.confidence,
      },
      relation: {
        bond: relation.bond,
        trust: relation.trust,
        curiosity: relation.curiosity,
        engagement: relation.engagement,
        touchCount: relation.touchCount,
        messageCount: relation.messageCount,
      },
      activeIntent: activeSequence?.intent || null,
      queueDepth: pending.length + (activeSequence ? 1 : 0),
    };
  }

  function forcePersist() {
    persistMaybe(now(), true);
  }

  return {
    ingest,
    pulse,
    snapshot,
    forcePersist,
    actionTrackFromName,
  };
}
