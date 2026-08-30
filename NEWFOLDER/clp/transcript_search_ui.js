(() => {
  'use strict';
  if (window.__VKE_TRANSCRIPT_SEARCH_UI_V1__) return;
  window.__VKE_TRANSCRIPT_SEARCH_UI_V1__ = true;

  const FIELD_ID = 'vke-transcript-search-field-v1';
  const PANEL_ID = 'vke-transcript-search-panel-v2';
  const STYLE_ID = 'vke-transcript-search-style-v1';
  const transcripts = new Map();
  let panel = null;
  let activeVideoId = null;
  let activeCues = [];

  const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const fmt = (value) => {
    const n = Math.max(0, Math.round(Number(value) || 0));
    const s = n % 60;
    const m = Math.floor(n / 60) % 60;
    const h = Math.floor(n / 3600);
    const pad = (x) => String(x).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  };

  function styleText() {
    return `
#${FIELD_ID}{
  display:inline-flex!important;align-items:center!important;box-sizing:border-box!important;
  width:142px!important;min-width:142px!important;max-width:142px!important;height:32px!important;
  margin:0 6px!important;padding:0 11px!important;border:1px solid rgba(255,255,255,.16)!important;
  border-radius:9px!important;background:rgba(255,255,255,.10)!important;color:#fff!important;
  outline:none!important;box-shadow:0 2px 10px rgba(0,0,0,.14)!important;
  backdrop-filter:blur(8px)!important;-webkit-backdrop-filter:blur(8px)!important;
  font:500 12px/32px -apple-system,BlinkMacSystemFont,Roboto,sans-serif!important;
  cursor:text!important;opacity:.88!important;transition:width .16s ease,background .16s ease,opacity .16s ease!important;
  flex:0 0 142px!important;vertical-align:middle!important;
}
#${FIELD_ID}:hover{background:rgba(255,255,255,.14)!important;opacity:1!important}
#${FIELD_ID}:focus{background:rgba(255,255,255,.16)!important;opacity:1!important}
#${FIELD_ID}::placeholder{color:rgba(255,255,255,.82)!important;opacity:1!important}
#${FIELD_ID}.vke-transcript-ready{background:rgba(81,129,184,.16)!important;border-color:rgba(139,185,232,.24)!important}
#${PANEL_ID}{
  position:fixed!important;z-index:2147483647!important;width:min(460px,calc(100vw - 24px))!important;
  max-height:min(560px,calc(100vh - 28px))!important;overflow:hidden!important;
  display:flex!important;flex-direction:column!important;box-sizing:border-box!important;
  padding:12px!important;border:1px solid rgba(255,255,255,.12)!important;border-radius:14px!important;
  background:rgba(27,29,32,.96)!important;color:#fff!important;
  box-shadow:0 16px 50px rgba(0,0,0,.52)!important;backdrop-filter:blur(18px)!important;
  -webkit-backdrop-filter:blur(18px)!important;font:13px/18px -apple-system,BlinkMacSystemFont,Roboto,sans-serif!important;
}
#${PANEL_ID} *{box-sizing:border-box!important}
#${PANEL_ID} .vke-txt-head{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;margin-bottom:9px!important}
#${PANEL_ID} .vke-txt-title{font-size:14px!important;font-weight:650!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
#${PANEL_ID} .vke-txt-close{width:30px!important;height:30px!important;border:0!important;border-radius:8px!important;background:transparent!important;color:rgba(255,255,255,.72)!important;font-size:22px!important;line-height:28px!important;cursor:pointer!important}
#${PANEL_ID} .vke-txt-close:hover{background:rgba(255,255,255,.09)!important;color:#fff!important}
#${PANEL_ID} .vke-txt-input{width:100%!important;height:38px!important;padding:8px 11px!important;border:1px solid rgba(255,255,255,.14)!important;border-radius:10px!important;background:rgba(255,255,255,.08)!important;color:#fff!important;outline:none!important;font:500 13px/20px -apple-system,BlinkMacSystemFont,Roboto,sans-serif!important}
#${PANEL_ID} .vke-txt-input:focus{border-color:rgba(139,185,232,.50)!important;background:rgba(255,255,255,.11)!important}
#${PANEL_ID} .vke-txt-status{padding:8px 2px!important;color:rgba(255,255,255,.58)!important;font-size:11px!important;min-height:16px!important}
#${PANEL_ID} .vke-txt-results{min-height:0!important;overflow:auto!important;display:flex!important;flex-direction:column!important;gap:4px!important;padding-right:2px!important}
#${PANEL_ID} .vke-txt-hit{display:block!important;width:100%!important;padding:9px 10px!important;border:0!important;border-radius:9px!important;background:rgba(255,255,255,.055)!important;color:#fff!important;text-align:left!important;cursor:pointer!important;font:13px/18px -apple-system,BlinkMacSystemFont,Roboto,sans-serif!important}
#${PANEL_ID} .vke-txt-hit:hover{background:rgba(81,129,184,.23)!important}
#${PANEL_ID} .vke-txt-time{display:inline-block!important;min-width:42px!important;margin-right:7px!important;color:#9dc6ed!important;font-variant-numeric:tabular-nums!important;vertical-align:top!important}
#${PANEL_ID} .vke-txt-text{color:rgba(255,255,255,.96)!important}
#${PANEL_ID} .vke-txt-empty{padding:18px 5px!important;color:rgba(255,255,255,.52)!important;text-align:center!important}
`;
  }

  function installStyle(root) {
    if (!root?.querySelector || !root?.appendChild) return;
    try {
      if (root.querySelector(`style[${STYLE_ID}]`)) return;
      const style = document.createElement('style');
      style.setAttribute(STYLE_ID, '1');
      style.textContent = styleText();
      root.appendChild(style);
    } catch (_) {}
  }

  function roots() {
    const out = [document];
    const seen = new Set();
    for (let i = 0; i < out.length; i++) {
      const root = out[i];
      if (!root || seen.has(root)) continue;
      seen.add(root);
      try {
        root.querySelectorAll?.('*').forEach((el) => {
          if (el.shadowRoot && !seen.has(el.shadowRoot)) out.push(el.shadowRoot);
        });
      } catch (_) {}
    }
    return out;
  }

  function visibleVideo(video) {
    if (!video?.isConnected) return false;
    try {
      const r = video.getBoundingClientRect();
      return r.width >= 160 && r.height >= 90;
    } catch (_) {
      return false;
    }
  }

  function activeVideo() {
    const candidates = [];
    for (const root of roots()) {
      try {
        for (const v of root.querySelectorAll?.('video') || []) {
          if (!visibleVideo(v)) continue;
          let score = 0;
          const r = v.getBoundingClientRect();
          score += Math.min(r.width * r.height, 6_000_000);
          if (!v.paused && !v.ended) score += 2_000_000;
          if (v.readyState >= 2) score += 100_000;
          if (Number(v.duration) > 0) score += 100_000;
          try { score += (v.textTracks?.length || 0) * 500_000; } catch (_) {}
          if (v.closest?.('vk-video-player,[data-testid="video-player"],[data-testid="player_controls"]')) score += 4_000_000;
          candidates.push({ v, score });
        }
      } catch (_) {}
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.v || null;
  }

  function playerControlsRoot(video) {
    if (!video) return [];
    const rootsToCheck = [];
    try { if (video.getRootNode?.()) rootsToCheck.push(video.getRootNode()); } catch (_) {}
    let n = video;
    for (let i = 0; n && i < 18; i++) {
      try {
        const p = n.parentNode || n.parentElement;
        if (!p) break;
        if (p.querySelector?.('[data-testid="player_controls"]')) rootsToCheck.push(p);
        if (p.host) {
          if (p.host.shadowRoot) rootsToCheck.push(p.host.shadowRoot);
          n = p.host;
        } else {
          n = p;
        }
      } catch (_) { break; }
    }

    const found = [];
    const seen = new Set();
    for (const root of rootsToCheck.concat(roots())) {
      if (!root || seen.has(root)) continue;
      seen.add(root);
      try {
        root.querySelectorAll?.('[data-testid="player_controls"]').forEach((controls) => {
          const left = controls.querySelector('.controls-left,[class*="controls-left"]');
          if (left && !found.includes(left)) found.push(left);
        });
      } catch (_) {}
    }
    return found;
  }

  function removeLegacyButton(root) {
    try { root.querySelector?.('#vke-transcript-search-button-v1')?.remove(); } catch (_) {}
  }

  function ensureField(leftRoot) {
    if (!leftRoot) return null;
    installStyle(leftRoot.getRootNode?.() || leftRoot);
    removeLegacyButton(leftRoot);

    let field = leftRoot.querySelector?.(`#${FIELD_ID}`);
    if (field) return field;

    field = document.createElement('input');
    field.id = FIELD_ID;
    field.type = 'search';
    field.readOnly = true;
    field.autocomplete = 'off';
    field.setAttribute('aria-label', 'Поиск по словам в тексте');
    field.setAttribute('placeholder', 'Поиск по тексту');
    field.title = 'Поиск по словам в тексте';

    const time = leftRoot.querySelector?.('[data-testid="time"]') ||
      leftRoot.querySelector?.('[class*="time"],[data-testid*="time"]');
    const controls = leftRoot.closest?.('[data-testid="player_controls"]');
    const right = controls?.querySelector?.('.controls-right,[class*="controls-right"]');

    if (time?.parentNode === leftRoot) {
      time.parentNode.insertBefore(field, time.nextSibling);
    } else if (right?.parentNode === leftRoot) {
      leftRoot.insertBefore(field, right);
    } else {
      leftRoot.appendChild(field);
    }

    field.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, true);
    field.addEventListener('focus', (e) => {
      e.preventDefault();
      openPanel(field);
    }, true);
    field.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPanel(field);
    }, true);

    updateFieldState(field);
    return field;
  }

  function updateFieldState(field) {
    if (!field) return;
    const ready = activeCues.length > 0;
    field.classList.toggle('vke-transcript-ready', ready);
    field.title = ready ? `Поиск по словам в тексте · ${activeCues.length} фрагм.` : 'Поиск по словам в тексте';
  }

  function normalizeCues(cues) {
    const out = [];
    const seen = new Set();
    for (const c of Array.isArray(cues) ? cues : []) {
      const start = Number(c?.start ?? c?.startTime);
      const end = Number(c?.end ?? c?.endTime);
      const text = String(c?.text ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text) continue;
      const key = `${Math.round(start * 10)}|${Math.round(end * 10)}|${text.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ start, end, text });
    }
    return out.sort((a, b) => a.start - b.start || a.end - b.end);
  }

  function ingestTranscript(detail) {
    const id = String(detail?.videoId ?? '').trim();
    const cues = normalizeCues(detail?.cues);
    if (!id || !cues.length) return;
    transcripts.set(id, cues);
    activeVideoId = id;
    activeCues = cues;
    for (const field of document.querySelectorAll?.(`#${FIELD_ID}`) || []) updateFieldState(field);
    if (panel) renderResults(panel);
  }

  function ingestTextTrack(video, videoId) {
    if (!video || !videoId) return false;
    let best = [];
    try {
      for (const track of Array.from(video.textTracks || [])) {
        if (track.kind && track.kind !== 'subtitles' && track.kind !== 'captions') continue;
        const parsed = normalizeCues(Array.from(track.cues || []));
        if (parsed.length > best.length) best = parsed;
      }
    } catch (_) {}
    if (best.length) {
      transcripts.set(String(videoId), best);
      activeVideoId = String(videoId);
      activeCues = best;
      return true;
    }
    return false;
  }

  function currentIdFromLocation() {
    const text = `${location.href} ${location.pathname}`;
    const m = text.match(/(?:video|clip)(-?\d+_\d+)/i);
    return m?.[1] || null;
  }

  function refreshActiveState() {
    const video = activeVideo();
    const id = activeVideoId || currentIdFromLocation();
    if (!video) return;

    if (id && transcripts.has(String(id))) {
      activeVideoId = String(id);
      activeCues = transcripts.get(String(id)) || [];
    } else if (id) {
      ingestTextTrack(video, String(id));
    }

    for (const left of playerControlsRoot(video)) ensureField(left);
    for (const left of playerControlsRoot(video)) {
      const field = left.querySelector?.(`#${FIELD_ID}`);
      if (field) updateFieldState(field);
    }
  }

  function closePanel() {
    panel?.remove();
    panel = null;
    document.removeEventListener('pointerdown', outsidePanel, true);
  }

  function outsidePanel(e) {
    if (!panel) return;
    const target = e.target;
    if (panel.contains(target)) return;
    for (const field of document.querySelectorAll?.(`#${FIELD_ID}`) || []) {
      if (field === target) return;
    }
    closePanel();
  }

  function seek(start) {
    const video = activeVideo();
    if (!video) return;
    const target = Math.max(0, Math.min(Number(video.duration) || 1e12, Number(start) - 1));
    try {
      video.currentTime = target;
      const p = video.play?.();
      p?.catch?.(() => {});
    } catch (_) {}
  }

  function renderResults(panelNode) {
    const input = panelNode.querySelector('.vke-txt-input');
    const status = panelNode.querySelector('.vke-txt-status');
    const results = panelNode.querySelector('.vke-txt-results');
    if (!input || !status || !results) return;

    const cues = activeCues.length ? activeCues : (activeVideoId ? (transcripts.get(activeVideoId) || []) : []);
    const q = String(input.value || '').trim().toLocaleLowerCase('ru-RU');

    if (!cues.length) {
      status.textContent = 'Текст видео ещё загружается…';
      results.innerHTML = '<div class="vke-txt-empty">Ждём текстовую дорожку видео.</div>';
      return;
    }

    status.textContent = q ? `Найдено фрагментов: ${filterCues(cues, q).length}` : `Текст загружен: ${cues.length} фрагм.`;
    if (!q) {
      results.innerHTML = '<div class="vke-txt-empty">Введите слово или фразу.</div>';
      return;
    }

    const matches = filterCues(cues, q).slice(0, 150);
    if (!matches.length) {
      results.innerHTML = '<div class="vke-txt-empty">Ничего не найдено.</div>';
      return;
    }

    results.innerHTML = matches.map((cue, i) =>
      `<button type="button" class="vke-txt-hit" data-vke-index="${i}"><span class="vke-txt-time">${esc(fmt(cue.start))}</span><span class="vke-txt-text">${esc(cue.text)}</span></button>`
    ).join('');

    results.querySelectorAll('.vke-txt-hit').forEach((button) => {
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cue = matches[Number(button.dataset.vkeIndex)];
        if (cue) seek(cue.start);
        closePanel();
      }, true);
    });
  }

  function filterCues(cues, query) {
    const terms = String(query).split(/\s+/).filter(Boolean);
    return cues.filter((cue) => {
      const text = String(cue.text || '').toLocaleLowerCase('ru-RU');
      return terms.every((term) => text.includes(term));
    });
  }

  function openPanel(anchor) {
    closePanel();
    const video = activeVideo();
    const id = activeVideoId || currentIdFromLocation();
    if (video && id) {
      activeVideoId = String(id);
      if (!transcripts.has(activeVideoId)) ingestTextTrack(video, activeVideoId);
      activeCues = transcripts.get(activeVideoId) || activeCues;
    }

    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="vke-txt-head">
        <div class="vke-txt-title">Поиск по словам в тексте</div>
        <button type="button" class="vke-txt-close" aria-label="Закрыть">×</button>
      </div>
      <input type="search" class="vke-txt-input" autocomplete="off" placeholder="Введите слово или фразу…">
      <div class="vke-txt-status"></div>
      <div class="vke-txt-results"></div>
    `;
    document.body.appendChild(panel);

    panel.querySelector('.vke-txt-close').addEventListener('click', closePanel);
    panel.querySelector('.vke-txt-input').addEventListener('input', () => renderResults(panel));
    panel.querySelector('.vke-txt-input').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePanel();
    });

    const ar = anchor?.getBoundingClientRect?.();
    const width = panel.getBoundingClientRect().width;
    if (ar) {
      const left = Math.max(8, Math.min(innerWidth - width - 8, ar.left));
      panel.style.left = `${left}px`;
      const bottom = Math.max(8, innerHeight - ar.top + 10);
      panel.style.bottom = `${bottom}px`;
    } else {
      panel.style.left = '12px';
      panel.style.bottom = '60px';
    }

    renderResults(panel);
    requestAnimationFrame(() => {
      panel?.querySelector('.vke-txt-input')?.focus();
      document.addEventListener('pointerdown', outsidePanel, true);
    });
  }

  window.addEventListener('vke-transcript-ready', (e) => ingestTranscript(e.detail || {}));
  window.addEventListener('vke-transcript-updated', () => refreshActiveState());

  // The existing segment engine already performs the actual transcript/subtitle
  // acquisition through MAIN -> isolated bridge -> MV3 service worker. This UI
  // deliberately consumes that event and only keeps a local searchable index.
  let timer = 0;
  function tick() {
    refreshActiveState();
    timer = window.setTimeout(tick, 350);
  }

  installStyle(document);
  refreshActiveState();
  tick();
})();
