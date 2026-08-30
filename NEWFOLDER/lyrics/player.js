(function () {
'use strict';

// ─── Состояние ───────────────────────────────────────────────────────────────
let updateInterval      = null;
let globalModalObserver = null;
let trackObserver       = null;
let currentSource       = 'vk';
let isDraggingVol       = false;
let isUserScrolling     = false;
let scrollTimeout       = null;
let rafId               = null;
let trackCurrentTime    = 0;
let trackDuration       = 0;
let lastStateMsgAt      = 0;
let lyricsTick          = 0;
let autoSearchAborted   = false;
let currentTrackKey     = '';

const LYRICS_EVERY_N_TICKS = 2;

// ─── Настройки перевода ──────────────────────────────────────────────────────
const TRANSLATE_CACHE_KEY = 'clp_translate_cache_v1';

// ── Кэш текстов с таймингами ─────────────────────────────────────────────────
let externalLyricsCache  = {};
let externalLyricsErrors = {};

// ─── Приоритет источников для авто-поиска ────────────────────────────────────
const AUTO_SEARCH_ORDER = [
    'lrclib', 'genius', 'azlyrics', 'musixmatch', 'lyricsfreak', 'muzexo'
];

// ─── Источники ───────────────────────────────────────────────────────────────
const LYRIC_SOURCES = [
    { id: 'lrclib',      label: 'LRClib',      color: '#a78bfa' },
    { id: 'genius',      label: 'Genius',      color: '#f5c518' },
    { id: 'azlyrics',    label: 'AZLyrics',    color: '#4fc3f7' },
    { id: 'musixmatch',  label: 'Musixmatch',  color: '#ff5722' },
    { id: 'lyricsfreak', label: 'LyricsFreak', color: '#66bb6a' },
    { id: 'muzexo',      label: 'Muzexo',      color: '#e879f9' }
];

// Доступ к парсерам из clp/parsers.js (загружается раньше, см. manifest.json)
function getParsers() { return window.CLP_PARSERS || {}; }

// ═══════════════════════════════════════════════════════════════════════════
//  СТИЛИ
// ═══════════════════════════════════════════════════════════════════════════
function injectAntiFlickerStyles() {
    if (document.getElementById('clp-custom-styles')) return;
    const style = document.createElement('style');
    style.id = 'clp-custom-styles';
    style.innerHTML = `
[data-testid="audio-lyrics-modal"]:has(.custom-lyrics-player) .MusicLyricsLayout__content--N06YG,
[data-testid="audio-lyrics-modal"]:has(.custom-lyrics-player) [data-testid="static-audio-lyrics"],
[data-testid="audio-lyrics-modal"]:has(.custom-lyrics-player) .styles__content--DtsmN > *:not(.custom-lyrics-player) {
    display: none !important; visibility: hidden !important; opacity: 0 !important; pointer-events: none !important;
}
.MusicLyricsPlayer__timeWrapper--chZzC { display: none !important; }
[data-testid="audio_lyrics_progress_bar"] {
    position: relative !important; flex: 1 !important; min-width: 80px !important;
    height: 18px !important; display: flex !important; align-items: center !important; margin: 0 !important;
}
[data-testid="audio_lyrics_progress_bar"] > div:not(.clp-progress-track):not(.clp-progress-fill) {
    width: 100% !important; cursor: pointer !important; display: flex !important; align-items: center !important;
}
[data-testid="audio_lyrics_progress_bar"] > div > div { opacity: 0 !important; pointer-events: auto !important; }
[data-testid="audio_lyrics_progress_bar"] [role="slider"] { background: transparent !important; }
.clp-progress-track {
    position: absolute !important; left: 0 !important; right: 0 !important; top: 50% !important;
    transform: translateY(-50%) !important; height: 4px !important; border-radius: 2px !important;
    background: rgba(255, 255, 255, 0.18) !important; pointer-events: none !important;
}
.clp-progress-fill {
    position: absolute !important; left: 0 !important; top: 50% !important;
    transform: translateY(-50%) !important; height: 4px !important; width: 0% !important;
    border-radius: 2px !important; background: #5181b8 !important; pointer-events: none !important;
}
.clp-slider-wrapper {
    display: flex !important; flex-direction: column !important; align-items: stretch !important;
    width: 100% !important; padding: 8px 12px 8px 16px !important; margin-top: 4px !important;
    box-sizing: border-box !important; background: rgba(30, 30, 32, 0.9) !important;
    border-radius: 14px !important; border: 1px solid rgba(255, 255, 255, 0.06) !important; gap: 4px !important;
}
.clp-slider-row {
    display: flex !important; align-items: center !important; width: 100% !important;
    gap: 8px !important; justify-content: flex-start !important;
}
.clp-slider-time {
    color: #d8d8d8 !important; font-size: 12px !important; font-variant-numeric: tabular-nums !important;
    min-width: 30px !important; user-select: none !important; font-weight: 600 !important;
}
.clp-slider-time-right { text-align: right !important; }
[data-testid="audioplayerplaybackcontrols"] {
    display: flex !important; flex-wrap: nowrap !important; justify-content: center !important;
    align-items: center !important; gap: 6px !important; padding: 6px 12px !important; margin: 0 !important;
    background: rgba(255, 255, 255, 0.06) !important; border-radius: 12px !important;
    border: 1px solid rgba(255, 255, 255, 0.06) !important; width: 100% !important;
    order: -1 !important; box-sizing: border-box !important;
}
[data-testid="audioplayerplaybackcontrols"] button {
    margin: 0 !important; background: transparent !important; color: rgba(255, 255, 255, 0.8) !important; flex-shrink: 0 !important;
}
[data-testid="audioplayerplaybackcontrols"] button:hover { color: #fff !important; }
[data-testid="audio-player-controls-backward-button"],
[data-testid="audio-player-controls-forward-button"] { width: 28px !important; height: 28px !important; }
[data-testid="audio-player-controls-backward-button"] svg,
[data-testid="audio-player-controls-forward-button"] svg { width: 20px !important; height: 20px !important; }
[data-testid="audio-player-controls-state-button"] {
    width: 36px !important; height: 36px !important; border-radius: 50% !important; background: #ffffff !important;
    display: flex !important; align-items: center !important; justify-content: center !important; flex-shrink: 0 !important;
}
[data-testid="audio-player-controls-state-button"]:hover { background: #f0f0f0 !important; transform: scale(1.04) !important; }
[data-testid="audio-player-controls-state-button"] svg { width: 18px !important; height: 18px !important; fill: #111 !important; color: #111 !important; }
.clp-native-btn {
    width: 28px !important; height: 28px !important; background: transparent !important; border: none !important;
    border-radius: 50% !important; cursor: pointer !important; display: flex !important;
    align-items: center !important; justify-content: center !important; margin-left: 0 !important;
    transition: all 0.2s ease !important; color: rgba(255, 255, 255, 0.75) !important; flex-shrink: 0 !important;
}
.clp-native-btn:hover { background: rgba(255, 255, 255, 0.1) !important; transform: scale(1.08) !important; color: #fff !important; }
.clp-native-btn svg { width: 16px !important; height: 16px !important; fill: currentColor !important; }
.clp-src-btn {
    width: 100% !important; padding: 0 3px !important; font-size: 10px !important;
    font-weight: 700 !important; cursor: pointer !important; text-align: center !important;
    border-radius: 6px !important; border: 1px solid rgba(255,255,255,0.12) !important;
    background: rgba(255,255,255,0.05) !important; color: #aaa !important;
    transition: background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s, transform 0.1s !important;
    box-sizing: border-box !important; flex-shrink: 0 !important;
    white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important;
    line-height: 1 !important; position: relative !important;
    height: 26px !important; min-height: 26px !important; max-height: 26px !important;
    display: flex !important; align-items: center !important; justify-content: center !important;
}
.clp-src-btn:hover { background: rgba(255,255,255,0.15) !important; color: #fff !important; transform: translateX(2px); }
.clp-src-btn:active { transform: scale(0.96) !important; }
.clp-src-btn.active { background: #5181b8 !important; color: #fff !important; border-color: #5181b8 !important; }
.clp-src-btn.loading { opacity: 0.65 !important; cursor: wait !important; }
.clp-src-btn.error { border-color: #c62828 !important; color: #ef9a9a !important; opacity: 0.9 !important; background: rgba(198,40,40,0.08) !important; }
.clp-src-btn.found { border-color: #2e7d32 !important; color: #a5d6a7 !important; }
@keyframes clp-shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }
@keyframes clp-pulse { 0%, 100% { transform: scale(1); opacity: 0.6; } 50% { transform: scale(1.3); opacity: 1; } }
@keyframes clp-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
.clp-anim-search { display: inline-block; animation: clp-pulse 1.2s infinite ease-in-out; font-size: 28px !important; margin-bottom: 8px !important; }
.clp-anim-load { display: inline-block; animation: clp-spin 1s infinite linear; font-size: 28px !important; margin-bottom: 8px !important; }
.clp-translate-panel {
    display: none !important; position: absolute !important; top: 10px !important; right: 10px !important;
    z-index: 1000 !important; resize: both !important; overflow: auto !important;
    min-width: 260px !important; min-height: 130px !important; max-width: 90% !important;
    background: rgba(25, 25, 26, 0.95) !important; border-radius: 12px !important;
    border: 1px solid rgba(255, 255, 255, 0.1) !important; backdrop-filter: blur(12px) !important;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5) !important;
}
.clp-translate-panel.active { display: flex !important; flex-direction: column !important; }
.clp-translate-drag-handle {
    cursor: move !important; padding: 8px 10px !important; background: rgba(255,255,255,0.08) !important;
    border-bottom: 1px solid rgba(255,255,255,0.1) !important; font-size: 11px !important; color: #aaa !important;
    user-select: none !important; display: flex !important; align-items: center !important;
    justify-content: center !important; gap: 6px !important; border-radius: 12px 12px 0 0 !important;
}
.clp-translate-drag-handle:hover { background: rgba(255,255,255,0.15) !important; color: #fff !important; }
.clp-translate-content { padding: 12px !important; display: flex !important; flex-direction: column !important; gap: 10px !important; }
.clp-translate-row { display: flex !important; gap: 8px !important; align-items: center !important; }
.clp-lang-select {
    flex-grow: 1 !important; background: rgba(0, 0, 0, 0.3) !important; color: #fff !important;
    border: 1px solid rgba(255, 255, 255, 0.2) !important; border-radius: 6px !important;
    padding: 8px !important; font-size: 12px !important; cursor: pointer !important; outline: none !important;
}
.clp-btn-translate {
    width: 100% !important; padding: 10px !important; background: #5181b8 !important; color: #fff !important;
    border: none !important; border-radius: 6px !important; font-size: 13px !important;
    font-weight: 600 !important; cursor: pointer !important; transition: background 0.2s !important;
}
.clp-btn-translate:hover { background: #6a9bd6 !important; }
.clp-btn-translate:disabled { opacity: 0.6 !important; cursor: not-allowed !important; }
.clp-btn-translate.loading { position: relative !important; color: transparent !important; }
.clp-btn-translate.loading::after {
    content: '' !important; position: absolute !important; top: 50% !important; left: 50% !important;
    width: 14px !important; height: 14px !important; margin: -7px 0 0 -7px !important;
    border: 2px solid rgba(255, 255, 255, 0.3) !important; border-top-color: #fff !important;
    border-radius: 50% !important; animation: clp-spin 0.8s linear infinite !important;
}
.clp-vol-container {
    display:flex !important; flex-direction:column !important; align-items:center !important;
    justify-content:space-between !important; width:44px !important; min-width:44px !important;
    position: absolute !important; right: -50px !important; top: 62% !important;
    transform: translateY(-50%) !important; z-index: 200 !important; padding: 20px 0 !important;
    background: rgba(25, 25, 26, 0.85) !important; border-radius: 22px !important;
    backdrop-filter: blur(10px) !important; border: 1px solid rgba(255,255,255,0.1) !important;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3) !important;
}
.clp-vol-wrap {
    position:relative; height:260px; width:32px; display:flex; align-items:center;
    justify-content:center; cursor:pointer; margin-bottom: 10px;
}
.clp-vol-track {
    position:absolute; width:4px; height:100%; background:rgba(255,255,255,0.15);
    border-radius:2px; left:50%; transform:translateX(-50%);
}
.clp-vol-fill {
    position:absolute; width:100%; height:0%; background:#5181b8;
    border-radius:2px; bottom:0; pointer-events:none;
}
.clp-vol-thumb {
    position:absolute; width:16px; height:16px; background:#5181b8; border-radius:50%;
    left:50%; transform:translateX(-50%); bottom:0%; pointer-events:none;
    box-shadow:0 0 6px rgba(81,129,184,0.6); transition:transform 0.1s;
}
.clp-vol-wrap:hover .clp-vol-thumb { transform:translateX(-50%) scale(1.2); }
.clp-vol-icon {
    font-size:14px; color:#888; cursor:pointer; user-select:none; text-align:center;
    opacity: 0.7; transition: opacity 0.2s, transform 0.2s; padding: 4px; margin-top: 4px;
}
.clp-vol-icon:hover { opacity: 1; transform: scale(1.1); }
.custom-lyrics-player { bottom: 6px !important; }
#clp-lyrics { min-height: 240px !important; max-height: none !important; flex-grow: 1 !important; flex-basis: 0 !important; }
.custom-lyrics-player > div:first-child { width: 80px !important; min-width: 80px !important; }
`;
    (document.head || document.documentElement).appendChild(style);
}

// ═══════════════════════════════════════════════════════════════════════════
//  INJECTED SCRIPT (world: MAIN — видит window.ap / window.cur)
// ═══════════════════════════════════════════════════════════════════════════
window.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'CLP_STATE') return;
    const { currentTime, duration, volume, muted } = e.data;
    lastStateMsgAt = Date.now();
    if (typeof currentTime === 'number' && isFinite(currentTime) && currentTime >= 0) trackCurrentTime = currentTime;
    if (typeof duration === 'number' && isFinite(duration) && duration > 0) trackDuration = duration;
    if (typeof volume === 'number' && isFinite(volume) && !isDraggingVol) syncVolUI(volume, muted);
});

