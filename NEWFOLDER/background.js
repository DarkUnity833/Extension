importScripts('lyrics/background_lyrics.js');
importScripts('notifications/background_notifier.js');

// background.js
console.log('[VKE BG] Service Worker starting...');

async function cleanupLegacyHiddenImWindow() {
  try {
    const data = await chrome.storage.local.get(['vke_hidden_window_id']);
    const id = data.vke_hidden_window_id;
    if (id != null) {
      try { await chrome.windows.remove(id); } catch (_) {}
      await chrome.storage.local.remove('vke_hidden_window_id');
    }
  } catch (_) {}
}

cleanupLegacyHiddenImWindow();

const KATE_APP_ID = 2685278;
const REDIRECT_URI = 'https://oauth.vk.com/blank.html';
const SCOPE = 'messages,audio,video,docs,photos,stories,friends,groups,wall,offline,status';
const API_V = '5.199';
const LP_VERSION = 21;

const CACHE_PREFIX = 'vke_msg_';       // vke_msg_<peerId>_<cmid>
const CHAT_INDEX_PREFIX = 'vke_chatidx_'; 

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['vkeSettings'], (data) => {
    if (!data.vkeSettings) {
      chrome.storage.local.set({
        vkeSettings: {
          silentRead: true, silentWrite: true, offline: true,
          deletedMessages: true, bombs: true, editHistory: true,
          cacheHistory: true, hookBombs: true, nodeleteall: true
        }
      });
    }
  });
  startLongPollIfAuthorized();
});
chrome.runtime.onStartup.addListener(startLongPollIfAuthorized);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.type === 'VKE_FETCH_TEXT') {
    const url = typeof request.url === 'string' ? request.url : '';
    (async () => {
      if (!url) throw new Error('text url is empty');
      const u = new URL(url);
      const res = await fetch(u.href, {
        credentials: 'include',
        redirect: 'follow',
        referrer: request.pageUrl || `https://${u.hostname}/`,
        referrerPolicy: 'strict-origin-when-cross-origin',
        headers: {Accept: 'text/vtt,text/plain,application/json,application/xml;q=0.9,*/*;q=0.8'}
      });
      const text = await res.text();
      sendResponse({id:request.id, ok:res.ok, status:res.status, text, finalUrl:res.url || u.href});
    })().catch(e => sendResponse({id:request.id, ok:false, error:e?.message || String(e)}));
    return true;
  }

  if (request?.type === 'VKE_SEGMENT_API') {
    const p = request.payload || {};
    (async () => {
      const u = new URL('https://vkadskip-api.star-tech.dev' + String(p.path || '/'));
      for (const [k,v] of Object.entries(p.query || {})) if (v != null) u.searchParams.set(k, String(v));
      u.searchParams.set('v', '7.2.34');
      const headers = new Headers(p.headers || {});
      headers.set('X-VKE-Client','VKE');
      const res = await fetch(u.href, {method:String(p.method||'GET').toUpperCase(), headers, body:p.body||undefined, credentials:'omit'});
      const ct = res.headers.get('content-type') || '';
      let data = null;
      if (res.status !== 204) data = ct.includes('json') ? await res.json() : await res.text();
      sendResponse({id:p.id, ok:res.ok || res.status===204, status:res.status, data});
    })().catch(e => sendResponse({id:p.id, ok:false, error:e?.message || String(e)}));
    return true;
  }

  // Media resolver requests are executed in the extension service worker.
  // This avoids vkvideo.ru -> vk.ru CORS failures while preserving the user's
  // authenticated VK web session via credentials:'include' and host permissions.
  // Resolve an exact VK player/embed page (used by video messages whose API
  // object exposes player but no files.* entries). We intentionally parse only
  // media URLs belonging to that player response and return them to the page.
  if (request?.type === 'VKE_RESOLVE_PLAYER_MEDIA') {
    const rawUrl = typeof request.url === 'string' ? request.url : '';
    (async () => {
      if (!rawUrl) throw new Error('player url is empty');
      const u = new URL(rawUrl);
      if (!/(^|\.)vk(?:video)?\.(?:ru|com)$/i.test(u.hostname) && !/(^|\.)vkvd\d*\.okcdn\.ru$/i.test(u.hostname)) {
        throw new Error('unsupported player host');
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(u.href, {
          credentials: 'include',
          redirect: 'follow',
          signal: controller.signal,
          referrer: request.pageUrl || `https://${u.hostname}/`,
          referrerPolicy: 'strict-origin-when-cross-origin',
          headers: { 'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8' }
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`player HTTP ${res.status}`);
        const decoded = text
          .replace(/\\\//g, '/')
          .replace(/&quot;/g, '"')
          .replace(/&#34;/g, '"')
          .replace(/&amp;/g, '&');
        const rows = [];
        const seen = new Set();
        const add = (url, q = 0) => {
          if (typeof url !== 'string') return;
          let x = url.trim().replace(/\\\//g, '/').replace(/\\u0026/g, '&');
          try { x = JSON.parse('"' + x.replace(/"/g, '\\"') + '"'); } catch {}
          if (!/^https?:\/\//i.test(x)) return;
          if (/(?:getVideoPreview|\/preview(?:[/?]|$)|\/recoding\/|(?:^|[?&])(?:preview|is_preview|preview_only)=1)/i.test(x)) return;
          if (!/(?:\.mp4(?:[?#]|$)|(?:^|[?&])type=(?:1|3|5)(?:&|$))/i.test(x)) return;
          if (seen.has(x)) return;
          seen.add(x); rows.push({ url: x, q: Number(q) || 0 });
        };
        let m;
        const patterns = [
          /(?:["'](?:mp4|url|video|file)_?(?:2160|1440|1080|720|480|360|240|144)p?["']?)\\s*[:=]\\s*["']([^"']+)["']/gi,
          /["'](?:mp4|url|video|file)[_-]?(2160|1440|1080|720|480|360|240|144)[p]?["']?\\s*[:=]\\s*["']([^"']+)["']/gi,
          /https?:\/\/[^"'\s<\\]+/gi
        ];
        patterns[0].lastIndex = 0;
        while ((m = patterns[0].exec(decoded))) {
          const key = m[0].match(/(?:2160|1440|1080|720|480|360|240|144)/); add(m[1], key ? Number(key[0]) : 0);
        }
        patterns[1].lastIndex = 0;
        while ((m = patterns[1].exec(decoded))) add(m[2], Number(m[1]) || 0);
        patterns[2].lastIndex = 0;
        while ((m = patterns[2].exec(decoded))) add(m[0], 0);
        // VK sometimes serializes player vars as JS assignments rather than
        // JSON. Capture every explicit quality key as a last-mile fallback.
        const qre = /[\"']?(?:url|mp4|video|file)[_-]?(2160|1440|1080|720|480|360|240|144)p?[\"']?\s*[:=]\s*[\"']([^\"']+)[\"']/gi;
        while ((m = qre.exec(decoded))) add(m[2], Number(m[1]) || 0);
        rows.sort((a,b) => b.q - a.q);
        sendResponse({ ok: true, rows, finalUrl: res.url || u.href });
      } finally { clearTimeout(timer); }
    })().catch(e => sendResponse({ ok:false, error:e?.message || String(e) }));
    return true;
  }

  if (request?.type === 'VKE_RESOLVE_PAGE_MEDIA') {
    const urls = Array.isArray(request.urls) ? request.urls : [];
    (async () => {
      const results = [];
      const valid = [];
      for (const raw of urls.slice(0, 12)) {
        try {
          const u = new URL(String(raw));
          if (!/(^|\.)vk\.(?:ru|com)$/i.test(u.hostname)) continue;
          if (!/\/al_(?:video|clip)\.php$/i.test(u.pathname)) continue;
          valid.push(u);
        } catch {}
      }

      const pushResult = (url, res, method, error='') => {
        results.push({
          url, status: res?.status || 0, ok: !!res?.ok,
          contentType: res?.headers?.get?.('content-type') || '',
          text: res?.__text || '', method, error
        });
      };

      // Current VK player path: POST /al_video.php with act=show + video.
      // This mirrors the request shape used by current yt-dlp VK extractor.
      // Do the two first-party hosts in parallel and stop as soon as one gives
      // a payload containing mvData/player/files. This avoids the old 9s+ chain
      // of GET/POST attempts that caused "timeout resolving link" on vkvideo.ru.
      const postTargets = valid
        .filter(u => /\/al_video\.php$/i.test(u.pathname))
        .map(u => ({
          origin: u.origin,
          href: u.href,
          referer: request.pageUrl || `https://${u.hostname}/`,
          video: u.searchParams.get('video') || u.searchParams.get('clip'),
          list: u.searchParams.get('list') || ''
        }));

      // If the caller supplied only al_clip.php, convert to the same al_video
      // endpoint: VK's current web extractor resolves clips through al_video.php.
      for (const u of valid.filter(x => /\/al_clip\.php$/i.test(x.pathname))) {
        const video = u.searchParams.get('clip') || '';
        postTargets.push({
          origin: 'https://vk.com', href: u.href, referer: request.pageUrl || 'https://vk.com/', video,
          list: u.searchParams.get('list') || ''
        });
        postTargets.push({
          origin: 'https://vk.ru', href: u.href, referer: request.pageUrl || 'https://vk.ru/', video,
          list: u.searchParams.get('list') || ''
        });
      }

      const uniqueTargets=[]; const seen=new Set();
      for (const t of postTargets) {
        const key=`${t.origin}|${t.video}|${t.list}`;
        if(t.video && !seen.has(key)){seen.add(key);uniqueTargets.push(t)}
      }

      async function postOne(t){
        const body = new URLSearchParams();
        body.set('act','show');
        body.set('video',t.video);
        body.set('al','1');
        body.set('autoplay','1');
        body.set('module','video');
        if(t.list) body.set('list',t.list);
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),6500);
        try{
          const res=await fetch(`${t.origin}/al_video.php`,{
            method:'POST', credentials:'include', redirect:'follow', signal:controller.signal,
            referrer:t.referer, referrerPolicy:'strict-origin-when-cross-origin',
            headers:{
              'Accept':'*/*',
              'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8',
              'X-Requested-With':'XMLHttpRequest'
            },
            body:body.toString()
          });
          const text=await res.text();
          const out={status:res.status,ok:res.ok,headers:res.headers,__text:text};
          return {target:t,res:out,method:'POST'};
        }catch(e){
          return {target:t,res:null,method:'POST',error:e?.name==='AbortError'?'timeout':(e?.message||String(e))};
        }finally{clearTimeout(timer)}
      }

      const tagged = uniqueTargets.map((target, i) => postOne(target).then(result => ({...result, _i:i})));
      const active = new Map(tagged.map((promise, i) => [i, promise]));
      while(active.size){
        const winner = await Promise.race(active.values());
        active.delete(winner._i);
        pushResult(`${winner.target.origin}/al_video.php`,winner.res,winner.method,winner.error||'');
      }

      // Fast second path: VK's messenger player frequently asks the exact same
      // endpoint with act=video_box. Its payload can contain url144/url240/...
      // even when video.get/video.getByIds returns files={}. Mirror that request
      // before falling back to a normal GET page response.
      const videoBoxIds=[...new Set(uniqueTargets.map(t=>t.video).filter(Boolean))].slice(0,2);
      const videoBoxTasks=[];
      for(const host of ['https://vk.com','https://vk.ru']) for(const video of videoBoxIds){
        videoBoxTasks.push((async()=>{
          try{
            const body=new URLSearchParams({act:'video_box',al:'1',video,hd:'1'});
            const res=await fetch(host+'/al_video.php',{method:'POST',credentials:'include',redirect:'follow',referrer:request.pageUrl||host+'/',headers:{'Accept':'*/*','Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest'},body:body.toString()});
            const text=await res.text();
            pushResult(host+'/al_video.php?act=video_box',{status:res.status,ok:res.ok,headers:res.headers,__text:text},'POST','');
          }catch(e){pushResult(host+'/al_video.php?act=video_box',null,'POST',e?.message||String(e))}
        })());
      }
      await Promise.all(videoBoxTasks);

      // Fast fallback: one GET per first-party host using the exact video id.
      // Kept only after POST because current VK primarily expects POST.
      if(!results.some(x=>x.ok && x.text)){
        const ids=[...new Set(uniqueTargets.map(t=>t.video).filter(Boolean))];
        for(const host of ['https://vk.com','https://vk.ru']){
          if(!ids.length) break;
          const u=`${host}/al_video.php?act=show&al=1&autoplay=1&module=video&video=${encodeURIComponent(ids[0])}`;
          try{
            const res=await fetch(u,{credentials:'include',redirect:'follow',referrer:request.pageUrl||`${host}/`,headers:{'Accept':'*/*','X-Requested-With':'XMLHttpRequest'}});
            const text=await res.text();
            pushResult(u,{status:res.status,ok:res.ok,headers:res.headers,__text:text},'GET','');
            if(res.ok && /(?:mvData|player|url\d+|mp4_?\d+|owner_id|video_id|clip_id)/i.test(text)) break;
          }catch(e){pushResult(u,null,'GET',e?.message||String(e))}
        }
      }
      sendResponse({ok:true,results});
    })().catch(e=>sendResponse({ok:false,error:e?.message||String(e)}));
    return true;
  }
  if (request?.type === 'CLP_API_VIDEO_GET') {
    const id = typeof request.id === 'string' ? request.id : '';
    if (!id) { sendResponse({ok:false,error:'missing video id'}); return true; }
    (async()=>{
      const data=await chrome.storage.local.get(['vkToken']);
      const token=data.vkToken;
      if(!token){sendResponse({ok:false,error:'VK API token not available'});return;}
      let lastErr='VK API request failed';
      for(const host of ['https://api.vk.ru','https://api.vk.com']){
        for(const method of ['video.getByIds','video.get']){
          try{
            const query = method === 'video.getByIds'
              ? `videos=${encodeURIComponent(id)}`
              : `videos=${encodeURIComponent(id)}&count=1&extended=1`;
            const u=`${host}/method/${method}?v=${encodeURIComponent(API_V)}&${query}&access_token=${encodeURIComponent(token)}`;
            const r=await fetch(u,{credentials:'omit'});
            const j=await r.json();
            if(j?.response){sendResponse({ok:true,response:j});return;}
            lastErr=j?.error?.error_msg||lastErr;
          }catch(e){lastErr=e?.message||lastErr}
        }
      }
      sendResponse({ok:false,error:lastErr});
    })().catch(e=>sendResponse({ok:false,error:e?.message||String(e)}));
    return true;
  }

  // Media downloads are handled by the extension download manager rather than
  // page fetch(), so signed VK CDN URLs (okcdn/vkvd/vkuser/etc.) are not
  // subject to page-origin CORS restrictions.
  if (request?.type === 'VKE_CAPTURE_VISIBLE_TAB') {
    try {
      const windowId = sender?.tab?.windowId;
      if (windowId == null) throw new Error('Не удалось определить окно вкладки');
      chrome.tabs.captureVisibleTab(windowId, {format: 'png'}).then(dataUrl => {
        sendResponse({ok: true, dataUrl});
      }).catch(err => sendResponse({ok:false,error:err?.message||String(err)}));
    } catch (e) {
      sendResponse({ok:false,error:e?.message||String(e)});
    }
    return true;
  }

  if (request?.type === 'VKE_FETCH_MEDIA_BLOB') {
    const url = typeof request.url === 'string' ? request.url : '';
    const requestId = request.requestId || null;
    const pageUrl = typeof request.pageUrl === 'string' ? request.pageUrl : (sender?.tab?.url || 'https://vk.ru/');
    if (!/^https?:\/\//i.test(url)) {
      sendResponse({ok:false,error:'Некорректная media URL',requestId});
      return true;
    }
    (async()=>{
      let lastErr=null;
      for (const credentials of ['omit','include']) {
        try {
          const r=await fetch(url,{method:'GET',credentials,redirect:'follow',cache:'no-store',referrer:pageUrl,referrerPolicy:'strict-origin-when-cross-origin',headers:{'Accept':'video/mp4,video/*,image/*,*/*;q=0.8'}});
          if(!r.ok) throw new Error(`HTTP ${r.status}`);
          const b=await r.blob();
          if(!b || b.size<1024) throw new Error('Пустой media response');
          const blob = new Blob([await b.arrayBuffer()],{type:b.type||'application/octet-stream'});
          sendResponse({ok:true,requestId,blob});
          return;
        } catch(e) { lastErr=e; }
      }
      sendResponse({ok:false,requestId,error:lastErr?.message||String(lastErr||'media fetch failed')});
    })().catch(e=>sendResponse({ok:false,requestId,error:e?.message||String(e)}));
    return true;
  }

  if (request?.type === 'VKE_DIRECT_DOWNLOAD') {
    const url = typeof request.url === 'string' ? request.url : '';
    const filename = typeof request.filename === 'string' && request.filename
      ? request.filename.replace(/[\\/:*?"<>|]+/g, '_').trim()
      : `vk_media_${Date.now()}.bin`;
    let pageVideo = false;
    try {
      const u = new URL(url);
      pageVideo = /(?:^|\.)vk\.(?:ru|com)$/i.test(u.hostname) || /(?:^|\.)vkvideo\.ru$/i.test(u.hostname);
    } catch (_) {}
    if (pageVideo || !(/^(?:https?:\/\/|data:image\/(?:png|jpe?g|webp|gif|avif);base64,)/i.test(url))) {
      sendResponse({ ok: false, error: 'Некорректная ссылка' });
      return;
    }

    // Do not inject Referer/Origin here. Chrome treats some of these as
    // forbidden/unsafe request headers for downloads, which makes the
    // download fail before the CDN request is even started. Signed VK CDN
    // URLs already carry their authorization in the URL itself.
    chrome.downloads.download({
      url,
      filename,
      saveAs: false,
      conflictAction: 'uniquify'
    }).then(downloadId => {
      sendResponse({ ok: true, downloadId });
    }).catch(err => {
      sendResponse({ ok: false, error: err?.message || String(err) });
    });
    return true;
  }

  if (request?.type === 'VKE_DOWNLOAD_STATUS') {
    const id = Number(request.downloadId);
    if (!Number.isFinite(id)) { sendResponse({ ok:false, error:'bad download id' }); return; }
    chrome.downloads.search({ id }).then(items => {
      const d=items?.[0];
      if(!d){sendResponse({ok:false,error:'download not found'});return;}
      sendResponse({ok:true,id:d.id,state:d.state,bytesReceived:d.bytesReceived||0,totalBytes:d.totalBytes||0,filename:d.filename||'',error:d.error||null});
    }).catch(e=>sendResponse({ok:false,error:e?.message||String(e)}));
    return true;
  }

  console.log('[VKE BG] Received:', request.type);

  if (request.type === 'AUTH_START') {
    startAuth().then(result => {
      sendResponse(result);
      startLongPollIfAuthorized();
    }).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (request.type === 'AUTH_STATUS') {
    chrome.storage.local.get(['vkToken', 'vkUserId', 'vkTokenExpires'], (data) => {
      // Existing VKE installations may have a valid token without a stored
      // expiry timestamp. Presence of the token is the authoritative local
      // auth signal; the LongPoll/API layer will reject an actually invalid
      // token and can then trigger re-authentication.
      // Treat a stored VK token as the local authorization state. Older
      // installations can carry a stale/missing expiry timestamp even though
      // the token is still the token actually used by LongPoll/API.
      const authorized = !!data.vkToken;
      sendResponse({
        authorized,
        userId: data.vkUserId || null,
        tokenPresent: !!data.vkToken,
        tokenExpires: data.vkTokenExpires || null
      });
    });
    return true;
  }
  if (request.type === 'AUTH_LOGOUT') {
    chrome.storage.local.remove(['vkToken', 'vkUserId', 'vkTokenExpires'], () => {
      stopLongPoll();
      sendResponse({ success: true });
    });
    return true;
  }
  if (request.type === 'API_CALL') {
    callVkApi(request.payload.method, request.payload.params)
      .then(result => sendResponse({ success: true, response: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.type === 'GET_CACHED_MESSAGE') {
    getCachedMessage(request.payload.peerId, request.payload.cmid).then(sendResponse);
    return true;
  }
  if (request.type === 'GET_CACHED_CHAT') {
    getCachedChat(request.payload.peerId).then(sendResponse);
    return true;
  }
  if (request.type === 'GET_MESSAGE_VERSIONS') {
    const { peerId, cmid } = request.payload || {};
    getCachedMessage(peerId, cmid).then(msg => {
      sendResponse(Array.isArray(msg?.versions) && msg.versions.length ? msg.versions : (Array.isArray(msg?.edits) ? msg.edits : []));
    });
    return true;
  }
  if (request.type === 'RESOLVE_CMID') {
    const { peerId, messageId } = request.payload || {};
    resolveCmid(peerId, messageId).then(sendResponse);
    return true;
  }
  if (request.type === 'CACHE_HISTORY_PAGE') {
    cacheHistoryAll(request.payload.peerId, request.payload.offset || 0).then(sendResponse);
    return true;
  }
  if (request.type === 'RECORD_MESSAGE_TEXT') {
    const { peerId, cmid, text, date } = request.payload || {};
    recordMessageText(peerId, cmid, text, date).then(sendResponse);
    return true;
  }
});

// ==========================================
// OAuth & API Helpers
// ==========================================
async function startAuth() {
  return new Promise((resolve, reject) => {
    const authUrl = `https://oauth.vk.com/authorize?client_id=${KATE_APP_ID}&display=popup&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${SCOPE}&response_type=token&v=${API_V}`;
    chrome.windows.create({ url: authUrl, type: 'popup', width: 800, height: 600, focused: true }, (win) => {
      if (!win) { reject(new Error('Не удалось открыть окно')); return; }
      const winId = win.id;
      let resolved = false;
      const onUpdated = (tabId, changeInfo, tab) => {
        if (tab.windowId !== winId || !changeInfo.url) return;
        const url = changeInfo.url;
        if (url.includes('access_token=')) {
          resolved = true;
          chrome.tabs.onUpdated.removeListener(onUpdated);
          try {
            const hash = url.split('#')[1];
            const params = new URLSearchParams(hash);
            const token = params.get('access_token');
            const userId = params.get('user_id');
            const expiresIn = parseInt(params.get('expires_in') || '86400');
            chrome.storage.local.set({
              vkToken: token, vkUserId: userId, vkTokenExpires: Date.now() + expiresIn * 1000
            }, () => {
              chrome.windows.remove(winId).catch(() => {});
              resolve({ success: true, userId });
            });
          } catch (e) { reject(e); }
        } else if (url.includes('error=')) {
          resolved = true;
          chrome.tabs.onUpdated.removeListener(onUpdated);
          chrome.windows.remove(winId).catch(() => {});
          reject(new Error('Авторизация отменена'));
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.windows.onRemoved.addListener((removedWinId) => {
        if (removedWinId === winId && !resolved) {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          reject(new Error('Окно закрыто'));
        }
      });
    });
  });
}

async function getToken() {
  const data = await chrome.storage.local.get(['vkToken']);
  return data.vkToken || null;
}

async function callVkApi(method, params) {
  const token = await getToken();
  if (!token) throw new Error('Не авторизован');
  let lastError = 'VK API error';
  for (const host of ['https://api.vk.ru','https://api.vk.com']) {
    try {
      const query = new URLSearchParams({ ...params, access_token: token, v: API_V });
      const res = await fetch(`${host}/method/${method}?${query.toString()}`, { credentials: 'omit' });
      const json = await res.json();
      if (json?.response !== undefined) return json.response;
      lastError = json?.error?.error_msg || lastError;
    } catch (e) { lastError = e?.message || lastError; }
  }
  throw new Error(lastError);
}

// ==========================================
// LongPoll Logic
// ==========================================
let lpAbortController = null;
let lpRunning = false;

async function startLongPollIfAuthorized() {
  const token = await getToken();
  if (!token) { console.log('[VKE BG] LongPoll: нет токена'); return; }
  startLongPoll();
}

function stopLongPoll() {
  lpRunning = false;
  if (lpAbortController) { lpAbortController.abort(); lpAbortController = null; }
}

async function startLongPoll() {
  if (lpRunning) return;
  lpRunning = true;
  console.log('[VKE BG] LongPoll: старт');
  let server, key, ts;
  try {
    const lpInfo = await callVkApi('messages.getLongPollServer', { need_pts: 0, lp_version: LP_VERSION });
    server = lpInfo.server; key = lpInfo.key; ts = lpInfo.ts;
  } catch (e) {
    console.error('[VKE BG] LongPoll: ошибка сервера', e);
    lpRunning = false;
    setTimeout(startLongPollIfAuthorized, 10000);
    return;
  }
  lpLoop(server, key, ts);
}

async function lpLoop(server, key, ts) {
  while (lpRunning) {
    lpAbortController = new AbortController();
    try {
      const url = `https://${server}?act=a_check&key=${key}&ts=${ts}&wait=25&mode=234&version=${LP_VERSION}`;
      const res = await fetch(url, { signal: lpAbortController.signal });
      const data = await res.json();
      if (data.failed) {
        if (data.failed === 1 && data.ts) { ts = data.ts; continue; }
        console.warn('[VKE BG] LongPoll: failed=', data.failed);
        const lpInfo = await callVkApi('messages.getLongPollServer', { need_pts: 0, lp_version: LP_VERSION });
        server = lpInfo.server; key = lpInfo.key; ts = lpInfo.ts;
        continue;
      }
      ts = data.ts;
      if (Array.isArray(data.updates) && data.updates.length) processLongPollUpdates(data.updates);
    } catch (e) {
      if (e.name === 'AbortError') break;
      console.error('[VKE BG] LongPoll: ошибка', e);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  console.log('[VKE BG] LongPoll: остановлен');
}

// ВАЖНО: Функция для преобразования message_id (из LongPoll) в cmid (для UI)
async function resolveCmid(peerId, messageId) {
  if (peerId == null || messageId == null) return messageId;
  // Modern API has a direct conversation-message lookup. Prefer it because
  // message_id can be ambiguous once the message is deleted.
  try {
    const resp = await callVkApi('messages.getById', {
      message_ids: String(messageId),
      peer_id: peerId,
      extended: 0
    });
    const item = resp?.items?.[0];
    if (item) return item.conversation_message_id ?? item.cmid ?? item.id;
  } catch (_) {}

  return messageId;
}

async function getMessageByCmid(peerId, cmid) {
  if (peerId == null || cmid == null) return null;
  try {
    const resp = await callVkApi('messages.getByConversationMessageId', {
      peer_id: peerId,
      conversation_message_ids: String(cmid),
      extended: 0
    });
    return resp?.items?.[0] || null;
  } catch (e) {
    console.warn('[VKE BG] getByConversationMessageId failed:', peerId, cmid, e?.message || e);
    return null;
  }
}
const FLAG_DELETED = 128; 

function processLongPollUpdates(updates) {
  for (const u of updates) {
    if (!Array.isArray(u) || !u.length) continue;
    const code = Number(u[0]);
    try { globalThis.VkeBackgroundNotify?.onLongPollEvent?.(u); } catch (_) {}

    // Modern User Long Poll (v21):
    // 10004 new message, 10005 edited message, 10002 set flags,
    // 10003 reset flags/restore, 10018 message update.
    if (code === 10004) {
      const cmid = u[1];
      const flags = Number(u[2]) || 0;
      const minorId = u[3];
      const peerId = u[4];
      const ts = u[5];
      const text = u[6] || '';
      const extra = u[7] || {};
      handleNewMessageModern({ cmid, minorId, flags, peerId, ts, text, extra });
      continue;
    }

    if (code === 10005) {
      const cmid = u[1];
      const flags = Number(u[2]) || 0;
      const peerId = u[3];
      const ts = u[4];
      const text = u[5] || '';
      handleEditedCmid(peerId, cmid, text, ts);
      continue;
    }

    if (code === 10002) {
      const cmid = u[1];
      const flags = Number(u[2]) || 0;
      const peerId = u[3];
      // 10002 is generic set-flags: only 128/131072 mean deletion.
      if ((flags & (128 | 131072)) !== 0) handleDeletedCmid(peerId, cmid);
      continue;
    }

    if (code === 10003) {
      const cmid = u[1];
      const flags = Number(u[2]) || 0;
      const peerId = u[3];
      if ((flags & 128) !== 0) handleRestoredCmid(peerId, cmid);
      continue;
    }

    if (code === 10018) {
      const cmid = u[1];
      const peerId = u[3];
      const ts = u[4];
      const text = u[5] || '';
      if (peerId != null && cmid != null) handleEditedCmid(peerId, cmid, text, ts);
      continue;
    }

    // Legacy Long Poll compatibility.
    if (code === 4) {
      const [, msgId, flags, peerId, ts, text, extra] = u;
      handleNewMessage({ msgId, flags, peerId, ts, text, extra: extra || {} });
    } else if (code === 2) {
      const [, msgId, flags, peerId] = u;
      if ((Number(flags) & (128 | 131072)) !== 0) handleDeleted(peerId, msgId);
    } else if (code === 3) {
      const [, msgId, , peerId] = u;
      handleRestored(peerId, msgId);
    } else if (code === 5) {
      const [, msgId, , peerId, ts, text] = u;
      handleEdited(peerId, msgId, text, ts);
    }
  }
}
function cacheKey(peerId, cmid) { return `${CACHE_PREFIX}${peerId}_${cmid}`; }

async function getCachedMessage(peerId, cmid) {
  const key = cacheKey(peerId, cmid);
  const res = await chrome.storage.local.get([key]);
  return res[key] || null;
}

async function setCachedMessage(peerId, cmid, data) {
  const key = cacheKey(peerId, cmid);
  const existing = await getCachedMessage(peerId, cmid);

  // Deletion state is persistent metadata. A later history sync/new-message
  // update must NOT reset is_deleted=true just because the normal message
  // object contains is_deleted:false. The only operation allowed to clear the
  // persistent flag is an explicit restoration event.
  const clearDeleted = data && data.__clearDeleted === true;
  const incoming = { ...(data || {}) };
  delete incoming.__clearDeleted;

  if (!clearDeleted && existing?.is_deleted === true && incoming.is_deleted === false) {
    delete incoming.is_deleted;
  }

  const merged = {
    ...existing,
    ...incoming,
    cmid: String(cmid),
    peer_id: peerId
  };

  await chrome.storage.local.set({ [key]: merged });
  return merged;
}

async function getCachedChat(peerId) {
  const all = await chrome.storage.local.get(null);
  const prefix = `${CACHE_PREFIX}${peerId}_`;
  const result = {};
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(prefix) || !value || typeof value !== 'object') continue;
    const cmid = String(value.cmid ?? key.slice(prefix.length));
    result[cmid] = { ...value, cmid };
  }
  return result;
}

async function persistMessageObject(peerId, cmid, item, versions) {
  if (!peerId || cmid == null) return null;
  const currentText = item?.text ?? '';
  const currentDate = item?.date ?? Math.floor(Date.now() / 1000);
  const existing = await getCachedMessage(peerId, cmid);
  const nextVersions = versions || existing?.versions || [{ text: currentText, date: currentDate }];
  return setCachedMessage(peerId, cmid, {
    id: item?.id ?? existing?.id,
    peer_id: peerId,
    text: currentText,
    date: currentDate,
    attachments: item?.attachments ?? existing?.attachments ?? null,
    is_bomb: !!(item?.expire_ttl || item?.ttl || existing?.is_bomb),
    is_deleted: false,
    versions: nextVersions
  });
}

async function handleNewMessageModern({ cmid, minorId, flags, peerId, ts, text, extra }) {
  const settings = (await chrome.storage.local.get(['vkeSettings'])).vkeSettings || {};
  if (settings.cacheHistory === false && settings.bombs === false && settings.deletedMessages === false) return;
  if (peerId == null || cmid == null) return;

  const existing = await getCachedMessage(peerId, cmid);
  const isBomb = !!(extra?.expire_ttl || extra?.ttl || existing?.is_bomb);
  const versions = existing?.versions?.length ? existing.versions : [{ text: text || '', date: ts }];
  await setCachedMessage(peerId, cmid, {
    id: minorId ?? existing?.id,
    peer_id: peerId,
    text: text || '',
    date: ts || Math.floor(Date.now() / 1000),
    is_bomb: isBomb,
    is_deleted: false,
    versions
  });
  if ((Number(flags) & 2) === 0) {
    try {
      await globalThis.VkeBackgroundNotify?.emitBackgroundPopup?.({
        type:'newMsg', title:'Новое сообщение', text:String(text || '').replace(/\s+/g, ' ').trim(), peerId, duration:6000
      });
    } catch (_) {}
  }
  notifyContentScripts(peerId, { type: 'VKE_MSG_CACHED', peerId, cmid: String(cmid) });
}

async function handleNewMessage({ msgId, flags, peerId, ts, text, extra }) {
  const settings = (await chrome.storage.local.get(['vkeSettings'])).vkeSettings || {};
  if (settings.cacheHistory === false && settings.bombs === false && settings.deletedMessages === false) return;
  const cmid = await resolveCmid(peerId, msgId);
  const existing = await getCachedMessage(peerId, cmid);
  const versions = existing?.versions?.length ? existing.versions : [{ text: text || '', date: ts }];
  await setCachedMessage(peerId, cmid, {
    id: msgId,
    peer_id: peerId,
    text: text || '',
    date: ts,
    is_bomb: !!(extra?.expire_ttl || extra?.ttl),
    is_deleted: false,
    versions
  });
  if ((Number(flags) & 2) === 0) {
    try {
      await globalThis.VkeBackgroundNotify?.emitBackgroundPopup?.({
        type:'newMsg', title:'Новое сообщение', text:String(text || '').replace(/\s+/g, ' ').trim(), peerId, duration:6000
      });
    } catch (_) {}
  }
  notifyContentScripts(peerId, { type: 'VKE_MSG_CACHED', peerId, cmid: String(cmid) });
}

async function recordMessageText(peerId, cmid, text, date) {
  if (!peerId || cmid == null || text == null) return null;
  const incomingText = String(text);
  const existing = await getCachedMessage(peerId, cmid);
  const ts = Number(date) || Math.floor(Date.now() / 1000);

  if (!existing) {
    return setCachedMessage(peerId, cmid, {
      peer_id: peerId,
      cmid: String(cmid),
      text: incomingText,
      date: ts,
      versions: [{ text: incomingText, date: ts }]
    });
  }

  const versions = Array.isArray(existing.versions) ? [...existing.versions] : [];
  const current = existing.text == null ? '' : String(existing.text);
  if (!versions.length) versions.push({ text: current, date: Number(existing.date) || ts });

  const last = versions[versions.length - 1]?.text == null
    ? current : String(versions[versions.length - 1].text);

  if (last !== incomingText) {
    versions.push({ text: incomingText, date: ts });
    await setCachedMessage(peerId, cmid, { text: incomingText, versions, lastEditedAt: ts });
  }
  return getCachedMessage(peerId, cmid);
}

async function handleEditedCmid(peerId, cmid, newText, ts) {
  const settings = (await chrome.storage.local.get(['vkeSettings'])).vkeSettings || {};
  if (settings.editHistory === false || !peerId || cmid == null) return;

  const existing = await getCachedMessage(peerId, cmid);
  let versions = existing?.versions ? [...existing.versions] : [];
  const nowTs = ts || Math.floor(Date.now() / 1000);
  const currentBeforeEdit = existing?.text ?? '';

  // Always keep the pre-edit text as the first version. Older builds could
  // create only the new version here, which made the History button appear
  // but show an empty history.
  if (!versions.length) {
    versions = [{ text: currentBeforeEdit, date: existing?.date || nowTs }];
  }

  const lastText = versions[versions.length - 1]?.text ?? currentBeforeEdit;
  if (lastText !== newText) {
    versions.push({ text: newText || '', date: nowTs });
  } else if (currentBeforeEdit && currentBeforeEdit !== newText &&
             !versions.some(v => String(v?.text ?? '') === String(currentBeforeEdit))) {
    versions.splice(Math.max(versions.length - 1, 0), 0, {
      text: currentBeforeEdit,
      date: Number(existing?.date) || nowTs
    });
  }

  await setCachedMessage(peerId, cmid, {
    peer_id: peerId,
    cmid: String(cmid),
    text: newText || '',
    versions,
    lastEditedAt: nowTs
  });
  console.log('[VKE BG] ✏️ Правка:', peerId, 'cmid:', cmid, 'versions:', versions.length);
  notifyContentScripts(peerId, {
    type: 'VKE_MESSAGE_EDITED',
    peer_id: peerId,
    cmid: String(cmid),
    text: newText || '',
    versionsCount: versions.length
  });
}

async function handleDeletedCmid(peerId, cmid) {
  const settings = (await chrome.storage.local.get(['vkeSettings'])).vkeSettings || {};
  if (settings.deletedMessages === false || !peerId || cmid == null) return;

  let existing = await getCachedMessage(peerId, cmid);

  // A delete event may arrive before our cache saw the original 10004. Fetch
  // the message by conversation_message_id while the server still exposes its
  // content/deleted metadata. This is the important persistence path.
  if (!existing || (!existing.text && !existing.attachments)) {
    const item = await getMessageByCmid(peerId, cmid);
    if (item) {
      existing = await setCachedMessage(peerId, cmid, {
        id: item.id,
        peer_id: peerId,
        text: item.text || '',
        date: item.date || Math.floor(Date.now() / 1000),
        attachments: item.attachments || null,
        is_bomb: !!item.expire_ttl,
        is_deleted: false,
        versions: existing?.versions?.length ? existing.versions : [{ text: item.text || '', date: item.date }]
      });
    }
  }

  const updated = await setCachedMessage(peerId, cmid, {
    is_deleted: true,
    deletedAt: Date.now()
  });

  console.log('[VKE BG] 🗑 Помечено удалённым:', peerId, 'cmid:', cmid, 'cached:', !!updated?.text || !!updated?.attachments);
  notifyContentScripts(peerId, {
    type: 'VKE_MESSAGE_DELETED',
    peer_id: peerId,
    cmid: String(cmid),
    text: updated.text || '',
    is_bomb: !!updated.is_bomb
  });
}
async function handleRestoredCmid(peerId, cmid) {
  if (!peerId || cmid == null) return;
  const existing = await getCachedMessage(peerId, cmid);
  if (existing?.is_deleted) {
    await setCachedMessage(peerId, cmid, { is_deleted: false, __clearDeleted: true });
    notifyContentScripts(peerId, { type: 'VKE_MESSAGE_RESTORED', peer_id: peerId, cmid: String(cmid) });
  }
}

async function handleDeleted(peerId, msgId) {
  const settings = (await chrome.storage.local.get(['vkeSettings'])).vkeSettings || {};
  if (settings.deletedMessages === false) return;

  // 1. Получаем настоящий cmid
  const cmid = await resolveCmid(peerId, msgId);
  const existing = await getCachedMessage(peerId, cmid);
  
  const updated = await setCachedMessage(peerId, cmid, {
    is_deleted: true,
    deletedAt: Date.now()
  });
  
  console.log('[VKE BG] 🗑 Помечено удалённым:', peerId, 'cmid:', cmid);
  notifyContentScripts(peerId, { 
      type: 'VKE_MESSAGE_DELETED', 
      peer_id: peerId, 
      cmid: cmid, // Отправляем ПРАВИЛЬНЫЙ cmid
      text: updated.text || '', 
      is_bomb: !!updated.is_bomb 
  });
}

async function handleRestored(peerId, msgId) {
  const cmid = await resolveCmid(peerId, msgId);
  const existing = await getCachedMessage(peerId, cmid);
  if (existing && existing.is_deleted) {
    await setCachedMessage(peerId, cmid, { is_deleted: false, __clearDeleted: true });
    notifyContentScripts(peerId, { type: 'VKE_MESSAGE_RESTORED', peer_id: peerId, cmid: cmid });
  }
}

async function handleEdited(peerId, msgId, newText, ts) {
  const cmid = await resolveCmid(peerId, msgId);
  return handleEditedCmid(peerId, cmid, newText, ts);
}

function notifyContentScripts(peerId, message) {
  chrome.tabs.query({ url: ['https://vk.com/*', 'https://vk.ru/*', 'https://*.vk.com/*', 'https://*.vk.ru/*'] }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  });
}

async function cacheHistoryAll(peerId, startOffset = 0) {
  const settings = (await chrome.storage.local.get(['vkeSettings'])).vkeSettings || {};
  if (settings.cacheHistory === false) return { cached: 0, more: false, nextOffset: startOffset, totalCount: 0, pages: 0 };
  let offset = Math.max(0, Number(startOffset) || 0);
  let cached = 0;
  let pages = 0;
  let totalCount = 0;
  const MAX_PAGES = 200;
  while (pages < MAX_PAGES) {
    const page = await cacheHistoryPage(peerId, offset);
    const n = Number(page?.cached) || 0;
    cached += n;
    totalCount = Number(page?.totalCount) || totalCount;
    pages++;
    const next = Number(page?.nextOffset);
    if (!page?.more || n === 0 || !Number.isFinite(next) || next <= offset) break;
    offset = next;
  }
  return { cached, more: false, nextOffset: offset, totalCount, pages };
}

async function cacheHistoryPage(peerId, offset) {
  const settings = (await chrome.storage.local.get(['vkeSettings'])).vkeSettings || {};
  if (settings.cacheHistory === false) return { cached: 0, more: false };

  const resp = await callVkApi('messages.getHistory', { peer_id: peerId, count: 200, offset, extended: 0 });
  const items = Array.isArray(resp?.items) ? resp.items : [];

  for (const item of items) {
    const itemCmid = item.conversation_message_id ?? item.id;
    const fetchedText = item.text || '';
    const existing = await getCachedMessage(peerId, itemCmid);
    let versions = Array.isArray(existing?.versions) ? [...existing.versions] : [];

    if (!versions.length) {
      versions = [{ text: fetchedText, date: item.date }];
    } else {
      const lastText = String(versions[versions.length - 1]?.text ?? '');
      if (lastText !== fetchedText && String(existing?.text ?? '') !== fetchedText) {
        versions.push({ text: fetchedText, date: item.date });
      }
    }

    await setCachedMessage(peerId, itemCmid, {
      id: item.id,
      conversation_message_id: itemCmid,
      peer_id: item.peer_id ?? peerId,
      from_id: item.from_id ?? null,
      date: item.date ?? 0,
      text: fetchedText,
      attachments: item.attachments || [],
      fwd_messages: item.fwd_messages || [],
      reply_message: item.reply_message || null,
      random_id: item.random_id ?? null,
      is_bomb: !!(item.expire_ttl),
      is_deleted: existing?.is_deleted === true,
      versions
    });
  }

  return {
    cached: items.length,
    more: items.length === 200 && (offset + items.length < (resp?.count || 0)),
    nextOffset: offset + items.length,
    totalCount: resp?.count || 0
  };
}

console.log('[VKE BG] ✅ Initialized');
chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{ if(msg?.type==='VKE_MUSIC_DOWNLOAD' && msg.url){ chrome.downloads.download({url:msg.url,filename:msg.filename||'VK Music.mp3',saveAs:false,conflictAction:'uniquify'},id=>{sendResponse({ok:!!id,id,error:chrome.runtime.lastError?.message||null});}); return true; }});

// CLP lyrics network fallback: direct request first, then proxy.
(() => {
  const DIRECT_TIMEOUT = 9000;
  const PROXY_TIMEOUT = 7000;
  const HEADERS = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
  };
  const timeoutFetch = (url, opts = {}, timeout = DIRECT_TIMEOUT) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    return fetch(url, {...opts, signal: controller.signal}).finally(() => clearTimeout(timer));
  };
  const proxies = url => {
    const q = encodeURIComponent(url);
    return [
      {url:`https://api.allorigins.win/raw?url=${q}`, json:false},
      {url:`https://api.codetabs.com/v1/proxy?quest=${q}`, json:false},
      {url:`https://api.allorigins.win/get?url=${q}`, json:true}
    ];
  };
  async function fetchHTML(url){
    try {
      const r = await timeoutFetch(url,{headers:HEADERS,redirect:'follow'},DIRECT_TIMEOUT);
      if(r.ok){const text=await r.text();if(text)return text;}
    } catch(e) {}
    let last = null;
    for(const proxy of proxies(url)){
      try{
        const r=await timeoutFetch(proxy.url,{headers:HEADERS,redirect:'follow'},PROXY_TIMEOUT);
        if(!r.ok){last=new Error('proxy HTTP '+r.status);continue;}
        const body=proxy.json?(await r.json()):await r.text();
        const text=proxy.json?(body?.contents ?? body?.body ?? ''):body;
        if(text)return text;
        last=new Error('proxy empty body');
      }catch(e){last=e;}
    }
    throw last || new Error('Все попытки запроса провалились: '+url);
  }
  chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
    if(msg?.type!=='CLP_FETCH_HTML') return;
    fetchHTML(msg.url).then(html=>sendResponse({html})).catch(e=>sendResponse({error:String(e?.message||e)}));
    return true;
  });
})();
