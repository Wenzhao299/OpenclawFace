// Minimal UI shell that only mutates small DOM nodes (avoids full re-render).

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function createShell(rootEl, { wsUrl }) {
  rootEl.innerHTML = `
    <div class="screen" id="screen" data-weather="clear">
      <div class="top">
        <div class="badge bad" id="ws-badge">WS DISCONNECTED</div>
        <div class="meta">
          <div class="row"><span class="k">mode</span><span class="v" id="meta-mode">idle</span></div>
          <div class="row"><span class="k">tool</span><span class="v" id="meta-tool">-</span></div>
          <div class="row"><span class="k">cog</span><span class="v" id="meta-cog">idle / idle · 35%</span></div>
          <div class="row"><span class="k">bond</span><span class="v" id="meta-bond">28%</span></div>
          <div class="row"><span class="k">thought</span><span class="v" id="meta-thought">-</span></div>
          <div class="row"><span class="k">weather</span><span class="v" id="meta-weather">clear</span></div>
          <div class="row"><span class="k">now</span><span class="v" id="meta-now">--:--</span></div>
          <div class="row"><span class="k">wx@</span><span class="v" id="meta-wx-time">--:--</span></div>
        </div>
      </div>

      <div class="center">
        <div class="stage">
          <div id="face-stage" class="face-stage"></div>
          <div id="thought-bubble" class="thought-bubble mood-neutral">
            <div class="thought-label" id="thought-label">idle · 35%</div>
            <div id="thought-text" class="thought-text">-</div>
          </div>
        </div>
      </div>

      <div class="bottom">
        <div class="small">WS: <code id="meta-ws">-</code></div>
        <div class="small">Last: <code id="meta-last">-</code></div>
      </div>
    </div>
  `;

  const els = {
    screen: rootEl.querySelector('#screen'),
    badge: rootEl.querySelector('#ws-badge'),
    mode: rootEl.querySelector('#meta-mode'),
    tool: rootEl.querySelector('#meta-tool'),
    cog: rootEl.querySelector('#meta-cog'),
    bond: rootEl.querySelector('#meta-bond'),
    thought: rootEl.querySelector('#meta-thought'),
    weather: rootEl.querySelector('#meta-weather'),
    now: rootEl.querySelector('#meta-now'),
    wxTime: rootEl.querySelector('#meta-wx-time'),
    ws: rootEl.querySelector('#meta-ws'),
    last: rootEl.querySelector('#meta-last'),
    stage: rootEl.querySelector('#face-stage'),
    thoughtBubble: rootEl.querySelector('#thought-bubble'),
    thoughtLabel: rootEl.querySelector('#thought-label'),
    thoughtText: rootEl.querySelector('#thought-text'),
  };

  els.ws.textContent = wsUrl;

  function setConnected(ok) {
    els.badge.className = `badge ${ok ? 'ok' : 'bad'}`;
    els.badge.textContent = ok ? 'WS OK' : 'WS DISCONNECTED';
  }

  function setMode(mode) {
    els.mode.textContent = mode;
    els.screen.className = `screen mode-${mode}`;
  }

  function setTool(name) {
    els.tool.textContent = name || '-';
  }

  function setThought(text, mood = 'neutral', thoughtState = 'idle', confidence = 0.35) {
    const clean = typeof text === 'string' ? text.trim() : '';
    const hasText = clean.length > 0;
    const conf = Math.round(clamp(Number(confidence) || 0, 0, 1) * 100);

    els.thought.textContent = hasText ? clean : '-';
    els.thoughtLabel.textContent = `${thoughtState || 'idle'} · ${conf}%`;

    els.thoughtBubble.className = `thought-bubble mood-${mood || 'neutral'}${hasText ? ' show' : ''}`;
    els.thoughtText.textContent = hasText ? clean : '-';
  }

  function setCognition(stateName, intent, confidence, queueDepth = 0) {
    const conf = Math.round(clamp(Number(confidence) || 0, 0, 1) * 100);
    const suffix = queueDepth > 0 ? ` q:${queueDepth}` : '';
    els.cog.textContent = `${stateName || 'idle'} / ${intent || 'idle'} · ${conf}%${suffix}`;
  }

  function setBond(bond, trust, engagement) {
    const b = Math.round(clamp(Number(bond) || 0, 0, 1) * 100);
    const t = Math.round(clamp(Number(trust) || 0, 0, 1) * 100);
    const e = Math.round(clamp(Number(engagement) || 0, 0, 1) * 100);
    els.bond.textContent = `${b}% t${t} e${e}`;
  }

  function setWeather(kind, tempC) {
    els.screen.dataset.weather = kind || 'clear';
    els.weather.textContent = `${kind || 'clear'}${tempC != null ? ` ${Math.round(tempC)}°C` : ''}`;
  }

  function setWeatherTime(t) {
    els.wxTime.textContent = t || '--:--';
  }

  function setNow(t) {
    els.now.textContent = t;
  }

  function setLast(obj) {
    els.last.textContent = obj;
  }

  return {
    els,
    setConnected,
    setMode,
    setTool,
    setThought,
    setCognition,
    setBond,
    setWeather,
    setWeatherTime,
    setNow,
    setLast,
  };
}