// ═══════════════════════════════════════════════════════════════════════════
//  УТИЛИТЫ
// ═══════════════════════════════════════════════════════════════════════════
function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

function cleanTrackMetadata(text) {
    if (!text) return '';
    return text.replace(/[()]/g, '').replace(/[.?]/g, '')
        .replace(/\sfeat..$/i, '').replace(/\sft..$/i)
        .replace(/\sprod..$/i, '').trim();
}

function getCurrentTrackInfo() {
    const titleEl  = document.querySelector('[data-testid="audio-lyrics-header-title"]') || document.querySelector('[data-testid="audio-player-title"]');
    const artistEl = document.querySelector('[data-testid="audio-lyrics-header-author"] a') || document.querySelector('[data-testid="lyrics_modal_authors"]') || document.querySelector('[data-testid="audio-player-artist"]');
    const title  = (titleEl && titleEl.innerText) ? titleEl.innerText.trim() : '';
    const artist = (artistEl && artistEl.innerText) ? artistEl.innerText.trim() : '';
    return { title: cleanTrackMetadata(title), artist: cleanTrackMetadata(artist) };
}

function getTrackKey() {
    const { title, artist } = getCurrentTrackInfo();
    return `${artist}|${title}`.toLowerCase().trim();
}

// ═══════════════════════════════════════════════════════════════════════════
//  АВТО-ПОИСК
// ═══════════════════════════════════════════════════════════════════════════
async function runAutoSearch(lyricsModal) {
    autoSearchAborted = false;
    const container = document.getElementById('clp-lyrics');
    if (!container) return;

    const { title, artist } = getCurrentTrackInfo();
    if (!title) return;
    const trackKey = `${artist}|${title}`.toLowerCase().trim();
    currentTrackKey = trackKey;
    externalLyricsErrors = {};

    const cached = Object.entries(externalLyricsCache).find(([_,v]) => v?._trackKey === trackKey && v.lines?.length);
    if (cached) {
        setActiveSourceBtn(cached[0]);
        renderExternalLyrics(container, cached[1]);
        return;
    }

    const vkNode = lyricsModal.querySelector('.MusicLyricsLayout__content--N06YG') || lyricsModal.querySelector('[data-testid="static-audio-lyrics"]');
    const vkLines = vkNode ? vkNode.querySelectorAll('[data-testid^="karaoke-audio-lyrics-line"],[data-testid="static-audio-lyrics-line"]') : null;
    if (vkLines && vkLines.length > 0) {
        setActiveSourceBtn('vk');
        syncVkLyricsPosition(lyricsModal);
        return;
    }

    container.innerHTML = '<div style="color:#aaa;text-align:center;padding:40px;"><div class="clp-anim-search">🔍</div><div>Ищем текст…</div><div style="font-size:12px;opacity:.65;margin-top:6px">Проверяю несколько источников одновременно</div></div>';
    const PARSERS = getParsers();
    const tasks = AUTO_SEARCH_ORDER.map(srcId => {
        const parser = PARSERS[srcId];
        const btn = document.querySelector(`.clp-src-btn[data-src="${srcId}"]`);
        if (btn) { btn.classList.remove('error','found'); btn.classList.add('loading'); }
        return Promise.race([
            Promise.resolve().then(() => parser ? parser(title, artist) : null),
            new Promise((_,rej) => setTimeout(() => rej(new Error('таймаут')), 11000))
        ]).then(result => ({srcId,result})).catch(error => ({srcId,error}));
    });

    const pending = new Set(AUTO_SEARCH_ORDER);
    const results = [];
    while (pending.size && !autoSearchAborted) {
        const winner = await Promise.race([...pending].map(srcId => tasks[AUTO_SEARCH_ORDER.indexOf(srcId)]));
        pending.delete(winner.srcId);
        const btn = document.querySelector(`.clp-src-btn[data-src="${winner.srcId}"]`);
        if (winner.result?.lines?.length) {
            const text = winner.result.lines.map(l => l.text||'').join(' ').trim();
            if (text.length >= 30) {
                winner.result._trackKey = trackKey;
                const score = text.length + (winner.result.hasTimestamps ? 5000 : 0);
                results.push({srcId:winner.srcId,result:winner.result,score});
                if (btn) { btn.classList.remove('loading','error'); btn.classList.add('found'); }
            } else if (btn) { btn.classList.remove('loading'); btn.classList.add('error'); }
        } else if (btn) {
            btn.classList.remove('loading'); btn.classList.add('error');
        }
        // A timed/fast successful result is enough; prefer synced lyrics.
        if (results.some(x => x.result.hasTimestamps && x.result.lines.length >= 5)) break;
    }

    AUTO_SEARCH_ORDER.forEach(srcId => {
        const btn = document.querySelector(`.clp-src-btn[data-src="${srcId}"]`);
        if (btn) btn.classList.remove('loading');
    });

    if (autoSearchAborted) return;
    results.sort((a,b) => b.score-a.score);
    const best = results[0];
    if (best) {
        externalLyricsCache[best.srcId] = best.result;
        setActiveSourceBtn(best.srcId);
        await switchSource(best.srcId, lyricsModal, true);
        return;
    }
    container.innerHTML = '<div style="color:#888;text-align:center;padding:40px;">😔 Текст не найден</div>';
}

