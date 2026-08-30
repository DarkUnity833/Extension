// VKE media UI — unified download button + quality menu for video/clip/story.
(() => {
  'use strict';
  if (window.__vkeMediaUIV5) return;
  window.__vkeMediaUIV5 = true;

  const ICON = '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M14 18c-.3 0-.6-.1-.8-.3l-5-5a1.05 1.05 0 0 1 1.5-1.5l3.2 3.2V6a1.1 1.1 0 0 1 2.2 0v8.4l3.2-3.2a1.05 1.05 0 0 1 1.5 1.5l-5 5c-.2.2-.5.3-.8.3Z"></path><path d="M22 22H6a1 1 0 1 1 0-2h16a1 1 0 1 1 0 2Z"></path></svg>';
  const SPIN = '<span class="vke-media-spin"></span>';
  const STYLE = `
.vke-media-dl-wrap{border:1px solid rgba(255,255,255,.18)!important;background:rgba(0,0,0,.25)!important;box-shadow:0 1px 8px rgba(0,0,0,.25)!important;border-radius:50%!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;flex:0 0 auto!important;margin:0 0 0 4px!important;z-index:2147483000!important;position:relative!important}
.vke-media-dl-btn{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:40px!important;height:40px!important;min-width:40px!important;min-height:40px!important;border:0!important;border-radius:50%!important;background:transparent!important;color:inherit!important;cursor:pointer!important;padding:0!important;box-sizing:border-box!important}
.vke-media-dl-btn:hover{background:rgba(127,127,127,.14)!important}.vke-media-dl-btn svg{transform:translateX(2px)!important}.vke-media-dl-btn[disabled]{pointer-events:none!important;opacity:.78!important}
.vke-media-dl-btn svg{width:26px!important;height:26px!important;fill:currentColor!important;pointer-events:none!important}
.vke-media-spin{width:23px!important;height:23px!important;border:3px solid rgba(127,127,127,.22)!important;border-top-color:currentColor!important;border-radius:50%!important;animation:vke-media-spin .7s linear infinite!important}
.vke-media-ring{width:28px!important;height:28px!important;border-radius:50%!important;display:grid!important;place-items:center!important;background:conic-gradient(currentColor calc(var(--p,0)*1%),rgba(127,127,127,.22) 0)!important;position:relative!important}
.vke-media-ring:after{content:'';position:absolute;inset:3px;border-radius:50%;background:var(--vkui--color_background_content,#fff)!important}.vke-media-ring>span{position:relative;z-index:1;font:700 8px/1 -apple-system,BlinkMacSystemFont,Roboto,sans-serif!important}
.vke-media-quality-menu.vke-visible{display:flex!important}
.vke-media-quality-menu.vke-vkvideo-dark{background:#222222!important;color:#ffffff!important;border-color:rgba(255,255,255,.12)!important;box-shadow:0 10px 34px rgba(0,0,0,.55)!important}
.vke-media-quality-menu.vke-vkvideo-dark .vke-media-quality-title{color:#ffffff!important;opacity:.92!important}
.vke-media-quality-menu.vke-vkvideo-dark .vke-media-quality-item{color:#ffffff!important}
.vke-media-quality-menu.vke-vkvideo-dark .vke-media-quality-sub{color:rgba(255,255,255,.70)!important}
.vke-media-quality-menu.vke-vkvideo-dark .vke-media-quality-item:hover{background:rgba(255,255,255,.10)!important}
.vke-media-quality-menu{display:none!important;position:fixed!important;min-width:154px!important;max-width:240px!important;left:0;top:0;right:auto;bottom:auto;transform:none;pointer-events:auto!important;padding:6px!important;border-radius:12px!important;background:var(--vkui--color_background_modal,#fff)!important;color:var(--vkui--color_text_primary,#000)!important;box-shadow:0 8px 30px rgba(0,0,0,.28)!important;border:1px solid var(--vkui--color_separator_primary_alpha,rgba(0,0,0,.10))!important;z-index:2147483647!important;flex-direction:column!important;gap:2px!important}
.vke-media-quality-menu.vke-visible{display:flex!important}
.vke-media-quality-title{padding:5px 9px 4px;font:600 12px/16px -apple-system,BlinkMacSystemFont,Roboto,sans-serif;color:#fff!important;opacity:.82}.vke-media-quality-menu.vke-vkvideo-dark .vke-media-quality-title{color:#fff!important;opacity:.82}
.vke-media-quality-row{display:flex!important;align-items:center!important;gap:2px!important;width:100%!important}.vke-media-quality-row .vke-media-quality-item{flex:1 1 auto!important}.vke-media-quality-item{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;width:100%!important;border:0!important;background:transparent!important;color:inherit!important;border-radius:8px!important;padding:8px 9px!important;cursor:pointer!important;text-align:left!important;font:500 13px/18px -apple-system,BlinkMacSystemFont,Roboto,sans-serif!important}
.vke-media-quality-item:hover{background:var(--vkui--color_background_secondary_alpha,rgba(0,0,0,.08))!important}.vke-media-quality-item[disabled]{opacity:.55!important;cursor:default!important}
.vke-media-quality-sub{font-size:11px!important;opacity:.55!important}.vke-media-toast{position:fixed!important;left:50%!important;bottom:24px!important;transform:translateX(-50%)!important;z-index:2147483647!important;background:rgba(32,34,37,.96)!important;color:#fff!important;border-radius:10px!important;padding:9px 14px!important;font:13px/18px -apple-system,BlinkMacSystemFont,Roboto,sans-serif!important;box-shadow:0 6px 22px rgba(0,0,0,.28)!important}
@keyframes vke-media-spin{to{transform:rotate(360deg)}}`;
  if (!document.getElementById('vke-media-ui-style')) {
    const s=document.createElement('style'); s.id='vke-media-ui-style'; s.textContent=STYLE; document.head.appendChild(s);
  }

  let seq=0;
  const coreCache = new Map();
  const uiGoodCache = new Map();
  const uiInflight = new Map();
  let globalMenu = null;
  let globalMenuOwner = null;
  let globalMenuCloseTimer = null;

  function toast(text){
    let x=document.querySelector('.vke-media-toast');
    if(!x){x=document.createElement('div');x.className='vke-media-toast';document.body.appendChild(x)}
    x.textContent=text; clearTimeout(x._t); x._t=setTimeout(()=>x.remove(),2600);
  }
  function progress(btn,id,label){
    window.__vkePollDownload?.(id,d=>{
      const p=d.totalBytes>0?d.bytesReceived/d.totalBytes*100:0;
      btn.innerHTML=`<span class="vke-media-ring" style="--p:${p}"><span>${p?Math.round(p)+'%':'…'}</span></span>`;
    },d=>{
      btn.innerHTML=`<span class="vke-media-ring" style="--p:${d.state==='complete'?100:0}"><span>${d.state==='complete'?'✓':'!'}</span></span>`;
      toast(d.state==='complete'?`${label}: готово`:`${label}: ошибка`);
      setTimeout(()=>reset(btn),700);
    });
  }
  function reset(btn){if(!btn)return;btn.disabled=false;btn.innerHTML=ICON;btn._busy=false;}
  async function direct(url,name,btn,label){
    const r=await chrome.runtime.sendMessage({type:'VKE_DIRECT_DOWNLOAD',url,filename:name});
    if(!r?.ok)throw new Error(r?.error||'Не удалось начать скачивание');
    btn.disabled=true; progress(btn,r.downloadId,label);
  }
  function askCore(type, videoId=null){
    try {
      if (window.__vkeMediaCore?.resolveForUI) {
        return Promise.resolve(window.__vkeMediaCore.resolveForUI(type, videoId||null));
      }
    } catch (e) {
      // Fall through to the isolated bridge for compatibility.
    }
    return new Promise((resolve,reject)=>{
      const id=`media_ui_${Date.now()}_${++seq}`;
      const on=e=>{
        if(e.source!==window||e.data?.type!=='VKE_MEDIA_RESOLVE_RESULT'||e.data.requestId!==id)return;
        window.removeEventListener('message',on);clearTimeout(timer);
        e.data.error?reject(new Error(e.data.error)):resolve(e.data.result||null);
      };
      window.addEventListener('message',on);
      window.postMessage({source:'vke-ui',type:'VKE_MEDIA_RESOLVE',requestId:id,scope:type,videoId:videoId||null},'*');
      const timer=setTimeout(()=>{window.removeEventListener('message',on);reject(new Error('Не удалось определить текущее медиа'))},12000);
    });
  }
  function classify(info){if(info?.isStory)return 'story';if(info?.isClip)return 'clip';if(info?.isCircle||info?.type==='video_message')return 'video_message';return 'video'}
  function isSignedMediaUrl(u){
    if(typeof u!=='string'||!/^https?:\/\//i.test(u))return false;
    try{const x=new URL(u);return /(?:vkvd\d*\.okcdn\.ru|okcdn\.ru|vkuser\.net|vk-cdn\.net|userapi\.com)/i.test(x.hostname)&&/^(?:0|1|2|3|4|5)$/.test(String(x.searchParams.get('type')||''))&&x.searchParams.has('id')}catch{return false}
  }
  function qualitiesFor(info,kind){
    let q=[];
    if(kind==='story') q=Array.isArray(info?.story?.qualities)?info.story.qualities:[];
    else q=Array.isArray(info?.video?.qualities)?info?.video?.qualities:[];
    // The exact API/captured qualities are authoritative even for messenger
    // videos. Older builds deliberately discarded them and kept only the live
    // <video> source, which is why messenger showed either one quality or no
    // links at all. Keep the exact live source only as a fallback.
    if(info?.src && ((/^https?:\/\//i.test(info.src)&& (isSignedMediaUrl(info.src)||/\.mp4(?:[?#]|$)/i.test(info.src))) || /^blob:/i.test(info.src)) && !q.some(x=>x?.url===info.src)){
      q.push({url:info.src,q:Number(info.height)||720,key:info?.isMessengerVideo?'messenger_live':'live_src'});
    }
    if(!q.length && Array.isArray(info?.fallback)) q=q.concat(info.fallback);
    return q.map(x=>{
      if(!x||typeof x.url!=='string')return x;
      let qq=Number(x.q)||0;
      if(!qq){try{const t=new URL(x.url,location.href).searchParams.get('type');qq=({'4':144,'0':240,'1':360,'2':480,'3':720,'5':1080}[String(t)]||0)}catch{}}
      return {...x,q:qq};
    }).filter(x=>x&&typeof x.url==='string'&&((/^https?:\/\//i.test(x.url)&&(Number(x.q)>0||isSignedMediaUrl(x.url)))||/^blob:/i.test(x.url)))
      .filter((x,i,a)=>a.findIndex(y=>y.url===x.url)===i)
      .sort((a,b)=>Number(b.q)-Number(a.q));
  }
  function bestFor(info,kind){
    const q=qualitiesFor(info,kind);
    if(kind==='clip') return q.find(x=>Number(x.q)===720)||q.find(x=>Number(x.q)<=720)||q[0]||info?.fallback?.find?.(x=>x.url);
    return q[0]||info?.fallback?.slice?.().sort((a,b)=>(b.q||0)-(a.q||0))[0]||null;
  }
  function fileName(info,kind,q){
    const id=String(info?.id||Date.now()).replace(/-/g,'m');
    return `${kind==='clip'?'vk_clip':kind==='story'?'vk_story':'vk_video'}_${id}_${Number(q)||720}p.mp4`;
  }
  async function resolveCached(kind,force=false,videoId=null){
    const key=`${kind}:${videoId||'auto'}`;
    const now=Date.now();
    const old=coreCache.get(key);
    if(!force && old && now-old.ts<20000 && old.info) return old.info;
    if(uiInflight.has(key)) return uiInflight.get(key);
    const p=(async()=>{
      const info=await askCore(kind,videoId);
      coreCache.set(key,{ts:Date.now(),info});
      if(info?.video?.qualities?.length) uiGoodCache.set(key,{ts:Date.now(),info});
      return info;
    })();
    uiInflight.set(key,p);
    try{return await p}finally{uiInflight.delete(key)}
  }
  function isVkVideoHost(){
    return /(^|\.)vkvideo\.(ru|com)$/i.test(location.hostname);
  }
  function syncVkVideoMenuTheme(menu){
    if(!menu) return;
    const dark=isVkVideoHost();
    menu.classList.toggle('vke-vkvideo-dark', dark);
    if(dark){
      menu.style.setProperty('background-color','#222222','important');
      menu.style.setProperty('color','#ffffff','important');
      menu.style.setProperty('border-color','rgba(255,255,255,.12)','important');
    }else{
      menu.style.removeProperty('background-color');
      menu.style.removeProperty('color');
      menu.style.removeProperty('border-color');
    }
  }
  function getMenu(w){
    if(!globalMenu){
      globalMenu=document.createElement('div');
      globalMenu.className='vke-media-quality-menu';
      globalMenu.addEventListener('pointerdown',e=>e.stopPropagation(),true);
      globalMenu.addEventListener('mouseenter',()=>clearTimeout(globalMenuCloseTimer));
      globalMenu.addEventListener('mouseleave',()=>{
        clearTimeout(globalMenuCloseTimer);
        globalMenuCloseTimer=setTimeout(()=>{
          const owner=globalMenuOwner;
          if(owner&&!owner.matches(':hover')) closeMenu(owner);
        },220);
      });
      (document.documentElement||document.body).appendChild(globalMenu);
    }
    return globalMenu;
  }
  function closeMenu(w){
    if(!globalMenu)return;
    if(w&&globalMenuOwner!==w)return;
    globalMenu.classList.remove('vke-visible');
    globalMenu.style.display='none';
    if(globalMenuOwner)globalMenuOwner.classList.remove('vke-menu-open');
    globalMenuOwner=null;
  }
  function closeAllMenus(except=null){
    if(globalMenu && (!except || globalMenuOwner!==except)){
      globalMenu.classList.remove('vke-visible');
      globalMenu.style.display='none';
      if(globalMenuOwner)globalMenuOwner.classList.remove('vke-menu-open');
      globalMenuOwner=null;
    }
    document.querySelectorAll('.vke-media-dl-wrap.vke-menu-open').forEach(x=>{if(x!==except)x.classList.remove('vke-menu-open')});
  }
  function positionMenu(w,menu){
    if(!w||!menu)return;
    const r=w.querySelector('.vke-media-dl-btn')?.getBoundingClientRect?.()||w.getBoundingClientRect();
    const mw=Math.min(260,Math.max(158,menu.offsetWidth||158));
    let left=r.left+(r.width-mw)/2;
    left=Math.max(8,Math.min(left,innerWidth-mw-8));
    let top=r.top-menu.offsetHeight-8;
    if(top<8) top=r.bottom+8;
    top=Math.max(8,Math.min(top,innerHeight-menu.offsetHeight-8));
    menu.style.position='fixed';
    menu.style.left=Math.round(left)+'px';
    menu.style.top=Math.round(top)+'px';
    menu.style.bottom='auto';
    menu.style.transform='none';
  }
  function buildMenu(w,btn,kind,info,status='') {
    if(kind==='story') return closeMenu(w);
    closeAllMenus(w);
    const menu=getMenu(w);
    globalMenuOwner=w;
    w.classList.add('vke-menu-open');
    menu.className='vke-media-quality-menu vke-visible';
    syncVkVideoMenuTheme(menu);
    menu.style.display='flex';
    menu.innerHTML='';
    syncVkVideoMenuTheme(menu);
    const title=document.createElement('div');title.className='vke-media-quality-title';title.textContent='Качество видео';menu.appendChild(title);
    if(status){
      const x=document.createElement('div');x.className='vke-media-quality-item';x.style.cursor='default';x.textContent=status;menu.appendChild(x);
      requestAnimationFrame(()=>positionMenu(w,menu));
      return;
    }
    if(kind==='clip'){
      const item=document.createElement('button');item.type='button';item.className='vke-media-quality-item';item.textContent='720p';
      item.addEventListener('click',ev=>{ev.preventDefault();ev.stopPropagation();downloadQuality(btn,w,kind,info,720)});
      menu.appendChild(item);
    } else {
      const q=qualitiesFor(info,kind);
      if(!q.length){
        const x=document.createElement('div');x.className='vke-media-quality-item';x.style.cursor='default';x.textContent='Ссылки пока не получены';menu.appendChild(x);
      } else {
        for(const itemData of q){
          const item=document.createElement('button');item.type='button';item.className='vke-media-quality-item';
          const left=document.createElement('span');left.textContent=`${itemData.q}p`;
          const right=document.createElement('span');right.className='vke-media-quality-sub';right.textContent=itemData===q[0]?'максимум':'';
          item.append(left,right); item.title=`Скачать ${itemData.q}p`;
          item.addEventListener('click',ev=>{ev.preventDefault();ev.stopPropagation();downloadQuality(btn,w,kind,info,itemData.q)});
          menu.appendChild(item);
        }
      }
    }
    requestAnimationFrame(()=>positionMenu(w,menu));
  }
  async function downloadQuality(btn,w,kind,info,qWanted){
    if(btn._busy)return; btn._busy=true; btn.disabled=true; btn.innerHTML=SPIN; closeMenu(w);
    try{
      const q=qualitiesFor(info,kind);
      let pick = kind==='clip' ? (q.find(x=>x.q===720)||q.find(x=>x.q<=720)) : (q.find(x=>x.q===qWanted)||q.find(x=>x.q===Math.max(...q.map(x=>x.q))));
      if(!pick)pick=bestFor(info,kind);
      if(!pick?.url)throw new Error('Не удалось получить ссылку на медиа');
      await direct(pick.url,fileName(info,kind,pick.q),btn,kind==='clip'?'Клип':kind==='story'?'История':'Видео');
    }catch(e){toast(e?.message||'Не удалось скачать');reset(btn)}
  }
  async function prepareMenu(){ return; }
  function captureStoryBlob(){
    return new Promise((resolve,reject)=>{
      const id=`ui_story_${Date.now()}_${++seq}`;
      const on=e=>{if(e.source!==window||e.data?.type!=='CLP_CAPTURE_STORY_RESULT'||e.data.clientId!==id)return;window.removeEventListener('message',on);clearTimeout(timer);e.data.error?reject(new Error(e.data.error)):resolve(e.data.blob)};
      window.addEventListener('message',on);
      window.postMessage({type:'CLP_CAPTURE_STORY',clientId:id},'*');
      const timer=setTimeout(()=>{window.removeEventListener('message',on);reject(new Error('Не удалось получить ссылку на медиа'))},45000);
    });
  }
  async function downloadStoryFallback(btn){
    const blob=await captureStoryBlob();
    if(!blob || blob.size<50000) throw new Error('Не удалось получить ссылку на медиа');
    const u=URL.createObjectURL(blob);
    try{
      const a=document.createElement('a'); a.href=u; a.download=`vk_story_${Date.now()}.webm`; document.body.appendChild(a); a.click(); a.remove();
    }finally{setTimeout(()=>URL.revokeObjectURL(u),15000)}
    reset(btn); toast('История: готово');
  }
  function findStoryImageUrl(){
    const roots=[];
    const viewer=document.querySelector('[data-testid=stories_viewer], .StoriesViewer, [class*=StoriesViewer i], [class*=StoryViewer i]');
    if(viewer) roots.push(viewer);
    roots.push(document.body);
    const seen=new Set();
    for(const root of roots){
      if(!root || seen.has(root)) continue;
      seen.add(root);
      const imgs=[...root.querySelectorAll('img')].filter(x=>{const r=x.getBoundingClientRect?.(); return r && r.width>120 && r.height>120 && getComputedStyle(x).visibility!=='hidden' && getComputedStyle(x).display!=='none';});
      imgs.sort((a,b)=>{const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect(); return br.width*br.height-ar.width*ar.height;});
      for(const img of imgs){
        const u=img.currentSrc||img.src||img.getAttribute('src')||'';
        if(/^data:image\//i.test(u)||/^https?:\/\//i.test(u)) return u;
      }
      for(const el of root.querySelectorAll('*')){
        const bg=getComputedStyle(el).backgroundImage||'';
        const m=bg.match(/url\([\"']?(data:image\/[^\"')]+|https?:\/\/[^\"')]+)[\"']?\)/i);
        if(m) return m[1];
      }
    }
    const cache=window.__vkeStoryImageCache;
    if(Array.isArray(cache)&&cache.length){
      for(let i=cache.length-1;i>=0;i--){ if(/^data:image\//i.test(cache[i])||/^https?:\/\//i.test(cache[i])) return cache[i]; }
    }
    return null;
  }

  function findDomMediaUrl(kind,w){
    const exact = w?._targetVideo;
    if(exact && document.contains(exact)){
      const u=exact.currentSrc||exact.src||exact.querySelector?.('source')?.src||'';
      if(/^https?:\/\//i.test(u)||/^blob:/i.test(u)) return u;
    }
    const roots=[];
    if(w){
      const local = w.closest('.AttachVideoMessage, .AttachVideoMessage__preview, .ConvoMessage, .ConvoMessageWithoutBubble, [data-testid*=video-message i]');
      if(local) roots.push(local);
      if(w.parentElement) roots.push(w.parentElement);
    }
    if(kind==='story'){
      const storyVideo=document.querySelector('video.videoStoriesViewerPlayer');
      if(storyVideo){
        const u=storyVideo.currentSrc||storyVideo.src||storyVideo.querySelector?.('source')?.src||'';
        if(/^https?:\/\//i.test(u)||/^blob:/i.test(u)) return u;
      }
      const viewer=document.querySelector('[data-testid=stories_viewer], .StoriesViewer, [class*=StoriesViewer]')||document.body;
      roots.unshift(viewer);
    }
    const seen=new Set();
    for(const root of roots){
      if(!root||seen.has(root))continue; seen.add(root);
      const vids=[...root.querySelectorAll('video')];
      vids.sort((a,b)=>{
        const ap=a.paused?0:1, bp=b.paused?0:1;
        if(ap!==bp)return bp-ap;
        const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();
        return (br.width*br.height)-(ar.width*ar.height);
      });
      for(const v of vids){
        const u=v.currentSrc||v.src||v.querySelector?.('source')?.src||'';
        if(/^https?:\/\//i.test(u)){
          try{
            const x=new URL(u,location.href);
            const exp=x.searchParams.get('expires')||x.searchParams.get('expire');
            if(exp && Number.isFinite(Number(exp))){
              const n=Number(exp); if(Date.now()>(n>1e12?n:n*1000)) continue;
            }
          }catch{}
          return u;
        }
        if(/^blob:/i.test(u)) return u;
      }
    }
    return null;
  }

  async function fetchBlobViaBridge(url, timeout=20000){
    return new Promise((resolve,reject)=>{
      const id=`vke_blob_${Date.now()}_${++seq}`;
      const timer=setTimeout(()=>{window.removeEventListener('message',on);reject(new Error('Не удалось получить media blob'))},timeout);
      const on=e=>{
        if(e.source!==window||e.data?.type!=='CLP_FETCH_BLOB_RESULT'||e.data.requestId!==id)return;
        clearTimeout(timer);window.removeEventListener('message',on);
        e.data.error?reject(new Error(e.data.error)):resolve(e.data.blob||null);
      };
      window.addEventListener('message',on);
      window.postMessage({type:'CLP_FETCH_BLOB_REQUEST',requestId:id,url},'*');
    });
  }
  async function domMediaToBlob(url){
    if(/^blob:/i.test(url)) return fetchBlobViaBridge(url);
    const res=await fetch(url,{credentials:'include',cache:'no-store'});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob=await res.blob();
    if(!blob||blob.size<1024) throw new Error('Файл пустой');
    return blob;
  }
  function saveLocalBlob(blob,name,btn,label){
    const u=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(u),15000);reset(btn);toast(`${label}: готово`);return true;
  }
  async function downloadDomMedia(btn,kind,w){
    if(kind==='story'){
      const img=findStoryImageUrl();
      if(img){
        const ext=/data:image\/png/i.test(img)||/\.png(?:[?#]|$)/i.test(img)?'png':/\.webp(?:[?#]|$)/i.test(img)?'webp':'jpg';
        const name=`vk_story_${Date.now()}.${ext}`;
        try{
          if(/^data:image\//i.test(img)){
            const b=await fetch(img).then(r=>r.blob());
            return saveLocalBlob(b,name,btn,'История');
          }
          try{
            const b=await fetchBlobViaBridge(img);
            if(b?.size>1000) return saveLocalBlob(b,name,btn,'История');
          }catch{}
          await direct(img,name,btn,'История');
          return true;
        }catch{}
      }
      const videoStory=findDomMediaUrl('story',w);
      if(!videoStory) return false;
      const url=videoStory;
      const name=`vk_story_${Date.now()}.mp4`;
      try{
        if(/^blob:/i.test(url)){
          const blob=await fetchBlobViaBridge(url);
          if(blob?.size>100000) return saveLocalBlob(blob,name,btn,'История');
        } else if(/^https?:\/\//i.test(url)){
          try{return await direct(url,name,btn,'История').then(()=>true)}catch{}
          const blob=await fetchBlobViaBridge(url);
          if(blob?.size>100000)return saveLocalBlob(blob,name,btn,'История');
        }
      }catch{}
      return false;
    }
    const url=findDomMediaUrl(kind,w);
    if(!url)return false;
    const name=`vk_circle_${Date.now()}.mp4`;
    try{
      if(/^blob:/i.test(url)){
        const blob=await fetchBlobViaBridge(url);
        if(blob?.size>100000)return saveLocalBlob(blob,name,btn,kind==='story'?'История':'Кружок');
        throw new Error('Media blob пустой');
      }
      // DOM already contains VK's signed playable URL. Use it directly first.
      if(/^https?:\/\//i.test(url)){
        try{return await direct(url,name,btn,kind==='story'?'История':'Кружок').then(()=>true)}catch(downloadErr){
          // Browser download manager may reject some CDN streams; page fetch is a fallback.
          const blob=await domMediaToBlob(url);
          return saveLocalBlob(blob,name,btn,kind==='story'?'История':'Кружок');
        }
      }
    }catch(e){
      if(/^blob:/i.test(url)) throw e;
    }
    return false;
  }

  async function directClick(btn,kind,w){
    if(btn._busy)return;
    btn._busy=true; btn.disabled=true; btn.innerHTML=SPIN;
    try{
      if(kind==='story'){
        // Story download is API-authoritative. Never choose an arbitrary image
        // from document.body or the cache: VK preloads neighbour stories.
        const info=await resolveCached('story',true);
        const story=info?.story||{};
        const storyType=String(story?.type||'').toLowerCase();
        if(storyType==='photo' && info?.storyPhoto?.url){
          const u=info.storyPhoto.url;
          const ext=/\.png(?:[?#]|$)/i.test(u)?'png':/\.webp(?:[?#]|$)/i.test(u)?'webp':'jpg';
          await direct(u,`vk_story_${info.id||Date.now()}.${ext}`,btn,'История');
          return;
        }
        if(storyType==='video'){
          const q=qualitiesFor(info,'story');
          const pick=q[0]||null;
          if(pick?.url){
            await direct(pick.url,`vk_story_${info.id||Date.now()}_${Number(pick.q)||720}p.mp4`,btn,'История');
            return;
          }
        }
        // Last resort: exact current story player only, never neighbour cache.
        const exact=findDomMediaUrl('story',w);
        if(exact){
          if(/^https?:\/\//i.test(exact)&&!/getVideoPreview|\/preview(?:[/?]|$)|\/recoding\//i.test(exact)){
            await direct(exact,`vk_story_${Date.now()}.mp4`,btn,'История'); return;
          }
          if(/^blob:/i.test(exact)){
            const blob=await fetchBlobViaBridge(exact);
            if(blob?.size>100000)return saveLocalBlob(blob,`vk_story_${Date.now()}.webm`,btn,'История');
          }
        }
        await downloadStoryFallback(btn);
        return;
      }

      // For clips/videos use the exact active media resolver. It never scans
      // unrelated messenger circles and is shared by vk.ru and vkvideo.ru.
      const info=await resolveCached(kind,true);
      const pick=bestFor(info,kind);
      if(!pick?.url) throw new Error('Не удалось получить ссылку на медиа');
      const label=kind==='clip'?'Клип':'Видео';
      const name=fileName(info,kind,pick.q);
      if(/^blob:/i.test(pick.url)){
        const blob=await fetchBlobViaBridge(pick.url);
        if(!blob||blob.size<10000) throw new Error('Видео-поток пустой');
        saveLocalBlob(blob,name,/video\//i.test(blob.type)?blob.type:'video/mp4',btn,label);
        return;
      }
      await direct(pick.url,name,btn,label);
    }catch(e){
      toast(e?.message||'Не удалось скачать');
      reset(btn);
    }
  }
  function findExactHoverVideo(w){
    if(w?._targetVideo&&document.contains(w._targetVideo)) return w._targetVideo;
    const roots=[];
    const local=w?.closest?.('.VideoView,.VideoViewer,.video-viewer,[role=dialog],[data-testid*=video_modal i],[data-testid*=video_page i]');
    if(local) roots.push(local);
    if(w?.parentElement) roots.push(w.parentElement);
    const pick=(root)=>{
      const vids=[...root.querySelectorAll('video')].filter(v=>{
        if(v.closest('.AttachVideoMessage,[data-testid*=video-message i],[class*=AttachVideoMessage i]')) return false;
        const r=v.getBoundingClientRect?.();
        return r&&r.width>120&&r.height>80&&getComputedStyle(v).display!=='none'&&getComputedStyle(v).visibility!=='hidden';
      });
      vids.sort((a,b)=>{
        const ap=!a.paused?1:0,bp=!b.paused?1:0;if(ap!==bp)return bp-ap;
        const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();
        return br.width*br.height-ar.width*ar.height;
      });
      return vids[0]||null;
    };
    for(const root of roots){const v=pick(root);if(v)return v;}
    // Modern VK may render the actual player as a standalone player-media
    // element with a blob: source. Search globally, but explicitly exclude
    // circles/video-message elements so they can never become the target.
    const all=[...document.querySelectorAll('video.player-media,video[class*="player-media" i],video')].filter(v=>{
      if(v.closest('.AttachVideoMessage,[data-testid*=video-message i],[class*=AttachVideoMessage i]')) return false;
      const r=v.getBoundingClientRect?.();
      return r&&r.width>180&&r.height>120&&getComputedStyle(v).display!=='none'&&getComputedStyle(v).visibility!=='hidden';
    });
    all.sort((a,b)=>{
      const ap=!a.paused&&!a.ended?1:0,bp=!b.paused&&!b.ended?1:0;if(ap!==bp)return bp-ap;
      const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();
      const aa=ar.width*ar.height,ba=br.width*br.height;if(aa!==ba)return ba-aa;
      return (b.matches('video.player-media,video[class*="player-media" i]')?1:0)-(a.matches('video.player-media,video[class*="player-media" i]')?1:0);
    });
    return all[0]||null;
  }
  function findVideoIdForButton(w){
    if(!w) return null;
    const roots=[];
    const add=r=>{if(r&&!roots.includes(r))roots.push(r)};
    add(w.closest?.('[data-testid*=video_modal i],[data-testid*=video_page i],[role=dialog],.VideoView,.VideoViewer,.video-viewer'));
    add(w.parentElement);
    if(w._targetVideo) add(w._targetVideo.closest?.('[data-testid*=video_modal i],[data-testid*=video_page i],[role=dialog],.VideoView,.VideoViewer,.video-viewer'));
    const attrs=['data-video-id','data-vk-video-id','data-full-id','data-id','data-video-url','href','src'];
    const extract=value=>{
      if(!value) return null;
      let s=''; try{s=decodeURIComponent(String(value))}catch{s=String(value)}
      let m=s.match(/(?:^|[/?#&])(?:video|clip)s?(-?\d+)_(\d+)(?:$|[/?#&])/i);
      if(m) return `${m[1]}_${m[2]}`;
      m=s.match(/(?:^|[/?#&])video(-?\d+)_(\d+)/i);
      if(m) return `${m[1]}_${m[2]}`;
      return null;
    };
    for(const root of roots){
      if(!root) continue;
      const nodes=[root,...(root.querySelectorAll?.('[data-video-id],[data-vk-video-id],[data-full-id],[data-id],[data-video-url],a[href],video[src],video[data-src]')||[])];
      for(const el of nodes){
        for(const a of attrs){
          const v=extract(el.getAttribute?.(a));
          if(v) return v;
        }
      }
    }
    const route=extract(location.href); if(route) return route;
    return null;
  }
  function showResolvedUrls(w,info){ return; }

  function make(kind,title,targetVideo=null){
    const w=document.createElement('div');w.className='vke-media-dl-wrap';w.dataset.vkeMediaDownload=kind;w.dataset.vkeMenuOwner=`vke_menu_${Date.now()}_${++seq}`;
    const b=document.createElement('button');b.type='button';b.className='vke-media-dl-btn';b.removeAttribute('title');b.setAttribute('aria-label',title);b.title=kind==='video'?'Наведите для поиска ссылок и качества видео':title;b.innerHTML=ICON;
    w._targetVideo=targetVideo||null;
    w.append(b);
    // Video keeps the quality selector on hover. Circles/stories stay one-click.
    if(kind==='video') {
      const openAndResolve=()=>{
        if(w._busy)return;
        clearTimeout(w._closeTimer);
        const exactId=findVideoIdForButton(w);
        w.dataset.vkeVideoId=exactId||'';
        const key=`video:${exactId||'auto'}`;
        const good=exactId?uiGoodCache.get(key)?.info:coreCache.get(key)?.info;
        if(good?.video?.qualities?.length){
          buildMenu(w,b,'video',good);
        } else {
          buildMenu(w,b,'video',null,'Ищем ссылки…');
        }
        const live=findExactHoverVideo(w);
        const liveUrl=live?.currentSrc||live?.src||live?.querySelector?.('source')?.src||'';
        if(!good&&liveUrl&&!/^blob:/i.test(liveUrl)){
          const liveQ=Number(live?.videoHeight)||Number(live?.height)||0;
          const liveInfo={id:exactId,src:liveUrl,height:liveQ,video:{qualities:[{url:liveUrl,q:liveQ||720,key:'live'}]},fallback:[]};
          // Keep player URL only as an immediate provisional row; API results replace/augment it.
          buildMenu(w,b,'video',liveInfo,'Ищем ссылки…');
        }
        resolveCached('video',false,exactId).then(info=>{
          if(info?.video?.qualities?.length) uiGoodCache.set(key,{ts:Date.now(),info});
          if(w.matches(':hover')||globalMenu?.matches(':hover')) buildMenu(w,b,'video',info);
        }).catch(()=>{
          const latest=uiGoodCache.get(key)?.info;
          if(latest&&(w.matches(':hover')||globalMenu?.matches(':hover'))) buildMenu(w,b,'video',latest);
        });
      };
      // Use pointer/focus events as well as mouseenter. VK rebuilds its controls
      // frequently and pointerenter is more reliable on the replacement nodes.
      w.addEventListener('mouseenter',openAndResolve);
      w.addEventListener('pointerenter',openAndResolve);
      w.addEventListener('focusin',openAndResolve);
      w.addEventListener('mouseleave',()=>{
        clearTimeout(w._closeTimer);
        w._closeTimer=setTimeout(()=>{
          if(globalMenuOwner===w && !w.matches(':hover') && !globalMenu?.matches(':hover')) closeMenu(w);
        },320);
      });
      w.addEventListener('pointerleave',()=>{
        clearTimeout(w._closeTimer);
        w._closeTimer=setTimeout(()=>{
          if(globalMenuOwner===w && !w.matches(':hover') && !globalMenu?.matches(':hover')) closeMenu(w);
        },320);
      });
      b.addEventListener('click',e=>{
        if(kind==='video'){
          // Safety fallback: if hover was missed because VK replaced the control,
          // clicking the download icon still opens the quality selector.
          e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
          openAndResolve();
          return;
        }
        e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();directClick(b,kind,w);
      },{capture:true});
    }
    return w;
  }
  if(!window.__vkeMediaUiGlobalMenuHandler){
    window.__vkeMediaUiGlobalMenuHandler=true;
    document.addEventListener('pointerdown',ev=>{
      if(ev.target.closest?.('.vke-media-dl-wrap,.vke-media-quality-menu')) return;
      closeAllMenus(null);
    },true);
    document.addEventListener('keydown',ev=>{if(ev.key==='Escape')closeAllMenus(null)},true);
  }

  function removeLegacy(){document.querySelectorAll('.clp-clips-dl-wrap,.clp-route-fallback-wrap,.vke-clip-msg-dl,.vke-video-dl-wrap').forEach(x=>x.remove());}
  function clipInstall(){
    const groups=[...document.querySelectorAll('[data-testid="clips-controls-more-actions-button"]')].map(b=>b.closest('[data-testid="roundedgroup"],.vkit-5Xz4Qd,[class*="roundedgroup" i]')||b.parentElement).filter(Boolean);
    for(const g of groups){
      if(g.querySelector(':scope > .vke-media-dl-wrap[data-vke-media-download="clip"]'))continue;
      const more=g.querySelector('[data-testid="clips-controls-more-actions-button"]');
      const slot=more?.closest('[aria-expanded]')||more?.parentElement?.parentElement||more?.parentElement;
      const w=make('clip','Скачать клип 720p');
      if(slot?.parentNode===g)g.insertBefore(w,slot);else g.appendChild(w);
    }
  }
  function videoModalInstall(){
    const groups=[...document.querySelectorAll('[data-testid="video_modal_more_button"],[data-testid="video_page_more_button"]')];
    for(const more of groups){
      const parent=more.parentElement?.parentElement||more.parentElement;if(!parent)continue;
      if(parent.querySelector(':scope > .vke-media-dl-wrap[data-vke-media-download="video"]'))continue;
      const target=more.closest('[data-testid*=video_modal i],[data-testid*=video_page i]')?.querySelector('video')||null;
      parent.insertBefore(make('video','Скачать видео в максимальном доступном качестве',target),more.parentElement||more);
    }
  }
  function storyInstall(){ /* story button is owned exclusively by stories_download.js */ }
  function genericInstall(){
    // IMPORTANT: circles intentionally have NO visible download button.
    // They are downloaded only from the message context action "Скачать вложения".
    document.querySelectorAll('.AttachVideoMessage .vke-media-dl-wrap[data-vke-media-download="video_message"], .vke-media-dl-wrap[data-vke-media-download="video_message"]').forEach(x=>x.remove());

    // Generic fallback for actual video/clip players only. Never attach it to a
    // video-message/circle container.
    const videos=[...document.querySelectorAll('video')].filter(v=>{
      if(v.closest('.AttachVideoMessage,[data-testid*=video-message i]')) return false;
      const r=v.getBoundingClientRect();
      return r.width>220&&r.height>180&&getComputedStyle(v).display!=='none';
    });
    if(!videos.length)return;
    videos.sort((a,b)=>{const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();return br.width*br.height-ar.width*ar.height});
    const v=videos[0];let p=v.parentElement;
    for(let i=0;p&&i<10;i++,p=p.parentElement){const r=p.getBoundingClientRect();if(r.width>280&&r.height>200)break}
    if(!p||p.querySelector(':scope > .vke-media-overlay')||p.querySelector('.vke-media-dl-wrap'))return;
    if(getComputedStyle(p).position==='static')p.style.position='relative';
    const kind=/\/clip(?:s)?[-/]/i.test(location.pathname)||/[?#&]z=clip-/i.test(location.href)?'clip':'video';
    const w=make(kind,kind==='clip'?'Скачать клип':'Скачать видео в максимальном доступном качестве',v);
    w.classList.add('vke-media-overlay');
    p.appendChild(w);
  }
  function purgeCircleButtons(){
    document.querySelectorAll(
      '.vke-media-dl-wrap[data-vke-media-download="video_message"],'+
      '.AttachVideoMessage .vke-media-dl-wrap'
    ).forEach(x=>x.remove());
  }
  function attach(){
    // Restore normal media controls, but NEVER create a visible circle button.
    removeLegacy();
    purgeCircleButtons();
    clipInstall();
    videoModalInstall();
    storyInstall();
    if(!document.querySelector('[data-testid="clips-controls-more-actions-button"],[data-testid="video_modal_more_button"],[data-testid="video_page_more_button"],[data-testid="stories_viewer_menu_icon"]')){
      genericInstall();
    }
    purgeCircleButtons();
  }
  const mo=new MutationObserver(()=>{clearTimeout(attach._t);attach._t=setTimeout(attach,120)});
  mo.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['href','data-video-id','data-clip-id','aria-expanded']});
  [0,100,250,500,900,1500,2500,4000,7000].forEach(ms=>setTimeout(attach,ms));
  setInterval(attach,900);
})();
