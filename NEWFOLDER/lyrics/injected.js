(() => {
'use strict';
if (window.__VKE_CLP_INJECTED__) return;
window.__VKE_CLP_INJECTED__ = true;

console.log('[CLP] Injected music bridge loaded');

let last = { currentTime: 0, duration: 0, volume: 1, muted: false, src: '', title: '', artist: '' };
let lastNonZeroVolume = 0.8;
let pendingVolume = null;
let lastTrackKey = '';

function isUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function looksLikeAudioUrl(url) {
  if (!isUrl(url)) return false;
  return /(?:\.mp3|\.m4a|\.aac|\.ogg|\.opus|\.wav)(?:[?#]|$)/i.test(url)
      || /(?:audio|audios|mp3|m4a|stream|track|media|music)/i.test(url);
}

function findUrls(obj, depth = 0, seen = new Set(), out = []) {
  if (obj == null || depth > 8 || out.length >= 50) return out;
  if (typeof obj === 'string') {
    if (looksLikeAudioUrl(obj) && !out.includes(obj)) out.push(obj);
    return out;
  }
  if (typeof obj !== 'object' || seen.has(obj)) return out;
  seen.add(obj);

  if (Array.isArray(obj)) {
    for (const value of obj) findUrls(value, depth + 1, seen, out);
    return out;
  }

  let keys;
  try { keys = Object.keys(obj); } catch { return out; }
  const priority = ['url','src','audio_url','audioUrl','streamUrl','stream_url','downloadUrl','download_url','link','file','media','track'];
  const ordered = [...new Set(priority.concat(keys))];
  for (const key of ordered) {
    try {
      findUrls(obj[key], depth + 1, seen, out);
      if (out.length >= 50) break;
    } catch {}
  }
  return out;
}

function pickAudio() {
  const els = [...document.querySelectorAll('audio, video')];
  return els.find(a => !a.paused && (a.currentSrc || a.src))
      || els.find(a => a.currentSrc || a.src)
      || null;
}

function apState() {
  try {
    const ap = window.ap;
    if (!ap) return null;
    const t = ap.getCurrentTrack?.() || ap.getTrack?.() || ap.cur?.track || ap.currentTrack || null;
    const currentTime = Number(ap.getCurrentTime?.() ?? ap.getPosition?.());
    const duration = Number(ap.getDuration?.());
    const volume = Number(ap.getVolume?.());
    const muted = typeof ap.isMuted === 'function' ? !!ap.isMuted() : null;
    return { ap, t, currentTime, duration, volume, muted };
  } catch {
    return null;
  }
}

function performanceAudioUrl() {
  try {
    const entries = performance.getEntriesByType('resource') || [];
    for (let i = entries.length - 1; i >= 0; i--) {
      const name = entries[i]?.name || '';
      if (looksLikeAudioUrl(name)) return name;
    }
  } catch {}
  return '';
}

function trackMeta(t) {
  t = t || {};
  return {
    title: t.title || t.name || t.trackTitle || t.track_name || '',
    artist: t.artist || t.author || t.artistName || t.artist_name || t.performer || ''
  };
}

function resolveSource(ap, track, audio) {
  const candidates = [];
  const add = value => { if (isUrl(value) && !candidates.includes(value)) candidates.push(value); };

  add(audio?.currentSrc);
  add(audio?.src);
  for (const u of findUrls(track)) add(u);
  for (const u of findUrls(ap?.cur)) add(u);
  if (!candidates.length) for (const u of findUrls(ap)) add(u);
  if (!candidates.length) add(performanceAudioUrl());
  add(last.src);

  return candidates.find(looksLikeAudioUrl) || candidates[0] || '';
}

function emit() {
  const audio = pickAudio();
  const state = apState();
  const meta = trackMeta(state?.t);

  let currentTime = Number.isFinite(state?.currentTime) ? state.currentTime : NaN;
  let duration = Number.isFinite(state?.duration) ? state.duration : NaN;
  let volume = Number.isFinite(state?.volume) ? state.volume : NaN;
  let muted = state?.muted === null || state?.muted === undefined ? null : !!state.muted;

  if (!Number.isFinite(currentTime) && audio) currentTime = Number(audio.currentTime);
  if (!Number.isFinite(duration) && audio) duration = Number(audio.duration);
  if (!Number.isFinite(volume) && audio) volume = Number(audio.volume);
  if (muted === null && audio) muted = !!audio.muted;

  if (pendingVolume !== null && Date.now() - pendingVolume.at < 1200) {
    volume = pendingVolume.value;
    muted = pendingVolume.value === 0;
  } else {
    pendingVolume = null;
  }

  if (!Number.isFinite(currentTime)) currentTime = last.currentTime || 0;
  if (!Number.isFinite(duration)) duration = last.duration || 0;
  if (!Number.isFinite(volume)) volume = last.volume ?? 1;
  volume = Math.max(0, Math.min(1, volume));

  if (volume > 0.001) lastNonZeroVolume = volume;
  if (muted === null) muted = volume <= 0.001;

  const source = resolveSource(state?.ap, state?.t, audio);
  const key = `${meta.artist}::${meta.title}::${source}`;
  if (key !== lastTrackKey && meta.title) {
    lastTrackKey = key;
    pendingVolume = null;
  }

  const msg = {
    type: 'CLP_STATE',
    currentTime,
    duration,
    volume,
    muted,
    src: source,
    title: meta.title,
    artist: meta.artist
  };
  last = msg;
  window.postMessage(msg, '*');
  return msg;
}

function setVolume(value) {
  const v = Math.max(0, Math.min(1, Number(value) || 0));
  if (v > 0.001) lastNonZeroVolume = v;
  pendingVolume = { value: v, at: Date.now() };

  try {
    if (window.ap?.setVolume) window.ap.setVolume(v);
    else if (window.ap?.volume !== undefined) window.ap.volume = v;
  } catch (e) {
    console.warn('[CLP] ap.setVolume failed:', e);
  }

  const audio = pickAudio();
  if (audio) {
    try { audio.volume = v; } catch {}
    try { audio.muted = v === 0; } catch {}
  }
  emit();
}

function toggleMute() {
  const current = Number.isFinite(last.volume) ? last.volume : 1;
  if (last.muted || current <= 0.001) setVolume(lastNonZeroVolume || 0.8);
  else setVolume(0);
}

window.addEventListener('message', e => {
  const data = e.data || {};
  if (data.type === 'CLP_REQUEST_STATE') {
    emit();
    return;
  }
  if (data.type === 'CLP_SET_VOLUME') {
    setVolume(data.volume);
    return;
  }
  if (data.type === 'CLP_TOGGLE_MUTE') {
    toggleMute();
  }
});

setInterval(emit, 200);
new MutationObserver(() => emit()).observe(document.documentElement, { subtree: true, childList: true });
window.addEventListener('loadedmetadata', emit, true);
window.addEventListener('play', emit, true);
window.addEventListener('pause', emit, true);
window.addEventListener('volumechange', emit, true);

autoInit:
emit();
})();
