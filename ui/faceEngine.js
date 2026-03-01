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
    case 'happy':
      return { valence: 0.85, arousal: 0.62, accent: COLORS.ok };
    case 'angry':
      return { valence: -0.75, arousal: 0.9, accent: COLORS.err };
    case 'sad':
      return { valence: -0.56, arousal: 0.22, accent: COLORS.fog };
    case 'sleep':
      return { valence: 0.08, arousal: 0.03, accent: COLORS.fog };
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
    case 'sleepy':
    case 'tool_focus':
      return 'eyes';
    case 'speak':
      return 'mouth';
    case 'angry':
    case 'sad':
    case 'sleep':
    case 'wave':
    case 'greet':
    case 'happy':
    case 'tap_ack':
      return 'core';
    default:
      return 'core';
  }
}

function modeFaceProfile(mode) {
  switch (mode) {
    case 'listening':
      return { eyeOpenMul: 0.98, eyeRound: 0.1, eyeNarrow: 0.05, eyeTilt: 0, mouthCurve: 1.4, mouthWidth: 0, mouthStyle: 'listening', attStrength: 0.9, blinkMin: 0.16 };
    case 'thinking':
      return { eyeOpenMul: 0.76, eyeRound: 0.03, eyeNarrow: 0.3, eyeTilt: 0.12, mouthCurve: 0.2, mouthWidth: -8, mouthStyle: 'thinking', attStrength: 0.6, blinkMin: 0.14 };
    case 'tool':
      return { eyeOpenMul: 0.62, eyeRound: 0.01, eyeNarrow: 0.46, eyeTilt: 0.22, mouthCurve: -0.8, mouthWidth: -10, mouthStyle: 'tool', attStrength: 0.52, blinkMin: 0.11 };
    case 'speaking':
      return { eyeOpenMul: 0.96, eyeRound: 0.12, eyeNarrow: 0.06, eyeTilt: 0, mouthCurve: 2, mouthWidth: 0, mouthStyle: 'speaking', attStrength: 0.62, blinkMin: 0.18 };
    case 'happy':
      return { eyeOpenMul: 0.82, eyeRound: 0.2, eyeNarrow: 0.2, eyeTilt: -0.1, mouthCurve: 10.5, mouthWidth: 8, mouthStyle: 'happy', attStrength: 0.82, blinkMin: 0.15 };
    case 'angry':
      return { eyeOpenMul: 0.52, eyeRound: 0, eyeNarrow: 0.66, eyeTilt: 0.56, mouthCurve: -10.5, mouthWidth: -10, mouthStyle: 'angry', attStrength: 0.34, blinkMin: 0.08 };
    case 'sad':
      return { eyeOpenMul: 0.62, eyeRound: 0.06, eyeNarrow: 0.34, eyeTilt: -0.44, mouthCurve: -11, mouthWidth: 5, mouthStyle: 'sad', attStrength: 0.38, blinkMin: 0.1 };
    case 'sleep':
      return { eyeOpenMul: 0.14, eyeRound: 0, eyeNarrow: 0.92, eyeTilt: -0.08, mouthCurve: -1.8, mouthWidth: -12, mouthStyle: 'sleep', attStrength: 0.22, blinkMin: 0.04 };
    case 'error':
      return { eyeOpenMul: 0.56, eyeRound: 0, eyeNarrow: 0.52, eyeTilt: 0.46, mouthCurve: -8, mouthWidth: -6, mouthStyle: 'error', attStrength: 0.35, blinkMin: 0.08 };
    default:
      return { eyeOpenMul: 1, eyeRound: 0.05, eyeNarrow: 0.04, eyeTilt: 0, mouthCurve: 0, mouthWidth: 0, mouthStyle: 'default', attStrength: 1, blinkMin: 0.18 };
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
    anim.weather = typeof kind === 'string' && kind ? kind : 'clear';
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
      // Smaller and slower rain for a softer panel style.
      for (let i = 0; i < 52; i++) {
        const x = (i * 13 + ((anim.t * 88) + i * 7) % s.w) % s.w;
        const y = (i * 17 + ((anim.t * 182) + i * 11) % (s.h + 36)) - 18;
        const len = 4.2 + (i % 3) * 1.2;
        gWeather.roundRect(x, y, 1.05, len, 1).fill({ color: tint, alpha: 0.11 });
        if (i % 7 === 0) {
          gWeather.circle(x + 0.5, y + len + 0.7, 0.6).fill({ color: tint, alpha: 0.1 });
        }
      }
    } else if (anim.weather === 'snow') {
      for (let i = 0; i < 30; i++) {
        const x = (i * 21 + (anim.t * 26) % s.w) % s.w;
        const y = (i * 33 + (anim.t * 44) % s.h) % s.h;
        const r = 0.85 + ((i % 3) * 0.5);
        gWeather.circle(x, y, r).fill({ color: tint, alpha: 0.16 });
      }
    } else if (anim.weather === 'fog') {
      for (let i = 0; i < 5; i++) {
        const yy = 58 + i * 28;
        const xx = ((anim.t * 9) % 100) - 50;
        gWeather.roundRect(50 + xx, yy, s.w - 100, 18, 12).fill({ color: tint, alpha: 0.05 });
      }
    } else if (anim.weather === 'cloudy') {
      for (let i = 0; i < 6; i++) {
        const baseX = 70 + ((i * 68 + anim.t * 8) % (s.w - 140));
        const baseY = 62 + (i % 3) * 34;
        gWeather.circle(baseX, baseY, 14).fill({ color: COLORS.fog, alpha: 0.09 });
        gWeather.circle(baseX + 12, baseY + 2, 11).fill({ color: COLORS.fog, alpha: 0.08 });
        gWeather.circle(baseX - 11, baseY + 4, 9).fill({ color: COLORS.fog, alpha: 0.07 });
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
        target.mouthCurve += 2.5 * i;
        target.mouthWidth += 2 * i;
        target.mouthAmp += 3 * i;
        target.eyeRound += 0.08 * i;
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
        target.mouthCurve += 3 * i;
        target.eyeRound += 0.08 * i;
        target.blush += 0.03 * i;
        break;
      case 'wink': {
        const wink = p < 0.5 ? p * 2 : (1 - p) * 2;
        target.rightWink *= clamp(1 - wink * 0.92 * i, 0.08, 1);
        target.eyeRound += 0.04 * i;
        target.smile += 4 * i;
        break;
      }
      case 'curious':
        target.lookX += Math.sin(p * Math.PI * 2) * 6 * i;
        target.lookY += Math.sin(p * Math.PI * 2) * 2.5 * i;
        target.headY += Math.sin(p * Math.PI) * -2 * i;
        target.eyeTilt += 0.06 * i;
        target.eyeRound += 0.12 * i;
        target.smile += 1.5 * i;
        break;
      case 'happy':
        target.smile += 7 * i;
        target.mouthCurve += 8 * i;
        target.mouthWidth += 6 * i;
        target.mouthAmp += 2 * i;
        target.eyeRound += 0.16 * i;
        target.eyeNarrow += 0.08 * i;
        target.eyeTilt += -0.14 * i;
        target.mouthStyle = 'happy';
        target.blush += 0.06 * i;
        break;
      case 'tool_focus':
        target.lookX += Math.sin(p * Math.PI * 8) * 7 * i;
        target.lookY += Math.cos(p * Math.PI * 6) * 1.4 * i;
        target.eyeNarrow += 0.32 * i;
        target.eyeTilt += 0.3 * i;
        target.mouthStyle = 'tool';
        target.mouthAmp += 1 * i;
        break;
      case 'speak':
        target.smile += 2 * i;
        target.mouthAmp += 3.5 * i;
        target.eyeOpenMul *= clamp(1 + 0.06 * i, 1, 1.2);
        target.forceSpeaking = true;
        break;
      case 'angry':
        target.lookX += loop * 2 * i;
        target.lookY += -pulse * 1.6 * i;
        target.smile += -8 * i;
        target.mouthCurve += -10 * i;
        target.mouthWidth += -8 * i;
        target.eyeOpenMul *= clamp(1 - 0.28 * i, 0.5, 1);
        target.eyeNarrow += 0.48 * i;
        target.eyeTilt += 0.56 * i;
        target.mouthStyle = 'angry';
        break;
      case 'sad':
        target.lookY += pulse * 1.4 * i;
        target.smile += -7 * i;
        target.mouthCurve += -9 * i;
        target.mouthWidth += 4 * i;
        target.eyeOpenMul *= clamp(1 - 0.2 * i, 0.54, 1);
        target.eyeRound += 0.03 * i;
        target.eyeNarrow += 0.2 * i;
        target.eyeTilt += -0.44 * i;
        target.mouthStyle = 'sad';
        break;
      case 'sleep':
      case 'sleepy':
        target.lookY += pulse * 1.8 * i;
        target.smile += -1.5 * i;
        target.mouthCurve += -2.2 * i;
        target.mouthWidth += -12 * i;
        target.eyeOpenMul *= clamp(1 - 0.72 * i, 0.08, 1);
        target.eyeNarrow += 0.88 * i;
        target.eyeTilt += -0.08 * i;
        target.mouthStyle = 'sleep';
        break;
      default:
        target.smile += pulse * 3 * i;
        target.mouthCurve += pulse * 1.2 * i;
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

    const profile = modeFaceProfile(anim.mode);
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
      mouthCurve: 0,
      mouthWidth: 0,
      blush: 0,
      eyeOpenMul: 1,
      eyeNarrow: 0,
      eyeRound: 0,
      eyeTilt: 0,
      leftWink: 1,
      rightWink: 1,
      forceSpeaking: false,
      mouthStyle: '',
    };

    for (const action of activeActions) {
      applyActionInfluence(actionMods, action);
    }

    const eyeY = 118 + breath + actionMods.headY;
    const eyeDX = 60;

    // base autonomous eye movement + pointer attention
    const autoLookX =
      anim.mode === 'thinking'
        ? Math.sin(anim.t * 1.4) * 3.6 + Math.cos(anim.t * 0.8) * 1.5
        : anim.mode === 'tool'
          ? Math.sin(anim.t * 6.0) * 6.8
          : anim.mode === 'listening'
            ? Math.sin(anim.t * 10.0) * 2.2
            : anim.mode === 'sleep'
              ? Math.sin(anim.t * 0.3) * 0.6
            : Math.sin(anim.t * 0.7) * 1.0;
    const autoLookY =
      anim.mode === 'thinking'
        ? Math.sin(anim.t * 1.2 + 0.8) * 2.4
        : anim.mode === 'tool'
          ? Math.sin(anim.t * 4.7 + 0.2) * 1.5
          : anim.mode === 'listening'
            ? Math.sin(anim.t * 7.5 + 0.6) * 0.8
            : anim.mode === 'sleep'
              ? Math.sin(anim.t * 0.4 + 0.4) * 0.7
            : Math.sin(anim.t * 0.6) * 0.5;

    const attX = (anim.attX - 0.5) * 18 * profile.attStrength;
    const attY = (anim.attY - 0.5) * 14 * profile.attStrength;
    const lookX = clamp(autoLookX + attX + actionMods.lookX, -14, 14);
    const lookY = clamp(autoLookY + attY + actionMods.lookY, -11, 11);

    // blink frequency from arousal
    const blinkPeriod = anim.mode === 'sleep' ? lerp(8.4, 5.2, clamp(anim.arousal, 0, 1)) : lerp(5.4, 2.2, clamp(anim.arousal, 0, 1));
    const blinkPhase = anim.t % blinkPeriod;
    let blink = 1;
    if (blinkPhase > blinkPeriod - 0.12) {
      const t = (blinkPhase - (blinkPeriod - 0.12)) / 0.12;
      blink = lerp(1, 0.12, easeInOut(Math.sin(t * Math.PI)));
    }
    if (anim.mode === 'sleep') {
      blink = Math.min(blink, 0.42 + Math.sin(anim.t * 0.45) * 0.05);
    }

    const narrow = clamp(profile.eyeNarrow + actionMods.eyeNarrow, 0, 1.2);
    const round = clamp(profile.eyeRound + actionMods.eyeRound, 0, 0.62);
    const eyeTilt = clamp(profile.eyeTilt + actionMods.eyeTilt, -1, 1);
    const eyeOpenMul = clamp(profile.eyeOpenMul * actionMods.eyeOpenMul, 0.08, 1.24);
    const eyeOpenMin = clamp(profile.blinkMin * (anim.mode === 'sleep' ? 0.45 : 1), 0.04, 0.34);

    let eyeOpen = blink * eyeOpenMul;
    eyeOpen -= narrow * 0.42;
    eyeOpen += round * 0.14;
    eyeOpen = clamp(eyeOpen, eyeOpenMin, 1.08);

    const baseEye = lerp(14.5, 20.5, clamp(anim.valence + 0.5, 0, 1));
    const eyeW = clamp(baseEye * (1 + round * 0.3 - narrow * 0.08), 11, 24);
    const eyeH = clamp(baseEye * eyeOpen * (1 + narrow * 0.06), 1.4, 22);
    const eyeHLeft = eyeH * actionMods.leftWink;
    const eyeHRight = eyeH * actionMods.rightWink;
    const mouthStyle = actionMods.mouthStyle || profile.mouthStyle;

    const white = COLORS.white;

    // cheeks (blush) depends on valence
    const blushAlpha = clamp((anim.valence + 0.2) * 0.2 + actionMods.blush + (anim.mode === 'happy' ? 0.02 : 0), 0, 0.3);
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
      const rx = eyeW * breathScale;
      const ry = Math.max(2.6, eyeHeight * breathScale);
      const innerShift = eyeTilt * ry * 0.42;
      const outerShift = -eyeTilt * ry * 0.26;
      const startShift = dir === 1 ? innerShift : outerShift;
      const endShift = dir === 1 ? outerShift : innerShift;
      const midShift = eyeTilt * ry * 0.12 * dir;

      if (ry < 4.2) {
        const lidCurve = 2.9 + narrow * 2.7 + Math.abs(eyeTilt) * 1.2;
        gFace.moveTo(ex - rx * 0.78, ey + startShift);
        gFace.quadraticCurveTo(ex, ey + lidCurve + midShift, ex + rx * 0.78, ey + endShift);
        gFace.stroke({ color: white, width: 3, alpha: 0.86 });
      } else {
        gFace.ellipse(ex, ey, rx, ry).fill({ color: white, alpha: 0.94 });
      }
    }

    // mouth
    const my = 178 + breath + actionMods.headY;
    const mw = clamp(42 + profile.mouthWidth + actionMods.mouthWidth, 16, 62);
    const smile = clamp(anim.valence, -1, 1);
    const curve = clamp(smile * 10 + profile.mouthCurve + actionMods.mouthCurve + actionMods.smile, -18, 18);
    const forceSpeaking = actionMods.forceSpeaking;

    if (anim.mode === 'speaking' || forceSpeaking) {
      const amp = clamp(4.2 + Math.sin(anim.t * 16) * 1.7 + actionMods.mouthAmp, 2, 11);
      const half = mw * 0.46;
      gFace.moveTo(cx - half, my);
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const x = lerp(cx - half, cx + half, t);
        const wave = Math.sin(anim.t * 14 + t * Math.PI * 2) * amp * 0.35;
        const arch = Math.sin(t * Math.PI) * amp;
        gFace.lineTo(x, my + arch + wave);
      }
      for (let i = 8; i >= 0; i--) {
        const t = i / 8;
        const x = lerp(cx - half, cx + half, t);
        const wave = Math.sin(anim.t * 14 + t * Math.PI * 2 + 0.4) * amp * 0.18;
        const arch = Math.sin(t * Math.PI) * (amp * 0.5);
        gFace.lineTo(x, my + arch + 5 + wave);
      }
      gFace.closePath();
      gFace.fill({ color: white, alpha: 0.16 });
      gFace.stroke({ color: white, width: 2.6, alpha: 0.8 });
    } else if (mouthStyle === 'listening') {
      const w = clamp(26 + actionMods.mouthAmp * 1.1, 18, 34);
      const c = 3.4 + actionMods.mouthAmp * 0.28;
      gFace.moveTo(cx - w / 2, my + 1.5);
      gFace.quadraticCurveTo(cx, my + c, cx + w / 2, my + 1.5);
      gFace.stroke({ color: white, width: 2.8, alpha: 0.76 });
      gFace.moveTo(cx - w * 0.18, my - 0.7);
      gFace.quadraticCurveTo(cx, my - 1.8, cx + w * 0.18, my - 0.7);
      gFace.stroke({ color: anim.accent, width: 1.4, alpha: 0.28 });
    } else if (mouthStyle === 'thinking') {
      const w = clamp(24 + actionMods.mouthAmp * 1.3, 18, 30);
      const sway = Math.sin(anim.t * 4.5) * 1.1;
      gFace.moveTo(cx - w / 2, my + 2);
      gFace.quadraticCurveTo(cx - w * 0.18, my + 6.4 + sway, cx, my + 2.6);
      gFace.quadraticCurveTo(cx + w * 0.18, my - 1 + sway * 0.4, cx + w / 2, my + 2);
      gFace.stroke({ color: white, width: 2.8, alpha: 0.8 });
      gFace.moveTo(cx - w * 0.16, my - 0.6);
      gFace.quadraticCurveTo(cx, my - 2.4, cx + w * 0.16, my - 0.6);
      gFace.stroke({ color: anim.accent, width: 1.4, alpha: 0.28 });
    } else if (mouthStyle === 'tool') {
      const w = clamp(26 + actionMods.mouthAmp * 1.2, 18, 34);
      gFace.moveTo(cx - w / 2, my + 1);
      gFace.lineTo(cx - w * 0.16, my - 2.8);
      gFace.lineTo(cx + w * 0.16, my - 2.8);
      gFace.lineTo(cx + w / 2, my + 1);
      gFace.stroke({ color: white, width: 3, alpha: 0.76 });
      gFace.moveTo(cx - w * 0.3, my + 6);
      gFace.quadraticCurveTo(cx, my + 8 + actionMods.mouthAmp * 0.2, cx + w * 0.3, my + 6);
      gFace.stroke({ color: anim.accent, width: 1.8, alpha: 0.32 });
    } else if (mouthStyle === 'happy') {
      const w = clamp(38 + actionMods.mouthAmp * 1.3, 28, 50);
      gFace.moveTo(cx - w / 2, my - 1);
      gFace.quadraticCurveTo(cx, my + 12 + actionMods.mouthAmp * 0.5, cx + w / 2, my - 1);
      gFace.stroke({ color: white, width: 3.2, alpha: 0.8 });
      gFace.moveTo(cx - w * 0.24, my + 1.2);
      gFace.quadraticCurveTo(cx, my + 5.2, cx + w * 0.24, my + 1.2);
      gFace.stroke({ color: anim.accent, width: 1.6, alpha: 0.32 });
    } else if (mouthStyle === 'angry') {
      const w = clamp(24 + actionMods.mouthAmp * 0.9, 18, 30);
      gFace.moveTo(cx - w / 2, my + 2.2);
      gFace.lineTo(cx + w / 2, my + 2.2);
      gFace.stroke({ color: white, width: 3.2, alpha: 0.86 });
      gFace.moveTo(cx - w * 0.32, my + 5.8);
      gFace.quadraticCurveTo(cx, my + 8.4, cx + w * 0.32, my + 5.8);
      gFace.stroke({ color: anim.accent, width: 1.5, alpha: 0.28 });
    } else if (mouthStyle === 'sad') {
      const w = clamp(30 + actionMods.mouthAmp * 0.8, 22, 38);
      gFace.moveTo(cx - w / 2, my + 4.6);
      gFace.quadraticCurveTo(cx, my - 2.8, cx + w / 2, my + 4.6);
      gFace.stroke({ color: white, width: 3, alpha: 0.78 });
      gFace.moveTo(cx - w * 0.16, my + 2.8);
      gFace.quadraticCurveTo(cx, my + 0.8, cx + w * 0.16, my + 2.8);
      gFace.stroke({ color: anim.accent, width: 1.3, alpha: 0.22 });
    } else if (mouthStyle === 'sleep') {
      const w = clamp(16 + actionMods.mouthAmp * 0.6, 12, 22);
      gFace.moveTo(cx - w / 2, my + 3.1);
      gFace.lineTo(cx + w / 2, my + 3.1);
      gFace.stroke({ color: white, width: 2.8, alpha: 0.74 });
    } else if (mouthStyle === 'error') {
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

    const sleepyAction = activeActions.some((action) =>
      ['sleep', 'sleepy'].includes(action.name) && action.weight > 0.05,
    );
    if (anim.mode === 'sleep' || sleepyAction) {
      for (let i = 0; i < 4; i++) {
        const drift = ((anim.t * 16) + i * 7) % 22;
        const x = 304 + i * 13;
        const y = 90 - i * 11 - drift;
        const r = Math.max(0.9, 2.2 - i * 0.35);
        gFx.circle(x, y, r).fill({ color: COLORS.fog, alpha: 0.16 - i * 0.03 });
      }
    }

    const angryAction = activeActions.some((action) =>
      ['angry'].includes(action.name) && action.weight > 0.05,
    );
    if (anim.mode === 'angry' || anim.mode === 'error' || angryAction) {
      const pulse = 0.5 + Math.sin(anim.t * 8) * 0.5;
      for (const dir of [-1, 1]) {
        const x = s.w / 2 + dir * 84;
        const y = 88;
        gFx.moveTo(x, y);
        gFx.lineTo(x + dir * 10, y - 8 - pulse * 3);
        gFx.lineTo(x + dir * 4, y + 6);
        gFx.stroke({ color: COLORS.err, width: 2, alpha: 0.25 + pulse * 0.18 });
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