function setActiveSourceBtn(srcId) {
    currentSource = srcId;
    document.querySelectorAll('.clp-src-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.src === srcId);
        b.classList.remove('loading');
    });
}

function renderExternalLyrics(container, lyricsData) {
    container.innerHTML = '';
    if (!lyricsData || !lyricsData.lines || lyricsData.lines.length === 0) {
        container.innerHTML = '<div style="color:#888;text-align:center;padding:40px;">😔 Текст не найден</div>';
        return;
    }
    container.dataset.hasTimestamps = lyricsData.hasTimestamps;
    if (!container.dataset.originalText) {
        container.dataset.originalText = lyricsData.lines.map(l => l.text).join('\n');
    }
    lyricsData.lines.forEach((line, index) => {
        const div = document.createElement('div');
        div.textContent = line.text || '\u00A0';
        div.className = 'clp-line-external';
        div.dataset.index = index;
        div.dataset.time = line.time;
        div.style.cssText = `text-align:center;padding:8px 0;margin:4px 0;cursor:${Number.isFinite(Number(line.time)) ? 'pointer' : 'default'};transition:all 0.2s;border-radius:8px;font-size:16px;color:rgba(255,255,255,0.5);background:transparent;`;
        if (Number.isFinite(Number(line.time)) && lyricsData.hasTimestamps) {
            div.onclick = (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (trackDuration <= 0) return;
                const fraction = Math.max(0, Math.min(1, line.time / trackDuration));
                seekViaNativeBar(fraction);
            };
        }
        container.appendChild(div);
    });
}

