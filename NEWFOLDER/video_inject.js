(function(){
'use strict';

/* VKE media resolver — v30
 * - does not require the extension token for web video/clip resolution
 * - captures VK's own video responses and direct CDN URLs
 * - resolves exact active item via DOM + React fiber
 * - resolves al_video.php/al_clip.php in the extension service worker to avoid vkvideo.ru CORS
 * - never substitutes an unrelated video's URL
 */

if (window.__vkeMediaResolver31) return;
window.__vkeMediaResolver31 = true;

const ORIGINAL_FETCH = window.__vkeOriginalFetch || window.fetch;
window.__vkeOriginalFetch = ORIGINAL_FETCH;
const ORIGINAL_OPEN = XMLHttpRequest.prototype.open;
const ORIGINAL_SEND = XMLHttpRequest.prototype.send;

const QUALITIES = [2160, 1440, 1080, 720, 480, 360, 240, 144];
const VIDEO_RE = /(?:al_video|al_clip|\/method\/video|\/method\/execute|video-related|clips|vkvideo|video_ext)/i;
const CDN_RE = /(?:vkuser(?:video|photo|audio)?\.[a-z0-9.-]+|vkvd\d*\.[a-z0-9.-]+|okcdn\.ru|vk-cdn\.net|userapi\.com|psv\d+\.|st\d+\.|sun\d+-|vre\.okcdn\.ru|cs\d+\.vk\.com)/i;

let capturedToken = null;
let requestedId = null;
let currentData = null;
const dataById = new Map();
const seenDirectUrls = new Set();

function parsePayload(text){
    if (!text) return null;
    let s = String(text).replace(/^\uFEFF/,'').trim().replace(/^<!--/,'').replace(/-->$/,'').trim();
    if (s.startsWith('<!>')) s = s.slice(4).trim();
    try { return JSON.parse(s); } catch {}
    const m = s.match(/(?:var\s+vars|mvData|__INITIAL_STATE__)\s*=\s*(\{[\s\S]*?\});?\s*$/);
    if (m) { try { return JSON.parse(m[1]); } catch {} }
    for(let start=0;start<s.length;start++){
      if(s[start]!=='{'&&s[start]!=='[') continue;
      let depth=0,quote=false,esc=false;
      for(let i=start;i<s.length;i++){
        const c=s[i];
        if(quote){if(esc)esc=false;else if(c==='\\')esc=true;else if(c==='\"')quote=false;continue;}
        if(c==='\"'){quote=true;continue;}
        if(c==='{'||c==='[')depth++;
        else if(c==='}'||c===']'){depth--;if(depth===0){try{return JSON.parse(s.slice(start,i+1))}catch{}break;}}
      }
    }
    return null;
}

function decodeMany(value){
    let s = String(value ?? '');
    for (let i=0;i<4;i++){
        try { const d = decodeURIComponent(s); if (d === s) break; s = d; }
        catch { break; }
    }
    return s;
}

function normalizeId(owner,id){
    if (owner == null || id == null) return null;
    const o = String(owner).trim(), v = String(id).trim();
    if (!/^-?\d+$/.test(o) || !/^\d+$/.test(v)) return null;
    return `${o}_${v}`;
}

function normalizePair(value){
    if (!value) return null;
    const s = decodeMany(value);
    let m = s.match(/(?:^|[/?#&])(?:clips?|clip|video)(-?\d+)_(\d+)/i);
    if (m) return normalizeId(m[1], m[2]);
    m = s.match(/(?:^|[^\d-])(-?\d{3,})_(\d{3,})(?:$|[^\d])/);
    if (m) return normalizeId(m[1], m[2]);
    return null;
}

function videoRouteMeta(value){
    if (!value) return null;
    const s=decodeMany(value);
    const m=s.match(/(?:^|[/?#&])(?:video|clip|clips)(-?\d+)_(\d+)(?:\/([A-Za-z0-9_-]+))?/i);
    return m ? {id:normalizeId(m[1],m[2]), accessKey:m[3]||null} : null;
}

function idFromElement(el){
    if (!el) return null;
    for (const a of ['data-video-id','data-clip-id','data-vk-video-id','data-full-id','data-id','href','src','data-url','data-video-url']){
        const id = normalizePair(el.getAttribute?.(a));
        if (id) return id;
    }
    return null;
}

function idFromObject(obj, depth=0){
    if (!obj || typeof obj !== 'object' || depth > 10) return null;
    const pairs=[
        ['owner_id','id'],['ownerId','id'],['ownerId','videoId'],['oid','vid'],['oid','id'],
        ['owner_id','video_id'],['owner_id','videoId'],['owner_id','clip_id'],['ownerId','clipId'],
    ];
    for(const [ok,ik] of pairs){
        if(obj[ok]!=null&&obj[ik]!=null){
            const id=normalizeId(obj[ok],obj[ik]); if(id)return id;
        }
    }
    for (const k of ['clip_id','video_id','full_id','videoId','clipId','fullId','video_id_str','clip_id_str']) {
        const id=normalizePair(obj[k]); if(id)return id;
    }
    for (const k of ['video','clip','attachment','item','object','media','currentItem','currentVideo','record','mvData','player']) {
        if (obj[k] && typeof obj[k] === 'object'){
            const id=idFromObject(obj[k],depth+1); if(id)return id;
        }
    }
    return null;
}

function walkFiberValue(value, callback, depth=0, seen=new Set()){
    if (!value || depth > 9) return false;
    const type = typeof value;
    if (type !== 'object' && type !== 'function') return false;
    if (seen.has(value)) return false;
    seen.add(value);
    if (callback(value)) return true;
    for (const k of Object.keys(value).slice(0,140)){
        try {
            const v = value[k];
            if (v && typeof v === 'object' && walkFiberValue(v,callback,depth+1,seen)) return true;
        } catch {}
    }
    return false;
}

function idFromReact(el){
    if (!el) return null;
    let node = el;
    for (let hop=0; node && hop<10; hop++, node=node.parentElement){
        for (const key of Object.keys(node)){
            if (!key.startsWith('__reactProps$') && !key.startsWith('__reactFiber$')) continue;
            try {
                let found = null;
                walkFiberValue(node[key], obj => {
                    const id = idFromObject(obj);
                    if (id){ found = id; return true; }
                    if (typeof obj === 'string'){
                        const pair = normalizePair(obj);
                        if (pair){ found = pair; return true; }
                    }
                    return false;
                });
                if (found) return found;
            } catch {}
        }
    }
    return null;
}

function visible(el){
    if (!el) return false;
    const r = el.getBoundingClientRect?.();
    if (!r || r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity || 1) > 0;
}

function inStory(el){
    return !!el?.closest?.('[data-testid="stories_viewer"],[data-testid*="story" i],.StoriesViewer,[class*="StoryViewer" i],[class*="StoriesViewer" i]');
}

function storyVideo(){
    const root=document.querySelector('[data-testid="stories_viewer"],.StoriesViewer,[class*="StoryViewer" i],[class*="StoriesViewer" i]');
    const all=[...(root||document).querySelectorAll('video')].filter(v=>visible(v));
    const playing=all.filter(v=>!v.paused&&!v.ended&&(v.currentSrc||v.src));
    const pool=playing.length?playing:all;
    pool.sort((a,b)=>scoreVideo(b)-scoreVideo(a));
    return pool[0]||null;
}

function activeVideo(){
    const all = [...document.querySelectorAll('video')].filter(v => visible(v) && !inStory(v) && !v.closest('.AttachVideoMessage,[data-testid*=video-message i],[class*=AttachVideoMessage i]'));
    if (!all.length) return null;
    const playing = all.filter(v => !v.paused && !v.ended && (v.currentSrc || v.src));
    const pool = playing.length ? playing : all;
    pool.sort((a,b) => scoreVideo(b)-scoreVideo(a));
    return pool[0] || null;
}

function scoreVideo(v){
    const r = v.getBoundingClientRect();
    const area = r.width*r.height;
    const cx=r.left+r.width/2, cy=r.top+r.height/2;
    const dist=Math.hypot(cx-innerWidth/2, cy-innerHeight/2);
    return area + (!v.paused?800000:0) + (v.readyState>=3?120000:0) - Math.min(dist,innerWidth+innerHeight)*1000;
}

function clipControlsRoot(){
    const ctl=document.querySelector('[data-testid="clips-controls-like-button"],[data-testid="clips-controls-share-button"],[data-testid="clips-controls-more-actions-button"]');
    if(!ctl)return null;
    let root=ctl.closest('[role="dialog"],[data-testid="clips-modal"],[data-testid*="clip" i],[class*="MessengerClipsModal" i],[class*="clipsModal" i],[class*="ClipModal" i]');
    if(root && root.querySelector('video'))return root;
    for(let p=ctl.parentElement,i=0;p&&i<12;i++,p=p.parentElement){
        if(p.querySelector('video')){
            const r=p.getBoundingClientRect?.();
            if(r && r.width>250 && r.height>250) return p;
        }
    }
    return root||null;
}
function activeClipVideo(){
    const root=clipControlsRoot();
    if(!root)return null;
    const vids=[...root.querySelectorAll('video')].filter(v=>visible(v));
    if(!vids.length)return null;
    const playing=vids.filter(v=>!v.paused&&!v.ended&&(v.currentSrc||v.src));
    const pool=playing.length?playing:vids;
    pool.sort((a,b)=>scoreVideo(b)-scoreVideo(a));
    return pool[0]||null;
}
function activeMessengerVideo(){
    const nodes=[...document.querySelectorAll('.AttachVideoMessage video,[data-testid="message-video"] video,[data-testid*="video-message" i] video,video.player-media,video[class*="player-media" i]')].filter(v=>visible(v));
    const playing=nodes.filter(v=>!v.paused&&!v.ended&&(v.currentSrc||v.src));
    const pool=playing.length?playing:nodes;
    pool.sort((a,b)=>scoreVideo(b)-scoreVideo(a));
    return pool[0]||null;
}
function activeAccessKeyFromDom(){
    return videoRouteMeta(location.pathname+' '+location.href)?.accessKey || null;
}

function activeIdFromDom(){
    const path=location.pathname, href=location.href;
    // Messenger video viewer: the route itself is the most authoritative id.
    // Never let a random link/video elsewhere in the conversation win.
    const routeDecoded = decodeMany(href);
    const routeMeta=videoRouteMeta(routeDecoded);
    if(routeMeta?.id) return routeMeta.id;
    let id=normalizePair(path);
    if (id && (/(?:^|\/)clips?-?\d+_/i.test(path) || /(?:^|\/)video-?\d+_/i.test(path) || /[?#&]z=(?:clip|video)-/i.test(href))) return id;

    // Messenger clip modal: bind the ID search to the actual clip controls first.
    const clipRoot = clipControlsRoot();
    if (clipRoot) {
        const preferred = [
            clipRoot.querySelector('[data-testid="clips-controls-more-actions-download-item"]'),
            clipRoot.querySelector('[data-testid="clips-controls-more-actions-button"]'),
            clipRoot.querySelector('[data-testid="clips-controls-share-button"]'),
            clipRoot.querySelector('[data-testid="clips-controls-like-button"]'),
            activeClipVideo()
        ].filter(Boolean);
        for (const el of preferred) {
            id = idFromElement(el) || idFromReact(el);
            if (id) return id;
            for (const a of (el.querySelectorAll?.('a[href],input[readonly],*[data-video-id],*[data-clip-id],*[data-full-id]') || [])) {
                id = idFromElement(a) || idFromReact(a) || normalizePair(a.value || a.getAttribute?.('href') || '');
                if (id) return id;
            }
        }
        id = idFromReact(clipRoot);
        if (id) return id;
    }

    const roots=[];
    const addRoot=r=>{if(r&&visible(r)&&!roots.includes(r))roots.push(r)};
    const v=activeVideo();
    if(v){
        addRoot(v);
        for(let p=v.parentElement,i=0;p&&p!==document.body&&i<10;i++,p=p.parentElement) addRoot(p);
    }
    [
        '[data-testid="clips-controls-share-button"]',
        '[data-testid="clips-controls-more-actions-button"]',
        '[data-testid="clips-controls-more-actions-download-item"]',
        '[data-testid="clips-feed-controls"]',
        '[data-testid="video_modal_like_button"]',
        '[data-testid="video_page_like_button"]',
        '[data-testid="video_modal_more_button"]',
        '[data-testid="video_page_more_button"]'
    ].forEach(sel=>document.querySelectorAll(sel).forEach(addRoot));

    for(const root of roots){
        id=idFromElement(root)||idFromReact(root);
        if(id)return id;
        const links=root.querySelectorAll?.('a[href*="/clip"],a[href*="clip-"],a[href*="/video"],a[href*="video-"],input[value*="/clip"],input[value*="/video"]')||[];
        for(const link of links){id=idFromElement(link)||idFromReact(link);if(id)return id;}
        let p=root.parentElement;
        for(let i=0;p&&i<12;i++,p=p.parentElement){
            id=idFromElement(p)||idFromReact(p);
            if(id)return id;
        }
    }
    // Messenger Clip modal often has no useful data-* attributes, but the
    // exported/share URL and React props still contain the full id.
    for(const el of document.querySelectorAll('input[readonly],textarea[readonly],a[href],button,[role=button]')){
        if(!visible(el)) continue;
        id=idFromElement(el)||idFromReact(el);
        if(id)return id;
        const text=(el.value||el.getAttribute?.('href')||el.textContent||'').slice(0,4000);
        id=normalizePair(text);
        if(id)return id;
    }
    return null;
}

function isDirect(url){
    if(typeof url!=='string'||!/^https?:\/\//i.test(url))return false;
    if(/(?:\.m3u8|\.mpd)(?:[?#]|$)/i.test(url))return false;
    if(/\/recoding\/|\bgetVideoPreview\b|\/(?:video_)?preview(?:[/?#]|$)|[?&](?:preview|is_preview|preview_only)=1(?:&|$)/i.test(url))return false;
    return /(?:\.mp4)(?:[?#]|$)/i.test(url) || CDN_RE.test(url);
}

function qualityFromKey(key){
    const s=String(key||'');
    const m=s.match(/(?:mp4[_-]?|url|video[_-]?|quality[_-]?)(2160|1440|1080|720|480|360|240|144)p?$/i) || s.match(/^(2160|1440|1080|720|480|360|240|144)$/i);
    return m ? `${m[1]}p` : null;
}
function qualityFromObject(obj){
    if (!obj || typeof obj!=='object') return null;
    const explicit = qualityFromKey(obj.quality || obj.resolution || obj.name);
    if (explicit) return explicit;
    const n=Number(obj.height||obj.height_px||0);
    if (Number.isFinite(n)&&n>0){
        let best=QUALITIES[QUALITIES.length-1], diff=Infinity;
        for(const q of QUALITIES){const d=Math.abs(q-n);if(d<diff){diff=d;best=q}}
        return `${best}p`;
    }
    return null;
}
function filesTo(files,out){
    if(!files)return;
    const fallbackKey='__fallback';
    const put=(url,q=null)=>{if(!isDirect(url))return;if(q){out[q]=url;return;}if(!out[fallbackKey])out[fallbackKey]=url;};
    const walk=(value,hint=null,depth=0)=>{
        if(!value||depth>7)return;
        if(typeof value==='string'){put(value,qualityFromKey(hint));return;}
        if(Array.isArray(value)){for(const item of value)walk(item,null,depth+1);return;}
        if(typeof value!=='object')return;
        const direct=value.url||value.src||value.file||value.uri;
        if(direct)put(direct,qualityFromObject(value)||qualityFromKey(hint));
        for(const [k,v] of Object.entries(value)){
            const q=qualityFromKey(k);
            if(typeof v==='string'){put(v,q);continue;}
            if(v&&typeof v==='object')walk(v,q,depth+1);
        }
    };
    walk(files,null,0);
    if(!Object.keys(out).some(k=>/^\d+p$/.test(k))&&out[fallbackKey])out['720p']=out[fallbackKey];
    delete out[fallbackKey];
}

function deepExtract(obj,targetId,depth=0,seen=new Set()){
    if(!obj || depth>12) return null;
    if(typeof obj==='object'){
        if(seen.has(obj)) return null;
        seen.add(obj);
    }
    const discoveredId=idFromObject(obj);
    const scoped = !(targetId && discoveredId && discoveredId !== targetId);
    const out={};

    if(typeof obj==='object'){
        // Never take direct files from a sibling media object with another id.
        if(scoped){
            for(const key of ['files','video_files','resolutions','variants','player','mvData','media']){
                try{filesTo(obj[key],out)}catch{}
            }
            for(const [k,v] of Object.entries(obj)){
                if(typeof v==='string' && isDirect(v)){
                    const q=qualityFromKey(k);
                    if(q) out[q]=v;
                    else if(CDN_RE.test(v) && /\.mp4(?:[?#]|$)/i.test(v)) out['720p']=out['720p']||v;
                }
            }
        }
        // Still recurse through a mismatched wrapper: modern payloads often put
        // the exact video object one or two levels below an unrelated container.
        for(const [k,v] of Object.entries(obj)){
            if(!v || typeof v!=='object' || depth>=12) continue;
            const nested=deepExtract(v,targetId,depth+1,seen);
            if(nested?.vsrc){Object.assign(out,nested.vsrc)}
        }
    }

    if(Object.keys(out).length && scoped) return {id:discoveredId||targetId||null,vsrc:out};
    return null;
}

function captureToken(value){
    if(!value || typeof value!=='object')return;
    let hit=null;
    walkFiberValue(value,obj=>{
        if(obj?.access_token && typeof obj.access_token==='string' && obj.access_token.length>15){hit=obj.access_token;return true;}
        return false;
    });
    if(hit)capturedToken=hit;
}
function captureUrlToken(u){
    const m=String(u||'').match(/[?&]access_token=([^&#]+)/i);
    if(m) capturedToken=decodeURIComponent(m[1]);
}
function authToken(){
    return window.vk?.webToken?.access_token || window.vk?.access_token || window.__vkeVkAccessToken || window.cur?.access_token || window.vkConfig?.access_token || capturedToken || null;
}

function mergeVsrc(a,b){
    const out={...(a||{})};
    for(const [q,u] of Object.entries(b||{})){
        if(typeof u!=='string'||!u) continue;
        // Prefer an explicit quality slot and never overwrite a better/existing URL.
        if(!out[q]) out[q]=u;
    }
    return out;
}

function sendData(vsrc,id,meta={}){
    if(!vsrc || !Object.keys(vsrc).length) return;
    const exact = id || requestedId || activeIdFromDom() || null;
    const normalized = normalizePair(exact) || exact;
    if (requestedId && normalized && normalizePair(requestedId)!==normalized) return;
    const prev = normalized ? dataById.get(normalized) : null;
    const data={
        vsrc:mergeVsrc(prev?.vsrc,vsrc),
        videoId:normalized||null,
        _clipId:normalized||null,
        _isClip:!!meta.isClip
    };
    if(normalized)dataById.set(normalized,data);
    currentData=data;
    window.postMessage({type:'CLP_VIDEO_DATA',...data},'*');
}

function extractForeignVideoGetByIds(payload){
    const items=payload?.response?.items;
    if(!Array.isArray(items)) return 0;
    let found=0;
    for(const item of items){
        const id=normalizePair(`${item?.owner_id||''}_${item?.id||''}`);
        if(!id) continue;
        const files=item?.files;
        const out={};
        for(const q of QUALITIES){
            const key=`mp4_${q}`;
            const u=files?.[key];
            if(typeof u==='string' && isDirect(u)) out[`${q}p`]=u;
        }
        if(Object.keys(out).length){
            sendData(out,id,{isClip:false});
            found++;
        }
    }
    return found;
}

function extractVideoBoxPayload(payload, targetId){
    if(!payload || typeof payload!=='object' || !targetId) return 0;
    const out={};
    const aliases={url144:'144p',url240:'240p',url360:'360p',url480:'480p',url720:'720p',url1080:'1080p',url1440:'1440p',url2160:'2160p'};
    const walk=(obj,depth=0)=>{
        if(!obj||typeof obj!=='object'||depth>12)return;
        for(const [k,v] of Object.entries(obj)){
            const q=aliases[k];
            if(q && typeof v==='string' && isDirect(v)) out[q]=v;
            else if(v&&typeof v==='object') walk(v,depth+1);
        }
    };
    walk(payload);
    if(!Object.keys(out).length)return 0;
    sendData(out,targetId,{isClip:false});
    return 1;
}

function extractForeignVideoRelated(payload){
    const items=payload?.feedData?.items;
    if(!Array.isArray(items)) return 0;
    const keyQuality={144:'144p',240:'240p',360:'360p',480:'480p',720:'720p',1080:'1080p',1440:'1440p',2160:'2160p'};
    let found=0;
    for(const item of items){
        const id=normalizePair(item?.id);
        if(!id) continue;
        const streams=Array.isArray(item?.video?.streams)?item.video.streams:[];
        const out={};
        for(const st of streams){
            const u=typeof st==='string'?st:st?.url;
            if(typeof u!=='string' || !isDirect(u)) continue;
            let q=null;
            try{q=new URL(u,location.href).searchParams.get('type')}catch{}
            if(keyQuality[q]) out[keyQuality[q]]=u;
        }
        if(Object.keys(out).length){sendData(out,id,{isClip:/clip/i.test(location.href)});found++;}
    }
    return found;
}

function extractQualityUrlsFromText(text){
    const out={};
    const s=String(text||'').replace(/\\\//g,'/').replace(/&quot;/g,'\"').replace(/&#34;/g,'\"').replace(/&amp;/g,'&').replace(/\\u0026/g,'&');
    const add=(q,u)=>{
        if(!q||typeof u!=='string')return;
        let x=u.trim().replace(/\\\//g,'/');
        if(!isDirect(x))return;
        out[q]=out[q]||x;
    };
    const names=['2160','1440','1080','720','480','360','240','144'];
    for(const n of names){
        const q=`${n}p`;
        const re=new RegExp(`(?:[\"']?(?:url|mp4|video|file)[_-]?${n}p?[\"']?|[\"']${n}p[\"'])\\s*[:=]\\s*[\"']([^\"']+)`, 'ig');
        let m; while((m=re.exec(s))) add(q,m[1]);
    }
    const generic=/[\"'](?:url|mp4|video|file)[_-]?(2160|1440|1080|720|480|360|240|144)p?[\"']\s*[:=]\s*[\"']([^\"']+)[\"']/ig;
    let m; while((m=generic.exec(s))) add(`${m[1]}p`,m[2]);
    return out;
}

function inspect(text, requestUrl=''){
    const target=requestedId||activeIdFromDom();
    // The current VK page can return a JavaScript/HTML payload rather than JSON.
    // Extract the explicit url144..url2160 assignments before trying generic JSON
    // parsing so one stream is never mistaken for the complete quality set.
    if(target){
        const raw=extractQualityUrlsFromText(text);
        if(Object.keys(raw).length) sendData(raw,target,{isClip:!!target && /clip/i.test(requestUrl)});
    }
    const json=parsePayload(text);
    if(!json)return;
    captureToken(json);
    const targetIdNow=requestedId||activeIdFromDom();
    // Current VK web extractor uses payload[-1].mvData/player. Prefer that
    // exact object before the generic recursive search so sibling media cannot win.
    let result=null;
    try{
        const payload=json?.payload;
        const opts=Array.isArray(payload)?payload[payload.length-1]:null;
        const mv=opts?.mvData || opts?.player || opts?.video || opts?.clip;
        if(mv){
            result=deepExtract({owner_id:targetIdNow?String(targetIdNow).split('_')[0]:undefined,id:targetIdNow?String(targetIdNow).split('_')[1]:undefined,files:mv,mvData:mv},targetIdNow);
        }
        if(!result && opts) result=deepExtract(opts,targetIdNow);
    }catch{}
    if(!result) result=deepExtract(json,targetIdNow);
    // Some modern VK payloads store an item list under payload[1].
    if(!result && Array.isArray(json?.payload)) result=deepExtract(json.payload,targetIdNow);
    if(result?.vsrc) sendData(result.vsrc,result.id||targetIdNow,{isClip:!!targetIdNow && /clip/i.test(requestUrl)});
}

function extractForeignLiveRecord(payload){
    const rows=payload?.data?.record?.data?.[0]?.playerUrls;
    if(!Array.isArray(rows)) return 0;
    const id=normalizePair(payload?.data?.record?.id||payload?.data?.record?.videoId||requestedId);
    if(!id) return 0;
    const map={tiny:'144p',lowest:'240p',low:'360p',medium:'480p',high:'720p',full_hd:'1080p'};
    const out={};
    for(const row of rows){
        const q=map[row?.type];
        if(q&&typeof row?.url==='string'&&isDirect(row.url)) out[q]=row.url;
    }
    if(Object.keys(out).length){sendData(out,id,{isClip:/clip/i.test(location.href)});return 1;}
    return 0;
}

window.fetch=new Proxy(ORIGINAL_FETCH,{async apply(target,thisArg,args){
    const u=typeof args[0]==='string'?args[0]:(args[0]?.url||'');
    captureUrlToken(u);
    try{ if(isDirect(u)&&CDN_RE.test(u)&&(/\.mp4/i.test(u)||/ct=6/i.test(u))) seenDirectUrls.add(u); }catch{}
    const response=await target.apply(thisArg,args);
    try{
        const ct=(response?.headers?.get?.('content-type')||'').toLowerCase();
        if(VIDEO_RE.test(u) || /\/api\/web\/v1\/video-related/i.test(u)){
            const text=await response.clone().text().catch(()=> '');
            if(text){
                if(/\/method\/video\.getByIds/i.test(u)){
                    try{const j=JSON.parse(text); extractForeignVideoGetByIds(j);}catch{}
                } else if(/\/api\/web\/v1\/video-related/i.test(u)){
                    try{const j=JSON.parse(text); extractForeignVideoRelated(j);}catch{}
                } else if(/api\.live\.vkvideo\.ru\/v1\/blog\/semtools\/public_video_stream\/record\//i.test(u)){
                    try{const j=JSON.parse(text); extractForeignLiveRecord(j);}catch{}
                }
                inspect(text,u);
            }
        } else if(/json/i.test(ct) && /(?:method\/(?:video\.|execute)|al_(?:video|clip)\.php|video_ext|clips?)/i.test(u)){
            const text=await response.clone().text().catch(()=> '');
            if(text) inspect(text,u);
        }
        const responseUrl=response?.url||'';
        if(isDirect(responseUrl)&&CDN_RE.test(responseUrl)){
            seenDirectUrls.add(responseUrl);
            if(/\.mp4(?:[?#]|$)/i.test(responseUrl)) sendData({'720p':responseUrl},requestedId||activeIdFromDom(),{isClip:/clip/i.test(location.href)});
        }
    }catch{}
    return response;
}});

XMLHttpRequest.prototype.open=function(method,url,...rest){
    this.__vkeVideoUrl=String(url||'');
    try{ if(/ct=6|\.mpd(?:[?#]|$)|\.m3u8(?:[?#]|$)/i.test(this.__vkeVideoUrl)) seenDirectUrls.add(this.__vkeVideoUrl); }catch{}
    captureUrlToken(this.__vkeVideoUrl);
    return ORIGINAL_OPEN.call(this,method,url,...rest);
};
XMLHttpRequest.prototype.send=function(...args){
    this.__vkeVideoBody=args[0];
    const u=this.__vkeVideoUrl||'';
    // Do not attach listeners to every VK XHR: this used to interfere with VK's
    // own dynamically-generated handlers and created a large amount of overhead.
    if(VIDEO_RE.test(u)){
        this.addEventListener('load',()=>{
            try{
                const ct=(this.getResponseHeader('content-type')||'').toLowerCase();
                const text=this.responseText||'';
                const bodyText=typeof this.__vkeVideoBody==='string'?this.__vkeVideoBody:(this.__vkeVideoBody instanceof URLSearchParams?this.__vkeVideoBody.toString():'');
                const isVideoBox=/al_video\.php/i.test(u) && (/(?:^|&)act=video_box(?:&|$)/i.test(bodyText)||/(?:^|[?&])act=video_box(?:&|$)/i.test(u));
                if(isVideoBox){
                    const key=new URLSearchParams(bodyText).get('video')||activeIdFromDom();
                    const pair=normalizePair(key)||key;
                    try{extractVideoBoxPayload(JSON.parse(text)?.payload||JSON.parse(text),pair);}catch{}
                } else if(/\/method\/video\.getByIds/i.test(u)){
                    try{extractForeignVideoGetByIds(JSON.parse(text));}catch{}
                } else if(/\/api\/web\/v1\/video-related/i.test(u)){
                    try{extractForeignVideoRelated(JSON.parse(text));}catch{}
                } else if(/api\.live\.vkvideo\.ru\/v1\/blog\/semtools\/public_video_stream\/record\//i.test(u)){
                    try{extractForeignLiveRecord(JSON.parse(text));}catch{}
                }
                if(VIDEO_RE.test(u) && text) inspect(text,u);
            }catch{}
        },{once:true});
    }
    return ORIGINAL_SEND.apply(this,args);
};

function directCandidates(){
    const out=[];
    const add=u=>{if(isDirect(u)&&CDN_RE.test(u)&&!out.includes(u))out.push(u)};
    const route=decodeMany(location.href);
    const hasMessengerRoute=/\/im\/[^#]*[?&]z=(?:video)-?\d+_\d+/i.test(route) || /(?:^|[^a-z])video-?\d+_\d+/i.test(route);
    let v=null;
    if(hasMessengerRoute){
        const routeId=normalizePair(route);
        const candidates=[...document.querySelectorAll('video')].filter(x=>visible(x)&&!x.closest('.AttachVideoMessage,[class*=AttachVideoMessage i]'));
        const exact=candidates.filter(x=>{
            const r=x.closest('.ConvoMessage,.ConvoMessageWithoutBubble,[role=dialog],.VideoView,.VideoViewer,.video-viewer')||x.parentElement;
            const html=String(r?.outerHTML||'');
            const src=String(x.currentSrc||x.src||'');
            return routeId && (html.includes(`video${routeId}`)||html.includes(routeId)||src.includes(routeId));
        });
        const pool=exact.length?exact:candidates.filter(x=>x.matches('video.player-media,video[class*=player-media i]'));
        pool.sort((a,b)=>scoreVideo(b)-scoreVideo(a));
        v=pool[0]||null;
    }else{
        v=activeClipVideo()||activeVideo();
    }
    if(!v) return out;
    add(v.currentSrc); add(v.src); v.querySelectorAll?.('source').forEach(s=>add(s.src));
    for(let p=v.parentElement,i=0;p&&p!==document.body&&i<8;i++,p=p.parentElement){
        p.querySelectorAll?.(':scope > video, :scope > video source, :scope > [data-video-url], :scope > [data-src], :scope > [data-url]').forEach(el=>{
            add(el.currentSrc); add(el.src); add(el.getAttribute?.('src')); add(el.getAttribute?.('data-video-url')); add(el.getAttribute?.('data-src')); add(el.getAttribute?.('data-url'));
        });
    }
    // Only use a recent resource when it is the same active player's host path.
    try{
        const base=new URL(v.currentSrc||v.src,location.href);
        performance.getEntriesByType('resource').forEach(e=>{
            const u=e?.name||'';
            if(!/\.mp4(?:[?#]|$)/i.test(u)||!CDN_RE.test(u))return;
            try{
                const x=new URL(u);
                if(x.host===base.host) add(u);
            }catch{}
        });
    }catch{}
    return out;
}

async function resolveViaPageApi(id, accessKey=null){
    if(!id)return false;
    const videoKey=accessKey ? `${id}/${accessKey}` : id;

    // First try the current page origin with the page's own authenticated cookies.
    // This is the most reliable path on vk.ru/clip-* and vkvideo.ru/video-*.
    const origins=[];
    try{ origins.push(location.origin); }catch{}
    for(const origin of ['https://vk.ru','https://vk.com','https://vkvideo.ru']){
        if(!origins.includes(origin)) origins.push(origin);
    }

    for(const origin of origins.slice(0,4)){
        const base=origin+'/al_video.php';
        for(const method of ['POST','GET']){
            try{
                let res;
                if(method==='POST'){
                    const body=new URLSearchParams({act:'show',video:videoKey,al:'1',autoplay:'1',module:'video'});
                    res=await ORIGINAL_FETCH(base,{method:'POST',credentials:'include',headers:{'Accept':'*/*','Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest'},body:body.toString()});
                }else{
                    const u=base+'?act=show&al=1&autoplay=1&module=video&video='+encodeURIComponent(videoKey);
                    res=await ORIGINAL_FETCH(u,{credentials:'include',headers:{'Accept':'*/*','X-Requested-With':'XMLHttpRequest'}});
                }
                const text=await res.clone().text().catch(()=> '');
                if(text){
                    inspect(text,base);
                    if(/act=video_box/i.test(base)) { try { extractVideoBoxPayload(parsePayload(text)?.payload||parsePayload(text),videoKey); } catch {} }
                }
                if(currentData?.vsrc) return true;
            }catch{}
        }
    }

    // VK's own player commonly asks al_video.php?act=video_box for messenger videos.
    // Mirror that request shape as a dedicated fallback; its payload may expose
    // url144/url240/... even when video.get reports files={}.
    for(const origin of origins.slice(0,4)){
        try{
            const body=new URLSearchParams({act:'video_box',al:'1',video:videoKey,hd:'1'});
            const res=await ORIGINAL_FETCH(origin+'/al_video.php',{method:'POST',credentials:'include',headers:{'Accept':'*/*','Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest'},body:body.toString()});
            const text=await res.clone().text().catch(()=> '');
            if(text) inspect(text,origin+'/al_video.php?act=video_box');
            if(currentData?.vsrc)return true;
        }catch{}
    }

    // Then use the service-worker path for cross-origin/cookie-restricted pages.
    const urls=[
        `https://vk.ru/al_video.php?act=show&al=1&autoplay=1&module=video&video=${encodeURIComponent(videoKey)}`,
        `https://vk.com/al_video.php?act=show&al=1&autoplay=1&module=video&video=${encodeURIComponent(videoKey)}`,
        `https://vkvideo.ru/al_video.php?act=show&al=1&autoplay=1&module=video&video=${encodeURIComponent(videoKey)}`,
        `https://vk.ru/al_clip.php?act=show&al=1&clip=${encodeURIComponent(id)}`,
        `https://vk.com/al_clip.php?act=show&al=1&clip=${encodeURIComponent(id)}`,
        `https://vkvideo.ru/al_clip.php?act=show&al=1&clip=${encodeURIComponent(id)}`
    ];
    const requestId=`clp_page30_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const result=await new Promise(resolve=>{
        let done=false;
        const finish=v=>{if(done)return;done=true;window.removeEventListener('message',on);clearTimeout(timer);resolve(v)};
        const on=e=>{if(e.source!==window||e.data?.type!=='CLP_RESOLVE_PAGE_MEDIA_RESULT'||e.data.requestId!==requestId)return;finish(e.data.results||[])};
        window.addEventListener('message',on);
        window.postMessage({source:'vke-clp',type:'CLP_RESOLVE_PAGE_MEDIA',requestId,urls,pageUrl:location.href},'*');
        const timer=setTimeout(()=>finish([]),12000);
    });
    for(const item of result){
        if(!item?.ok||!item.text)continue;
        inspect(item.text,item.url||'');
        if(/act=video_box/i.test(item.url||'')){ try { const j=parsePayload(item.text); extractVideoBoxPayload(j?.payload||j,videoKey); } catch {} }
        if(currentData?.vsrc)return true;
    }
    return false;
}

async function resolveViaTokenApi(id){
    const token=authToken();
    if(!token||!id)return false;
    const key=activeAccessKeyFromDom();
    const videoKey=key?`${id}/${key}`:id;
    for(const host of ['https://api.vk.ru','https://api.vk.com']){
        try{
            const r=await ORIGINAL_FETCH(`${host}/method/video.get?v=5.199&videos=${encodeURIComponent(videoKey)}&access_token=${encodeURIComponent(token)}`);
            if(!r.ok)continue;
            const json=await r.json(); captureToken(json);
            const result=deepExtract(json,id);
            if(result?.vsrc){sendData(result.vsrc,id,{isClip:/clip/i.test(location.href)});return true;}
        }catch{}
    }
    return false;
}

async function resolveViaExtensionApi(id){
    if(!id)return false;
    const key=activeAccessKeyFromDom();
    const videoKey=key?`${id}/${key}`:id;
    const requestId=`clp_api_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    return new Promise(resolve=>{
        let done=false;
        const finish=v=>{if(done)return;done=true;window.removeEventListener('message',on);clearTimeout(timer);resolve(!!v)};
        const on=e=>{
            if(e.source!==window||e.data?.type!=='CLP_API_VIDEO_GET_RESULT'||e.data.requestId!==requestId)return;
            try{ if(e.data.response){ captureToken(e.data.response); const found=deepExtract(e.data.response,id); if(found?.vsrc){ sendData(found.vsrc,found.id||id,{isClip:/clip/i.test(location.href)}); finish(true); return; } } }catch{}
            finish(false);
        };
        window.addEventListener('message',on);
        window.postMessage({source:'vke-clp',type:'CLP_API_VIDEO_GET',requestId,id:videoKey},'*');
        const timer=setTimeout(()=>finish(false),9000);
    });
}

async function requestResolve(id,clientId){
    requestedId=normalizePair(id)||id||activeIdFromDom()||null;
    const accessKey=/clip/i.test(location.href)?null:activeAccessKeyFromDom();
    currentData=null;

    let ok=false;
    try{
      const candidates=directCandidates();
      const messengerRoute=/\/im\/[^#]*[?&]z=(?:video)-?\d+_\d+/i.test(decodeMany(location.href));
      if(candidates.length && !messengerRoute){ sendData({'720p':candidates[0]},requestedId,{isClip:/clip/i.test(location.href)}); ok=true; }
    }catch{}
    if(requestedId) {
        for(let attempt=0;attempt<3;attempt++){
            const r=await resolveViaPageApi(requestedId,accessKey); ok=ok||r;
            if(!ok) await new Promise(r=>setTimeout(r,300+attempt*450));
        }
    }
    // Second line: authenticated VK API. This is especially important on vkvideo.ru,
    // where the page can be a separate origin and the first-party al_video endpoint
    // can be unavailable to the page resolver.
    if(requestedId && (!currentData?.vsrc || Object.keys(currentData.vsrc).length<2)) {
        for(let attempt=0;attempt<2;attempt++){
            const r=await resolveViaTokenApi(requestedId); ok=ok||r;
            if(!ok) await new Promise(r=>setTimeout(r,400));
        }
    }
    // Final extension-side API fallback (uses the stored Kate Mobile/VK token).
    if(requestedId && (!currentData?.vsrc || Object.keys(currentData.vsrc).length<2)) {
        for(let attempt=0;attempt<2;attempt++){
            const r=await resolveViaExtensionApi(requestedId); ok=ok||r;
            if(!ok) await new Promise(r=>setTimeout(r,400));
        }
    }

    if(!currentData?.vsrc){
        const candidates=directCandidates();
        if(candidates.length){
            // Only use a direct URL if it belongs to the active player. Messenger
            // routes are resolved by the exact player/API path, never by a random
            // circle elsewhere in the conversation.
            const messengerRoute=/\/im\/[^#]*[?&]z=(?:video)-?\d+_\d+/i.test(decodeMany(location.href));
            if(!messengerRoute) sendData({'720p':candidates[0]},requestedId,{isClip:/clip/i.test(location.href)});
        }
    }

    if(currentData?.vsrc){
        window.postMessage({type:'CLP_VIDEO_DATA_RESPONSE',clientId,_clipId:currentData.videoId||requestedId||null,vsrc:currentData.vsrc},'*');
    }else{
        window.postMessage({type:'CLP_VIDEO_ERROR',clientId,_clipId:requestedId||null,error:requestedId?'Не удалось получить прямую ссылку на это видео':'ID видео/клипа не найден'},'*');
    }
}

async function fetchRangePart(url,start,credentials){
    const headers={Accept:'video/mp4,video/*,*/*;q=0.8',Range:`bytes=${start}-`};
    const r=await ORIGINAL_FETCH(url,{method:'GET',credentials,cache:'no-store',headers});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf=await r.arrayBuffer();
    const cr=r.headers.get('Content-Range')||'';
    return {r,buf,cr};
}

async function downloadMediaRange(url){
    if(!/^https?:\/\//i.test(String(url||''))) throw new Error('Некорректная media URL');
    let first=null, lastErr=null;
    for(const credentials of ['omit','include']){
      try{ first=await fetchRangePart(url,0,credentials); break; }catch(e){ lastErr=e; }
    }
    if(!first) throw lastErr||new Error('Не удалось получить media');

    // Some VK CDN endpoints ignore Range and return the complete file.
    if(first.r.status===200 || !first.cr){
      return new Blob([first.buf],{type:first.r.headers.get('Content-Type')||'video/mp4'});
    }

    const m=first.cr.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
    if(!m) return new Blob([first.buf],{type:first.r.headers.get('Content-Type')||'video/mp4'});
    let start=Number(m[1]), end=Number(m[2]), total=m[3]==='*'?null:Number(m[3]);
    const chunks=[first.buf];
    if(start!==0) throw new Error('Range начал не с нуля');
    if(total!=null && total<1024) throw new Error('Некорректный размер media');
    let guard=0;
    while(total==null || end+1<total){
      if(++guard>128) throw new Error('Слишком много media частей');
      let part=null; lastErr=null;
      for(const credentials of ['omit','include']){
        try{ part=await fetchRangePart(url,end+1,credentials); break; }catch(e){ lastErr=e; }
      }
      if(!part) throw lastErr||new Error('Не удалось продолжить media');
      if(part.r.status===200) {
        chunks.push(part.buf);
        return new Blob(chunks,{type:part.r.headers.get('Content-Type')||first.r.headers.get('Content-Type')||'video/mp4'});
      }
      const cm=part.cr.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
      if(!cm || Number(cm[1])!==end+1) throw new Error('Разрыв media range');
      end=Number(cm[2]);
      if(total==null && cm[3]!=='*') total=Number(cm[3]);
      chunks.push(part.buf);
    }
    return new Blob(chunks,{type:first.r.headers.get('Content-Type')||'video/mp4'});
}

window.addEventListener('message',e=>{
    if(e.source!==window)return;
    const d=e.data||{};
    if(d.type==='CLP_GET_ACTIVE_ID'){
        const id=activeIdFromDom();
        window.postMessage({type:'CLP_ACTIVE_ID_RESULT',clientId:d.clientId||null,id},'*');
        return;
    }
    if(d.type==='CLP_REQUEST_VIDEO_URL'){
        requestResolve(d.clipId||null,d.clientId||null);
        return;
    }
    if(d.type==='CLP_DOWNLOAD_MEDIA_REQUEST') {
        (async()=>{
          try {
            const blob=await downloadMediaRange(d.url);
            if(!blob || blob.size<1024) throw new Error('Пустой media blob');
            window.postMessage({type:'CLP_DOWNLOAD_MEDIA_RESULT',requestId:d.requestId,blob},'*');
          } catch(err) {
            window.postMessage({type:'CLP_DOWNLOAD_MEDIA_RESULT',requestId:d.requestId,error:String(err?.message||err||'media download failed')},'*');
          }
        })();
        return;
    }
    if(d.type==='CLP_FETCH_BLOB_REQUEST'){
        (async()=>{
          let lastErr=null;
          // Signed VK/OK CDN media is already authorized by the URL. For cross-origin
          // CDN fetches credentials: include can make CORS reject the request, even
          // though the <video> element can play it. Prefer a credential-less CORS
          // request, then fall back to the old credentialed request.
          for (const opts of [
            {credentials:'omit', mode:'cors', cache:'no-store'},
            {credentials:'include', mode:'cors', cache:'no-store'}
          ]) {
            try {
              const r=await ORIGINAL_FETCH(d.url,opts);
              if(!r.ok) throw new Error(`HTTP ${r.status}`);
              const blob=await r.blob();
              if(!blob || blob.size<1024) throw new Error('Пустой media blob');
              window.postMessage({type:'CLP_FETCH_BLOB_RESULT',requestId:d.requestId,blob},'*');
              return;
            } catch(err) { lastErr=err; }
          }
          window.postMessage({type:'CLP_FETCH_BLOB_RESULT',requestId:d.requestId,error:String(lastErr?.message||lastErr||'fetch failed')},'*');
        })();
    }
    if(d.type==='CLP_CAPTURE_MEDIA_REQUEST'){
        captureCurrentMedia(false,d.clientId||null,d.scope||null).catch(err=>window.postMessage({type:'CLP_CAPTURE_MEDIA_RESULT',clientId:d.clientId||null,error:String(err?.message||err)},'*'));
    }
    if(d.type==='CLP_CAPTURE_STORY'){
        captureCurrentMedia(true,d.clientId||null).catch(err=>window.postMessage({type:'CLP_CAPTURE_STORY_RESULT',clientId:d.clientId||null,error:String(err?.message||err)},'*'));
    }
});

async function captureCurrentMedia(allowStory,clientId,scope){
    const video=allowStory?storyVideo():(scope==='clip'?(activeClipVideo()||activeMessengerVideo()):(scope==='circle'?activeMessengerVideo():activeVideo()));
    if(!video)throw new Error('Активное видео не найдено');
    if(typeof video.captureStream!=='function' || typeof MediaRecorder==='undefined')throw new Error('Запись текущего видео не поддерживается');
    const oldTime=video.currentTime;
    const oldPaused=video.paused;
    try{
        video.currentTime=0;
        await video.play();
        const stream=video.captureStream();
        const mime=['video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(MediaRecorder.isTypeSupported)||'video/webm';
        const rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:Math.min(10_000_000,Math.max(2_500_000,(video.videoWidth||1280)*(video.videoHeight||720)*4))});
        const chunks=[];
        const done=new Promise((resolve,reject)=>{rec.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};rec.onerror=()=>reject(rec.error||new Error('MediaRecorder error'));rec.onstop=()=>resolve();});
        rec.start(200);
        const endAt=Date.now()+Math.max(1000,((Number(video.duration)||15)-0.05)*1000+300);
        while(Date.now()<endAt && !video.ended){await new Promise(r=>setTimeout(r,200));}
        try{rec.stop()}catch{}
        await done;
        const blob=new Blob(chunks,{type:mime.split(';')[0]});
        if(blob.size<100000)throw new Error('Запись получилась слишком маленькой');
        const url=URL.createObjectURL(blob);
        window.postMessage({type:allowStory?'CLP_CAPTURE_STORY_RESULT':'CLP_CAPTURE_MEDIA_RESULT',clientId,blob,url},'*');
    } finally {
        try{video.currentTime=oldTime}catch{}
        if(oldPaused)try{video.pause()}catch{}
    }
}

// Keep the last known data available to UI scripts without spamming the console.
setInterval(()=>{ if(currentData?.vsrc) window.postMessage({type:'CLP_VIDEO_DATA',...currentData},'*'); },2000);

})();
