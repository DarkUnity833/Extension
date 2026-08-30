// injected.js — выполняется в контексте страницы VK (world: MAIN)
(function() {
'use strict';
console.log('[CLP] Injected script loaded!');

function getAudio() { return document.querySelector('audio'); }
function getAP() { return window.ap || null; }

// Длительность текущего трека из window.ap
function getDurationFromAP() {
    const ap = getAP();
    if (!ap) return 0;
    try {
        const cur = ap.getCurrentAudio ? ap.getCurrentAudio() : ap._currentAudio;
        if (cur) {
            if (Array.isArray(cur) && cur[5]) return parseFloat(cur[5]) || 0;
            if (cur.duration) return parseFloat(cur.duration) || 0;
        }
    } catch (e) {}
    return 0;
}

// ─── Трансляция состояния ──────────────────────────────────────────────
setInterval(() => {
    try {
        const ap = getAP();
        const audioEl = getAudio();
        let currentTime = 0, duration = 0, isPlaying = false, volume = 1;

        if (ap) {
            try {
                const cur = ap.getCurrentAudio ? ap.getCurrentAudio() : ap._currentAudio;
                if (cur) {
                    // Длительность — из cur[5]
                    if (Array.isArray(cur) && cur[5]) {
                        duration = parseFloat(cur[5]) || 0;
                    } else if (cur.duration) {
                        duration = parseFloat(cur.duration) || 0;
                    }

                    // Текущее время — способ 1: getCurrentTime (если вдруг есть)
                    if (typeof ap.getCurrentTime === 'function') {
                        const t = parseFloat(ap.getCurrentTime());
                        if (isFinite(t) && t > 0) currentTime = t;
                    }

                    // Текущее время — способ 2: getCurrentProgress() × duration
                    // В текущей версии VK getCurrentTime НЕТ, но есть
                    // getCurrentProgress(), возвращающий долю 0..1.
                    if (currentTime === 0 && duration > 0 && typeof ap.getCurrentProgress === 'function') {
                        const progress = parseFloat(ap.getCurrentProgress());
                        if (isFinite(progress) && progress >= 0 && progress <= 1) {
                            currentTime = progress * duration;
                        }
                    }

                    if (typeof ap.isPlaying === 'function') isPlaying = !!ap.isPlaying();

                    if (typeof ap.getVolume === 'function') {
                        const vol = parseFloat(ap.getVolume());
                        if (isFinite(vol)) volume = Math.max(0, Math.min(1, vol));
                    }
                }
            } catch (e) {
                console.warn('[CLP] ap error:', e);
            }
        }

        // Fallback на audio элемент
        if (audioEl) {
            if (duration === 0 && isFinite(audioEl.duration) && audioEl.duration > 0) {
                duration = audioEl.duration;
            }
            if (currentTime === 0 && isFinite(audioEl.currentTime)) {
                currentTime = audioEl.currentTime || 0;
            }
            if (!ap) isPlaying = !audioEl.paused;
            if (isFinite(audioEl.volume)) volume = audioEl.volume;
        }

        if (duration > 0 || currentTime > 0) {
            window.postMessage({
                type: 'CLP_STATE',
                currentTime: parseFloat(currentTime.toFixed(2)),
                duration: parseFloat(duration.toFixed(2)),
                isPlaying,
                volume,
            }, '*');
        }
    } catch (e) {
        console.error('[CLP] State error:', e);
    }
}, 200);

// ─── Отправка URL для downloader ──────────────────────────────────────
function sendTrackUrl() {
    try {
        const ap = getAP();
        if (!ap) return;
        const cur = ap.getCurrentAudio ? ap.getCurrentAudio() : ap._currentAudio;
        if (!cur) return;
        let url = null, ownerId = null, id = null;
        if (Array.isArray(cur)) {
            url = cur[2]; ownerId = cur[1]; id = cur[0];
        } else if (cur.url) {
            url = cur.url; ownerId = cur.owner_id; id = cur.id;
        }
        if (url && !url.includes('audio_api_unavailable')) {
            window.postMessage({
                type: 'CLP_TRACK_URL',
                url, ownerId, id, owner_id: ownerId, audioId: id
            }, '*');
        }
    } catch (e) {}
}
setTimeout(sendTrackUrl, 500);
setInterval(sendTrackUrl, 5000);

// ─── Управление (play/pause/prev/next) ─────────────────────────────────
window.addEventListener('CLP_ACTION', (e) => {
    const type = e.detail?.type;
    const ap = getAP();
    const audioEl = getAudio();
    if (ap) {
        try {
            if (type === 'PLAY_PAUSE') {
                if (typeof ap.isPlaying === 'function' && ap.isPlaying()) {
                    if (ap.pause) ap.pause();
                } else {
                    if (ap.play) ap.play();
                }
                return;
            }
            if (type === 'PREV' && typeof ap.playPrev === 'function') { ap.playPrev(); return; }
            if (type === 'NEXT' && typeof ap.playNext === 'function') { ap.playNext(); return; }
        } catch (err) {}
    }
    if (type === 'PLAY_PAUSE' && audioEl) {
        try { audioEl.paused ? audioEl.play() : audioEl.pause(); } catch (err) {}
    }
});

// ─── Перемотка (надёжная, несколькими стратегиями) ─────────────────────
// Запасной путь: кликаем по нативному прогресс-бару VK, как с громкостью.
function seekViaNativeBar(seconds) {
    const dur = getDurationFromAP();
    if (dur <= 0) return false;
    const fraction = Math.max(0, Math.min(1, seconds / dur));
    const sliders = Array.from(document.querySelectorAll('[role="slider"]'));
    const bar = sliders.find(el => {
        const label = (el.getAttribute('aria-label') || '').toLowerCase();
        if (!label.includes('воспроизведени') || label.includes('громк')) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    });
    if (!bar) return false;
    const target = bar.closest('[data-testid="audio_lyrics_progress_bar"]') || bar.parentElement || bar;
    const rect = target.getBoundingClientRect();
    const clientX = rect.left + rect.width * fraction;
    const clientY = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX, clientY };
    try {
        target.dispatchEvent(new PointerEvent('pointerdown', opts));
        target.dispatchEvent(new PointerEvent('pointermove', opts));
        target.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, opts, { buttons: 0 })));
        target.dispatchEvent(new MouseEvent('click', opts));
        return true;
    } catch (e) { return false; }
}

