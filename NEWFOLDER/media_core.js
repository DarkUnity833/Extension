// VKE media core — unified resolver for video / clips / stories.
// MAIN world: exact active media binding, React metadata, VK API bridge.
(() => {
  'use strict';
  if (window.__vkeMediaCoreV3) return;
  window.__vkeMediaCoreV3 = true;

  const VERSION = '1.5.0';
  const QUALITY_KEYS = ['2160p','1440p','1080p','720p','480p','360p','240p','144p'];
  const URL_RE = /^https?:\/\//i;
  const BAD_RE = /(?:\/preview(?:[/?]|$)|getVideoPreview|\/recoding\/|(?:^|[?&])(?:preview|is_preview)=1(?:&|$)|(?:^|[?&])size=\d+x\d+(?:&|$))/i;
  const CDN_RE = /(?:vkuser|vkvd\d*|okcdn|vk-cdn|userapi|psv\d*|st\d+|sun\d+-|vre\.okcdn|cs\d+\.vk)/i;
  const cache = new Map();
  const capturedById = new Map();
  let seq = 0;
  function mergeQualities(a = [], b = []) {
    const byQ = new Map();
    const put = x => {
      if (!x || typeof x.url !== 'string' || !x.url) return;
      const q = Number(x.q) || 0;
      const key = String(x.key || 'captured');
      const k = q > 0 ? `q:${q}` : `u:${x.url}`;
      const prev = byQ.get(k);
      // Prefer a real signed HTTP URL over blob/live fallbacks.
      if (!prev || (/^https?:\/\//i.test(x.url) && !/^https?:\/\//i.test(prev.url))) {
        byQ.set(k, { url: x.url, q, key });
      }
    };
    [...a, ...b].forEach(put);
    return [...byQ.values()].sort((x,y) => y.q - x.q);
  }

  function rememberCaptured(id, data) {
    if (!id || !data) return;
    const key = String(id);
    const prev = capturedById.get(key);
    const merged = {
      ...(prev || {}),
      ...data,
      id: key,
      files: { ...(prev?.files || {}), ...(data.files || {}) },
      qualities: mergeQualities(prev?.qualities || [], data.qualities || []),
      ts: Date.now()
    };
    capturedById.set(key, merged);
    while (capturedById.size > 80) capturedById.delete(capturedById.keys().next().value);
  }

  function captureVideoObject(id, obj, clip=false){
    const normalized=parsePair(id)||objectId(obj); if(!normalized||!obj||typeof obj!=='object') return false;
    const meta=extractVsrc(obj); if(!meta.qualities.length) return false;
    rememberCaptured(normalized,{id:normalized,files:toPlain(meta.files)||{},qualities:meta.qualities,clip:!!clip,source:'standalone-downloader'}); return true;
  }
  function captureVideoPayload(payload, clip=false){
    let found=0; const seen=new Set();
    const walk=(obj,depth=0)=>{
      if(!obj||typeof obj!=='object'||depth>9||seen.has(obj)) return; seen.add(obj);
      const id=objectId(obj); if(id&&captureVideoObject(id,obj,clip)) found++;
      if(Array.isArray(obj)){for(const v of obj.slice(0,160)) walk(v,depth+1);return;}
      for(const v of Object.values(obj)) if(v&&typeof v==='object') walk(v,depth+1);
    }; walk(payload); return found;
  }
  function captureVideoBoxPayload(payload, targetId=null){
    const aliases={url144:144,url240:240,url360:360,url480:480,url720:720,url1080:1080,url1440:1440,url2160:2160};
    const urls={}; const seen=new Set();
    const walk=(obj,depth=0)=>{if(!obj||typeof obj!=='object'||depth>12||seen.has(obj))return;seen.add(obj);for(const [k,v] of Object.entries(obj)){if(typeof v==='string'&&/^https?:\/\//i.test(v)&&aliases[k])urls[aliases[k]]=v;else if(v&&typeof v==='object')walk(v,depth+1)}};
    walk(payload); if(!Object.keys(urls).length) return 0;
    const id=parsePair(targetId||location.href)||parsePair(location.pathname+' '+location.search); if(!id)return 0;
    const [owner,vid]=id.split('_');
    const files=Object.fromEntries(Object.entries(urls).map(([q,u])=>['mp4_'+q,u]));
    captureVideoObject(id,{owner_id:owner,id:vid,files},false); return 1;
  }
  const __vkeCoreFetch=window.fetch;
  window.fetch=new Proxy(__vkeCoreFetch,{apply(target,thisArg,args){
    const req=args[0], url=typeof req==='string'?req:req?.url||''; const method=String(args[1]?.method||(req instanceof Request?req.method:'GET')).toUpperCase();
    const body=args[1]?.body || (req instanceof Request ? req.body : null);
    const p=Reflect.apply(target,thisArg,args);
    if(method==='POST'&&/\/method\/video\.getByIds/i.test(url)) p.then(r=>r.clone().json().then(j=>captureVideoPayload(j?.response?.items||j?.items||j,false)).catch(()=>{})).catch(()=>{});
    const bodyText=typeof body==='string'?body:(body instanceof URLSearchParams?body.toString():'');
    const videoBox=/\/al_video\.php(?:\?|$)/i.test(url)&&(/(?:^|&)act=video_box(?:&|$)/i.test(bodyText)||/(?:^|[?&])act=video_box(?:&|$)/i.test(url));
    if(videoBox) p.then(r=>r.clone().json().then(j=>{const vb=new URLSearchParams(bodyText);captureVideoBoxPayload(j?.payload||j,vb.get('video')||null)}).catch(()=>{})).catch(()=>{});
    return p;
  }});
  const __vkeCoreOpen=XMLHttpRequest.prototype.open, __vkeCoreSend=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(method,url,...rest){this.__vkeCoreUrl=String(url||'');this.__vkeCoreMethod=String(method||'GET').toUpperCase();return __vkeCoreOpen.apply(this,[method,url,...rest])};
  XMLHttpRequest.prototype.send=function(...args){this.__vkeCoreBody=args[0];this.addEventListener('load',()=>{try{const u=this.__vkeCoreUrl||'',txt=this.responseText||'';if(this.status<200||this.status>=300||!txt)return;const bodyText=typeof this.__vkeCoreBody==='string'?this.__vkeCoreBody:(this.__vkeCoreBody instanceof URLSearchParams?this.__vkeCoreBody.toString():'');if(this.__vkeCoreMethod==='POST'&&/\/method\/video\.getByIds/i.test(u)){const j=JSON.parse(txt);captureVideoPayload(j?.response?.items||j?.items||[],false)}else if(/\/al_video\.php(?:\?|$)/i.test(u)&&(/(?:^|&)act=video_box(?:&|$)/i.test(bodyText)||/(?:^|[?&])act=video_box(?:&|$)/i.test(u))){const j=JSON.parse(txt);captureVideoBoxPayload(j?.payload||j,new URLSearchParams(bodyText).get('video')||null)}}catch{}},{once:true});return __vkeCoreSend.apply(this,args)};

  window.addEventListener('message', e => {
    if (e.source !== window || e.data?.type !== 'CLP_VIDEO_DATA') return;
    const d = e.data;
    const id = parsePair(d.videoId || d._clipId);
    if (!id || !d.vsrc || typeof d.vsrc !== 'object') return;
    const qualities = pickFiles(d.vsrc);
    if (!qualities.length) return;
    rememberCaptured(id, {
      id,
      files: d.vsrc,
      qualities,
      clip: !!d._isClip
    });
  });

  function decodeMany(v) {
    let s = String(v ?? '');
    for (let i = 0; i < 5; i++) {
      try { const d = decodeURIComponent(s); if (d === s) break; s = d; } catch { break; }
    }
    return s;
  }
  function pair(owner, id) {
    if (owner == null || id == null) return null;
    const o = String(owner), n = String(id);
    return /^-?\d+$/.test(o) && /^\d+$/.test(n) ? `${o}_${n}` : null;
  }
  function parsePair(value) {
    if (!value) return null;
    const s = decodeMany(value);
    let m = s.match(/(?:^|[/?#&])(?:clip|clips|video)(-?\d+)_(\d+)/i);
    if (m) return pair(m[1], m[2]);
    m = s.match(/(?:^|[^\d-])(-?\d{3,})_(\d{3,})(?:$|[^\d])/);
    return m ? pair(m[1], m[2]) : null;
  }
  function parseVideoRoute(value) {
    if (!value) return null;
    const s = decodeMany(value);
    const m = s.match(/(?:^|[/?#&])(?:clip|clips|video)(-?\d+)_(\d+)(?:\/([A-Za-z0-9_-]+))?/i);
    if (!m) return null;
    return { id: pair(m[1], m[2]), accessKey: m[3] || null };
  }
  function parseStoryPair(value) {
    if (!value) return null;
    const s = decodeMany(value);
    const m = s.match(/(?:^|[/?#&])story(-?\d+)_(\d+)/i) || s.match(/(?:^|[/?#&])stories?[-_](?:story[-_]?)?(-?\d+)_(\d+)/i);
    return m ? pair(m[1], m[2]) : null;
  }
  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect?.();
    if (!r || r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity || 1) > 0;
  }
  function walk(value, cb, depth = 0, seen = new Set()) {
    if (!value || depth > 10) return false;
    const t = typeof value;
    if (t !== 'object' && t !== 'function') return false;
    if (seen.has(value)) return false;
    seen.add(value);
    if (cb(value)) return true;
    let keys = [];
    try { keys = Object.keys(value).slice(0, 160); } catch { return false; }
    for (const k of keys) {
      try {
        const v = value[k];
        if (v && typeof v === 'object' && walk(v, cb, depth + 1, seen)) return true;
      } catch {}
    }
    return false;
  }
  function objectId(obj) {
    if (!obj || typeof obj !== 'object') return null;
    for (const [ok, ik] of [['owner_id','id'],['ownerId','id'],['oid','vid'],['owner_id','video_id'],['owner_id','clip_id'],['ownerId','videoId'],['ownerId','clipId']]) {
      const id = pair(obj[ok], obj[ik]);
      if (id) return id;
    }
    for (const k of ['full_id','video_id_str','clip_id_str','video_id','clip_id','videoId','clipId','fullId']) {
      const id = parsePair(obj[k]);
      if (id) return id;
    }
    return null;
  }
  function reactCandidates(root) {
    if (!root) return [];
    const out = [];
    const nodes = [root, ...root.querySelectorAll('*')].slice(0, 3200);
    for (const el of nodes) {
      for (const key of Object.keys(el)) {
        if (!key.startsWith('__reactProps$') && !key.startsWith('__reactFiber$')) continue;
        try {
          walk(el[key], obj => {
            const id = objectId(obj);
            if (!id) return false;
            const files = obj?.files || obj?.video?.files || obj?.clip?.files;
            const type = String(obj?.type || obj?.kind || obj?.objectType || '').toLowerCase();
            const mediaish = !!files || /^(video|clip|video_message)$/.test(type) || obj?.video || obj?.clip;
            out.push({ id, obj, mediaish, files });
            return false;
          });
        } catch {}
      }
    }
    return out;
  }
  function reactData(root) {
    const candidates = reactCandidates(root);
    candidates.sort((a, b) => Number(b.mediaish) - Number(a.mediaish));
    return candidates[0] || null;
  }
  function mediaRoots() {
    const out = [];
    const add = r => { if (r && visible(r) && !out.includes(r)) out.push(r); };
    const controls = document.querySelectorAll('[data-testid^="clips-controls-"],[data-testid^="video_modal_"],[data-testid^="video_page_"]');
    for (const c of controls) {
      let p = c;
      for (let i = 0; p && i < 12; i++, p = p.parentElement) {
        if (p.querySelector('video') || p.querySelector('img')) {
          const r = p.getBoundingClientRect?.();
          if (r && r.width > 160 && r.height > 160) { add(p); break; }
        }
      }
    }
    const vids = [...document.querySelectorAll('video')].filter(v => visible(v) && !v.closest('.AttachVideoMessage,[data-testid*="video-message" i],[class*="AttachVideoMessage" i]'));
    vids.sort((a,b) => score(b) - score(a));
    for (const v of vids.slice(0, 8)) {
      let p = v.parentElement;
      for (let i = 0; p && i < 10; i++, p = p.parentElement) {
        const r = p.getBoundingClientRect?.();
        if (r && r.width > 220 && r.height > 180) { add(p); break; }
      }
    }
    return out;
  }
  function inStory(el) {
    return !!el?.closest?.('[data-testid*="stories_viewer" i],[data-testid*="story" i],.StoriesViewer,[class*="StoryViewer" i],[class*="StoriesViewer" i]');
  }
  function score(v) {
    const r = v.getBoundingClientRect();
    const area = r.width * r.height;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dist = Math.hypot(cx - innerWidth / 2, cy - innerHeight / 2);
    return area + (!v.paused ? 800000 : 0) + (v.readyState >= 3 ? 120000 : 0) - Math.min(dist, innerWidth + innerHeight) * 1000;
  }
  function activeVideo() {
    const vids = [...document.querySelectorAll('video')].filter(v => visible(v) && !inStory(v) && !v.closest('.AttachVideoMessage,[data-testid*=\"video-message\" i],[class*=\"AttachVideoMessage\" i]'));
    vids.sort((a,b) => score(b) - score(a));
    return vids[0] || null;
  }
  function activeStoryVideo() {
    const root = document.querySelector('[data-testid*="stories_viewer" i],.StoriesViewer,[class*="StoryViewer" i],[class*="StoriesViewer" i]');
    const vids = [...(root || document).querySelectorAll('video')].filter(visible);
    vids.sort((a,b) => score(b) - score(a));
    return vids[0] || null;
  }
  // Messenger video attachments are not part of activeVideo() because VK
  // renders them inside AttachVideoMessage. Keep a dedicated resolver here;
  // media_ui calls media_core from the isolated world and previously hit
  // `activeMessengerVideo is not defined`, which made the quality menu fail.
  function activeMessengerVideo() {
    const selectors = [
      '.AttachVideoMessage video',
      '[data-testid="message-video"] video',
      '[data-testid*="video-message" i] video',
      'video.player-media',
      'video[class*="player-media" i]'
    ];
    const set = new Set();
    const nodes = [];
    for (const sel of selectors) {
      for (const v of document.querySelectorAll(sel)) {
        if (set.has(v) || !visible(v)) continue;
        set.add(v);
        nodes.push(v);
      }
    }
    const route = decodeMany(location.href);
    const routeId = parsePair(route);
    if (routeId) {
      // Messenger viewer route is authoritative. Never fall back to a random
      // playable video/circle when the exact message cannot be matched.
      const exact = nodes.filter(v => {
        if (!v.currentSrc && !v.src && !v.querySelector?.('source')?.src) return false;
        const msg = v.closest?.('.ConvoMessage,.ConvoMessageWithoutBubble,.AttachVideoMessage,[role=dialog],.VideoView,.VideoViewer,[class*="VideoView" i]');
        if (!msg) return false;
        const text = String(msg.outerHTML || '');
        return text.includes(`video${routeId}`) || text.includes(routeId);
      });
      exact.sort((a,b) => score(b) - score(a));
      return exact[0] || null;
    }
    nodes.sort((a,b) => score(b) - score(a));
    return nodes[0] || null;
  }
  function isStoryContext() {
    return !!document.querySelector('[data-testid="stories_viewer_menu_icon"],[data-testid*="stories_viewer" i],.StoriesViewer,[class*="StoryViewer" i]');
  }
  function isClipContext() {
    return !!document.querySelector('[data-testid="clips-controls-like-button"],[data-testid="clips-controls-share-button"],[data-testid="clips-controls-more-actions-button"]') || /\/clip(?:s)?-?\d+_/i.test(location.pathname) || /[?&]z=clip-?\d+_/i.test(location.href);
  }
  function idFromRoute() { return parseVideoRoute(location.pathname + ' ' + location.href)?.id || parsePair(location.pathname + ' ' + location.href); }
  function accessKeyFromRoute() { return parseVideoRoute(location.pathname + ' ' + location.href)?.accessKey || null; }
  function idFromRoot(root) {
    const direct = idFromRoute();
    if (direct && (isClipContext() || /video/i.test(location.pathname + location.search))) return direct;
    const preferred = root?.querySelectorAll?.('[data-video-id],[data-clip-id],[data-full-id],[data-id],[href]') || [];
    for (const el of preferred) {
      const id = parsePair(el.getAttribute('data-video-id') || el.getAttribute('data-clip-id') || el.getAttribute('data-full-id') || el.getAttribute('data-id') || el.getAttribute('href'));
      if (id) return id;
    }
    const rd = reactData(root);
    return rd?.id || null;
  }
  function currentInfo(scope = 'auto') {
    const story = scope === 'story' || (scope === 'auto' && isStoryContext());
    const clip = !story && (scope === 'clip' || (scope === 'auto' && isClipContext()));
    const inMessenger = /\/im\//i.test(location.pathname);
    const route = decodeMany(location.href);
    const messengerRouteVideo = !!(inMessenger && /[?&]z=video-?\d+_\d+/i.test(route));
    const video = story ? activeStoryVideo() : (messengerRouteVideo ? (activeMessengerVideo() || activeVideo()) : activeVideo());
    const messengerVideoRoot = video && messengerRouteVideo
      ? video.closest?.('.ConvoMessage,.ConvoMessageWithoutBubble,.AttachVideoMessage,[data-testid*=video-message i],[data-testid*=message-video i],[role="dialog"],[class*=VideoView i]')
      : (video && video.closest?.('.AttachVideo,.AttachVideo__container,[data-testid*=video-message i],[data-testid*=message-video i]') && !video.closest?.('.AttachVideoMessage,[class*=AttachVideoMessage i]')
        ? video.closest('.AttachVideo,.AttachVideo__container,[data-testid*=video-message i],[data-testid*=message-video i]') : null);
    const root = story ? (video?.closest?.('.StoriesViewer,.StoriesViewer__item,[data-testid*=stories_viewer i],[class*=StoryViewer i]') || mediaRoots()[0] || document.body)
      : (clip ? (video?.closest?.('[data-testid*=clip i],.MessengerClipsModal,[class*=ClipModal i]') || mediaRoots()[0] || document.body)
      : (messengerVideoRoot || video?.closest?.('[data-testid*=video_modal i],[data-testid*=video_page i]') || mediaRoots()[0] || document.body));

    let id = idFromRoute();
    if (inMessenger && !video && !clip) id = null;
    if (inMessenger && video && !messengerRouteVideo && video.closest?.('.AttachVideoMessage,[data-testid*=video-message i],[class*=AttachVideoMessage i]')) id = null;
    if (!(id && (clip || /video/i.test(location.pathname + location.search)))) {
      const selectors = [
        '[data-video-id]','[data-clip-id]','[data-full-id]',
        'a[href*="video"]','a[href*="clip"]','[href*="z=video"]','[href*="z=clip"]'
      ];
      for (const sel of selectors) {
        const els = root?.querySelectorAll?.(sel) || [];
        for (const el of els) {
          const got = parsePair(el.getAttribute('data-video-id') || el.getAttribute('data-clip-id') || el.getAttribute('data-full-id') || el.getAttribute('href'));
          if (got) { id = got; break; }
        }
        if (id) break;
      }
    }

    const rd = reactData(root);
    if (!id && rd?.id) id = rd.id;
    const src = video?.currentSrc || video?.src || video?.querySelector?.('source')?.src || '';
    const routeMeta = parseVideoRoute(location.pathname + ' ' + location.href);
    const accessKey = routeMeta?.accessKey || rd?.access_key || rd?.accessKey || rd?.obj?.access_key || rd?.obj?.accessKey || null;
    return { id, accessKey, storyId: rd?.story || null, mediaObj: rd?.obj || null, src, width: video?.videoWidth || 0, height: video?.videoHeight || 0, duration: video?.duration || 0, isClip: !!clip, isStory: !!story, root };
  }

  function isSignedMediaUrl(u) {
    if (typeof u !== 'string' || !URL_RE.test(u) || BAD_RE.test(u)) return false;
    try {
      const x = new URL(u);
      if (!CDN_RE.test(x.hostname)) return false;
      return /^(?:0|1|2|3|4|5)$/.test(String(x.searchParams.get('type') || '')) && x.searchParams.has('id');
    } catch { return false; }
  }
  function pickFiles(files) {
    if (!files || typeof files !== 'object') return [];
    const out = [];
    const aliases = {
      url2160:2160,url1440:1440,url1080:1080,url720:720,url480:480,url360:360,url240:240,url144:144,
      mp4_2160:2160,mp4_1440:1440,mp4_1080:1080,mp4_720:720,mp4_480:480,mp4_360:360,mp4_240:240,mp4_144:144
    };
    const validVideoFile = v => {
      if (typeof v !== 'string' || !URL_RE.test(v) || BAD_RE.test(v)) return false;
      if (/\.(?:mp4|m4v|webm)(?:[?#]|$)/i.test(v)) return true;
      try {
        const u = new URL(v);
        // VK's playable CDN URLs often omit .mp4 and are identified by the
        // signed `type=3|5&id=...` tuple. Reject vk.ru/vkvideo.ru HTML pages.
        return /(?:vkvd\d*\.okcdn\.ru|okcdn\.ru|vkuser\.net|vk-cdn\.net|userapi\.com)/i.test(u.hostname) &&
          /^(?:0|1|2|3|4|5)$/.test(String(u.searchParams.get('type') || '')) &&
          u.searchParams.has('id');
      } catch { return false; }
    };
    for (const [k,v] of Object.entries(files)) {
      if (!validVideoFile(v)) continue;
      const q = aliases[k] || Number((k.match(/(?:mp4|url|file|video)[_-]?(\d+)/i)||[])[1] || 0);
      if (q > 0) out.push({ url:v, q, key:k });
    }
    const seen = new Set();
    return out.filter(x => !seen.has(x.url) && seen.add(x.url)).sort((a,b)=>b.q-a.q);
  }
  function extractVsrc(obj) {
    const files = obj?.files || obj?.video?.files || obj?.clip?.files || null;
    let qualities = pickFiles(files);
    if (!qualities.length && obj && typeof obj === 'object') {
      const pseudo = {};
      for (const k of Object.keys(obj)) if (/^(url|mp4)_?\d+$/i.test(k) && typeof obj[k] === 'string') pseudo[k]=obj[k];
      qualities = pickFiles(pseudo);
    }
    return { files, qualities };
  }
  function toPlain(value, depth = 0, seen = new WeakSet()) {
    if (value == null || depth > 8) return value == null ? value : undefined;
    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') return value;
    if (t !== 'object') return undefined;
    if (seen.has(value)) return undefined;
    seen.add(value);
    if (Array.isArray(value)) return value.map(v => toPlain(v, depth + 1, seen)).filter(v => v !== undefined);
    const out = {};
    for (const key of Object.keys(value).slice(0, 500)) {
      try {
        const v = toPlain(value[key], depth + 1, seen);
        if (v !== undefined) out[key] = v;
      } catch {}
    }
    return out;
  }

  async function pageApiCall(method, params) {
    const api = window.vkApi;
    if (!api || typeof api.api !== 'function') throw new Error('vkApi unavailable');
    const result = await api.api(method, params || {});
    return toPlain(result);
  }

  function apiCall(method, params, timeout = 9000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => { if (settled) return; settled = true; cleanup(); fn(value); };
      const requestId = `media_api_${Date.now()}_${++seq}`;
      const on = e => {
        if (e.source !== window || e.data?.source !== 'vke-bridge' || e.data?.type !== 'VKE_MEDIA_API_RESULT' || e.data.requestId !== requestId) return;
        e.data.error ? finish(reject, new Error(e.data.error)) : finish(resolve, e.data.response);
      };
      let timer;
      const cleanup = () => { window.removeEventListener('message', on); clearTimeout(timer); };

      // Kate Mobile/page API first: it uses the already-authorized VK session
      // and does not require exposing the access token to page code.
      Promise.resolve().then(() => pageApiCall(method, params)).then(
        value => finish(resolve, value),
        () => {
          if (settled) return;
          window.addEventListener('message', on);
          window.postMessage({ source:'vke-main', type:'VKE_MEDIA_API', requestId, method, params }, '*');
          timer = setTimeout(() => finish(reject, new Error('API timeout')), timeout);
        }
      );
    });
  }
  function findExactMessengerVideoSource(normalized, root=null){
    const pair=String(normalized||'');
    if(!pair) return null;
    const roots=[];
    const push=r=>{if(r&&!roots.includes(r))roots.push(r)};
    if(root && root!==document.body) push(root);
    for(const a of document.querySelectorAll('a[href*="z=video"],a[href*="video"],a[href*="/video"]')){
      const href=decodeMany(a.getAttribute('href')||'');
      if(!href.includes(`video${pair}`) && !href.includes(pair)) continue;
      push(a.closest('.ConvoMessage,.ConvoMessageWithoutBubble,.AttachVideo,.AttachVideo__container')||a.parentElement);
    }
    const route=decodeMany(location.href);
    if(route.includes(`video${pair}`)){
      for(const v of document.querySelectorAll('.ConvoMessage video,.ConvoMessageWithoutBubble video,.AttachVideo video,[data-testid*=video-message i] video,video.player-media,video[class*="player-media" i]')){
        if(v.closest('.AttachVideoMessage,[class*=AttachVideoMessage i]')) continue;
        push(v.closest('.ConvoMessage,.ConvoMessageWithoutBubble,.AttachVideo,.AttachVideo__container,[role="dialog"]')||v.parentElement);
      }
      // Fullscreen/player routes often render a standalone <video class=player-media>
      // outside the message DOM. Bind the route id directly to the largest visible video.
      const all=[...document.querySelectorAll('video')].filter(v=>{if(v.closest('.AttachVideoMessage,[class*=AttachVideoMessage i]'))return false;const rr=v.getBoundingClientRect?.();const cs=getComputedStyle(v);return rr&&rr.width>250&&rr.height>150&&cs.display!=='none'&&cs.visibility!=='hidden'});
      all.sort((a,b)=>{const ap=!a.paused?1:0,bp=!b.paused?1:0;if(ap!==bp)return bp-ap;const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();return br.width*br.height-ar.width*ar.height});
      for(const v of all.slice(0,3)) push(v.closest('[role="dialog"],.VideoView,.VideoViewer,.video-viewer')||v.parentElement);
    }
    const read=r=>{
      if(!r) return null;
      const vids=[...r.querySelectorAll('video')].filter(v=>{
        if(!root && v.closest('.AttachVideoMessage,[class*=AttachVideoMessage i]')) return false;
        const rr=v.getBoundingClientRect?.(); const cs=getComputedStyle(v);
        return rr&&rr.width>100&&rr.height>80&&cs.display!=='none'&&cs.visibility!=='hidden';
      });
      const playing=vids.filter(v=>!v.paused&&!v.ended);
      for(const v of (playing.length?playing:vids)){
        const u=v.currentSrc||v.src||v.querySelector?.('source')?.src||'';
        if(URL_RE.test(u) && !BAD_RE.test(u)) return u;
        if(/^blob:/i.test(u)) return u;
      }
      return null;
    };
    for(const r of roots){const u=read(r);if(u)return u;}
    return null;
  }
  function requestVideoInject(id, timeout = 9000) {
    if(!id) return Promise.resolve(null);
    return new Promise(resolve=>{
      const clientId=`core_inject_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      let done=false;
      const finish=v=>{if(done)return;done=true;window.removeEventListener('message',on);clearTimeout(timer);resolve(v||null)};
      const on=e=>{
        if(e.source!==window) return;
        const d=e.data||{};
        if(d.type==='CLP_VIDEO_DATA_RESPONSE' && d.clientId===clientId){
          const q=pickFiles(d.vsrc||{});
          if(q.length) finish(q);
        } else if(d.type==='CLP_VIDEO_DATA' && (d.videoId===id || !d.videoId)){
          const q=pickFiles(d.vsrc||{});
          if(q.length) finish(q);
        }
      };
      window.addEventListener('message',on);
      window.postMessage({source:'vke-core',type:'CLP_REQUEST_VIDEO_URL',clipId:id,clientId},'*');
      const timer=setTimeout(()=>finish(null),timeout);
    });
  }

  function knownPlayerQualitySets(normalized) {
    const out = [];
    const seen = new Set();
    const add = (obj, source) => {
      if (!obj || typeof obj !== 'object' || seen.has(obj)) return;
      seen.add(obj);
      const meta = extractVsrc(obj);
      if (meta.qualities.length) out.push({ source, qualities: meta.qualities });
    };
    try {
      add(window.mvcur?.player?.vars, 'mvcur.player.vars');
      add(window.cur?.videoInlinePlayer?.vars, 'cur.videoInlinePlayer.vars');
      add(window.mvcur?.player?.video?.vars, 'mvcur.player.video.vars');
      const routeObj = window.mvcur?.mvData || window.cur?.mvData;
      add(routeObj?.player, 'mvData.player');
      add(routeObj, 'mvData');
    } catch {}
    return out;
  }

  function makeVideoData(normalized, clip, qualities, files = {}) {
    const merged = mergeQualities([], qualities || []);
    return {
      id: normalized,
      files: toPlain(files) || {},
      qualities: merged.map(x => ({ url:x.url, q:Number(x.q)||0, key:x.key||'resolver' })),
      clip: !!clip
    };
  }

  async function resolveVideo(id, clip = false, root = null, accessKey = null) {
    const normalized = parsePair(id) || id;
    if (!normalized) throw new Error('ID видео/клипа не найден');

    const cached = cache.get(normalized);
    if (cached && Date.now() - cached.ts < 7000 && cached.data?.qualities?.length >= 2) return cached.data;

    let qualities = [];
    let files = {};
    const add = list => {
      if (!Array.isArray(list)) return;
      qualities = mergeQualities(qualities, list);
    };
    const absorb = obj => {
      if (!obj || typeof obj !== 'object') return false;
      const meta = extractVsrc(obj);
      if (!meta.qualities.length) return false;
      add(meta.qualities);
      files = { ...files, ...(toPlain(meta.files) || {}) };
      return true;
    };

    // 1) Exact page-player variables. VK's own desktop downloader uses
    // mvcur.player.vars / cur.videoInlinePlayer.vars and these can contain the
    // complete url144..url2160 set even before video.getByIds finishes.
    for (const set of knownPlayerQualitySets(normalized)) add(set.qualities);

    // 2) Exact React object for this ID. Never use a sibling media object.
    const scopedRoot = root && root !== document.body ? root : null;
    const candidates = reactCandidates(scopedRoot || document.body);
    const exact = candidates.find(x => x.id === normalized && x.mediaish) || candidates.find(x => x.id === normalized);
    if (exact) absorb(exact.obj);

    // 3) Anything captured by our network hooks for this exact ID. Network
    // responses are merged, never replaced, so a later 1080p can augment an
    // earlier 144p/720p result.
    const captured = capturedById.get(normalized);
    if (captured?.qualities?.length) add(captured.qualities);
    if (qualities.length >= 2) {
      const data = makeVideoData(normalized, clip, qualities, files);
      cache.set(normalized, { ts:Date.now(), data });
      return data;
    }

    // 4) Ask the MAIN-world resolver. Do not return early: its first result is
    // often only the currently selected stream (commonly 144p/360p).
    try {
      const injected = await requestVideoInject(normalized, 6500);
      add(injected);
      if (qualities.length >= 2) {
        const data = makeVideoData(normalized, clip, qualities, files);
        cache.set(normalized, { ts:Date.now(), data });
        return data;
      }
    } catch {}

    // 5) Authenticated API: video.getByIds and video.get are both tried even
    // when the first one technically succeeds but returns files={}.
    const probe = exact?.obj || {};
    const key = accessKey || probe?.access_key || probe?.accessKey || probe?.video?.access_key || probe?.clip?.access_key || null;
    const videoKey = key ? `${normalized}/${key}` : normalized;
    const apiResults = await Promise.allSettled([
      apiCall('video.getByIds', { videos: videoKey }, 9000),
      apiCall('video.get', { videos: videoKey, count: 1, extended: 1 }, 9000)
    ]);
    for (const r of apiResults) {
      if (r.status !== 'fulfilled') continue;
      const result = r.value;
      const item = result?.items?.[0] || result?.response?.items?.[0] || result?.response?.[0] || result?.[0];
      if (item) {
        absorb(item);
        try {
          const nested = deepExtract(item, normalized);
          if (nested?.vsrc) add(pickFiles(nested.vsrc));
        } catch {}
      }
    }
    if (qualities.length >= 2) {
      const data = makeVideoData(normalized, clip, qualities, files);
      cache.set(normalized, { ts:Date.now(), data });
      return data;
    }

    // 6) External resolver, useful for attached/private videos.
    try {
      const ext = await apiCall('video.getExternal', { video_id: normalized }, 9000);
      const extObj = ext?.response || ext || null;
      absorb(extObj);
    } catch {}

    // 7) Give the network hooks a small window to receive the player's late
    // al_video.php/video_box response. This is what fixes the "first time no
    // links, second time suddenly links" behaviour.
    const waitUntil = Date.now() + 1800;
    while (Date.now() < waitUntil && qualities.length < 2) {
      await new Promise(r => setTimeout(r, 220));
      const late = capturedById.get(normalized);
      if (late?.qualities?.length) { add(late.qualities); files = { ...files, ...(late.files || {}) }; }
    }

    // 8) Last-resort direct source from the exact active player. This is kept
    // only as fallback and never allowed to override a real quality URL.
    let exactLiveCandidate = null;
    if (!clip) {
      const exactLive = findExactMessengerVideoSource(normalized, root);
      if (exactLive) {
        const liveInfo = currentInfo('video');
        exactLiveCandidate = { url: exactLive, q: /^blob:/i.test(exactLive) ? 0 : Number(liveInfo?.height) || 0, key:'messenger_live' };
      }
    }
    if (exactLiveCandidate) add([exactLiveCandidate]);

    const live = currentInfo(clip ? 'clip' : 'video');
    const liveCandidates = [];
    const pushLive = (u,q=0) => {
      if (typeof u !== 'string' || BAD_RE.test(u) || (!URL_RE.test(u) && !/^blob:/i.test(u))) return;
      if (live?.root?.querySelector?.('.AttachVideoMessage')) return;
      if (URL_RE.test(u) && CDN_RE.test(u) && !/\.(?:mp4|m4v|webm)(?:[?#]|$)/i.test(u) && !isSignedMediaUrl(u)) return;
      if (!liveCandidates.some(x => x.url === u)) liveCandidates.push({url:u,q:Number(q)||0,key:'live'});
    };
    if (!qualities.length) {
      if (live?.src) pushLive(live.src, live?.height || 0);
      if (live?.root && !live.root.querySelector?.('.AttachVideoMessage')) {
        try {
          const activeHost = new URL(live.src || location.href, location.href).host;
          for (const e of performance.getEntriesByType('resource').slice(-350).reverse()) {
            const u=e?.name||'';
            if (!URL_RE.test(u) || BAD_RE.test(u) || !CDN_RE.test(u) || !/\.(?:mp4|m4v|webm)(?:[?#]|$)/i.test(u)) continue;
            if (activeHost && new URL(u).host !== activeHost) continue;
            pushLive(u, live?.height || 0);
          }
        } catch {}
      }
      add(liveCandidates);
    }

    const data = makeVideoData(normalized, clip, qualities, files);
    if (data.qualities.length) {
      cache.set(normalized, { ts:Date.now(), data });
      return data;
    }
    throw new Error('VK не вернул файлы видео');
  }
  function recentCdnMediaUrls(limit=20){
    const out=[]; const add=u=>{if(typeof u!=='string'||!URL_RE.test(u)||BAD_RE.test(u))return;if(/\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)/i.test(u)||/\.m3u8(?:[?#]|$)/i.test(u))return;try{const x=new URL(u),h=x.hostname;if(!CDN_RE.test(h))return;const media=/\.(?:mp4|m4v|webm)(?:[?#]|$)/i.test(u);const signed=/^(?:0|1|2|3|4|5)$/.test(String(x.searchParams.get('type')||''))&&x.searchParams.has('id');if(!(media||signed))return;if(!out.some(v=>v.url===u))out.push({url:u,q:0,key:'recent'})}catch{}};try{const now=performance.timeOrigin+performance.now();for(const e of performance.getEntriesByType('resource').slice(-500).reverse()){const age=now-(performance.timeOrigin+(e.startTime||0));if(age>45000)break;add(e?.name||'');if(out.length>=limit)break}}catch{}return out;
  }
  function liveStoryFiles(info){
    const out=[]; const add=u=>{if(typeof u!=='string'||!URL_RE.test(u)||BAD_RE.test(u)||/\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)/i.test(u))return;try{const x=new URL(u);if(!CDN_RE.test(x.hostname))return;const media=/\.(?:mp4|m4v|webm)(?:[?#]|$)/i.test(u);const signed=/^(?:0|1|2|3|4|5)$/.test(String(x.searchParams.get('type')||''))&&x.searchParams.has('id');if(!(media||signed))return;if(!out.some(v=>v.url===u))out.push({url:u,q:Number(info?.height)||0,key:'live'})}catch{}};add(info?.src);try{for(const e of performance.getEntriesByType('resource').slice(-450).reverse()){add(e?.name||'');if(out.length>=16)break}}catch{}return out;
  }
  async function resolveStory(info) {
    let storyId = info?.storyId || parseStoryPair(location.pathname + ' ' + location.href);
    if (!storyId) {
      const rd = reactData(info?.root || document.body);
      storyId = rd?.story || rd?.story_id || rd?.storyId || null;
      if (storyId && !String(storyId).includes('_') && rd?.owner_id != null) storyId = pair(rd.owner_id, storyId);
    }
    if (!storyId) return null;
    try {
      const response = await apiCall('stories.getById', { stories: storyId, extended: 1 }, 12000);
      const item = response?.items?.[0] || response?.response?.items?.[0] || response?.response?.[0] || null;
      return toPlain(item);
    } catch { return null; }
  }
  function fallbackDirect(info) {
    const out = [];
    if (URL_RE.test(info?.src || '') && !BAD_RE.test(info.src) && CDN_RE.test(info.src) && (/\.mp4(?:[?#]|$)/i.test(info.src) || isSignedMediaUrl(info.src))) out.push({url:info.src,q:info.height || 0});
    try {
      const host = new URL(info?.src || location.href, location.href).host;
      const entries = performance.getEntriesByType('resource');
      for (let i=entries.length-1; i>=0; i--) {
        const u = entries[i]?.name || '';
        if (!URL_RE.test(u) || BAD_RE.test(u) || !/\.mp4(?:[?#]|$)/i.test(u) || !CDN_RE.test(u)) continue;
        if (host && (() => { try { return new URL(u).host !== host; } catch { return false; } })()) continue;
        if (!out.some(x=>x.url===u)) out.push({url:u,q:0});
      }
    } catch {}
    return out;
  }
  function storyPhoto(story) {
    if (String(story?.type || '').toLowerCase() !== 'photo') return null;
    const p=story?.photo || null;
    if(!p) return null;
    const arr=Array.isArray(p.sizes)?p.sizes.filter(x=>x&&typeof x.url==='string'):[];
    arr.sort((a,b)=>(Number(b.width)||0)*(Number(b.height)||0)-(Number(a.width)||0)*(Number(a.height)||0));
    const u=arr[0]?.url || p.url || p.src || null;
    return u && /^https?:\/\//i.test(u) ? {url:u,width:Number(arr[0]?.width||p.width||0),height:Number(arr[0]?.height||p.height||0)} : null;
  }
  function storyFiles(story) {
    if (String(story?.type || '').toLowerCase() !== 'video') return [];
    const candidates = [story?.video?.files, story?.clip?.files];
    for (const files of candidates) {
      const q = pickFiles(files);
      if (q.length) return q;
    }
    const direct = [story?.video_url, story?.videoUrl, story?.url, story?.src].filter(u => URL_RE.test(String(u||'')) && !BAD_RE.test(String(u||'')) && ( /\.mp4(?:[?#]|$)/i.test(String(u)) || isSignedMediaUrl(String(u)) ));
    return direct.map(u => ({ url:u, q:720, key:'direct' }));
  }

  async function resolveForUI(scope, forcedId = null) {
    const info = currentInfo(scope || 'auto');
    const requestedId = parsePair(forcedId) || forcedId || info.id || null;
    const out = {
      id: requestedId || null, accessKey: info.accessKey || accessKeyFromRoute() || null, isClip: !!info.isClip, isStory: !!info.isStory,
      src: typeof info.src === 'string' ? info.src : '',
      width: Number(info.width)||0, height: Number(info.height)||0, duration: Number(info.duration)||0,
      isMessengerVideo: /\/im\//i.test(location.pathname) && /[?&]z=video-?\d+_\d+/i.test(decodeMany(location.href)),
      fallback: fallbackDirect(info).map(x => ({url:x.url,q:Number(x.q)||0}))
    };
    if (info.isStory) {
      const live = liveStoryFiles(info);
      out.story = await resolveStory(info);
      const storyType = String(out.story?.type || '').toLowerCase();
      const photo = storyType === 'photo' ? storyPhoto(out.story) : null;
      if (photo) out.storyPhoto = photo;
      if (storyType === 'video') {
        const sf = storyFiles(out.story);
        // Only use files from THIS story object or the exact current story player.
        // Never merge a page-wide resource list: VK preloads neighbour stories.
        if (sf.length) out.story = { ...out.story, files: Object.fromEntries(sf.map((x,i)=>[`mp4_${x.q||720}_${i}`,x.url])), qualities: sf };
        else if (info.src && URL_RE.test(info.src) && !BAD_RE.test(info.src) && ( /\.mp4(?:[?#]|$)/i.test(info.src) || isSignedMediaUrl(info.src) )) out.story = { ...out.story, files: { mp4_720: info.src }, qualities: [{url:info.src,q:720,key:'direct'}] };
      } else if (storyType === 'photo') {
        // Never replace a photo story with a previous CDN resource or video player.
        delete out.story.qualities;
        delete out.story.files;
      }
      return toPlain(out);
    }
    if (!out.id) throw new Error('ID видео/клипа не найден');
    // Exact id supplied by the UI: do not bind resolution to a possibly unrelated
    // globally selected player root in a rebuilt VK modal.
    const resolveRoot = forcedId ? null : info.root;
    const video = await resolveVideo(out.id, out.isClip, resolveRoot, info.isClip ? null : (info.accessKey || accessKeyFromRoute()));
    out.video = { id: video.id, files: toPlain(video.files)||{}, qualities: (video.qualities||[]).map(x=>({url:x.url,q:Number(x.q)||0,key:x.key||''})), clip:!!video.clip };
    return toPlain(out);
  }

  window.addEventListener('message', e => {
    if (e.source !== window) return;
    const d = e.data || {};
    if (d.source === 'vke-ui' && d.type === 'VKE_MEDIA_RESOLVE') {
      resolveForUI(d.scope || 'auto', d.videoId || null).then(result => {
        window.postMessage({ source:'vke-main', type:'VKE_MEDIA_RESOLVE_RESULT', requestId:d.requestId, result }, '*');
      }).catch(err => {
        window.postMessage({ source:'vke-main', type:'VKE_MEDIA_RESOLVE_RESULT', requestId:d.requestId, error:String(err?.message || err) }, '*');
      });
    }
  });

  window.__vkeMediaCore = {
    version: VERSION,
    currentInfo,
    resolveVideo,
    resolveStory,
    fallbackDirect,
    isClipContext,
    isStoryContext,
    resolveForUI
  };
})();