function syncExternalLyricsPosition(container) {
    if (!container || currentSource === 'vk') return;
    const lyricsData = externalLyricsCache[currentSource];
    if (!lyricsData || !lyricsData.hasTimestamps) return;

    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
        rafId = null;
        const lines = container.querySelectorAll('.clp-line-external');
        if (!lines.length) return;
        let activeIndex = -1;
        for (let i = 0; i < lyricsData.lines.length; i++) {
            const lineTime = lyricsData.lines[i].time;
            const nextTime = (lyricsData.lines[i + 1] && lyricsData.lines[i + 1].time) || trackDuration;
            if (trackCurrentTime >= lineTime && trackCurrentTime < nextTime) { activeIndex = i; break; }
        }
        lines.forEach((line, i) => {
            const isActive = (i === activeIndex);
            line.style.background = isActive ? 'rgba(255,255,255,0.08)' : 'transparent';
            line.style.color = isActive ? '#fff' : 'rgba(255,255,255,0.5)';
            if (isActive && !isUserScrolling) {
                setTimeout(() => { line.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50);
            }
        });
    });
}

async function switchSource(sourceId, lyricsModal, silent) {
    if (!silent) autoSearchAborted = true;
    setActiveSourceBtn(sourceId);

    const container = document.getElementById('clp-lyrics');
    if (!container) return;

    delete container.dataset.originalText;
    delete container.dataset.translatedText;
    delete container.dataset.hasTimestamps;

    if (sourceId === 'vk') { syncVkLyricsPosition(lyricsModal); return; }
    if (externalLyricsCache[sourceId]) { renderExternalLyrics(container, externalLyricsCache[sourceId]); return; }
    if (externalLyricsErrors[sourceId]) {
        container.innerHTML = '<div style="color:#888;text-align:center;padding:40px;">😔 Не удалось найти трек в этом источнике</div>';
        return;
    }

    const btn = document.querySelector(`.clp-src-btn[data-src="${sourceId}"]`);
    if (btn) btn.classList.add('loading');

    const { title, artist } = getCurrentTrackInfo();
    if (!title) {
        container.innerHTML = '<div style="color:#888;text-align:center;padding:20px;">⚠️ Не удалось определить трек</div>';
        if (btn) btn.classList.remove('loading');
        return;
    }

    const PARSERS = getParsers();
    try {
        const parser = PARSERS[sourceId];
        if (!parser) throw new Error('Парсер не реализован');
        container.innerHTML = '<div style="color:#aaa;text-align:center;padding:40px;"><div class="clp-anim-load">⏳</div><div>Загружаем...</div></div>';
        const result = await parser(title, artist);
        externalLyricsCache[sourceId] = result;
        renderExternalLyrics(container, result);
        if (btn) { btn.classList.remove('loading'); btn.classList.add('found'); }
    } catch (err) {
        console.warn(`[CLP] ${sourceId} error:`, err);
        externalLyricsErrors[sourceId] = true;
        if (btn) { btn.classList.remove('loading'); btn.classList.add('error'); }
        container.innerHTML = '<div style="color:#888;text-align:center;padding:40px;">😔 Не удалось найти трек в этом источнике</div>';
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  ДОБИРАНИЕ UI МОДАЛКИ (идемпотентно, вызывается каждый тик)
// ═══════════════════════════════════════════════════════════════════════════
function ensureProgressUI(lyricsModal) {
    if (!lyricsModal) return;
    const progressBar = lyricsModal.querySelector('[data-testid="audio_lyrics_progress_bar"]');
    const controlsContainer = document.querySelector('[data-testid="audioplayerplaybackcontrols"]');

    if (progressBar) {
        let wrapper = progressBar.closest('.clp-slider-wrapper');
        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.className = 'clp-slider-wrapper';
            progressBar.parentNode.insertBefore(wrapper, progressBar);
        }
        if (controlsContainer && controlsContainer.parentElement !== wrapper) wrapper.appendChild(controlsContainer);

        let sliderRow = document.getElementById('clp-slider-row');
        if (!sliderRow) {
            sliderRow = document.createElement('div');
            sliderRow.id = 'clp-slider-row';
            sliderRow.className = 'clp-slider-row';
            wrapper.appendChild(sliderRow);
        }
        if (progressBar.parentElement !== sliderRow) sliderRow.appendChild(progressBar);

        if (!progressBar.querySelector('.clp-progress-track')) {
            const track = document.createElement('div');
            track.className = 'clp-progress-track';
            progressBar.appendChild(track);
        }
        if (!progressBar.querySelector('.clp-progress-fill')) {
            const fill = document.createElement('div');
            fill.className = 'clp-progress-fill';
            fill.id = 'clp-progress-fill';
            progressBar.appendChild(fill);
        }
        let timeCurrent = document.getElementById('clp-slider-time-current');
        if (!timeCurrent) {
            timeCurrent = document.createElement('span');
            timeCurrent.id = 'clp-slider-time-current';
            timeCurrent.className = 'clp-slider-time';
            timeCurrent.textContent = '0:00';
            sliderRow.insertBefore(timeCurrent, progressBar);
        }
        let timeTotal = document.getElementById('clp-slider-time-total');
        if (!timeTotal) {
            timeTotal = document.createElement('span');
            timeTotal.id = 'clp-slider-time-total';
            timeTotal.className = 'clp-slider-time clp-slider-time-right';
            timeTotal.textContent = '0:00';
            sliderRow.appendChild(timeTotal);
        }
    }

    if (controlsContainer && !document.getElementById('clp-native-share')) {
        const shareBtn = document.createElement('button');
        shareBtn.id = 'clp-native-share';
        shareBtn.className = 'clp-native-btn';
        shareBtn.title = 'Поделиться';
        shareBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M11.996 3.725A2.15 2.15 0 0 0 10 5.87l-.001 2.117-.02.005a9.904 9.904 0 0 0-7.827 10.721c.083.811 1.116 1.103 1.611.455l.187-.237a9.08 9.08 0 0 1 5.836-3.265l.213-.026.001 2.494a2.15 2.15 0 0 0 3.476 1.692l7.824-6.132a2.15 2.15 0 0 0 0-3.384l-7.824-6.132a2.15 2.15 0 0 0-1.326-.458z"/></svg>`;
        shareBtn.addEventListener('click', () => {
            const nativeBtn = document.querySelector('[data-testid="MusicAudio_Share"]');
            if (nativeBtn) nativeBtn.click();
        });
        controlsContainer.appendChild(shareBtn);

        const addBtn = document.createElement('button');
        addBtn.id = 'clp-native-add';
        addBtn.className = 'clp-native-btn';
        addBtn.title = 'Добавить в мою музыку';
        addBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 11h6.5a1 1 0 0 1 0 2H13v6.5a1 1 0 0 1-2 0V13H4.5a1 1 0 0 1 0-2H11V4.5a1 1 0 0 1 2 0z"></path></svg>`;
        addBtn.addEventListener('click', () => {
            const nativeBtn = document.querySelector('[data-testid="MusicAudio_ToggleOwning"]');
            if (nativeBtn) { nativeBtn.click(); setTimeout(updatePlayerUI, 50); }
        });
        controlsContainer.appendChild(addBtn);

        const dlBtn = document.createElement('button');
        dlBtn.id = 'clp-native-download';
        dlBtn.className = 'clp-native-btn';
        dlBtn.title = 'Скачать';
        dlBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 3a1 1 0 0 1 1 1v9.586l2.293-2.293a1 1 0 1 1 1.414 1.414l-4 4a1 1 0 0 1-1.414 0l-4-4a1 1 0 1 1 1.414-1.414L11 13.586V4a1 1 0 0 1 1-1m-7 16a1 1 0 1 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1"></path></svg>`;
        dlBtn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            window.postMessage({type: 'VKE_VKDL_DOWNLOAD_CURRENT'}, '*');
        });
        controlsContainer.appendChild(dlBtn);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  ПОСТРОЕНИЕ UI
// ═══════════════════════════════════════════════════════════════════════════
function initCustomPlayerLayout(lyricsModal) {
    const contentContainer = lyricsModal.querySelector('.styles__content--DtsmN');
    if (!contentContainer) return;

    const nativeText = lyricsModal.querySelector('.MusicLyricsLayout__content--N06YG') || lyricsModal.querySelector('[data-testid="static-audio-lyrics"]');
    if (lyricsModal.querySelector('.custom-lyrics-player')) {
        syncVkLyricsPosition(lyricsModal);
        return;
    }

    externalLyricsCache = {};
    externalLyricsErrors = {};
    document.querySelectorAll('#clp-native-similar, .clp-native-similar').forEach(el => el.remove());

    contentContainer.style.setProperty('position', 'relative', 'important');
    contentContainer.style.setProperty('overflow', 'visible', 'important');

    const customPlayer = document.createElement('div');
    customPlayer.className = 'custom-lyrics-player';
    customPlayer.style.cssText = 'position:absolute !important;top:0 !important;left:0 !important;right:0 !important;bottom:6px !important;width:100% !important;display:flex !important;flex-direction:row !important;box-sizing:border-box !important;padding:20px !important;z-index:10 !important;';

    const srcBtns = LYRIC_SOURCES.map(s =>
        `<button class="clp-src-btn" data-src="${s.id}" style="border-left:3px solid ${s.color} !important;" title="${s.label}">${s.label}</button>`
    ).join('');

    customPlayer.innerHTML = `
        <div id="clp-sources-list" style="display:flex !important;flex-direction:column !important;gap:4px !important;width:80px !important;min-width:80px !important;border-right:1px solid rgba(255,255,255,0.1) !important;padding-right:9px !important;overflow-y:auto !important;">
            <button class="clp-src-btn active" data-src="vk" style="border-left:3px solid #5181b8 !important;font-weight:900 !important;">VK</button>
            <button class="clp-src-btn" id="clp-btn-translate-toggle" data-src="translate" style="border-left:3px solid #ff9800 !important;" title="Перевод текста">🌐 Перевод</button>
            <div style="height:1px;background:rgba(255,255,255,0.08);margin:2px 0;"></div>
            ${srcBtns}
        </div>
        <div style="display:flex !important;flex-direction:column !important;flex-grow:1 !important;padding-left:14px !important;min-width:0 !important;position:relative !important;">
            <div id="clp-lyrics" style="flex-grow:1 !important;flex-basis:0 !important;overflow-y:auto !important;text-align:center !important;font-size:16px !important;line-height:1.8 !important;padding:20px 15px !important;color:rgba(255,255,255,0.85) !important;min-height:240px !important;"></div>
            <div class="clp-translate-panel" id="clp-translate-panel">
                <div class="clp-translate-drag-handle"><span>✥</span> Переместить / Изменить размер</div>
                <div class="clp-translate-content">
                    <div class="clp-translate-row">
                        <select class="clp-lang-select" id="clp-lang-from">
                            <option value="en">Английский</option><option value="ru">Русский</option><option value="de">Немецкий</option><option value="fr">Французский</option><option value="es">Испанский</option><option value="it">Итальянский</option><option value="ja">Японский</option><option value="ko">Корейский</option><option value="zh">Китайский</option>
                        </select>
                        <span style="color:#888;font-size:14px;">→</span>
                        <select class="clp-lang-select" id="clp-lang-to">
                            <option value="ru" selected>Русский</option><option value="en">Английский</option><option value="de">Немецкий</option><option value="fr">Французский</option><option value="es">Испанский</option><option value="it">Итальянский</option><option value="ja">Японский</option><option value="ko">Корейский</option><option value="zh">Китайский</option>
                        </select>
                    </div>
                    <button class="clp-btn-translate" id="clp-btn-do-translate">Перевести текст</button>
                </div>
            </div>
        </div>
        <div class="clp-vol-container" id="clp-vol-container">
            <div class="clp-vol-wrap" id="clp-vol-slider">
                <div class="clp-vol-track"><div class="clp-vol-fill" id="clp-vol-fill"></div></div>
                <div class="clp-vol-thumb" id="clp-vol-thumb"></div>
            </div>
            <div class="clp-vol-icon" id="clp-vol-icon" title="Mute/Unmute">🔊</div>
        </div>
    `;
    contentContainer.appendChild(customPlayer);
    if (nativeText) { nativeText.style.display='none'; nativeText.style.visibility='hidden'; nativeText.style.opacity='0'; }

    const sourcesList = document.getElementById('clp-sources-list');
    if (sourcesList) {
        sourcesList.addEventListener('click', (e) => {
            const btn = e.target.closest('.clp-src-btn');
            if (!btn) return;
            const srcId = btn.dataset.src;
            if (!srcId || srcId === 'translate' || srcId === currentSource) return;
            switchSource(srcId, lyricsModal, false);
        });
    }

    ensureProgressUI(lyricsModal);

    // ─── Громкость ───────────────────────────────────────────────────────
    const volSlider = document.getElementById('clp-vol-slider');
    const volFill   = document.getElementById('clp-vol-fill');
    const volThumb  = document.getElementById('clp-vol-thumb');
    const volIcon   = document.getElementById('clp-vol-icon');
    let isMuted = false;
    let lastVol = 0.8;

    function updateVolUI(v, muted = null) {
        v = Math.max(0, Math.min(1, Number(v) || 0));
        if (muted === true) v = 0;
        const pct = v * 100;
        if (volFill)  volFill.style.height = pct + '%';
        if (volThumb) volThumb.style.bottom = pct + '%';
        isMuted = muted === null ? v <= 0.001 : !!muted;
        if (v > 0.001) lastVol = v;
        if (volIcon) {
            volIcon.textContent = isMuted || v <= 0.001 ? '🔇' : v < 0.4 ? '🔉' : '🔊';
            volIcon.title = isMuted ? 'Включить звук' : 'Выключить звук';
            volIcon.setAttribute('aria-label', volIcon.title);
        }
    }

    function applyVolume(v) {
        v = Math.max(0, Math.min(1, Number(v) || 0));
        isDraggingVol = true;
        updateVolUI(v, v === 0);
        window.postMessage({ type: 'CLP_SET_VOLUME', volume: v }, '*');
        setTimeout(() => { isDraggingVol = false; }, 120);
    }

    setTimeout(() => { window.postMessage({ type: 'CLP_REQUEST_STATE' }, '*'); }, 150);

    volIcon?.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        window.postMessage({ type: 'CLP_TOGGLE_MUTE' }, '*');
    });

    function volPctFromEvent(e) {
        const r = volSlider.getBoundingClientRect();
        const cy = e.touches ? e.touches[0].clientY : e.clientY;
        return Math.max(0, Math.min(1, (r.bottom - cy) / Math.max(1, r.height)));
    }

    volSlider?.addEventListener('pointerdown', e => {
        e.preventDefault();
        isDraggingVol = true;
        volSlider.setPointerCapture?.(e.pointerId);
        applyVolume(volPctFromEvent(e));
    });
    volSlider?.addEventListener('pointermove', e => {
        if (!isDraggingVol) return;
        e.preventDefault();
        applyVolume(volPctFromEvent(e));
    });
    volSlider?.addEventListener('pointerup', e => {
        if (!isDraggingVol) return;
        e.preventDefault();
        applyVolume(volPctFromEvent(e));
        isDraggingVol = false;
    });
    volSlider?.addEventListener('pointercancel', () => { isDraggingVol = false; });

    document.getElementById('clp-lyrics').addEventListener('scroll', () => {
        isUserScrolling = true;
        if (scrollTimeout) clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => { isUserScrolling = false; }, 1500);
    });

    syncVkLyricsPosition(lyricsModal);
    startStatePolling(lyricsModal);
    setTimeout(() => runAutoSearch(lyricsModal), 1200);
    watchForTrackChange(lyricsModal);
    initTranslateHandlers();
}