function seekToSeconds(seconds) {
    const ap = getAP();
    // 1) пробуем разные методы у ap (seek может называться по-разному)
    if (ap) {
        const methods = ['seek', 'seekTo', 'setCurrentTime', 'setPosition'];
        for (const m of methods) {
            if (typeof ap[m] === 'function') {
                try { ap[m](seconds); return true; } catch (e) {}
            }
        }
    }
    // 2) напрямую в audio-элемент
    const audioEl = getAudio();
    if (audioEl && isFinite(audioEl.duration) && audioEl.duration > 0) {
        try { audioEl.currentTime = Math.min(seconds, audioEl.duration); return true; } catch (e) {}
    }
    // 3) клик по нативному прогресс-бару
    return seekViaNativeBar(seconds);
}

// Универсальный вход: принимает либо долю (0..1), либо секунды
function doSeek(arg) {
    let seconds = null;
    if (arg && typeof arg.time === 'number') {
        seconds = arg.time;
    } else if (typeof arg === 'number') {
        // трактуем как долю, если <= 1, иначе как секунды
        if (arg >= 0 && arg <= 1) {
            const dur = getDurationFromAP();
            seconds = dur > 0 ? arg * dur : null;
        } else {
            seconds = arg;
        }
    } else if (arg && typeof arg.fraction === 'number') {
        const dur = getDurationFromAP();
        seconds = dur > 0 ? arg.fraction * dur : null;
    }
    if (seconds !== null && seconds >= 0) {
        seekToSeconds(seconds);
    }
}

// Основной канал перемотки — CustomEvent (его НЕ видит плеер VK,
// в отличие от window.postMessage, который VK перехватывает и может
// переключить трек).
window.addEventListener('CLP_SEEK', (e) => {
    doSeek(e.detail || {});
});

// Совместимость со старым content.js, который ещё шлёт postMessage.
// ВАЖНО: это только ПРИЁМ. Сам факт, что content.js шлёт postMessage,
// может триггерить VK — поэтому в content.js клик по караоке лучше
// перевести на CustomEvent (см. правку ниже).
window.addEventListener('message', (e) => {
    if (!e.data) return;
    if (e.data.type === 'CLP_SEEK') {
        doSeek(e.data);
    }
    if (e.data.type === 'CLP_SET_VOLUME') {
        const vol = Math.max(0, Math.min(1, e.data.volume ?? 1));
        const ap = getAP();
        const audioEl = getAudio();
        if (ap && typeof ap.setVolume === 'function') { try { ap.setVolume(vol); } catch (err) {} }
        if (audioEl) { try { audioEl.volume = vol; } catch (err) {} }
    }
});

window.addEventListener('CLP_SET_VOLUME', (e) => {
    const vol = Math.max(0, Math.min(1, e.detail?.volume ?? 1));
    const ap = getAP();
    const audioEl = getAudio();
    if (ap && typeof ap.setVolume === 'function') { try { ap.setVolume(vol); } catch (err) {} }
    if (audioEl) { try { audioEl.volume = vol; } catch (err) {} }
});

// ─── Блокировка рекламы ──────────────────────────────────────────────
const _origPlay = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function() {
    if (this.src && isAdUrl(this.src)) {
        console.info('[CLP] 🚫 Реклама заблокирована');
        scheduleSkipAd();
        return Promise.resolve();
    }
    return _origPlay.apply(this, arguments);
};

function isAdUrl(url) {
    if (!url) return false;
    // Реальные треки VK (audio_api_unavailable) — точно НЕ реклама.
    // Это главная защита от ложных скипов настоящего трека.
    if (url.indexOf('audio_api_unavailable') !== -1) return false;
    // Реклама — только если "ad" встречается как отдельный сегмент пути,
    // а не как подстрока (иначе ловились бы слова вроде "radio", "loading").
    return /\/(ads?|adverts?|advertisements?|commercials?|promos?)\//i.test(url) ||
           /adservice|doubleclick|googlesyndication|adtech\.de/i.test(url) ||
           /[?&]adv=1/i.test(url) ||
           /radiant\.media.*\/ads?\//i.test(url);
}

let _skipScheduled = false;
function scheduleSkipAd() {
    if (_skipScheduled) return;
    _skipScheduled = true;
    setTimeout(() => {
        _skipScheduled = false;
        try {
            const ap = getAP();
            if (ap && typeof ap.playNext === 'function') ap.playNext();
        } catch (e) {}
    }, 150);
}

setInterval(() => {
    const ap = getAP();
    if (!ap) return;
    try {
        const track = ap.getCurrentAudio ? ap.getCurrentAudio() : ap._currentAudio;
        if (track) {
            const url = Array.isArray(track) ? track[2] : track.url;
            if (url && isAdUrl(url)) scheduleSkipAd();
        }
    } catch (e) {}
}, 800);

})();