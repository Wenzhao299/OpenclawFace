const PIXI = globalThis.PIXI;

if (!PIXI) {
  throw new Error('PIXI is not available. Ensure ui/vendor/pixi.min.js is loaded before main.js.');
}

// Cute rounded style face engine.
// Layers: bg / weather / face / fx

const COLORS = {
  bg: 0x0b0f14,
  card: 0x101826,
  white: 0xe8f0ff,
  blush: 0xff7aa8,
  sky: 0x4aa3ff,
  sun: 0xffd27d,
  rain: 0x2e7cff,
  snow: 0xe8f0ff,
  fog: 0x93a4bf,
  ok: 0x2ecc71,
  err: 0xe74c3c,
};

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function moodParams(mode) {
  // valence: -1..+1, arousal: 0..1
  switch (mode) {
    case 'idle':
      return { valence: 0.3, arousal: 0.1, accent: COLORS.sky };
    case 'listening':
      return { valence: 0.2, arousal: 0.55, accent: COLORS.sky };
    case 'thinking':
      return { valence: 0.0, arousal: 0.45, accent: COLORS.sky };
    case 'tool':
      return { valence: -0.1, arousal: 0.65, accent: COLORS.sun };
    case 'speaking':
      return { valence: 0.55, arousal: 0.6, accent: COLORS.ok };
    case 'error':
      return { valence: -0.7, arousal: 0.75, accent: COLORS.err };
    default:
      return { valence: 0.2, arousal: 0.2, accent: COLORS.sky };
  }
}