// ═══════════════════════════════════════════════════════════════════════════
//  ДЕТЕКТИРОВАНИЕ СМЕНЫ ТРЕКА
// ═══════════════════════════════════════════════════════════════════════════
function watchForTrackChange(lyricsModal) {
    if (trackObserver) trackObserver.disconnect();
    const titleEl = document.querySelector('[data-testid="audio-lyrics-header-title"]') || document.querySelector('[data-testid="audio-player-title"]');
    if (!titleEl) return;
    currentTrackKey = getTrackKey();
    trackObserver = new MutationObserver(() => {
        const newKey = getTrackKey();
        if (newKey && newKey !== currentTrackKey) {
            currentTrackKey = newKey;
            externalLyricsCache = {};
            externalLyricsErrors = {};
            document.querySelectorAll('.clp-src-btn').forEach(b => b.classList.remove('loading', 'found', 'error'));
            const panel = document.getElementById('clp-translate-panel');
            if (panel) {
                panel.classList.remove('active');
                const tg = document.getElementById('clp-btn-translate-toggle');
                if (tg) tg.classList.remove('active');
            }
            setTimeout(() => runAutoSearch(lyricsModal), 1200);
        }
    });
    trackObserver.observe(titleEl, { childList: true, subtree: true, characterData: true });
}

