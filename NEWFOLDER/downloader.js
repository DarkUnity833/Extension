'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   DOWNLOADER.JS v7.9.3 — Полная загрузка плейлиста + Точный вес + Счетчик
   - Удаляем рекламу "Яндекс Браузер"
   - Виртуальный скроллинг по счетчику треков плейлиста
   - Оценка веса с поправкой на реальный битрейт ВК
   ═══════════════════════════════════════════════════════════════════════════ */
((d, w) => {
    let vkId = 0;

    // ─── 1. ДЕОБФУСКАТОР (оригинальный алгоритм) ──────────────────────────
    const run = {
        o: t => {
            if (!t || !~t.indexOf('audio_api_unavailable')) return t;
            try {
                let e = t.split('?extra=')[1].split('#'),
                    o = '' === e[1] ? '' : run.a(e[1]);
                if (e = run.a(e[0]), 'string' != typeof o || !e) return t;
                o = o ? o.split(String.fromCharCode(9)) : [];
                for (let s, r, n = o.length; n--;) {
                    if (r = o[n].split(String.fromCharCode(11)), s = r.splice(0, 1, e)[0], !run.l[s]) return t;
                    e = run.l[s].apply(null, r);
                }
                if (e && 'http' == e.slice(0, 4)) return e;
            } catch {}
            return t;
        },
        r: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN0PQRSTUVWXYZO123456789+/=',
        a: (t, e = '') => {
            if (!t || t.length % 4 == 1) return false;
            for (let n, i, o = 0, a = 0; i = t.charAt(a++);)
                i = run.r.indexOf(i),
                ~i && (n = o % 4 ? 64 * n + i : i, o++ % 4) && (e += String.fromCharCode(255 & n >> (-2 * o & 6)));
            return e;
        },
        s: (t, e) => {
            let i = t.length, a = i, o = [];
            if (i) for (e = Math.abs(e); a--;) e = (i * (a + 1) ^ e + a) % i, o[a] = e;
            return o;
        },
        l: {
            v: t => t.split('').reverse().join(''),
            r: (t, e) => {
                t = t.split('');
                for (let i, o = run.r + run.r, a = t.length; a--;) i = o.indexOf(t[a]), ~i && (t[a] = o.slice(i - e, 1));
                return t.join('');
            },
            s: (t, e) => {
                let i = t.length;
                if (i) {
                    let o = run.s(t, e), a = 0;
                    for (t = t.split(''); ++a < i;) t[a] = t.splice(o[i - 1 - a], 1, t[a])[0];
                    t = t.join('');
                }
                return t;
            },
            i: (t, e) => run.l.s(t, e ^ vkId),
            x: (t, e) => {
                let i = [];
                return e = e.charCodeAt(0), t.split('').forEach(o => i.push(String.fromCharCode(o.charCodeAt(0) ^ e))), i.join('');
            }
        }
    };

    // ─── 2. УТИЛИТЫ (оригинальные) ──────────────────────────────────────────
    const get = (url, m, h) => {
        let g = new XMLHttpRequest();
        g.open(m ? 'post' : 'head', url, true);
        if (m) g.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded'),
               g.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        g.onreadystatechange = () => g.readyState == 4 && h(g);
        g.send(m);
    };

    const getUrl = (b, h) => {
        b.url ? h({ url: run.o(b.url) }) : get('/music', 'al=1&act=reload_audio' + (b.ids.split('_').length < 4 ? 's&audio_' : '&') + 'ids=' + b.ids, j => {
            try {
                j = JSON.parse(j.responseText);
                if (j && j.payload && j.payload[1] && j.payload[1][0] && typeof j.payload[1][0][0] != 'string') {
                    let a = j.payload[1][0][0];
                    h({ url: run.o(a[2]) });
                } else h();
            } catch { h(); }
        });
    };

    const getName = n => {
        n = n.replace(/&#([0-9]{2,5});/g, (a, num) => String.fromCharCode(+num));
        let e = d.createElement('div'); e.innerHTML = n;
        return e.textContent.replace(/[/:*?"<>|~]/g, '').replace(/[_\s]+/g, ' ').trim() + '.mp3';
    };

    const getSize = (a, b, t) => {
        let k = 1024, s = Math.floor(Math.log(b) / Math.log(k));
        a.dataset.size = a.size = Math.min(32 * Math.round(b / 4096 / t), 320) + 'kbs - ' + (b ? (b / Math.pow(k, s)).toFixed(2) + ' ' + ['B ', 'KB', 'MB', 'GB'][s] : '0 B');
    };

    const getStep = (a, b, c) => a.dataset.size = 'load' + '.'.repeat(new Date / 1000 % 4).padEnd(3) + '    ' + (b / c * 100).toFixed() + '%';

    const saveBlob = (blob, name) => {
        const url = URL.createObjectURL(blob);
        const a = d.createElement('a');
        a.href = url; a.download = name;
        d.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    };

    // ─── XHR-обёртки ────────────────────────────────────────────────────────
    function xhrFetchBlob(url) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.responseType = 'blob';
            xhr.withCredentials = true;
            xhr.onload = () => {
                if (xhr.status === 200) {
                    resolve(xhr.response);
                } else {
                    reject(new Error(`HTTP ${xhr.status}`));
                }
            };
            xhr.onerror = () => reject(new Error('Network error'));
            xhr.send();
        });
    }

    function xhrHead(url) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('HEAD', url, true);
            xhr.withCredentials = true;
            xhr.onload = () => {
                if (xhr.status === 200) {
                    const len = +xhr.getResponseHeader('Content-Length');
                    resolve({ status: xhr.status, length: len });
                } else {
                    reject(new Error(`HEAD ${xhr.status}`));
                }
            };
            xhr.onerror = () => reject(new Error('Network error'));
            xhr.send();
        });
    }

    function xhrRange(url, start, end) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.withCredentials = true;
            xhr.setRequestHeader('Range', `bytes=${start}-${end}`);
            xhr.onload = () => {
                if (xhr.status === 206 || xhr.status === 200) {
                    const cl = xhr.getResponseHeader('Content-Range');
                    const len = cl ? parseInt(cl.split('/')[1]) : 0;
                    resolve({ status: xhr.status, length: len });
                } else {
                    reject(new Error(`Range ${xhr.status}`));
                }
            };
            xhr.onerror = () => reject(new Error('Network error'));
            xhr.send();
        });
    }

    // ─── 3. ПОЛУЧЕНИЕ ИНФОРМАЦИИ О ТРЕКЕ ────────────────────────────────
    const getInfo = e => {
        if (e.dataset.audio) {
            let a = JSON.parse(e.dataset.audio), b = a[1] + '_' + a[0];
            if (a[13]) {
                let c = a[13].split('/');
                b += '_' + c[c[1].length == 0 ? 2 : 3] + '_' + c[5];
            } else if (a[24]) b += '_' + a[24];
            return { name: getName(a[4] + ' - ' + a[3] + (a[16] ? ' (' + a[16] + ')' : '')), duration: a[5], ids: b };
        } else {
            let f = (e, s) => {
                let o, fiber = e[Object.keys(e).find(k => k.startsWith('__reactFiber'))], depth = 0;
                while (fiber && depth++ < 10) {
                    let t = fiber.memoizedProps;
                    if (t && typeof t === 'object') {
                        o = t.track?.entity?.apiAudio || t.episode?.entity?.apiAudio || (t.audio?.id && t.audio?.url ? t.audio : null) || t.audio?.entity?.apiAudio || t.originalAttachment || t.track?.data?.apiAudio || t.episode?.data?.apiAudio;
                        if (o) break;
                    }
                    fiber = fiber.return;
                }
                if (!o && !s && e?.parentElement) return f(e.parentElement, 1);
                return o || {};
            }, o = f(e);
            return {
                name: getName((o.artist||'') + ' - ' + (o.title||'') + (o.subtitle ? ' (' + o.subtitle + ')' : '')),
                duration: o.duration,
                ids: o.owner_id + '_' + o.id + '_' + o.access_key,
                url: o.url
            };
        }
    };

    // ─── 4. HLS ИНИЦИАЛИЗАЦИЯ (улучшенная) ────────────────────────────────
    let hlsLoaded = false;
    const initHls = () => new Promise((resolve) => {
        if (w.Hls) {
            resolve(w.Hls);
            return;
        }
        // Пытаемся загрузить из stVersions
        const versions = Object.keys(w.stVersions || {}).filter(e => /\/hls/.test(e));
        if (versions.length) {
            const script = d.createElement('script');
            script.src = '/dist/' + versions[0];
            script.onload = () => {
                if (w.Hls) {
                    resolve(w.Hls);
                } else {
                    // Ищем в webpack-модулях
                    Object.keys(w).filter(e => /webpack/.test(e) && Array.isArray(w[e]))
                        .map(e => w[e]).flat().forEach(e => {
                            if (e[1]) for (let i in e[1]) ~e[1][i].toString().indexOf('hls.js config') && 
                                (e[1][i](e, i, { d: (a, t) => e = t, r: e => e }), e.default && (w.Hls = e.default(), resolve(w.Hls)));
                        });
                    if (!w.Hls) resolve(null);
                }
            };
            script.onerror = () => resolve(null);
            d.body.appendChild(script);
            return;
        }
        // Fallback: CDN
        const cdn = d.createElement('script');
        cdn.src = 'https://cdn.jsdelivr.net/npm/hls.js@0.14.17/dist/hls.min.js';
        cdn.onload = () => {
            if (w.Hls) {
                resolve(w.Hls);
            } else {
                resolve(null);
            }
        };
        cdn.onerror = () => resolve(null);
        d.body.appendChild(cdn);
    });

    // ─── 4b. СОБСТВЕННЫЙ ZIP-УПАКОВЩИК (без внешних зависимостей) ──────────
    const crc32 = (() => {
        let table = null;
        return buf => {
            if (!table) {
                table = new Uint32Array(256);
                for (let n = 0; n < 256; n++) {
                    let c = n;
                    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                    table[n] = c >>> 0;
                }
            }
            let crc = 0xFFFFFFFF;
            for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
            return (crc ^ 0xFFFFFFFF) >>> 0;
        };
    })();

    async function createZip(files) {
        const encoder = new TextEncoder();
        const localChunks = [];
        const centralChunks = [];
        let offset = 0;
        let centralSize = 0;

        for (const f of files) {
            const nameBytes = encoder.encode(f.name);
            const dataBuf = new Uint8Array(await f.data.arrayBuffer());
            const crc = crc32(dataBuf);
            const size = dataBuf.length;

            const localHeader = new Uint8Array(30 + nameBytes.length);
            let dv = new DataView(localHeader.buffer);
            dv.setUint32(0, 0x04034b50, true);
            dv.setUint16(4, 20, true);
            dv.setUint16(6, 0x0800, true); 
            dv.setUint16(8, 0, true); 
            dv.setUint16(10, 0, true);
            dv.setUint16(12, 0, true);
            dv.setUint32(14, crc, true);
            dv.setUint32(18, size, true);
            dv.setUint32(22, size, true);
            dv.setUint16(26, nameBytes.length, true);
            dv.setUint16(28, 0, true);
            localHeader.set(nameBytes, 30);

            localChunks.push(localHeader, dataBuf);

            const central = new Uint8Array(46 + nameBytes.length);
            dv = new DataView(central.buffer);
            dv.setUint32(0, 0x02014b50, true);
            dv.setUint16(4, 20, true);
            dv.setUint16(6, 20, true);
            dv.setUint16(8, 0x0800, true); 
            dv.setUint16(10, 0, true);
            dv.setUint16(12, 0, true);
            dv.setUint16(14, 0, true);
            dv.setUint32(16, crc, true);
            dv.setUint32(20, size, true);
            dv.setUint32(24, size, true);
            dv.setUint16(28, nameBytes.length, true);
            dv.setUint16(32, 0, true);
            dv.setUint16(34, 0, true);
            dv.setUint32(38, 0, true);
            dv.setUint32(42, offset, true);
            central.set(nameBytes, 46);
            centralChunks.push(central);
            centralSize += central.length;

            offset += localHeader.length + dataBuf.length;
        }

        const end = new Uint8Array(22);
        const dv = new DataView(end.buffer);
        dv.setUint32(0, 0x06054b50, true);
        dv.setUint16(8, files.length, true);
        dv.setUint16(10, files.length, true);
        dv.setUint32(12, centralSize, true);
        dv.setUint32(16, offset, true);

        return new Blob([...localChunks, ...centralChunks, end], { type: 'application/zip' });
    }

    // ─── 5. КНОПКИ В СПИСКЕ (оригинальный updateNode) ─────────────────────
    const updateNode = e => {
        if (e.A || e.querySelector('[aria-disabled=true]')) return;
        let b = getInfo(e);
        if (!b.ids) return;
        let id = b.ids.split('_', 2).join('_');
        if (updateNode[id]) return e.A = updateNode[id];

        let a = d.createElement('a');
        const save = blob => {
            a.dataset.size = a.size;
            a.href = URL.createObjectURL(new Blob(blob));
            a.download = b.name;
            a.click();
        };

        a.className = 'audioSize clp-dl-btn';
        a.dataset.size = 'load...';
        a.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"></path></svg>';

        a.addEventListener('mouseenter', e => {
            if (a.dataset.size.slice(-3) == '...') getUrl(b, async u => {
                if (!u) return a.dataset.size = 'try wait...';
                a.download = b.name; a.url = u.url;
                if (u.size) getSize(a, u.size, b.duration);
                else if (await initHls() || w.Hls?.isSupported()) {
                    let hls = new Hls(), audio = d.createElement('audio'), frag, data = [], frags, cut, media_err = 0, duration;
                    let clear = e => { e && (a.dataset.size = 'error...'); hls.stopLoad(); hls.destroy() };
                    hls.on(Hls.Events.MANIFEST_PARSED, (e, d) => { d = d.levels[0].details; frags = d.fragments.length; duration = d.totalduration });
                    hls.on(Hls.Events.BUFFER_CODECS, (e, d) => cut = d.audio && d.audio.container == 'audio/mp4');
                    hls.on(Hls.Events.BUFFER_APPENDING, (e, d) => frag = d.data);
                    hls.on(Hls.Events.FRAG_BUFFERED, (e, d) => {
                        if (!a.start && frag) return hls.detachMedia(), a.load = () => hls.attachMedia(audio), getSize(a, frag.length / d.frag.duration * duration, duration);
                        if (frag) data.push(cut ? frag.slice(8, frag.length) : frag);
                        audio.currentTime = d.frag.start + d.frag.duration;
                        getStep(a, data.length, frags);
                        if (data.length >= frags) clear(), save(data);
                    });
                    hls.on(Hls.Events.ERROR, (e, d) => {
                        if (d.details == 'bufferFullError' || d.details == 'fragLoadError') return clear(e);
                        if (d.type == Hls.ErrorTypes.MEDIA_ERROR && media_err < 2) { if (++media_err > 1) hls.swapAudioCodec(); return hls.recoverMediaError() }
                        clear(e);
                    });
                    hls.loadSource(a.url);
                    hls.attachMedia(audio);
                }
            });
        });

        a.addEventListener('click', async e => {
            e.stopPropagation();
            if (e.isTrusted && a.size && !a.href) {
                e.preventDefault();
                if (a.load) a.start = 1, a.load();
                else {
                    try {
                        const blob = await xhrFetchBlob(a.url);
                        if (blob.size < 500) throw new Error('Файл пустой или битый');
                        save([blob]);
                    } catch (err) {
                        console.error('[VKDL] Download error:', err);
                        a.dataset.size = 'error...';
                    }
                }
            }
        });
        return e.A = updateNode[id] = a;
    };

    const findNode = e => {
        if (e.dataset.testid == 'audiorow-actions') {
            let a = e;
            while (a && !/^(AudioLayer_PlaybackQueue_)?(MusicTrack|PodcastEpisodes?)(Cell|Row|Item)$/.test(a.dataset.testid)) a = a.parentElement;
            return a && updateNode(a) && a.addEventListener('mouseenter', () => a.A.parentElement != e.firstElementChild && e.firstElementChild?.append(a.A));
        }
        e.querySelectorAll('[data-testid=audiorow-actions]').forEach(findNode);
    };

    // ─── 6. КЭШ URL ОТ INJECTED.JS ────────────────────────────────────────
    const urlCache = new Map();
    w.addEventListener('message', ev => {
        if (ev.source !== w) return;
        const data = ev.data;
        if (!data || data.type !== 'CLP_TRACK_URL' || !data.url) return;
        const ownerId = String(data.ownerId || data.owner_id || '');
        const id = String(data.id || data.audioId || '');
        if (ownerId && id && ownerId !== 'undefined') {
            urlCache.set(`${ownerId}_${id}`, { url: data.url, ts: Date.now() });
        }
    });

    // ─── 7. ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ HLS-СБОРКИ ────────────────────────
    function downloadHlsAsBlob(url) {
        return new Promise(async (resolve, reject) => {
            try {
                const Hls = await initHls();
                if (!Hls) {
                    reject(new Error('HLS не поддерживается'));
                    return;
                }
                const hls = new Hls();
                const audio = d.createElement('audio');
                let totalFragments = 0;
                let loadedFragments = 0;
                let mediaErrCount = 0;
                let cut = false;
                let pendingChunk = null;
                const fragmentsData = [];
                let isResolved = false;

                const cleanup = () => { hls.stopLoad(); hls.destroy(); };
                const finish = () => {
                    if (isResolved) return;
                    isResolved = true;
                    cleanup();
                    resolve(new Blob(fragmentsData, { type: 'audio/mpeg' }));
                };
                const fail = (err) => {
                    if (isResolved) return;
                    isResolved = true;
                    cleanup();
                    reject(err);
                };

                hls.on(Hls.Events.MANIFEST_PARSED, (e, data) => {
                    const details = data.levels[0].details;
                    totalFragments = details.fragments.length;
                });

                hls.on(Hls.Events.BUFFER_CODECS, (e, data) => {
                    cut = !!(data.audio && data.audio.container === 'audio/mp4');
                });

                hls.on(Hls.Events.BUFFER_APPENDING, (e, data) => {
                    if (data.data) pendingChunk = data.data;
                });

                hls.on(Hls.Events.FRAG_BUFFERED, (e, data) => {
                    if (pendingChunk) {
                        fragmentsData.push(cut && loadedFragments > 0 ? pendingChunk.slice(8) : pendingChunk);
                        pendingChunk = null;
                        loadedFragments++;
                    }
                    if (data.frag) audio.currentTime = data.frag.start + data.frag.duration;
                    if (totalFragments && loadedFragments >= totalFragments) finish();
                });

                hls.on(Hls.Events.ERROR, (e, data) => {
                    if (data.details === 'bufferFullError') return; 
                    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaErrCount < 2) {
                        mediaErrCount++;
                        if (mediaErrCount > 1) hls.swapAudioCodec();
                        return hls.recoverMediaError();
                    }
                    if (data.fatal || data.details === 'fragLoadError') {
                        fail(new Error('HLS error: ' + data.details));
                    }
                });

                hls.loadSource(url);
                hls.attachMedia(audio);

                setTimeout(() => {
                    if (!isResolved) fail(new Error('Timeout загрузки HLS'));
                }, 120000);
            } catch (e) {
                reject(e);
            }
        });
    }

    // ─── 8. УДАЛЕНИЕ РЕКЛАМЫ ──────────────────────────────────────────────
    function removeAds() {
        const convBars = document.querySelectorAll('.ConversationsBar, [class*="ConversationsBar"]');
        for (const el of convBars) {
            if (el.innerText.includes('Яндекс Браузер') || el.innerHTML.includes('Яндекс&nbsp;Браузер')) {
                el.remove();
                continue;
            }
            const img = el.querySelector('img[alt*="Яндекс Браузер"]');
            if (img) {
                el.remove();
            }
        }

        const leftMenu = document.querySelector('[data-testid="leftmenu"]');
        if (leftMenu) {
            const items = leftMenu.querySelectorAll('[data-testid="leftmenuitem-text"]');
            for (const item of items) {
                if (item.innerText.trim() === 'Яндекс Браузер') {
                    const parent = item.closest('[data-testid="leftmenuitem"]');
                    if (parent) {
                        parent.remove();
                    }
                }
            }
        }

        const allEls = document.querySelectorAll('*');
        for (const el of allEls) {
            if (!el.innerText) continue;
            if (el.innerText.includes('Яндекс Браузер') && el.innerText.includes('Скачать')) {
                if (el.closest('[data-testid="audio-lyrics-header"]') || 
                    el.closest('[data-testid="audio-player-title"]') ||
                    el.closest('[data-testid="MusicAudio_OpenLyrics"]')) {
                    continue;
                }
                if (el.closest('[data-testid="leftmenu"]')) {
                    continue;
                }
                let parent = el;
                while (parent && parent !== document.body) {
                    const classes = parent.className || '';
                    if (typeof classes === 'string' && (
                        classes.includes('ConversationsBar') ||
                        classes.includes('Banner') ||
                        classes.includes('Ad') ||
                        classes.includes('Promo')
                    )) {
                        parent.remove();
                        break;
                    }
                    parent = parent.parentElement;
                }
            }
        }
    }

    // ─── 9. ДОПОЛНИТЕЛЬНЫЕ КНОПКИ ─────────────────────────────────────────
    async function downloadCurrent(btn) {
        if (btn._busy) return;
        if (btn._previewHls) {
            try { btn._previewHls.stopLoad(); btn._previewHls.destroy(); } catch (e) {}
            btn._previewHls = null;
        }
        btn._busy = true;
        btn.dataset.size = 'ищу трек...';
        try {
            const ap = w.ap;
            if (!ap) throw new Error('Плеер не найден');
            let cur = ap.getCurrentAudio?.() || ap._currentAudio;
            if (!cur) throw new Error('Ничего не играет');

            let ownerId, id, duration, artist, title;
            if (Array.isArray(cur)) {
                ownerId = String(cur[1]);
                id = String(cur[0]);
                duration = cur[5] || 0;
                artist = cur[4] || '';
                title = cur[3] || '';
            } else if (cur.owner_id && cur.id) {
                ownerId = String(cur.owner_id);
                id = String(cur.id);
                duration = cur.duration || 0;
                artist = cur.artist || '';
                title = cur.title || '';
            } else {
                throw new Error('Не удалось определить ID');
            }
            if (!ownerId || !id) throw new Error('Не удалось определить ID');

            const selectors = [
                '.audio_row.current',
                '[data-testid^="MusicTrackRow"][class*="selected"]',
                '[aria-selected="true"]',
                '.audio_row._current',
                '[data-testid="MusicTrackRow"][data-id="' + id + '"]'
            ];
            let activeRow = null;
            for (const sel of selectors) {
                const el = d.querySelector(sel);
                if (el) { activeRow = el; break; }
            }
            if (!activeRow) {
                const rows = d.querySelectorAll('[data-audio]');
                for (const row of rows) {
                    try {
                        const data = JSON.parse(row.dataset.audio);
                        if (String(data[0]) === id && String(data[1]) === ownerId) {
                            activeRow = row;
                            break;
                        }
                    } catch(e) {}
                }
            }

            if (activeRow && activeRow.A && activeRow.A.url) {
                const url = activeRow.A.url;
                btn.dataset.size = 'dl...';
                if (url.includes('.m3u8') || url.includes('m3u8')) {
                    btn.dataset.size = 'загружаю';
                    const blob = await downloadHlsAsBlob(url);
                    if (blob.size < 500) throw new Error('Файл пустой или битый');
                    const name = getName(artist + ' - ' + title);
                    saveBlob(blob, name);
                } else {
                    const blob = await xhrFetchBlob(url);
                    if (blob.size < 500) throw new Error('Файл пустой или битый');
                    const name = getName(artist + ' - ' + title);
                    saveBlob(blob, name);
                }
                btn.dataset.size = 'готово';
                setTimeout(() => btn.dataset.size = '', 2000);
                btn._busy = false;
                return;
            }

            const cacheKey = `${ownerId}_${id}`;
            let url = null;
            const cached = urlCache.get(cacheKey);
            if (cached && cached.url && !cached.url.includes('audio_api_unavailable')) {
                url = cached.url;
            }

            if (!url) {
                let accessKey = '';
                if (Array.isArray(cur)) {
                    if (cur[13]) {
                        let c = cur[13].split('/');
                        accessKey = c[c[1].length == 0 ? 2 : 3] + '_' + c[5];
                    } else if (cur[24]) {
                        accessKey = cur[24];
                    }
                } else if (cur.access_key) {
                    accessKey = cur.access_key;
                }
                const ids = ownerId + '_' + id + (accessKey ? '_' + accessKey : '');
                const b = { ids, duration, name: getName(artist + ' - ' + title) };
                await new Promise((resolve, reject) => {
                    getUrl(b, async (result) => {
                        if (result && result.url) {
                            url = result.url;
                            resolve();
                        } else {
                            reject(new Error('Не удалось получить ссылку'));
                        }
                    });
                });
            }

            if (!url) throw new Error('Ссылка не получена');

            btn.dataset.size = 'dl...';
            if (url.includes('.m3u8') || url.includes('m3u8')) {
                btn.dataset.size = 'загружаю';
                const blob = await downloadHlsAsBlob(url);
                if (blob.size < 500) throw new Error('Файл пустой или битый');
                const name = getName(artist + ' - ' + title);
                saveBlob(blob, name);
            } else {
                const blob = await xhrFetchBlob(url);
                if (blob.size < 500) throw new Error('Файл пустой или битый');
                const name = getName(artist + ' - ' + title);
                saveBlob(blob, name);
            }
            btn.dataset.size = 'готово';
            setTimeout(() => btn.dataset.size = '', 2000);
        } catch (e) {
            console.error('[VKDL Current]', e);
            btn.dataset.size = 'err';
            setTimeout(() => btn.dataset.size = '', 3000);
        } finally { btn._busy = false; }
    }

    async function showCurrentTrackInfo(btn) {
        if (btn._busy || btn._infoLoading || btn.dataset.size) return;
        btn._infoLoading = true;
        btn.dataset.size = 'ищу трек...';
        try {
            const ap = w.ap;
            if (!ap) return;
            let cur = ap.getCurrentAudio?.() || ap._currentAudio;
            if (!cur) return;
            let ownerId, id, duration;
            if (Array.isArray(cur)) {
                ownerId = String(cur[1]);
                id = String(cur[0]);
                duration = cur[5] || 0;
            } else if (cur.owner_id && cur.id) {
                ownerId = String(cur.owner_id);
                id = String(cur.id);
                duration = cur.duration || 0;
            } else return;
            if (!ownerId || !id) return;

            const selectors = [
                '.audio_row.current',
                '[data-testid^="MusicTrackRow"][class*="selected"]',
                '[aria-selected="true"]',
                '.audio_row._current'
            ];
            let activeRow = null;
            for (const sel of selectors) {
                const el = d.querySelector(sel);
                if (el) { activeRow = el; break; }
            }
            if (!activeRow) {
                const rows = d.querySelectorAll('[data-audio]');
                for (const row of rows) {
                    try {
                        const data = JSON.parse(row.dataset.audio);
                        if (String(data[0]) === id && String(data[1]) === ownerId) {
                            activeRow = row;
                            break;
                        }
                    } catch(e) {}
                }
            }

            if (activeRow && activeRow.A && activeRow.A.size) {
                btn.dataset.size = activeRow.A.size;
                btn._infoLoading = false;
                return;
            }

            const cacheKey = `${ownerId}_${id}`;
            let url = null;
            const cached = urlCache.get(cacheKey);
            if (cached && cached.url && !cached.url.includes('audio_api_unavailable')) {
                url = cached.url;
            }

            if (!url) {
                let accessKey = '';
                if (Array.isArray(cur)) {
                    if (cur[13]) {
                        let c = cur[13].split('/');
                        accessKey = c[c[1].length == 0 ? 2 : 3] + '_' + c[5];
                    } else if (cur[24]) {
                        accessKey = cur[24];
                    }
                } else if (cur.access_key) {
                    accessKey = cur.access_key;
                }
                const ids = ownerId + '_' + id + (accessKey ? '_' + accessKey : '');
                const b = { ids, duration };
                await new Promise((resolve) => {
                    getUrl(b, async (result) => {
                        if (result && result.url) {
                            url = result.url;
                        }
                        resolve();
                    });
                });
            }

            if (url) {
                if (url.includes('.m3u8') || url.includes('m3u8')) {
                    try {
                        const Hls = await initHls();
                        if (Hls && Hls.isSupported()) {
                            const got = await new Promise(res => {
                                const hls = new Hls();
                                btn._previewHls = hls;
                                const audioEl = d.createElement('audio');
                                let frag = null, hlsDuration = 0, done = false;
                                const stop = (ok, reason) => {
                                    if (done) return;
                                    done = true;
                                    try { hls.stopLoad(); hls.destroy(); } catch (e) {}
                                    if (btn._previewHls === hls) btn._previewHls = null;
                                    res(ok);
                                };
                                hls.on(Hls.Events.MANIFEST_PARSED, (e, data) => {
                                    try { hlsDuration = data.levels[0].details.totalduration; }
                                    catch (err) {}
                                });
                                hls.on(Hls.Events.BUFFER_APPENDING, (e, data) => { frag = data.data; });
                                hls.on(Hls.Events.FRAG_BUFFERED, (e, data) => {
                                    try {
                                        if (frag && data.frag) {
                                            const total = hlsDuration || duration;
                                            getSize(btn, frag.length / data.frag.duration * total, total);
                                            return stop(true);
                                        }
                                        stop(false, 'no frag data on FRAG_BUFFERED (frag=' + !!frag + ', data.frag=' + !!data.frag + ')');
                                    } catch (err) { stop(false, err); }
                                });
                                hls.on(Hls.Events.ERROR, (e, data) => stop(false, 'hls ERROR: ' + JSON.stringify(data && data.details)));
                                hls.loadSource(url);
                                hls.attachMedia(audioEl);
                                setTimeout(() => stop(false, 'timeout after 8s'), 8000);
                            });
                            btn._infoLoading = false;
                            if (got) return;
                        }
                    } catch (e) {}
                    btn.dataset.size = 'HLS поток';
                    btn._infoLoading = false;
                    return;
                }
                try {
                    let len = 0;
                    try {
                        const head = await xhrHead(url);
                        len = head.length;
                    } catch (e) {}

                    if (!len && duration > 0) {
                        try {
                            const range = await xhrRange(url, 0, 1);
                            len = range.length;
                        } catch (e) {}
                    }

                    if (len > 0 && duration > 0) {
                        const kbs = Math.min(32 * Math.round(len / 4096 / duration), 320);
                        let k = 1024, s = Math.floor(Math.log(len) / Math.log(k));
                        btn.dataset.size = `${kbs}kbs - ${(len / Math.pow(k, s)).toFixed(2)} ${['B ','KB','MB','GB'][s]}`;
                        btn._infoLoading = false;
                        return;
                    }
                } catch (e) {}
            }

            btn.dataset.size = 'play to see';
        } catch { btn.dataset.size = ''; }
        finally { btn._infoLoading = false; }
    }

    // ─── 9a. ПОЛУЧЕНИЕ ТОЧНОГО КОЛИЧЕСТВА ТРЕКОВ ИЗ UI ─────────────────────
    function getPlaylistTotalCount() {
        const countSpan = d.querySelector('[data-testid="musicplayliststatistics-count"]');
        if (countSpan && countSpan.textContent) {
            const num = parseInt(countSpan.textContent.replace(/\\D/g, ''), 10);
            if (!isNaN(num) && num > 0) return num;
        }
        return -1;
    }

    // ─── 9b. РАСКРЫТИЕ ПОЛНОГО ПЛЕЙЛИСТА («Показать все» + СКРОЛЛ) ─────────
    async function expandFullPlaylist(rowSelector, onStatus) {
        // 1. Ищем и кликаем "Показать все", если кнопка есть
        for (let i = 0; i < 5; i++) {
            const label = Array.from(d.querySelectorAll('span'))
                .find(el => el.children.length === 0 && el.textContent.trim() === 'Показать все');
            if (!label) break;
            const clickable = label.closest('[role="button"], button, .vkuiTappable__host') || label;
            clickable.click();
            await new Promise(r => setTimeout(r, 700));
        }

        // 2. Ищем скроллируемый контейнер плейлиста
        let scrollContainer = d.querySelector('.vkuiModalPage__in-wrap') ||
                              d.querySelector('.vkuiModalPage__content-wrap') ||
                              d.querySelector('.CatalogBlock__layout');

        if (!scrollContainer) {
            const firstRow = d.querySelector(rowSelector);
            if (firstRow) {
                let node = firstRow.parentElement;
                while (node && node !== d.body) {
                    const style = window.getComputedStyle(node);
                    if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                        scrollContainer = node;
                        break;
                    }
                    node = node.parentElement;
                }
            }
        }
        if (!scrollContainer) scrollContainer = window;

        const targetCount = getPlaylistTotalCount();

        // 3. Скроллим вниз до конца, пока не прогрузятся все треки
        let lastCount = -1;
        let retries = 0;
        
        // Лимит в 200 циклов на случай гигантских плейлистов
        for (let i = 0; i < 200; i++) {
            const count = d.querySelectorAll(rowSelector).length;
            
            if (targetCount > 0) {
                onStatus?.(`Разворачиваю... ${count} из ${targetCount}`);
                if (count >= targetCount) break;
            } else {
                onStatus?.(`Разворачиваю... найдено ${count}`);
            }

            if (count === lastCount) {
                retries++;
                // Даем 4 попытки (вместо 3) на случай медленного рендера
                if (retries >= 4) break;
            } else {
                retries = 0;
            }
            lastCount = count;

            if (scrollContainer === window) {
                window.scrollTo(0, document.body.scrollHeight);
            } else {
                scrollContainer.scrollTop = scrollContainer.scrollHeight;
                // Микро-скролл вверх/вниз для триггера ленивой загрузки (virtual scrolling hack)
                scrollContainer.scrollTop = scrollContainer.scrollHeight - 20;
                await new Promise(r => setTimeout(r, 50));
                scrollContainer.scrollTop = scrollContainer.scrollHeight;
            }
            await new Promise(r => setTimeout(r, 800)); // Ждем рендер
        }
    }

    // ─── 9c. ИМЯ ПЛЕЙЛИСТА/АЛЬБОМА ДЛЯ ZIP ─────────────────────────────────
    function getPlaylistName() {
        const titleEl = d.querySelector('[data-testid="MusicPlaylistModal_Title"]');
        const title = titleEl ? titleEl.textContent.trim() : '';

        let author = '';
        for (const tid of ['MusicPlaylistModal_Author', 'MusicPlaylistModal_Owner', 'MusicPlaylistModal_Subtitle']) {
            const el = d.querySelector(`[data-testid="${tid}"]`);
            if (el && el.textContent.trim()) { author = el.textContent.trim(); break; }
        }
        if (!author && titleEl) {
            let sib = titleEl.parentElement?.nextElementSibling || titleEl.nextElementSibling;
            let hops = 0;
            while (sib && hops++ < 5) {
                const txt = sib.textContent?.trim();
                if (txt && txt !== title && txt.length < 80 && !sib.querySelector('button')) { author = txt; break; }
                sib = sib.nextElementSibling;
            }
        }

        let name = (title || 'playlist') + (author ? ' - ' + author : '');
        name = name.replace(/&#([0-9]{2,5});/g, (a, num) => String.fromCharCode(+num));
        const div = d.createElement('div'); div.innerHTML = name;
        name = div.textContent.replace(/[/:*?"<>|~\\\\]/g, '').replace(/[_\s]+/g, ' ').trim();
        return name || 'playlist';
    }

    const PLAYLIST_ROW_SELECTOR = '[data-testid^="MusicTrackRow"], [data-testid^="PodcastEpisodeRow"], .audio_row';

    async function collectPlaylistRows(onStatus) {
        const rowSelector = PLAYLIST_ROW_SELECTOR;
        onStatus?.('Разворачиваю плейлист...');
        await expandFullPlaylist(rowSelector, onStatus);

        let playlistContainer =
            d.querySelector('[data-testid="MusicPlaylistTracks_Items"]') ||
            d.querySelector('[data-testid="TrackList"]');

        if (!playlistContainer || !playlistContainer.querySelectorAll(rowSelector).length) {
            const headerEl = d.querySelector('[data-testid="audiolistboxheader-actions"]');
            let node = headerEl;
            while (node && node !== d.body) {
                if (node.querySelectorAll(rowSelector).length) { playlistContainer = node; break; }
                node = node.parentElement;
            }
        }

        if (!playlistContainer) return [];

        const rawRows = Array.from(playlistContainer.querySelectorAll(rowSelector));
        if (!rawRows.length) return [];

        const seen = new Set();
        const rows = [];
        for (const row of rawRows) {
            const info = getInfo(row);
            if (!info.ids && !info.url) continue;
            // Игнорируем пустые или невалидные строки-скелетоны
            if (!info.name || info.name.trim() === '.mp3') continue;
            
            const dedupKey = info.ids || info.url;
            if (seen.has(dedupKey)) continue;
            seen.add(dedupKey);
            rows.push({ row, info });
        }
        return rows;
    }

    async function downloadPlaylist(btn) {
        if (btn._busy) return;
        btn._busy = true;
        const origHTML = btn.innerHTML;
        const origTitle = btn.title;
        btn.title = 'Поиск треков...';
        try {
            const rows = await collectPlaylistRows(status => { btn.title = status; });
            if (!rows.length) throw new Error('Треки не найдены в плейлисте');

            const files = [];
            let ok = 0;
            const RING_R = 14;
            const RING_C = 2 * Math.PI * RING_R;
            function renderRing(done, total) {
                const frac = total > 0 ? done / total : 0;
                btn.innerHTML = `
                    <span class="clp-ring-wrap">
                        <svg viewBox="0 0 32 32" width="32" height="32" style="transform:rotate(-90deg)">
                            <circle cx="16" cy="16" r="${RING_R}" fill="none" stroke="rgba(128,128,128,.3)" stroke-width="2.5"/>
                            <circle cx="16" cy="16" r="${RING_R}" fill="none" stroke="currentColor" stroke-width="2.5"
                                stroke-dasharray="${RING_C}"
                                stroke-dashoffset="${RING_C * (1 - frac)}"
                                stroke-linecap="round"/>
                        </svg>
                        <span class="clp-ring-label">${done}/${total}</span>
                    </span>`;
            }

            for (let i = 0; i < rows.length; i++) {
                const { row, info } = rows[i];
                btn.title = `Скачиваю ${i + 1}/${rows.length}`;
                renderRing(i + 1, rows.length);
                try {
                    let url = info.url ? run.o(info.url) : null;
                    if (!url || url.includes('audio_api_unavailable')) {
                        url = await new Promise(resolve => {
                            getUrl({ ids: info.ids, url: info.url }, result => resolve(result && result.url));
                        });
                    }
                    if (!url) continue;

                    let blob;
                    if (url.includes('.m3u8') || url.includes('m3u8')) {
                        blob = await downloadHlsAsBlob(url);
                    } else {
                        blob = await xhrFetchBlob(url);
                    }
                    if (blob && blob.size > 500) {
                        files.push({ name: info.name || `track_${i}.mp3`, data: blob });
                        ok++;
                    }
                } catch (e) {
                    console.warn('[VKDL Playlist] Трек', i + 1, 'пропущен:', e.message || e);
                }
            }

            if (ok === 0) throw new Error('Не удалось скачать ни одного трека. Прокрутите список.');

            const nameCounts = new Map();
            for (const f of files) {
                const count = nameCounts.get(f.name) || 0;
                nameCounts.set(f.name, count + 1);
                if (count > 0) {
                    const dot = f.name.lastIndexOf('.');
                    f.name = dot > -1
                        ? `${f.name.slice(0, dot)} (${count})${f.name.slice(dot)}`
                        : `${f.name} (${count})`;
                }
            }

            btn.title = 'Упаковка...';
            let zipBlob = null;
            try {
                zipBlob = await createZip(files);
            } catch (e) { console.warn('[VKDL] Ошибка упаковки ZIP:', e); }

            if (zipBlob) {
                saveBlob(zipBlob, `${getPlaylistName()}.zip`);
            } else {
                alert(`Не удалось собрать ZIP. Скачиваем ${ok} файлов по отдельности...`);
                for (const f of files) {
                    saveBlob(f.data, f.name);
                    await new Promise(r => setTimeout(r, 800));
                }
            }
        } catch (e) {
            console.error('[VKDL Playlist]', e);
            alert('Ошибка: ' + e.message);
        } finally {
            btn._busy = false;
            btn.innerHTML = origHTML;
            btn.title = origTitle;
        }
    }

    // ─── 9d. ПРИМЕРНЫЙ ВЕС ПЛЕЙЛИСТА (всплывающая менюшка по hover) ───────
    const WEIGHT_CONCURRENCY = 4;
    const WEIGHT_AVG_KBPS = 256; 

    function formatBytesApprox(bytes) {
        if (!bytes || bytes <= 0) return '0 MB';
        const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
        return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
    }

    async function estimatePlaylistWeight(rows, onProgress) {
        let totalBytes = 0, measured = 0, estimated = 0, failed = 0, idx = 0;

        async function worker() {
            while (idx < rows.length) {
                const i = idx++;
                const { info } = rows[i];
                try {
                    let url = info.url ? run.o(info.url) : null;
                    if (!url || url.includes('audio_api_unavailable')) {
                        url = await new Promise(resolve => {
                            getUrl({ ids: info.ids, url: info.url, duration: info.duration }, r => resolve(r && r.url));
                        });
                    }
                    if (!url) { failed++; onProgress?.(measured + estimated + failed, rows.length); continue; }

                    if (url.includes('.m3u8') || url.includes('m3u8')) {
                        if (info.duration > 0) {
                            totalBytes += info.duration * WEIGHT_AVG_KBPS * 1000 / 8;
                            estimated++;
                        } else failed++;
                    } else {
                        try {
                            const head = await xhrHead(url);
                            if (head.length > 0) { totalBytes += head.length; measured++; }
                            else if (info.duration > 0) { totalBytes += info.duration * WEIGHT_AVG_KBPS * 1000 / 8; estimated++; }
                            else failed++;
                        } catch (e) {
                            if (info.duration > 0) { totalBytes += info.duration * WEIGHT_AVG_KBPS * 1000 / 8; estimated++; }
                            else failed++;
                        }
                    }
                } catch (e) {
                    failed++;
                }
                onProgress?.(measured + estimated + failed, rows.length);
            }
        }

        await Promise.all(Array.from({ length: Math.min(WEIGHT_CONCURRENCY, rows.length) }, worker));
        return { totalBytes, measured, estimated, failed, total: rows.length };
    }

    let weightPopupEl = null;
    function getWeightPopup() {
        if (weightPopupEl && d.body.contains(weightPopupEl)) return weightPopupEl;
        weightPopupEl = d.createElement('div');
        weightPopupEl.className = 'clp-weight-popup';
        d.body.appendChild(weightPopupEl);
        return weightPopupEl;
    }

    function positionWeightPopup(popup, anchor) {
        const r = anchor.getBoundingClientRect();
        popup.style.left = `${r.left + r.width / 2}px`;
        popup.style.top = `${r.bottom + 8}px`;
    }

    function renderWeightPopup(popup, result) {
        const { totalBytes, estimated, total } = result;
        const approxNote = estimated > 0 ? `<div class="clp-weight-row clp-weight-sub">≈ ${estimated} шт. по битрейту (HLS)</div>` : '';
        popup.innerHTML = `
            <div class="clp-weight-row clp-weight-total">≈ ${formatBytesApprox(totalBytes)}</div>
            <div class="clp-weight-row clp-weight-sub">${total} треков</div>
            ${approxNote}
        `;
    }

    function showWeightPopup(btn) {
        if (btn._busy) return;
        const popup = getWeightPopup();
        positionWeightPopup(popup, btn);
        popup.style.display = 'block';

        if (btn._weightResult) { renderWeightPopup(popup, btn._weightResult); return; }
        if (btn._weightLoading) return;

        btn._weightLoading = true;
        popup.innerHTML = `<div class="clp-weight-row">Считаю вес… <span class="clp-weight-progress">0/?</span></div>`;

        (async () => {
            try {
                // Передаем коллбек для отображения в прогрессе скачивания/вычислений
                const rows = await collectPlaylistRows((status) => {
                    const statusText = popup.querySelector('.clp-weight-row');
                    if (statusText && status.includes('Разворачиваю')) {
                        statusText.innerHTML = status; 
                    }
                });
                
                if (!rows.length) { popup.innerHTML = `<div class="clp-weight-row">Треки не найдены</div>`; return; }

                popup.innerHTML = `<div class="clp-weight-row">Считаю вес… <span class="clp-weight-progress">0/${rows.length}</span></div>`;

                const result = await estimatePlaylistWeight(rows, (done, total) => {
                    const el = popup.querySelector('.clp-weight-progress');
                    if (el) el.textContent = `${done}/${total}`;
                });
                btn._weightResult = result;
                if (popup.style.display !== 'none') renderWeightPopup(popup, result);
            } catch (e) {
                popup.innerHTML = `<div class="clp-weight-row">Не удалось посчитать</div>`;
            } finally {
                btn._weightLoading = false;
            }
        })();
    }

    function hideWeightPopup() {
        if (weightPopupEl) weightPopupEl.style.display = 'none';
    }

    // ─── 10. ДОПОЛНИТЕЛЬНАЯ ИНЪЕКЦИЯ КНОПОК ──────────────────────────────
    function injectExtraButtons() {
        const lyricsBtn = d.querySelector('[data-testid="MusicAudio_OpenLyrics"]');
        if (lyricsBtn && !lyricsBtn.parentElement.querySelector('.clp-cur-dl-btn')) {
            const btn = d.createElement('button');
            btn.className = 'clp-dl-btn clp-cur-dl-btn';
            btn.type = 'button';
            btn.title = 'Скачать текущий трек';
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"></path></svg>';
            btn.onclick = () => downloadCurrent(btn);
            btn.onmouseenter = () => showCurrentTrackInfo(btn);
            btn.onmouseleave = () => {
                if (btn._previewHls) {
                    try { btn._previewHls.stopLoad(); btn._previewHls.destroy(); } catch (e) {}
                    btn._previewHls = null;
                }
                if (!btn._busy) btn.dataset.size = '';
            };
            lyricsBtn.parentElement.appendChild(btn);
        }

        const headerActions = d.querySelector('[data-testid="audiolistboxheader-actions"]');
        if (headerActions && !headerActions.querySelector('.clp-pl-dl-btn')) {
            const group = headerActions.querySelector('[role="group"]');
            const template = group?.querySelector('button');
            if (group && template) {
                const btn = template.cloneNode(true);
                btn.classList.add('clp-pl-dl-btn');
                btn.removeAttribute('data-testid');
                btn.removeAttribute('aria-busy');
                btn.title = 'Скачать все треки';
                const iconHost = btn.querySelector('.vkuiButton__before') || btn;
                iconHost.innerHTML = '<svg aria-hidden="true" display="block" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style="width:24px;height:24px"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"></path></svg>';
                btn.onclick = () => downloadPlaylist(btn);
                btn.onmouseenter = () => showWeightPopup(btn);
                btn.onmouseleave = () => hideWeightPopup();
                group.appendChild(btn);
            } else if (group) {
                const btn = d.createElement('button');
                btn.className = 'clp-dl-btn clp-pl-dl-btn';
                btn.type = 'button';
                btn.title = 'Скачать все треки';
                btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"></path></svg>';
                btn.onclick = () => downloadPlaylist(btn);
                btn.onmouseenter = () => showWeightPopup(btn);
                btn.onmouseleave = () => hideWeightPopup();
                group.appendChild(btn);
            }
        }
    }

    // ─── 11. СТИЛИ ──────────────────────────────────────────────────────────
    function injectStyles() {
        if (d.getElementById('clp-dl-styles')) return;
        const st = d.createElement('style');
        st.id = 'clp-dl-styles';
        st.textContent = `
            .clp-dl-btn:before {
                content: attr(data-size); display: none; position: absolute; right: 27px; width: 130px;
                padding: 4px 8px; background-color: var(--vkui--color_background_content, #fff);
                border: 1px solid var(--vkui--color_separator_primary, rgba(0,0,0,0.1));
                border-radius: 8px; color: var(--vkui--color_text_primary, #000);
                font-size: 13px; line-height: 18px; text-align: center;
                white-space: break-spaces; z-index: 100; pointer-events: none;
                box-shadow: 0 2px 8px rgba(0,0,0,0.08);
            }
            .clp-dl-btn:hover:before { display: grid; }
            .clp-dl-btn[data-size=""]:before { display: none !important; }

            .clp-dl-btn {
                position: relative; overflow: visible; display: inline-flex; align-items: center; justify-content: center;
                cursor: pointer; transition: background-color 0.2s ease, opacity 0.2s ease;
                border: none; background: transparent; color: var(--vkui--color_icon_secondary, #818c99);
                border-radius: 50%; padding: 0; margin: 0;
            }
            .clp-pl-dl-btn .clp-ring-wrap { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; }
            .clp-pl-dl-btn .clp-ring-label {
                position: absolute; font-size: 10px; line-height: 1; font-weight: 600; font-variant-numeric: tabular-nums;
                color: currentColor; pointer-events: none; white-space: nowrap;
            }
            .clp-weight-popup {
                position: fixed; display: none; z-index: 10000; transform: translateX(-50%);
                background: var(--vkui--color_background_content, #fff);
                border: 1px solid var(--vkui--color_separator_primary, rgba(0,0,0,.1));
                border-radius: 10px; padding: 8px 14px;
                box-shadow: 0 4px 16px rgba(0,0,0,.18);
                font-size: 13px; color: var(--vkui--color_text_primary, #000);
                white-space: nowrap; pointer-events: none; text-align: center;
            }
            .clp-weight-row { line-height: 1.4; }
            .clp-weight-total { font-weight: 700; font-size: 15px; }
            .clp-weight-sub { font-size: 11px; opacity: .65; margin-top: 1px; }
            .clp-weight-progress { font-variant-numeric: tabular-nums; }
            .clp-dl-btn:hover {
                background-color: var(--vkui--color_background_secondary_alpha, rgba(0,0,0,0.04));
                color: var(--vkui--color_icon_primary, #000);
                opacity: 0.9;
            }
            .clp-dl-btn.clp-cur-dl-btn { width: 24px; height: 24px; min-width: 24px; min-height: 24px; }
            .clp-pl-dl-btn { margin-left: 8px; }
            .clp-dl-btn svg { width: 20px; height: 20px; fill: currentColor; }

            .audioSize:before {
                content: attr(data-size); display: none; position: absolute; right: 27px; width: 130px;
                padding: 2px 5px; background-color: var(--n15, var(--vkui--color_background_content));
                border: 1px solid var(--vkui--color_separator_primary);
                border-radius: 6px; color: var(--vkui--color_text_primary);
                font-size: 13px; line-height: 20px; text-align: center; white-space: break-spaces; z-index: 100;
            }
            .audioSize { position: relative; align-items: center; width: 24px; height: 24px; cursor: pointer; }
            .audioSize[href] { color: var(--vkui--color_text_secondary); }
            .audioSize:hover:before { display: grid; }
            .audioSize svg { opacity: 0.85; width: 20px; height: 20px; }
            .audioSize:hover svg { opacity: 1; }
        `;
        d.head.appendChild(st);
    }

    // ─── 12. ИНИЦИАЛИЗАЦИЯ ─────────────────────────────────────────────────
    function init() {
        injectStyles();
        removeAds(); 

        let k = d.head.textContent.match(/\bid:\s?(\d+)/);
        if (k && k[0]) vkId = +k[1];

        findNode(d.body);
        new MutationObserver(e => {
            e.forEach(e => e.type === 'childList' && e.addedNodes.forEach(e => e.nodeType === 1 && findNode(e)));
        }).observe(d.body, { childList: true, subtree: true });

        new MutationObserver(() => {
            injectExtraButtons();
            removeAds(); 
        }).observe(d.body, { childList: true, subtree: true });

        injectExtraButtons();

        console.log('[VKDL] ✅ Ready (v7.9.3 — Smart total counter added)');
    }

    if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init);
    else init();
})(document, window);