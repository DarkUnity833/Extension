'use strict';
/* VK Music downloader — восстановленная MAIN-world логика старого VKDL 7.9.3.
 * Важное: файл должен работать в MAIN world, потому что ему нужен window.ap
 * и React Fiber страницы VK. Chrome API здесь не используется.
 */
(() => {
  if (window.__VKE_VKDL_793__) return;
  window.__VKE_VKDL_793__ = true;

  const d = document;
  const w = window;
  let vkId = Number(w.vk?.id || 0) || 0;

  const ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 3a1 1 0 0 1 1 1v9.586l2.293-2.293a1 1 0 1 1 1.414 1.414l-4 4a1 1 0 0 1-1.414 0l-4-4a1 1 0 1 1 1.414-1.414L11 13.586V4a1 1 0 0 1 1-1m-7 16a1 1 0 0 1 1-1h12a1 1 0 1 0 0 2H6a1 1 0 0 1-1-1"/></svg>';
  const safeName = (s) => String(s || 'VK Music').replace(/[\\/:*?"<>|~]+/g, '').replace(/\s+/g, ' ').trim() || 'VK Music';
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function decodeB64(t, e = '') {
    if (!t || t.length % 4 === 1) return false;
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN0PQRSTUVWXYZO123456789+/=';
    for (let n, i, o = 0, a = 0; (i = t.charAt(a++));) {
      i = alphabet.indexOf(i);
      if (~i) {
        n = o % 4 ? 64 * n + i : i;
        o++ % 4 && (e += String.fromCharCode(255 & n >> (-2 * o & 6)));
      }
    }
    return e;
  }

  const cipher = {
    r: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN0PQRSTUVWXYZO123456789+/=',
    a: decodeB64,
    s: (t, e) => {
      const i = t.length;
      let a = i, o = [];
      if (i) for (e = Math.abs(e); a--;) e = (i * (a + 1) ^ e + a) % i, o[a] = e;
      return o;
    },
    l: {
      v: t => t.split('').reverse().join(''),
      r: (t, e) => {
        t = t.split('');
        const alphabet = cipher.r + cipher.r;
        for (let i, o, a = t.length; a--;) i = alphabet.indexOf(t[a]), ~i && (t[a] = alphabet.slice(i - e, i - e + 1));
        return t.join('');
      },
      s: (t, e) => {
        let i = t.length;
        if (i) {
          const o = cipher.s(t, e);
          let a = 0;
          t = t.split('');
          while (++a < i) t[a] = t.splice(o[i - 1 - a], 1, t[a])[0];
          t = t.join('');
        }
        return t;
      },
      i: (t, e) => cipher.l.s(t, e ^ vkId),
      x: (t, e) => {
        const code = e.charCodeAt(0), out = [];
        t.split('').forEach(o => out.push(String.fromCharCode(o.charCodeAt(0) ^ code)));
        return out.join('');
      }
    }
  };

  function decodeAudioUrl(value) {
    if (!value || typeof value !== 'string') return value;
    if (!~value.indexOf('audio_api_unavailable')) return value;
    try {
      let parts = value.split('?extra=')[1]?.split('#');
      if (!parts || !parts[0]) return value;
      let extra = parts[1] || '';
      let x = extra ? cipher.a(extra) : '';
      let url = cipher.a(parts[0]);
      if (!url) return value;
      const ops = x ? x.split(String.fromCharCode(9)) : [];
      for (let i = ops.length - 1; i >= 0; i--) {
        const spec = ops[i].split(String.fromCharCode(11));
        const fn = spec.splice(0, 1)[0];
        if (!cipher.l[fn]) return value;
        url = cipher.l[fn].apply(null, [url, ...spec]);
      }
      return url && /^https?:\/\//i.test(url) ? url : value;
    } catch (_) {
      return value;
    }
  }

  function get(url, body, handler) {
    const xhr = new XMLHttpRequest();
    xhr.open(body ? 'POST' : 'HEAD', url, true);
    if (body) {
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    }
    xhr.onreadystatechange = () => xhr.readyState === 4 && handler(xhr);
    xhr.send(body || null);
  }

  function resolveAudioUrl(info, cb) {
    if (info.url) return cb({ url: decodeAudioUrl(info.url) });
    if (!info.ids) return cb(null);
    const parts = info.ids.split('_');
    const endpoint = '/music';
    const path = 'al=1&act=reload_audio' + (parts.length < 4 ? 's&audio_' : '&') + 'ids=' + info.ids;
    get(endpoint, path, (xhr) => {
      try {
        const json = JSON.parse(xhr.responseText || '');
        const payload = json?.payload?.[1]?.[0]?.[0];
        if (payload && typeof payload[2] !== 'string') return cb({ url: decodeAudioUrl(payload[2]) });
        // Some current builds return the audio record directly in a nested shape.
        const candidate = findFirstUrl(json);
        return cb(candidate ? { url: decodeAudioUrl(candidate) } : null);
      } catch (_) { cb(null); }
    });
  }

  function findFirstUrl(obj, seen = new Set(), depth = 0) {
    if (!obj || depth > 8 || seen.has(obj)) return '';
    if (typeof obj === 'string') {
      if (/^https?:\/\//i.test(obj) && /(audio|audios|mp3|m4a|stream|music|track)/i.test(obj)) return obj;
      return '';
    }
    if (typeof obj !== 'object') return '';
    seen.add(obj);
    const keys = Array.isArray(obj)
      ? obj.map((_, i) => i)
      : ['url','src','audio_url','audioUrl','streamUrl','stream_url','downloadUrl','download_url','link','file','track','audio','item','data', ...Object.keys(obj)];
    for (const key of keys) {
      try { const got = findFirstUrl(obj[key], seen, depth + 1); if (got) return got; } catch (_) {}
    }
    return '';
  }

  function getName(raw) {
    const text = String(raw || '').replace(/&#([0-9]{2,5});/g, (_, n) => String.fromCharCode(+n));
    const el = d.createElement('div');
    el.innerHTML = text;
    return (el.textContent || 'VK Music').replace(/[/:*?"<>|~\\]/g, '').replace(/[_\s]+/g, ' ').trim() + '.mp3';
  }

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = d.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    (d.body || d.documentElement).appendChild(a);
    try { a.click(); } finally { a.remove(); }
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  function xhrBlob(url, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'blob';
      xhr.withCredentials = true;
      xhr.onprogress = e => { if (onProgress) onProgress(e.lengthComputable ? e.loaded / Math.max(1,e.total) : 0); };
      xhr.onload = () => xhr.status >= 200 && xhr.status < 400 ? resolve(xhr.response) : reject(new Error('HTTP ' + xhr.status));
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send();
    });
  }

  function xhrHead(url) {
    return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest(); xhr.open('HEAD',url,true); xhr.withCredentials=true;
      xhr.onload=()=>xhr.status>=200&&xhr.status<400?resolve(Number(xhr.getResponseHeader('Content-Length')||0)):reject(new Error('HTTP '+xhr.status));
      xhr.onerror=()=>reject(new Error('Network error')); xhr.send();
    });
  }

  function xhrContentLength(url) {
    return new Promise(async resolve => {
      try {
        const head = await xhrHead(url);
        if (head > 0) return resolve(head);
      } catch (_) {}
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.withCredentials = true;
        xhr.setRequestHeader('Range', 'bytes=0-1');
        xhr.responseType = 'arraybuffer';
        xhr.onload = () => {
          const cr = xhr.getResponseHeader('Content-Range') || '';
          const m = cr.match(/\/(\d+)$/);
          if (m) return resolve(Number(m[1]));
          const cl = Number(xhr.getResponseHeader('Content-Length') || 0);
          resolve(cl > 1 ? cl : 0);
        };
        xhr.onerror = () => resolve(0);
        xhr.send();
      } catch (_) { resolve(0); }
    });
  }

  let HlsCtor = w.Hls || null;
  let hlsLoadPromise = null;
  async function initHls() {
    if (HlsCtor || w.Hls) { HlsCtor = HlsCtor || w.Hls; return HlsCtor; }
    if (hlsLoadPromise) return hlsLoadPromise;
    hlsLoadPromise = (async () => {
      // 1) Наш bundled HLS.js. This is required for VK m3u8 downloads.
      try {
        await new Promise(resolve => {
          const src = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
            ? chrome.runtime.getURL('modules/hls.min.js')
            : '/modules/hls.min.js';
          const s = d.createElement('script');
          s.src = src;
          s.async = false;
          s.onload = resolve;
          s.onerror = resolve;
          (d.head || d.documentElement).appendChild(s);
        });
        if (w.Hls) { HlsCtor = w.Hls; return HlsCtor; }
      } catch (_) {}
      // 2) VK's own HLS bundle as fallback.
      const versions = Object.keys(w.stVersions || {}).filter(k => /\/hls/i.test(k));
      if (versions.length) {
        await new Promise(resolve => {
          const s = d.createElement('script');
          s.src = '/dist/' + versions[0];
          s.onload = resolve; s.onerror = resolve;
          (d.head || d.documentElement).appendChild(s);
        });
        if (w.Hls) HlsCtor = w.Hls;
      }
      return HlsCtor || w.Hls || null;
    })();
    return hlsLoadPromise;
  }

  async function downloadHls(url, onProgress) {
    const Hls = await initHls();
    if (!Hls) throw new Error('HLS поток: не найден Hls.js');
    return new Promise((resolve, reject) => {
      const hls = new Hls();
      const audio = d.createElement('audio');
      let chunks = [];
      let pending = null;
      let total = 0;
      let done = 0;
      let resolved = false;
      const cleanup = () => { try { hls.stopLoad(); hls.destroy(); } catch (_) {} };
      const finish = blob => { if (resolved) return; resolved = true; cleanup(); resolve(blob); };
      const fail = err => { if (resolved) return; resolved = true; cleanup(); reject(err); };
      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => { total = data?.levels?.[0]?.details?.fragments?.length || 0; if(onProgress) onProgress(0,total); });
      hls.on(Hls.Events.BUFFER_APPENDING, (_, data) => { pending = data?.data || null; });
      hls.on(Hls.Events.FRAG_BUFFERED, (_, data) => {
        if (pending) { chunks.push(pending); pending = null; done++; if(onProgress) onProgress(total?done/total:0,total?done:done); }
        if (data?.frag) { try { audio.currentTime = data.frag.start + data.frag.duration; } catch (_) {} }
        if (total && done >= total) finish(new Blob(chunks, { type: 'audio/mp4' }));
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data?.type === Hls.ErrorTypes.MEDIA_ERROR && !resolved) { try { hls.recoverMediaError(); } catch (_) {} return; }
        if (data?.fatal || data?.details === 'fragLoadError') fail(new Error('HLS: ' + (data?.details || 'unknown')));
      });
      hls.loadSource(url); hls.attachMedia(audio);
      setTimeout(() => { if (!resolved) fail(new Error('Таймаут HLS загрузки')); }, 120000);
    });
  }

  function getInfo(el) {
    if (el?.dataset?.audio) {
      try {
        const a = JSON.parse(el.dataset.audio);
        let access = '';
        if (a[13]) {
          const c = String(a[13]).split('/');
          access = '_' + c[(c[1] || '').length === 0 ? 2 : 3] + '_' + c[5];
        } else if (a[24]) access = '_' + a[24];
        return {
          name: getName((a[4] || '') + ' - ' + (a[3] || '') + (a[16] ? ' (' + a[16] + ')' : '')),
          duration: Number(a[5] || 0),
          ids: String(a[1]) + '_' + String(a[0]) + access,
          url: decodeAudioUrl(a[2] || ''),
          owner_id: String(a[1] || ''),
          id: String(a[0] || ''),
          access_key: a[24] || ''
        };
      } catch (_) {}
    }
    const findProps = (node) => {
      let cur = node;
      for (let depth = 0; cur && depth++ < 8; cur = cur.parentElement) {
        let fiber = null;
        for (const key of Object.keys(cur)) {
          if (key.startsWith('__reactFiber')) { fiber = cur[key]; break; }
        }
        let p = fiber;
        while (p) {
          const props = p.memoizedProps;
          if (props && typeof props === 'object') {
            const o = props.track?.entity?.apiAudio || props.episode?.entity?.apiAudio || props.audio?.entity?.apiAudio || props.track?.data?.apiAudio || props.episode?.data?.apiAudio || (props.audio?.id && props.audio?.url ? props.audio : null) || props.originalAttachment;
            if (o) return o;
          }
          p = p.return;
        }
      }
      return null;
    };
    const o = findProps(el) || {};
    const owner = o.owner_id ?? o.ownerId ?? '';
    const id = o.id ?? o.audio_id ?? '';
    const access = o.access_key || o.accessKey || '';
    return {
      name: getName((o.artist || o.author || '') + ' - ' + (o.title || o.name || '') + (o.subtitle ? ' (' + o.subtitle + ')' : '')),
      duration: Number(o.duration || 0),
      ids: [owner, id, access].filter(Boolean).join('_'),
      url: decodeAudioUrl(o.url || o.src || o.audio_url || ''),
      owner_id: String(owner), id: String(id), access_key: access
    };
  }

  function getCurrent() {
    const ap = w.ap;
    if (!ap) return null;
    let cur = null;
    try { cur = ap.getCurrentAudio?.() || ap._currentAudio || ap.getCurrentTrack?.() || ap.cur?.track || null; } catch (_) {}
    if (!cur) return null;
    if (Array.isArray(cur)) {
      const owner = String(cur[1] ?? '');
      const id = String(cur[0] ?? '');
      let access = '';
      if (cur[13]) {
        const c = String(cur[13]).split('/');
        access = c[(c[1] || '').length === 0 ? 2 : 3] + '_' + c[5];
      } else if (cur[24]) access = String(cur[24]);
      return { owner_id: owner, id, duration: Number(cur[5] || 0), artist: String(cur[4] || ''), title: String(cur[3] || ''), access_key: access, url: decodeAudioUrl(cur[2] || ''), ids: [owner,id,access].filter(Boolean).join('_'), name: getName((cur[4] || '') + ' - ' + (cur[3] || '')) };
    }
    return { owner_id: String(cur.owner_id ?? cur.ownerId ?? ''), id: String(cur.id ?? ''), duration: Number(cur.duration || 0), artist: String(cur.artist || cur.author || ''), title: String(cur.title || cur.name || ''), access_key: cur.access_key || cur.accessKey || '', url: decodeAudioUrl(cur.url || cur.src || cur.audio_url || ''), ids: [cur.owner_id ?? cur.ownerId, cur.id, cur.access_key || cur.accessKey].filter(Boolean).join('_'), name: getName((cur.artist || cur.author || '') + ' - ' + (cur.title || cur.name || '')) };
  }

  const URL_CACHE = new Map();
  const META_CACHE = new Map();
  const SIZE_CACHE = new Map();
  function cacheUrl(info, url) { if (info.owner_id && info.id && url) URL_CACHE.set(`${info.owner_id}_${info.id}`, { url, ts: Date.now() }); }

  async function resolveInfo(info) {
    if (info?.url && !info.url.includes('audio_api_unavailable')) { cacheUrl(info, info.url); return decodeAudioUrl(info.url); }
    if (info?.owner_id && info?.id) {
      const c = URL_CACHE.get(`${info.owner_id}_${info.id}`);
      if (c?.url && Date.now() - c.ts < 10 * 60 * 1000) return c.url;
    }
    return new Promise(resolveAudioUrlPromise => {
      resolveAudioUrl(info, r => {
        const url = r?.url ? decodeAudioUrl(r.url) : '';
        if (url) cacheUrl(info, url);
        resolveAudioUrlPromise(url || '');
      });
    });
  }

  async function downloadInfo(info, onProgress) {
    const url = await resolveInfo(info);
    if (!url) throw new Error('Не удалось получить ссылку на аудио');
    if (/\.m3u8(?:[?#]|$)|m3u8/i.test(url)) {
      const blob = await downloadHls(url, (p,n)=>onProgress?.(p, n));
      if (!blob?.size || blob.size < 500) throw new Error('Пустой HLS-файл');
      if (info.owner_id && info.id) SIZE_CACHE.set(`${info.owner_id}_${info.id}`, blob.size);
      saveBlob(blob, info.name || getName((info.artist || '') + ' - ' + (info.title || '')));
      return {url,blob};
    }
    const blob = await xhrBlob(url,onProgress);
    if (!blob?.size || blob.size < 500) throw new Error('Пустой аудиофайл');
    if (info.owner_id && info.id) SIZE_CACHE.set(`${info.owner_id}_${info.id}`, blob.size);
    saveBlob(blob, info.name || getName((info.artist || '') + ' - ' + (info.title || '')));
    return {url,blob};
  }

  async function downloadBlob(urlOrInfo, maybeUrl, onProgress) {
    const info = (typeof urlOrInfo === 'object') ? urlOrInfo : null;
    const url = maybeUrl || urlOrInfo;
    if (!url) return null;
    if (/\.m3u8(?:[?#]|$)|m3u8/i.test(url)) return downloadHls(url,onProgress);
    return xhrBlob(url,onProgress);
  }

  async function fetchText(url) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.withCredentials = true;
      xhr.responseType = 'text';
      xhr.onload = () => xhr.status >= 200 && xhr.status < 400 ? resolve(xhr.responseText || '') : reject(new Error('HTTP ' + xhr.status));
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send();
    });
  }


  async function estimateHlsBytes(url) {
    try {
      const master = await fetchText(url);
      if (!master) return 0;
      const variantLines = [];
      const lines = master.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (/^#EXT-X-STREAM-INF:/i.test(lines[i])) {
          const next = lines[i+1]?.trim();
          if (next && !next.startsWith('#')) {
            const bw = Number((lines[i].match(/(?:^|,)AVERAGE-BANDWIDTH=(\d+)/i)?.[1]) || (lines[i].match(/(?:^|,)BANDWIDTH=(\d+)/i)?.[1]) || 0);
            variantLines.push({ url: new URL(next, url).href, bw });
          }
        }
      }
      let media = master;
      if (variantLines.length) {
        variantLines.sort((a,b)=>(b.bw||0)-(a.bw||0));
        media = await fetchText(variantLines[0].url);
        url = variantLines[0].url;
      }
      if (!media) return 0;
      const segs = [];
      for (const line of media.split(/\r?\n/)) {
        const t=line.trim();
        if (!t || t[0]==='#') continue;
        try { segs.push(new URL(t, url).href); } catch (_) {}
      }
      if (!segs.length) return 0;
      let total = 0, idx = 0;
      const workers = Array.from({length: Math.min(8, segs.length)}, async () => {
        while (idx < segs.length) {
          const i = idx++;
          try { total += await xhrContentLength(segs[i]); } catch (_) {}
        }
      });
      await Promise.all(workers);
      return total;
    } catch (_) { return 0; }
  }

  function parseHlsMeta(text, duration) {
    if (!text) return null;
    const variants = [];
    const re = /#EXT-X-STREAM-INF:([^\n\r]+)[\r\n]+[^#\r\n]+/g;
    let m;
    while ((m = re.exec(text))) {
      const attrs = m[1];
      const b = attrs.match(/(?:^|,)BANDWIDTH=(\d+)/i);
      const ab = attrs.match(/(?:^|,)AVERAGE-BANDWIDTH=(\d+)/i);
      const bw = Number((ab && ab[1]) || (b && b[1]) || 0);
      if (bw > 0) variants.push(bw);
    }
    if (!variants.length) return null;
    const bits = Math.max(...variants);
    const kbps = Math.max(32, Math.round(bits / 1000));
    return { kbps, size: Math.max(0, Number(duration || 0)) * bits / 8, approx: true };
  }

  async function audioMeta(info) {
    const key = info?.owner_id && info?.id ? `${info.owner_id}_${info.id}` : info?.ids || '';
    if (key && META_CACHE.has(key)) return META_CACHE.get(key);

    const url = await resolveInfo(info);
    if (!url) throw new Error('URL не получен');

    const cachedSize = key ? SIZE_CACHE.get(key) : 0;
    if (cachedSize > 0 && info.duration > 0) {
      const kbps = Math.max(32, Math.round((cachedSize * 8) / info.duration / 1000));
      const result = { url, size: cachedSize, kbps, approx: false };
      if (key) META_CACHE.set(key, result);
      return result;
    }

    if (/\.m3u8(?:[?#]|$)|m3u8/i.test(url)) {
      let result = null;
      try {
        const exactBytes = await estimateHlsBytes(url);
        if (exactBytes > 0 && info.duration > 0) {
          result = { kbps: Math.max(32, Math.round((exactBytes * 8) / info.duration / 1000)), size: exactBytes, approx: false };
        }
      } catch (_) {}
      if (!result) try {
        result = parseHlsMeta(await fetchText(url), info.duration);
      } catch (_) {}
      if (!result) {
        try {
          const Hls = await initHls();
          if (Hls && Hls.isSupported()) {
            result = await new Promise(resolve => {
              const hls = new Hls({ enableWorker: false, lowLatencyMode: false });
              let settled = false;
              const done = value => { if (settled) return; settled = true; try { hls.destroy(); } catch (_) {} resolve(value); };
              hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
                const level = data?.levels?.[0];
                const bw = Number(level?.bitrate || level?.attrs?.BANDWIDTH || 0);
                done(bw > 0 ? { kbps: Math.max(32, Math.round(bw / 1000)), size: Math.max(0, Number(info.duration || 0)) * bw / 8, approx: true } : null);
              });
              hls.on(Hls.Events.ERROR, () => done(null));
              hls.loadSource(url);
              setTimeout(() => done(null), 5000);
            });
          }
        } catch (_) {}
      }
      if (!result) {
        const kbps = 256;
        result = { kbps, size: Math.max(0, Number(info.duration || 0)) * kbps * 1000 / 8, approx: true };
      }
      result.url = url;
      if (key) META_CACHE.set(key, result);
      return result;
    }

    let size = await xhrContentLength(url);
    if (size > 0 && info.duration > 0) {
      const kbps = Math.max(32, Math.round((size * 8) / info.duration / 1000));
      const result = { url, size, kbps, approx: false };
      if (key) { SIZE_CACHE.set(key, size); META_CACHE.set(key, result); }
      return result;
    }
    const kbps = 256;
    const result = { url, size: Math.max(0, Number(info.duration || 0)) * kbps * 1000 / 8, kbps, approx: true };
    // Approximate metadata is deliberately not cached: the first failed HEAD
    // must not permanently poison the tooltip with a wrong value.
    return result;
  }

  function rowName(row) {
    const c = row.cloneNode(true);
    c.querySelectorAll('button,svg,[aria-hidden="true"]').forEach(x => x.remove());
    const lines = (c.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
    return { artist: lines[0] || '', title: lines[1] || lines[0] || '' };
  }

  function nearestRow(el) {
    let n = el;
    for (let i = 0; n && i < 10; i++, n = n.parentElement) {
      if (n.dataset?.testid?.startsWith('MusicTrackRow') || n.dataset?.testid?.startsWith('PodcastEpisodeRow') || n.classList?.contains('audio_row') || n.querySelector?.('[data-testid="MusicAudio_MenuButton"]')) return n;
    }
    return el.closest?.('li,[role="listitem"],article') || el.parentElement;
  }

  function buttonRing(percent=null,label='') {
    if(percent===null) return '<span class="vke-dl-spinner"></span>';
    const r=9,c=2*Math.PI*r,p=Math.max(0,Math.min(1,percent));
    return `<span class="vke-dl-ring"><svg viewBox="0 0 24 24"><circle class="bg" cx="12" cy="12" r="${r}"/><circle class="fg" cx="12" cy="12" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c*(1-p)}"/></svg><span>${label}</span></span>`;
  }
  function paintButton(a, mode, pct, label){
    a.classList.toggle('is-loading',mode==='loading');
    a.classList.toggle('is-success',mode==='done');
    a.innerHTML = mode==='loading' ? buttonRing(pct,label) : ICON;
  }
  let metaTip = null;
  let metaTipAnchor = null;
  let metaTipToken = 0;
  function getMetaTip(){
    if (metaTip && d.body.contains(metaTip)) return metaTip;
    metaTip=d.createElement('div'); metaTip.className='vke-vkdl-meta-tip'; metaTip.style.display='none';
    (d.body||d.documentElement).appendChild(metaTip); return metaTip;
  }
  function positionMetaTip(btn){
    const tip=getMetaTip();
    if(!btn || !btn.isConnected) { tip.style.display='none'; return; }
    const r=btn.getBoundingClientRect();
    if(!r.width || !r.height) { tip.style.display='none'; return; }
    const tipWidth = Math.max(110, Math.min(190, tip.offsetWidth || 150));
    const left=Math.max(8, Math.min(window.innerWidth-8, r.left + r.width/2));
    const top=Math.max(8, r.top - 8);
    tip.style.left=left+'px'; tip.style.top=top+'px';
    tip.style.transform='translate(-50%,-100%)';
    metaTipAnchor = btn;
  }
  function showMetaTip(btn,text,token){
    if(!btn || !btn.isConnected) return;
    if(token != null && token !== metaTipToken) return;
    if(!btn.matches(':hover') && document.activeElement !== btn) return;
    const tip=getMetaTip();
    metaTipAnchor=btn;
    tip.textContent=text||'';
    positionMetaTip(btn);
    tip.style.display=text?'block':'none';
  }
  function hideMetaTip(btn, invalidate=true){
    if(invalidate) metaTipToken++;
    if(!btn || !metaTipAnchor || btn===metaTipAnchor || !metaTipAnchor.matches?.(':hover')) {
      if(metaTip) metaTip.style.display='none';
      metaTipAnchor=null;
    }
  }
  function keepMetaTipPosition(){
    if(metaTip && metaTip.style.display!=='none' && metaTipAnchor) {
      if(!metaTipAnchor.isConnected || (!metaTipAnchor.matches(':hover') && document.activeElement!==metaTipAnchor)) {
        hideMetaTip(metaTipAnchor);
      } else {
        positionMetaTip(metaTipAnchor);
      }
    }
  }
  window.addEventListener('scroll', keepMetaTipPosition, true);
  window.addEventListener('resize', keepMetaTipPosition, {passive:true});
  document.addEventListener('visibilitychange', ()=>{ if(document.hidden) hideMetaTip(null); });
  function formatBytes(b){ if(!b||b<1)return '0 B'; const k=1024,u=['B','KB','MB','GB']; const i=Math.min(u.length-1,Math.floor(Math.log(b)/Math.log(k))); return `${(b/Math.pow(k,i)).toFixed(i?1:0)} ${u[i]}`; }
  function buttonRing(percent=null,label=''){
    if(percent===null) return '<span class="vke-dl-spinner"></span>';
    const r=9,c=2*Math.PI*r,p=Math.max(0,Math.min(1,Number(percent)||0));
    return `<span class="vke-dl-ring"><svg viewBox="0 0 24 24"><circle class="bg" cx="12" cy="12" r="${r}"/><circle class="fg" cx="12" cy="12" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c*(1-p)}"/></svg><span>${label}</span></span>`;
  }
  function paintButton(a, mode, pct, label){
    a.classList.toggle('is-loading',mode==='loading');
    a.classList.toggle('is-success',mode==='done');
    a.innerHTML = mode==='loading' ? buttonRing(pct,label) : ICON;
  }
  function buildFinalInfo(row){
    const info=getInfo(row), rn=rowName(row);
    return {...info,artist:rn.artist||info.artist||'',title:rn.title||info.title||'',name:info.name&&info.name!=='.mp3'?info.name:getName(`${rn.artist||info.artist||''} - ${rn.title||info.title||''}`)};
  }
  function createButton(){
    const a=d.createElement('a'); a.className='vke-vkdl-btn audioSize'; a.href='#'; a.title='Скачать'; a.innerHTML=ICON; a.dataset.size='';
    a.addEventListener('mouseenter',async()=>{
      if(a._busy) return;
      const token=++metaTipToken;
      metaTipAnchor=a;
      if(a._metaLoading){ showMetaTip(a,'Получаю данные…',token); return; }
      a._metaLoading=true;
      try{
        const row=nearestRow(a), finalInfo=buildFinalInfo(row);
        if(!finalInfo.owner_id||!finalInfo.id){ showMetaTip(a,'Недоступно',token); return; }
        const cached=a._meta;
        if(cached){ showMetaTip(a,`${cached.approx?'≈ ':''}${cached.kbps} kb/s\n${formatBytes(cached.size)}`,token); return; }
        showMetaTip(a,'Получаю данные…',token);
        const m=await audioMeta(finalInfo); a._meta=m;
        showMetaTip(a,`${m.approx?'≈ ':''}${m.kbps} kb/s\n${formatBytes(m.size)}`,token);
      }catch{ showMetaTip(a,'Не удалось определить размер',token); }
      finally{a._metaLoading=false;}
    });
    a.addEventListener('mouseleave',()=>{hideMetaTip(a);});
    a.addEventListener('blur',()=>{if(document.activeElement!==a) hideMetaTip(a);});
    a.addEventListener('click',async e=>{
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();if(a._busy)return;a._busy=true;hideMetaTip(a);
      try{
        const row=nearestRow(a), finalInfo=buildFinalInfo(row);
        paintButton(a,'loading',null,'');
        await downloadInfo(finalInfo,(p)=>paintButton(a,'loading',p,`${Math.round((Number(p)||0)*100)}%`));
        paintButton(a,'done');
        setTimeout(()=>{if(!a.matches(':hover'))a.innerHTML=ICON;},1800);
      }catch(err){console.warn('[VKDL]',err);paintButton(a,'done');}
      finally{a._busy=false;}
    },true);
    return a;
  }

  function injectRowButtons() {
    const groups = d.querySelectorAll('[data-testid="audiorow-actions"], [data-testid="MusicAudio_OpenSnippet"]');
    for (const el of groups) {
      const group = el.matches('[data-testid="audiorow-actions"]') ? el : el.closest('[role="group"]');
      if (!group || group.querySelector('.vke-vkdl-btn')) continue;
      const b = createButton();
      const menu = group.querySelector('[data-testid="MusicAudio_MenuButton"]');
      if (menu?.parentElement) menu.parentElement.before(b); else group.appendChild(b);
    }
  }

  async function downloadCurrent(button) {
    if (button._busy) return;
    button._busy = true;
    paintButton(button,'loading',0,'');
    button.dataset.size = 'ищу…';
    try {
      const info = getCurrent();
      if (!info) throw new Error('Плеер не найден');
      await downloadInfo(info,(p)=>paintButton(button,'loading',p,`${Math.round(p*100)}%`));
      paintButton(button,'done');
      button.dataset.size = 'готово';
    } catch (err) {
      console.warn('[VKDL Current]', err);
      button.dataset.size = 'ошибка';
    } finally {
      setTimeout(() => { button.dataset.size = ''; }, 2500);
      button._busy = false;
    }
  }

  function addCurrentButton() {
    const host = d.querySelector('[data-testid="MusicAudio_OpenLyrics"]')?.parentElement;
    if (!host || host.querySelector('.vke-vkdl-current')) return;
    const b = d.createElement('button');
    b.type = 'button'; b.className = 'vke-vkdl-current vke-vkdl-btn'; b.title = 'Скачать текущий трек'; b.innerHTML = ICON;
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); downloadCurrent(b); }, true);
    b.addEventListener('mouseenter', async () => {
      if (b._busy) return;
      const token=++metaTipToken;
      metaTipAnchor=b;
      try {
        const info=getCurrent();
        if (!info) return showMetaTip(b,'Нет текущего трека',token);
        showMetaTip(b,'Получаю данные…',token);
        const m=await audioMeta(info); b._meta=m;
        if (!b._busy) showMetaTip(b,`${m.approx?'≈ ':''}${m.kbps} kb/s\n${formatBytes(m.size)}`,token);
      } catch (_) { showMetaTip(b,'Не удалось определить размер',token); }
    });
    b.addEventListener('mouseleave', () => { hideMetaTip(b); });
    b.addEventListener('blur', () => { if(document.activeElement!==b) hideMetaTip(b); });
    host.appendChild(b);
  }

  function style() {
    if (d.getElementById('vke-vkdl-style')) return;
    const s = d.createElement('style'); s.id='vke-vkdl-style';
    s.textContent = `
      .vke-vkdl-btn{position:relative;display:inline-flex!important;align-items:center!important;justify-content:center!important;box-sizing:border-box!important;width:24px!important;height:24px!important;min-width:24px!important;min-height:24px!important;padding:0!important;margin:0!important;border:0!important;background:transparent!important;color:var(--vkui--color_icon_secondary,#818c99)!important;cursor:pointer!important;opacity:1!important;visibility:visible!important;pointer-events:auto!important;border-radius:50%!important;text-decoration:none!important;flex:0 0 24px!important;z-index:3!important}
      .vke-vkdl-btn:hover{background:var(--vkui--color_background_secondary_alpha,rgba(0,0,0,.08))!important;color:var(--vkui--color_icon_primary,#fff)!important}
      .vke-vkdl-btn svg{display:block!important;width:20px!important;height:20px!important;fill:currentColor!important;pointer-events:none!important}
      .vke-vkdl-meta-tip{position:fixed;z-index:2147483647;min-width:110px;max-width:190px;padding:6px 9px;border-radius:9px;background:rgba(30,30,32,.96);border:1px solid rgba(255,255,255,.12);color:#fff;font:12px/16px system-ui,sans-serif;text-align:center;white-space:pre-line;box-shadow:0 8px 28px rgba(0,0,0,.32);pointer-events:none;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
      .vke-vkdl-current{margin-left:-2px!important;transform:translateX(-2px)!important}
      .clp-pl-dl-btn,.vke-album-download{display:inline-flex!important;align-items:center!important;justify-content:center!important}
      .vke-album-download .vkuiButton__before{display:inline-flex!important;align-items:center!important;justify-content:center!important;height:100%!important;margin:0!important;padding:0!important}
      .vke-album-download svg{display:block!important;width:20px!important;height:20px!important;transform:translateY(0)!important}
    `;
    d.head.appendChild(s);
  }

  style();
  injectRowButtons();
  addCurrentButton();
  new MutationObserver(() => { injectRowButtons(); addCurrentButton(); }).observe(d.documentElement, {subtree:true, childList:true});

  w.addEventListener('message', (ev) => {
    const msg = ev.data || {};
    if (ev.source !== w || msg.type !== 'VKE_VKDL_DOWNLOAD_CURRENT') return;
    const fake = d.createElement('button');
    fake._busy = false;
    downloadCurrent(fake).catch(err => console.warn('[VKDL Current]', err));
  });

  w.VKE_VKDL = { getCurrent, getInfo, resolveInfo, downloadInfo, downloadBlob, fetchBlob:xhrBlob, audioMeta, safeName, ICON, downloadCurrent };
  console.log('[VKDL] ✅ Restored downloader 7.9.3 logic in MAIN world');
})();