// ═══════════════════════════════════════════════════════════════════════════
//  СИНХРОНИЗАЦИЯ ТЕКСТА VK
// ═══════════════════════════════════════════════════════════════════════════
function syncVkLyricsPosition(lyricsModal) {
    if (currentSource !== 'vk') return;
    const container = document.getElementById('clp-lyrics');
    if (!container) return;
    const isTranslated = !!container.dataset.translatedText;

    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
        rafId = null;
        const node = lyricsModal.querySelector('.MusicLyricsLayout__content--N06YG') || lyricsModal.querySelector('[data-testid="static-audio-lyrics"]');
        if (!node) return;
        const lines = node.querySelectorAll('[data-testid^="karaoke-audio-lyrics-line"],[data-testid="static-audio-lyrics-line"]');
        if (!lines.length) {
            if (!isTranslated) container.innerHTML = '<div style="color:#888;text-align:center;padding:40px;">😔 Текст не найден</div>';
            return;
        }
        let activeIndex = -1;
        lines.forEach((l, i) => {
            const tid = l.getAttribute('data-testid');
            if ((tid && tid.includes('active')) || (l.className && l.className.includes('active'))) activeIndex = i;
        });
        const children = Array.from(container.children);
        if (!isTranslated && children.length !== lines.length) {
            container.innerHTML = '';
            lines.forEach((line, i) => {
                const d = document.createElement('div');
                d.textContent = line.innerText;
                d.className = 'clp-line-vk';
                const on = (i === activeIndex);
                d.style.cssText = `text-align:center;padding:8px 0;margin:4px 0;cursor:pointer;transition:all 0.2s;border-radius:8px;font-size:16px;color:${on ? '#fff' : 'rgba(255,255,255,0.5)'};background:${on ? 'rgba(255,255,255,0.08)' : 'transparent'};`;
                d.onclick = (ev) => { ev.stopPropagation(); line.click(); };
                container.appendChild(d);
            });
            if (activeIndex >= 0 && !isUserScrolling && children[activeIndex]) {
                setTimeout(() => { children[activeIndex].scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50);
            }
        } else {
            const kids = Array.from(container.children);
            kids.forEach((child, i) => {
                const on = (i === activeIndex);
                child.style.background = on ? 'rgba(255,255,255,0.08)' : 'transparent';
                child.style.color = on ? '#fff' : 'rgba(255,255,255,0.5)';
                if (on && !isUserScrolling) child.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
//  ОБНОВЛЕНИЕ UI
// ═══════════════════════════════════════════════════════════════════════════
function getVKProgressPct() {
    const sliders = Array.from(document.querySelectorAll('[role="slider"]'));
    const slider = sliders.find(el => {
        const label = (el.getAttribute('aria-label') || '').toLowerCase();
        return label.includes('воспроизведени') && !label.includes('громк');
    }) || sliders.find(el => {
        const label = (el.getAttribute('aria-label') || '').toLowerCase();
        return label.includes('прогресс') && !label.includes('громк') && !label.includes('буфер');
    });
    if (!slider) return null;
    const val = parseFloat(slider.getAttribute('aria-valuenow'));
    return (isFinite(val) && val >= 0) ? val : null;
}

function seekViaNativeBar(fraction) {
    fraction = Math.max(0, Math.min(1, fraction));
    let bar = document.querySelector('[data-testid="audio_lyrics_progress_bar"]');
    if (!bar) {
        const sliders = Array.from(document.querySelectorAll('[role="slider"]'));
        const playSliders = sliders.filter(el => {
            const label = (el.getAttribute('aria-label') || '').toLowerCase();
            if (!label.includes('воспроизведени')) return false;
            if (label.includes('громк') || label.includes('буфер')) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });
        if (playSliders.length) {
            const widest = playSliders.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
            bar = widest.closest('[data-testid="AudioPlayerBlock_ProgressBar"]')
               || widest.closest('[data-testid="audio_lyrics_progress_bar"]')
               || widest.parentElement
               || widest;
        }
    }
    if (!bar) { console.warn('[CLP] seekViaNativeBar: бар не найден'); return false; }
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return false;
    const clientX = rect.left + rect.width * fraction;
    const clientY = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX, clientY };
    const inner = bar.querySelector('[role="slider"]') || bar;
    const targets = (inner !== bar) ? [inner, bar] : [bar];
    try {
        for (const t of targets) {
            t.dispatchEvent(new PointerEvent('pointerdown', opts));
            t.dispatchEvent(new PointerEvent('pointermove', opts));
            t.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, opts, { buttons: 0 })));
            t.dispatchEvent(new MouseEvent('click', opts));
        }
        return true;
    } catch (e) {
        console.warn('[CLP] seekViaNativeBar error:', e);
        return false;
    }
}

function updatePlayerUI() {
    if (isDraggingVol) return;

    ensureProgressUI(document.querySelector('[data-testid="audio-lyrics-modal"]'));

    let durationSec = trackDuration;
    let currentSec  = trackCurrentTime;

    const staleState = (Date.now() - lastStateMsgAt) > 1500;

    // Текущее время ВСЕГДА уточняем по родному тексту VK
    const timeEl = document.querySelector('[data-testid="audio_lyrics_progress_time"]');
    if (timeEl) {
        const timeText = timeEl.textContent.trim();
        if (timeText && timeText.includes(':')) {
            const parts = timeText.split(':');
            let secs = 0;
            if (parts.length === 2) secs = parseInt(parts[0]) * 60 + parseInt(parts[1]);
            else if (parts.length === 3) secs = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
            if (secs >= 0) currentSec = secs;
        }
    } else if (staleState) {
        const audio = document.querySelector('audio');
        if (audio && isFinite(audio.currentTime)) currentSec = audio.currentTime || 0;
    }

    // Длительность — fallback, только если CLP_STATE её не дал
    if (durationSec === 0) {
        const audio = document.querySelector('audio');
        if (audio && isFinite(audio.duration) && audio.duration > 0) durationSec = audio.duration;
    }
    if (durationSec === 0 && currentSec > 0) {
        const progressPct = getVKProgressPct();
        if (progressPct !== null && progressPct > 5 && progressPct < 99) {
            const derived = currentSec / (progressPct / 100);
            if (isFinite(derived) && derived > 0) durationSec = Math.round(derived);
        }
    }

    if (durationSec > 0) trackDuration = durationSec;
    if (currentSec >= 0) trackCurrentTime = currentSec;

    const timeTotal = document.getElementById('clp-slider-time-total');
    if (timeTotal && trackDuration > 0) {
        const newText = formatTime(trackDuration);
        if (timeTotal.textContent !== newText) timeTotal.textContent = newText;
    }

    const timeCurrent = document.getElementById('clp-slider-time-current');
    if (timeCurrent) {
        const newText = formatTime(trackCurrentTime);
        if (timeCurrent.textContent !== newText) timeCurrent.textContent = newText;
    }

    const fillEl = document.getElementById('clp-progress-fill');
    if (fillEl && trackDuration > 0) {
        const pctFill = Math.max(0, Math.min(100, (trackCurrentTime / trackDuration) * 100));
        fillEl.style.setProperty('width', pctFill + '%', 'important');
    }

    if (!isUserScrolling) syncVkLyricsPosition(document.querySelector('[data-testid="audio-lyrics-modal"]'));

    const nativeAddBtn = document.querySelector('[data-testid="MusicAudio_ToggleOwning"]');
    const clpAddBtn = document.getElementById('clp-native-add');
    if (nativeAddBtn && clpAddBtn) {
        const isActive = nativeAddBtn.getAttribute('data-testactive') === 'true';
        if (clpAddBtn.dataset.active !== String(isActive)) {
            clpAddBtn.dataset.active = String(isActive);
            if (isActive) {
                clpAddBtn.title = 'Удалить из моей музыки';
                clpAddBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M20.736 5.664a.9.9 0 0 1 0 1.272l-11.1 11.1a.9.9 0 0 1-1.272 0l-5.1-5.1a.9.9 0 0 1 1.272-1.272L9 16.127 19.464 5.664a.9.9 0 0 1 1.272 0" clip-rule="evenodd"></path></svg>`;
            } else {
                clpAddBtn.title = 'Добавить в мою музыку';
                clpAddBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 11h6.5a1 1 0 0 1 0 2H13v6.5a1 1 0 0 1-2 0V13H4.5a1 1 0 0 1 0-2H11V4.5a1 1 0 0 1 2 0z"></path></svg>`;
            }
        }
    }
}

function syncVolUI(v, muted = null) {
    if (typeof v !== 'number' || !isFinite(v)) return;
    v = Math.max(0, Math.min(1, v));
    const fill = document.getElementById('clp-vol-fill');
    const thumb = document.getElementById('clp-vol-thumb');
    const icon = document.getElementById('clp-vol-icon');
    if (muted === true) v = 0;
    if (fill) fill.style.height = (v * 100) + '%';
    if (thumb) thumb.style.bottom = (v * 100) + '%';
    if (icon) { icon.textContent = (muted || v === 0) ? '🔇' : v < 0.4 ? '🔉' : '🔊'; icon.title = (muted || v === 0) ? 'Включить звук' : 'Выключить звук'; }
}

// ═══════════════════════════════════════════════════════════════════════════
//  POLLING
// ═══════════════════════════════════════════════════════════════════════════
function startStatePolling(lyricsModal) {
    if (updateInterval) clearInterval(updateInterval);
    lyricsTick = 0;
    setTimeout(() => updatePlayerUI(), 100);
    updateInterval = setInterval(() => {
        updatePlayerUI();
        if (++lyricsTick >= LYRICS_EVERY_N_TICKS) {
            lyricsTick = 0;
            const container = document.getElementById('clp-lyrics');
            if (currentSource === 'vk') {
                syncVkLyricsPosition(lyricsModal);
            } else if (container) {
                const lyricsData = externalLyricsCache[currentSource];
                if (lyricsData && lyricsData.hasTimestamps) syncExternalLyricsPosition(container);
            }
        }
    }, 250);
}

function stopStatePolling() {
    if (updateInterval) { clearInterval(updateInterval); updateInterval = null; }
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (trackObserver) { trackObserver.disconnect(); trackObserver = null; }
}

// ═══════════════════════════════════════════════════════════════════════════
//  ПЕРЕВОД ТЕКСТА
// ═══════════════════════════════════════════════════════════════════════════
function getTranslateCache() {
    try { return JSON.parse(localStorage.getItem(TRANSLATE_CACHE_KEY) || '{}'); }
    catch (e) { return {}; }
}

function setTranslateCache(key, value) {
    try {
        const cache = getTranslateCache();
        cache[key] = value;
        const keys = Object.keys(cache);
        if (keys.length > 50) delete cache[keys[0]];
        localStorage.setItem(TRANSLATE_CACHE_KEY, JSON.stringify(cache));
    } catch (e) { console.warn('[CLP] Cache save error:', e); }
}

async function translateText(text, fromLang, toLang) {
    if (fromLang === toLang) return text;
    const cacheKey = `${fromLang}_${toLang}_${text.substring(0, 100).replace(/\s+/g, '_')}`;
    const cache = getTranslateCache();
    if (cache[cacheKey]) return cache[cacheKey];

    const lines = text.split('\n');
    const translatedLines = [];
    let currentChunk = '';
    const chunks = [];
    for (const line of lines) {
        if ((currentChunk + '\n' + line).length > 450 && currentChunk.length > 0) {
            chunks.push(currentChunk);
            currentChunk = line;
        } else {
            currentChunk = currentChunk ? currentChunk + '\n' + line : line;
        }
    }
    if (currentChunk) chunks.push(currentChunk);

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i].trim();
        if (!chunk) { translatedLines.push(''); continue; }
        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${fromLang}&tl=${toLang}&dt=t&q=${encodeURIComponent(chunk)}`;
            const resp = await fetch(url);
            const data = await resp.json();
            if (data && data[0]) {
                translatedLines.push(data[0].map(item => item[0]).join(''));
            } else {
                translatedLines.push(chunk);
            }
        } catch (e) {
            console.warn('[CLP] Translation error:', e);
            translatedLines.push(chunk);
        }
        if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 300));
    }

    const result = translatedLines.join('\n');
    setTranslateCache(cacheKey, result);
    return result;
}

function initTranslateHandlers() {
    const toggleBtn = document.getElementById('clp-btn-translate-toggle');
    const panel     = document.getElementById('clp-translate-panel');
    const doBtn     = document.getElementById('clp-btn-do-translate');
    const langFrom  = document.getElementById('clp-lang-from');
    const langTo    = document.getElementById('clp-lang-to');
    if (!toggleBtn || !panel || !doBtn) return;

    const dragHandle = panel.querySelector('.clp-translate-drag-handle');
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    dragHandle.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX; startY = e.clientY;
        const rect = panel.getBoundingClientRect();
        initialLeft = rect.left; initialTop = rect.top;
        panel.style.cursor = 'grabbing';
        e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        panel.style.left = `${initialLeft + (e.clientX - startX)}px`;
        panel.style.top  = `${initialTop + (e.clientY - startY)}px`;
        panel.style.right = 'auto'; panel.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => {
        if (isDragging) { isDragging = false; panel.style.cursor = 'default'; }
    });

    toggleBtn.addEventListener('click', () => {
        panel.classList.toggle('active');
        toggleBtn.classList.toggle('active', panel.classList.contains('active'));
    });

    doBtn.addEventListener('click', async () => {
        const container = document.getElementById('clp-lyrics');
        if (!container) return;
        const originalText = container.dataset.originalText || container.innerText;
        if (!originalText || originalText.trim().length < 3) {
            container.innerHTML = '<div style="color:#888;text-align:center;padding:20px;">⚠️ Нет текста для перевода</div>';
            return;
        }
        const from = langFrom.value;
        const to   = langTo.value;
        doBtn.disabled = true;
        doBtn.classList.add('loading');
        doBtn.textContent = 'Перевожу...';
        try {
            const translated = await translateText(originalText, from, to);
            container.dataset.originalText = originalText;
            container.dataset.translatedText = translated;
            container.dataset.translatedFrom = from;
            container.dataset.translatedTo = to;
            renderExternalLyrics(container, {
                lines: translated.split('\n').map(t => ({ time: 0, text: t })),
                hasTimestamps: false
            });
            doBtn.textContent = '✅ Переведено';
        } catch (e) {
            console.error('[CLP] Translate error:', e);
            container.innerHTML = '<div style="color:#ef9a9a;text-align:center;padding:20px;">❌ Ошибка перевода</div>';
            doBtn.textContent = 'Попробовать снова';
        } finally {
            doBtn.disabled = false;
            doBtn.classList.remove('loading');
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
//  ИНИЦИАЛИЗАЦИЯ
// ═══════════════════════════════════════════════════════════════════════════
injectAntiFlickerStyles();

let modalRetryTimer = null;
function ensureModalReady(){
    const modal=document.querySelector('[data-testid="audio-lyrics-modal"]');
    if(!modal){ if(modalRetryTimer){clearInterval(modalRetryTimer);modalRetryTimer=null;} stopStatePolling(); return; }
    if(!modal.querySelector('.custom-lyrics-player')) initCustomPlayerLayout(modal);
    if(modal.querySelector('.custom-lyrics-player') && modalRetryTimer){clearInterval(modalRetryTimer);modalRetryTimer=null;}
}
globalModalObserver = new MutationObserver(() => {
    ensureModalReady();
    const modal=document.querySelector('[data-testid="audio-lyrics-modal"]');
    if(modal && !modal.querySelector('.custom-lyrics-player') && !modalRetryTimer){
        let tries=0; modalRetryTimer=setInterval(()=>{tries++;ensureModalReady();if(tries>20||!document.body.contains(modal)){clearInterval(modalRetryTimer);modalRetryTimer=null;}},150);
    }
});
globalModalObserver.observe(document.body, { childList: true, subtree: true });
setInterval(()=>{ const modal=document.querySelector('[data-testid="audio-lyrics-modal"]'); if(modal && !modal.querySelector('.custom-lyrics-player')) ensureModalReady(); },500);


})();