function defaultTrackForAction(actionName) {
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

export async function createFaceEngine(containerEl) {
  const mount = document.createElement('div');
  mount.className = 'pixi-mount';
  containerEl.appendChild(mount);

  const app = new PIXI.Application();
  await app.init({ backgroundAlpha: 0, antialias: true, resolution: window.devicePixelRatio || 1 });
  mount.appendChild(app.canvas);

  const gBg = new PIXI.Graphics();
  const gWeather = new PIXI.Graphics();
  const gFace = new PIXI.Graphics();
  const gFx = new PIXI.Graphics();

  app.stage.addChild(gBg);
  app.stage.addChild(gWeather);
  app.stage.addChild(gFace);
  app.stage.addChild(gFx);

  const s = { w: 480, h: 270 };
  const anim = {
    t: 0,
    mode: 'idle',
    weather: 'clear',

    // attention point (0..1)
    attX: 0.5,
    attY: 0.5,

    valence: 0.3,
    arousal: 0.1,
    accent: COLORS.sky,
    // smoothing
    valenceT: 0.3,
    arousalT: 0.1,
    accentT: COLORS.sky,

    // blended action layers by track
    activeActions: [],
  };

  function resize() {
    const rect = mount.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    app.renderer.resize(w, h);
    gBg.scale.set(w / s.w, h / s.h);
    gWeather.scale.set(w / s.w, h / s.h);
    gFace.scale.set(w / s.w, h / s.h);
    gFx.scale.set(w / s.w, h / s.h);
  }

  function setMode(mode) {
    anim.mode = mode;
    const p = moodParams(mode);
    anim.valenceT = p.valence;
    anim.arousalT = p.arousal;
    anim.accentT = p.accent;
  }

  function setWeather(kind) {
    anim.weather = kind;
  }

  // x/y normalized 0..1; used for "look at pointer"
  function setAttention(x, y) {
    anim.attX = clamp(x ?? 0.5, 0, 1);
    anim.attY = clamp(y ?? 0.5, 0, 1);
  }

  // opts: {durationMs, intensity, track, blendInMs, blendOutMs, replace}
  function playAction(action, opts = {}) {
    const actionName = typeof action === 'string' && action.trim() ? action.trim() : 'pulse';
    const durationMs = clamp(Math.round(Number(opts.durationMs) || 900), 120, 12000);
    const intensity = clamp(Number(opts.intensity) || 0.85, 0, 1);
    const track = typeof opts.track === 'string' && opts.track.trim() ? opts.track.trim() : defaultTrackForAction(actionName);
    const blendInMs = clamp(Math.round(Number(opts.blendInMs) || 90), 16, 1500);
    const blendOutMs = clamp(Math.round(Number(opts.blendOutMs) || 160), 20, 2000);
    const replace = opts.replace !== false;

    const nowMs = performance.now();

    if (replace) {
      anim.activeActions = anim.activeActions.filter((a) => a.track !== track);
    }

    anim.activeActions.push({
      name: actionName,
      track,
      startedAt: nowMs,
      until: nowMs + durationMs,
      durationMs,
      intensity,
      blendInMs,
      blendOutMs,
    });
  }

  function getActiveActions() {
    const nowMs = performance.now();
    const next = [];
    const active = [];

    for (const action of anim.activeActions) {
      const leftMs = action.until - nowMs;
      if (leftMs <= 0) continue;

      const elapsed = nowMs - action.startedAt;
      const progress = clamp(elapsed / Math.max(1, action.durationMs), 0, 1);
      const inWeight = clamp(elapsed / Math.max(1, action.blendInMs), 0, 1);
      const outWeight = clamp(leftMs / Math.max(1, action.blendOutMs), 0, 1);
      const weight = clamp(Math.min(inWeight, outWeight), 0, 1);

      const withMeta = {
        ...action,
        progress,
        weight,
      };

      next.push(action);
      active.push(withMeta);
    }

    anim.activeActions = next;
    return active;
  }

  function drawCard() {
    gBg.clear();
    // background
    gBg.rect(0, 0, s.w, s.h).fill({ color: COLORS.bg });

    // card
    const r = 24;
    const x = 34;
    const y = 16;
    const w = s.w - 68;
    const h = s.h - 32;

    gBg.roundRect(x, y, w, h, r).fill({ color: COLORS.card, alpha: 0.95 });

    // soft inner glow
    gBg.roundRect(x, y, w, h, r).stroke({ color: anim.accent, width: 2, alpha: 0.14 });
  }

  function drawWeather() {
    gWeather.clear();
    const tint =
      anim.weather === 'rain'
        ? COLORS.rain
        : anim.weather === 'snow'
          ? COLORS.snow
          : anim.weather === 'fog'
            ? COLORS.fog
            : COLORS.sky;

    if (anim.weather === 'rain') {
      for (let i = 0; i < 36; i++) {
        const x = (i * 19 + (anim.t * 220) % s.w) % s.w;
        const y = (i * 37 + (anim.t * 460) % s.h) % s.h;
        gWeather.circle(x, y, 1.5).fill({ color: tint, alpha: 0.18 });
        gWeather.roundRect(x - 2, y, 4, 14, 2).fill({ color: tint, alpha: 0.1 });
      }
    } else if (anim.weather === 'snow') {
      for (let i = 0; i < 22; i++) {
        const x = (i * 23 + (anim.t * 42) % s.w) % s.w;
        const y = (i * 41 + (anim.t * 70) % s.h) % s.h;
        const r = 1.2 + ((i % 3) * 0.7);
        gWeather.circle(x, y, r).fill({ color: tint, alpha: 0.18 });
      }
    } else if (anim.weather === 'fog') {
      for (let i = 0; i < 5; i++) {
        const yy = 58 + i * 28;
        const xx = ((anim.t * 18) % 100) - 50;
        gWeather.roundRect(50 + xx, yy, s.w - 100, 16, 12).fill({ color: tint, alpha: 0.045 });
      }
    }
  }

  function applyActionInfluence(target, action) {
    const p = action.progress;
    const i = action.intensity * action.weight;
    const loop = Math.sin(p * Math.PI * 2);
    const pulse = Math.sin(p * Math.PI);

    switch (action.name) {
      case 'tap_ack':
        target.headY += Math.sin(p * Math.PI) * -5 * i;
        target.lookX += loop * 2 * i;
        target.lookY += -Math.sin(p * Math.PI) * 1.8 * i;
        target.smile += 4 * i;
        target.mouthAmp += 3 * i;
        target.blush += 0.02 * i;
        break;
      case 'nod':
      case 'nod_yes':
        target.headY += loop * 6 * i;
        target.smile += 2 * i;
        break;
      case 'wave':
      case 'greet':
        target.lookX += Math.sin(p * Math.PI * 4) * 9 * i;
        target.lookY += Math.cos(p * Math.PI * 3) * 2.2 * i;
        target.smile += 4 * i;
        target.blush += 0.03 * i;
        break;
      case 'wink': {
        const wink = p < 0.5 ? p * 2 : (1 - p) * 2;
        target.rightWink *= clamp(1 - wink * 0.92 * i, 0.08, 1);
        target.smile += 4 * i;
        break;
      }
      case 'curious':
        target.lookX += Math.sin(p * Math.PI * 2) * 6 * i;
        target.lookY += Math.sin(p * Math.PI * 2) * 2.5 * i;
        target.headY += Math.sin(p * Math.PI) * -2 * i;
        target.smile += 1.5 * i;
        break;
      case 'happy':
        target.smile += 7 * i;
        target.mouthAmp += 2 * i;
        target.blush += 0.05 * i;
        break;
      case 'tool_focus':
        target.lookX += Math.sin(p * Math.PI * 8) * 7 * i;
        target.mouthAmp += 1 * i;
        break;
      case 'speak':
        target.smile += 2 * i;
        target.mouthAmp += 3.5 * i;
        target.forceSpeaking = true;
        break;
      default:
        target.smile += pulse * 3 * i;
        target.mouthAmp += pulse * 1.2 * i;
        break;
    }
  }

  function drawFace(activeActions) {
    gFace.clear();

    // smooth to targets
    anim.valence = lerp(anim.valence, anim.valenceT, 0.06);
    anim.arousal = lerp(anim.arousal, anim.arousalT, 0.06);
    anim.accent = anim.accentT;

    const cx = s.w / 2;

    // breathing
    const breath = Math.sin(anim.t * 1.3) * 0.8;
    const breathScale = 1 + Math.sin(anim.t * 1.3) * 0.004;

    const actionMods = {
      lookX: 0,
      lookY: 0,
      headY: 0,
      smile: 0,
      mouthAmp: 0,
      blush: 0,
      rightWink: 1,
      forceSpeaking: false,
    };

    for (const action of activeActions) {
      applyActionInfluence(actionMods, action);
    }

    const eyeY = 118 + breath + actionMods.headY;
    const eyeDX = 60;

    // base autonomous eye movement + pointer attention
    const autoLookX =
      anim.mode === 'thinking'
        ? Math.sin(anim.t * 2.0) * 4
        : anim.mode === 'tool'
          ? Math.sin(anim.t * 6.0) * 7
          : anim.mode === 'listening'
            ? Math.sin(anim.t * 10.0) * 2.5
            : Math.sin(anim.t * 0.7) * 1.0;
    const autoLookY =
      anim.mode === 'thinking'
        ? Math.sin(anim.t * 1.6 + 0.4) * 2.0
        : anim.mode === 'tool'
          ? Math.sin(anim.t * 5.0 + 0.2) * 1.2
          : anim.mode === 'listening'
            ? Math.sin(anim.t * 7.5 + 0.6) * 0.9
            : Math.sin(anim.t * 0.6) * 0.5;

    const attStrength = anim.mode === 'idle' ? 1.0 : anim.mode === 'listening' ? 0.9 : 0.5;
    const attX = (anim.attX - 0.5) * 18 * attStrength;
    const attY = (anim.attY - 0.5) * 14 * attStrength;
    const lookX = autoLookX + attX + actionMods.lookX;
    const lookY = autoLookY + attY + actionMods.lookY;

    // blink frequency from arousal
    const blinkPeriod = lerp(5.4, 2.2, clamp(anim.arousal, 0, 1));
    const blinkPhase = anim.t % blinkPeriod;
    let blink = 1;
    if (blinkPhase > blinkPeriod - 0.12) {
      const t = (blinkPhase - (blinkPeriod - 0.12)) / 0.12;
      blink = lerp(1, 0.12, easeInOut(Math.sin(t * Math.PI)));
    }

    const eyeOpen = Math.max(0.18, blink);
    const baseEye = lerp(15, 20, clamp(anim.valence + 0.5, 0, 1));
    const eyeW = baseEye;
    const eyeH = baseEye * eyeOpen;
    const eyeHLeft = eyeH;
    const eyeHRight = eyeH * actionMods.rightWink;

    const white = COLORS.white;

    // cheeks (blush) depends on valence
    const blushAlpha = clamp((anim.valence + 0.2) * 0.2 + actionMods.blush, 0, 0.26);
    if (blushAlpha > 0.01) {
      for (const dir of [-1, 1]) {
        gFace.circle(cx + dir * 88, 150 + breath + actionMods.headY * 0.5, 16).fill({ color: COLORS.blush, alpha: blushAlpha });
      }
    }

    // eyes
    for (const dir of [-1, 1]) {
      const ex = cx + dir * eyeDX + lookX;
      const ey = eyeY + lookY;
      const eyeHeight = dir === -1 ? eyeHLeft : eyeHRight;
      gFace.ellipse(ex, ey, eyeW * breathScale, Math.max(3, eyeHeight * breathScale)).fill({ color: white, alpha: 0.94 });
      gFace.ellipse(ex, ey, eyeW * breathScale, Math.max(3, eyeHeight * breathScale)).stroke({ color: anim.accent, width: 1, alpha: 0.14 });
    }

    // mouth curve based on valence
    const my = 178 + breath + actionMods.headY;
    const mw = 40;
    const smile = clamp(anim.valence, -1, 1);
    const curve = smile * 10 + actionMods.smile;
    const forceSpeaking = actionMods.forceSpeaking;

    if (anim.mode === 'speaking' || forceSpeaking) {
      const amp = 5 + Math.sin(anim.t * 16) * 1.5 + actionMods.mouthAmp;
      gFace.moveTo(cx - 18, my);
      for (let i = 0; i <= 36; i += 6) {
        const x = cx - 18 + i;
        const y = my + Math.sin((anim.t * 14) + i / 6) * amp;
        gFace.lineTo(x, y);
      }
      gFace.stroke({ color: white, width: 3, alpha: 0.78 });
    } else if (anim.mode === 'listening') {
      gFace.circle(cx, my, 10 + actionMods.mouthAmp * 0.4).stroke({ color: white, width: 3, alpha: 0.72 });
    } else if (anim.mode === 'thinking') {
      gFace.circle(cx, my, 4 + actionMods.mouthAmp * 0.2).fill({ color: white, alpha: 0.72 });
    } else if (anim.mode === 'tool') {
      const side = 18 + actionMods.mouthAmp * 0.6;
      gFace.roundRect(cx - side / 2, my - side / 2, side, side, 6).stroke({ color: white, width: 3, alpha: 0.72 });
    } else if (anim.mode === 'error') {
      gFace.moveTo(cx - 12, my - 10).lineTo(cx + 12, my + 10).stroke({ color: white, width: 3, alpha: 0.76 });
      gFace.moveTo(cx - 12, my + 10).lineTo(cx + 12, my - 10).stroke({ color: white, width: 3, alpha: 0.76 });
    } else {
      gFace.moveTo(cx - mw / 2, my);
      gFace.quadraticCurveTo(cx, my + curve, cx + mw / 2, my);
      gFace.stroke({ color: white, width: 3, alpha: 0.72 });
    }
  }

  function drawFx(activeActions) {
    gFx.clear();

    const sparkleAction = activeActions.some((action) =>
      ['tap_ack', 'happy', 'greet', 'wave', 'speak'].includes(action.name) && action.weight > 0.05,
    );

    if (anim.mode === 'speaking' || sparkleAction) {
      const intensity = activeActions.reduce((acc, action) => {
        if (['tap_ack', 'happy', 'greet', 'wave', 'speak'].includes(action.name)) {
          return Math.max(acc, action.intensity * action.weight);
        }
        return acc;
      }, 0.5);

      for (let i = 0; i < 10; i++) {
        const x = 70 + ((i * 37 + anim.t * 90) % (s.w - 140));
        const y = 40 + ((i * 29 + anim.t * 60) % (s.h - 80));
        gFx.circle(x, y, 1.2 + intensity * 0.8).fill({ color: anim.accent, alpha: 0.08 + intensity * 0.07 });
      }
    }
  }

  app.ticker.add((ticker) => {
    anim.t += ticker.deltaMS / 1000;
    const activeActions = getActiveActions();
    drawCard();
    drawWeather();
    drawFace(activeActions);
    drawFx(activeActions);
  });

  window.addEventListener('resize', resize);
  resize();

  return {
    setMode,
    setWeather,
    setAttention,
    playAction,
    resize,
  };
}
