// VKE clips downloader — v25
// Exact clip binding, no quality picker, 720p-first, native VK Download interception,
// scoped fallbacks for Messenger/feed/groups, and progress indicator.
(function(){
'use strict';
if (window.__vkeClipsDownloader25) return;
window.__vkeClipsDownloader25 = true;

const STYLE = `
.clp-clips-dl-wrap{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:52px!important;height:52px!important;min-width:52px!important;min-height:52px!important;flex:0 0 52px!important;margin:0!important;padding:0!important}
.clp-clips-dl-btn{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:52px!important;height:52px!important;min-width:52px!important;min-height:52px!important;border:0!important;border-radius:999px!important;background:transparent!important;color:inherit!important;cursor:pointer!important;padding:0!important;box-sizing:border-box!important}
.clp-clips-dl-btn:hover{background:rgba(255,255,255,.10)!important}.clp-clips-dl-btn:active{background:rgba(255,255,255,.16)!important}
.clp-clips-dl-btn[disabled]{pointer-events:none!important;opacity:.72!important}
.clp-clips-dl-icon{width:28px!important;height:28px!important;fill:currentColor!important;pointer-events:none!important}
.clp-clips-ring{width:28px!important;height:28px!important;border-radius:50%!important;display:grid!important;place-items:center!important;background:conic-gradient(currentColor calc(var(--p,0)*1%),rgba(127,127,127,.25) 0)!important;position:relative!important}
.clp-clips-ring:after{content:'';position:absolute;inset:3px;border-radius:50%;background:rgba(24,26,31,.96)!important}.clp-clips-ring>span{position:relative;z-index:1;font:700 8px/1 -apple-system,BlinkMacSystemFont,Roboto,sans-serif!important}
.clp-clips-spin{width:23px!important;height:23px!important;border:3px solid rgba(255,255,255,.25)!important;border-top-color:currentColor!important;border-radius:50%!important;animation:clp-clips-spin .7s linear infinite!important}@keyframes clp-clips-spin{to{transform:rotate(360deg)}}
.clp-clips-toast{position:fixed!important;left:50%!important;bottom:24px!important;transform:translateX(-50%)!important;z-index:2147483647!important;padding:9px 14px!important;border-radius:10px!important;background:rgba(32,34,37,.96)!important;color:#fff!important;font:13px/18px -apple-system,BlinkMacSystemFont,Roboto,sans-serif!important;box-shadow:0 6px 22px rgba(0,0,0,.28)!important}
`;
const ICON = `<svg class="clp-clips-dl-icon" viewBox="0 0 28 28" aria-hidden="true"><path d="M14 18c-.3 0-.6-.1-.8-.3l-5-5a1.05 1.05 0 0 1 1.5-1.5l3.2 3.2V6a1.1 1.1 0 0 1 2.2 0v8.4l3.2-3.2a1.05 1.05 0 0 1 1.5 1.5l-5 5c-.2.2-.5.3-.8.3Z"/><path d="M22 22H6a1 1 0 1 1 0-2h16a1 1 0 0 1 0 2Z"/></svg>`;

if(!document.getElementById('clp-clips-dl-style-v24')){
  const s=document.createElement('style'); s.id='clp-clips-dl-style-v24'; s.textContent=STYLE; document.head.appendChild(s);
}

let seq=0, busyButton=null, stopPoll=null, attachTimer=0;

function toast(text){
  let el=document.querySelector('.clp-clips-toast');
  if(!el){el=document.createElement('div');el.className='clp-clips-toast';document.body.appendChild(el)}
  el.textContent=text; clearTimeout(el._t); el._t=setTimeout(()=>el.remove(),2200);
}
function visible(el){
  if(!el) return false;
  const r=el.getBoundingClientRect?.(); if(!r||r.width<2||r.height<2) return false;
  const cs=getComputedStyle(el); return cs.display!=='none'&&cs.visibility!=='hidden'&&Number(cs.opacity||1)>0;
}
function normalizeMany(value){
  let s=String(value??'');
  for(let i=0;i<6;i++){try{const d=decodeURIComponent(s);if(d===s)break;s=d}catch{break}}
  return s;
}
function parsePair(value){
  const s=normalizeMany(value);
  let m=s.match(/(?:^|[/?#&])(?:clips?|clip|video)(-?\d+)_(\d+)/i);
  if(m)return `${m[1]}_${m[2]}`;
  m=s.match(/(?:^|[^\d-])(-?\d{3,})_(\d{3,})(?:$|[^\d])/);
  return m?`${m[1]}_${m[2]}`:null;
}
function idFromElement(el){
  if(!el)return null;
  for(const a of ['data-video-id','data-clip-id','data-full-id','data-id','href','data-url','data-video-url']){
    const v=el.getAttribute?.(a)||el.value||''; const id=parsePair(v); if(id)return id;
  }
  return parsePair(el.textContent||'');
}
function walk(value,cb,depth=0,seen=new Set()){
  if(!value||depth>8)return false;
  const t=typeof value;if(t!=='object'&&t!=='function')return false;
  if(seen.has(value))return false;seen.add(value);
  if(cb(value))return true;
  let keys=[];try{keys=Object.keys(value).slice(0,140)}catch{return false}
  for(const k of keys){try{const v=value[k];if(v&&typeof v==='object'&&walk(v,cb,depth+1,seen))return true}catch{}}
  return false;
}
function reactId(root){
  if(!root)return null;
  let found=null;
  for(const n of [root,...root.querySelectorAll('*')].slice(0,2200)){
    for(const k of Object.keys(n)){
      if(!k.startsWith('__reactProps$')&&!k.startsWith('__reactFiber$'))continue;
      try{walk(n[k],obj=>{
        if(found)return true;
        if(obj?.owner_id!=null&&obj?.id!=null){const id=`${obj.owner_id}_${obj.id}`;if(/^-?\d+_\d+$/.test(id)){found=id;return true}}
        for(const q of ['clip_id','video_id','full_id','clipId','videoId','fullId']){const id=parsePair(obj?.[q]);if(id){found=id;return true}}
        return false;
      })}catch{}
      if(found)return found;
    }
    if(found)return found;
  }
  return null;
}
function controlButtons(root=document){
  return [...root.querySelectorAll('[data-testid="clips-controls-like-button"],[data-testid="clips-controls-comments-button"],[data-testid="clips-controls-share-button"],[data-testid="clips-controls-dislike-button"],[data-testid="clips-controls-more-actions-button"]')].filter(visible);
}
function clipGroupFromControl(control){
  if(!control)return null;
  return control.closest('[data-testid="roundedgroup"],[class*="roundedgroup" i],.vkit-5Xz4Qd')||control.parentElement?.parentElement||null;
}
function clipRootFromGroup(group){
  if(!group)return null;
  let p=group;
  for(let i=0;p&&i<10;i++,p=p.parentElement){
    const hasControls=p.querySelector('[data-testid="clips-controls-like-button"],[data-testid="clips-controls-more-actions-button"]');
    const hasVideo=p.querySelector('video');
    if(hasControls&&hasVideo){
      const r=p.getBoundingClientRect?.();
      if(r&&r.width>160&&r.height>160)return p;
    }
  }
  return group;
}
function activeClipGroups(){
  const controls=controlButtons();
  const groups=[];
  for(const c of controls){
    const g=clipGroupFromControl(c);if(!g||groups.includes(g))continue;
    const root=clipRootFromGroup(g);
    if(root)groups.push(root);
  }
  if(!groups.length){
    const pageIsClip=/(?:^|[/?&])clips?-?\d*[_-]|[?#&]z=clip-?/i.test(location.href)||/MessengerClipsModal|ClipsModal|ClipModal/i.test(document.body?.className||'');
    for(const v of [...document.querySelectorAll('video')].filter(visible)){
      let p=v.parentElement,root=null;
      for(let i=0;p&&p!==document.body&&i<12;i++,p=p.parentElement){
        const r=p.getBoundingClientRect?.();
        const marker=p.querySelector?.('[data-testid^="clips-controls-"]');
        const modal=/MessengerClipsModal|ClipsModal|ClipModal|clips-modal/i.test(`${p.className||''} ${p.getAttribute?.('data-testid')||''}`);
        if(r&&r.width>220&&r.height>220&&(marker||modal||pageIsClip)){root=p;break;}
      }
      if(root&&!groups.includes(root))groups.push(root);
    }
  }
  return groups;
}
function localId(root){
  if(!root)return null;
  let id=parsePair(location.pathname)||parsePair(location.href);
  if(id)return id;
  const elems=[
    root.querySelector('[data-testid="clips-controls-more-actions-download-item"]'),
    root.querySelector('[data-testid="clips-controls-more-actions-button"]'),
    ...root.querySelectorAll('a[href],input[readonly],*[data-video-id],*[data-clip-id],*[data-full-id],*[data-id*="_"]')
  ].filter(Boolean);
  for(const el of elems){id=idFromElement(el);if(id)return id}
  id=reactId(root);if(id)return id;
  return null;
}
function getMainId(){
  return new Promise(resolve=>{
    const clientId=`clipid24_${Date.now()}_${++seq}`; let done=false;
    const on=e=>{if(e.source!==window||e.data?.type!=='CLP_ACTIVE_ID_RESULT'||e.data.clientId!==clientId)return;done=true;window.removeEventListener('message',on);resolve(e.data.id||null)};
    window.addEventListener('message',on);window.postMessage({type:'CLP_GET_ACTIVE_ID',clientId},'*');
    setTimeout(()=>{if(done)return;window.removeEventListener('message',on);resolve(null)},2500);
  });
}
function requestData(id){
  return new Promise((resolve,reject)=>{
    const clientId=`clipdata24_${Date.now()}_${++seq}`; let done=false;
    const on=e=>{
      if(e.source!==window)return; const d=e.data||{};
      if(d.type==='CLP_VIDEO_DATA_RESPONSE'&&d.clientId===clientId){done=true;window.removeEventListener('message',on);clearTimeout(timer);resolve({id:d._clipId||id||null,vsrc:d.vsrc||null})}
      else if(d.type==='CLP_VIDEO_ERROR'&&d.clientId===clientId){done=true;window.removeEventListener('message',on);clearTimeout(timer);reject(new Error(d.error||'VK не отдал ссылку'))}
    };
    window.addEventListener('message',on);
    window.postMessage({type:'CLP_REQUEST_VIDEO_URL',clientId,clipId:id||null},'*');
    const timer=setTimeout(()=>{if(done)return;window.removeEventListener('message',on);reject(new Error('Таймаут получения ссылки'))},16000);
  });
}
function pick720(vsrc){
  if(!vsrc||typeof vsrc!=='object')return null;
  for(const q of ['720p','mp4_720','url720','720']){
    if(typeof vsrc[q]==='string'&&/^https?:\/\//i.test(vsrc[q])&&/\.mp4(?:[?#]|$)/i.test(vsrc[q])&&!/\/recoding\/|\/preview(?:[/?]|$)/i.test(vsrc[q]))return {q:'720p',url:vsrc[q]};
  }
  for(const q of ['480p','360p','240p','144p']){
    if(typeof vsrc[q]==='string'&&/^https?:\/\//i.test(vsrc[q])&&/\.mp4(?:[?#]|$)/i.test(vsrc[q])&&!/\/recoding\/|\/preview(?:[/?]|$)/i.test(vsrc[q]))return {q:q,url:vsrc[q]};
  }
  return null;
}
function requestCapture(root){
  return new Promise((resolve,reject)=>{
    const clientId=`clipcap24_${Date.now()}_${++seq}`;
    const on=e=>{if(e.source!==window||e.data?.type!=='CLP_CAPTURE_MEDIA_RESULT'||e.data.clientId!==clientId)return;window.removeEventListener('message',on);clearTimeout(timer);e.data.error?reject(new Error(e.data.error)):resolve(e.data.blob)};
    window.addEventListener('message',on);
    window.postMessage({type:'CLP_CAPTURE_MEDIA_REQUEST',clientId,scope:'clip'},'*');
    const timer=setTimeout(()=>{window.removeEventListener('message',on);reject(new Error('Не удалось получить текущий клип'))},45000);
  });
}
function saveBlob(blob,filename,button){
  const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),15000);reset(button);toast('Клип: готово');
}
function setVisual(button,mode,p=0){
  if(!button)return;button.disabled=true;
  if(mode==='wait'){button.innerHTML='<span class="clp-clips-spin"></span>';return}
  button.innerHTML=`<span class="clp-clips-ring" style="--p:${Math.max(0,Math.min(100,p))}"><span>${p?Math.round(p)+'%':'…'}</span></span>`;
}
function reset(button){if(!button)return;button.disabled=false;button.innerHTML=ICON;button._busy=false}
function startDownloadProgress(downloadId,button,label){
  stopPoll?.();stopPoll=window.__vkePollDownload?.(downloadId,d=>{const p=d.totalBytes>0?d.bytesReceived/d.totalBytes*100:0;setVisual(button,'progress',p)},d=>{const ok=d.state==='complete';setVisual(button,'progress',ok?100:0);toast(ok?`${label}: готово`:`${label}: ошибка`);setTimeout(()=>reset(button),700);stopPoll=null});
}
async function direct(url,filename,button,label){
  const r=await chrome.runtime.sendMessage({type:'VKE_DIRECT_DOWNLOAD',url,filename});
  if(!r?.ok)throw new Error(r?.error||'Не удалось начать скачивание');
  startDownloadProgress(r.downloadId,button,label);
}
function activeVideoInRoot(root){
  const vids=[...root.querySelectorAll('video')].filter(visible);
  if(!vids.length)return null;
  const playing=vids.filter(v=>!v.paused&&!v.ended&&(v.currentSrc||v.src));
  const pool=playing.length?playing:vids;
  pool.sort((a,b)=>{const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();return br.width*br.height-ar.width*ar.height});
  return pool[0]||null;
}
async function download(root,button){
  if(!root||button?._busy)return;
  if(button)button._busy=true;busyButton=button;setVisual(button,'wait');
  try{
    // 1. Exact id for THIS clip, never the page-wide first video.
    const id=localId(root)||await getMainId();
    // 2. Prefer VK's own metadata / direct 720p. This avoids 10-second quick-preview URLs.
    if(id){
      try{
        const data=await requestData(id); const picked=pick720(data?.vsrc);
        if(picked){await direct(picked.url,`vk_clip_${id.replace(/-/g,'m')}_${picked.q}.mp4`,button,`Клип ${picked.q}`);return;}
      }catch{}
    }
    // 3. Exact scoped player fallback. No page-wide video and no preview/recoding URL.
    const video=activeVideoInRoot(root); const src=video?.currentSrc||video?.src||'';
    if(/^https?:\/\//i.test(src)&&/\.mp4(?:[?#]|$)/i.test(src)&&!/\/recoding\/|\/preview(?:[/?]|$)|getVideoPreview/i.test(src)){
      await direct(src,`vk_clip_${id? id.replace(/-/g,'m') : Date.now()}_720p.mp4`,button,'Клип');return;
    }
    // 4. Last resort: capture only the scoped clip player.
    const blob=await requestCapture(root);if(!blob||blob.size<100000)throw new Error('Клип не удалось получить');
    saveBlob(blob,`vk_clip_${id? id.replace(/-/g,'m') : Date.now()}.webm`,button);
  }catch(err){toast(err?.message||'Не удалось скачать клип');reset(button)}
}
function installButton(root){
  if(!root||!visible(root))return;
  const group=root.querySelector('[data-testid="roundedgroup"],.vkit-5Xz4Qd,[class*="roundedgroup" i]')||root;
  if(group.querySelector(':scope > .clp-clips-dl-wrap') || root.querySelector('.clp-clips-overlay-wrap'))return;
  const more=group.querySelector('[data-testid="clips-controls-more-actions-button"]');
  const dislike=group.querySelector('[data-testid="clips-controls-dislike-button"]');
  const share=group.querySelector('[data-testid="clips-controls-share-button"]');
  const hasNativeControls=!!(more||dislike||share);
  const makeButton=()=>{
    const wrap=document.createElement('div');wrap.className='clp-clips-dl-wrap';wrap.dataset.vkeClipDownload='1';
    const button=document.createElement('button');button.className='clp-clips-dl-btn';button.type='button';button.title='Скачать клип 720p';button.setAttribute('aria-label','Скачать клип 720p');button.innerHTML=ICON;
    button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();download(root,button)});
    wrap.appendChild(button);return wrap;
  };
  if(hasNativeControls){
    const moreSlot=more?.closest('[aria-expanded]') || more?.parentElement?.parentElement || null;
    const dislikeSlot=dislike?.closest('[data-testid="roundedgroupitem"]') || dislike?.parentElement?.parentElement || null;
    const shareSlot=share?.closest('[data-testid="roundedgroupitem"]') || share?.parentElement?.parentElement || null;
    const anchor=(moreSlot?.parentNode===group?moreSlot:null) || (dislikeSlot?.parentNode===group?dislikeSlot:null) || (shareSlot?.parentNode===group?shareSlot:null);
    const wrap=makeButton();
    if(anchor?.parentNode===group)group.insertBefore(wrap,anchor);else group.appendChild(wrap);
    return;
  }
  const video=activeVideoInRoot(root);if(!video)return;
  const holder=video.parentElement;if(!holder)return;
  const wrap=makeButton();wrap.classList.add('clp-clips-overlay-wrap');
  wrap.style.cssText='position:absolute!important;right:12px!important;top:12px!important;z-index:2147483000!important;margin:0!important;';
  if(getComputedStyle(holder).position==='static')holder.style.position='relative';
  holder.appendChild(wrap);
}
function routeClipId(){
  const s=normalizeMany(location.pathname+' '+location.href);
  const m=s.match(/(?:^|[/?#&])(?:clip|clips|video)(-?\d+)_(\d+)/i)||s.match(/(?:^|[/?#&])(?:clip|clips)(-?\d+)_(\d+)/i);
  return m?`${m[1]}_${m[2]}`:null;
}
function installRouteFallback(){
  if(!/\/clip(?:s)?-?\d+_\d+/i.test(location.pathname) && !/[?#&]z=clip-?\d+_\d+/i.test(location.href)) return;
  const root=document.body;
  const videos=[...document.querySelectorAll('video')].filter(visible);
  if(!videos.length)return;
  const v=videos.sort((a,b)=>{const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();return (br.width*br.height)-(ar.width*ar.height)})[0];
  let holder=v.parentElement; for(let i=0;holder&&i<10;i++,holder=holder.parentElement){const r=holder.getBoundingClientRect?.();if(r&&r.width>220&&r.height>220)break;}
  if(!holder)return;
  let wrap=holder.querySelector(':scope > .clp-route-fallback-wrap');
  if(wrap)return;
  wrap=document.createElement('div');wrap.className='clp-route-fallback-wrap';wrap.style.cssText='position:absolute!important;right:16px!important;top:16px!important;z-index:2147483000!important;';
  const btn=document.createElement('button');btn.className='clp-clips-dl-btn';btn.type='button';btn.title='Скачать клип 720p';btn.setAttribute('aria-label','Скачать клип 720p');btn.innerHTML=ICON;
  btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();download(holder,btn)});
  wrap.appendChild(btn);
  if(getComputedStyle(holder).position==='static')holder.style.position='relative';
  holder.appendChild(wrap);
}
function attachAll(){
  // Remove the old left-side messenger clip button and any duplicated older versions.
  document.querySelectorAll('.vke-clip-msg-dl').forEach(x=>x.remove());
  installRouteFallback();
  const groups=activeClipGroups(); for(const g of groups)installButton(g);
}
// Intercept VK native "Скачать" for a clip: keep it watermark-free and force our 720p path.
document.addEventListener('click',e=>{
  const item=e.target?.closest?.('[data-testid="clips-controls-more-actions-download-item"]');
  if(!item)return;
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  const control=document.querySelector('[data-testid="clips-controls-more-actions-button"]');
  const group=clipGroupFromControl(control); const root=clipRootFromGroup(group||control?.parentElement);
  const btn=root?.querySelector('.clp-clips-dl-btn'); if(root&&btn)download(root,btn); else attachAll();
},{capture:true});

const mo=new MutationObserver(()=>{clearTimeout(attachTimer);attachTimer=setTimeout(attachAll,80)});
mo.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['href','data-video-id','data-clip-id','data-full-id','aria-expanded']});
[0,150,400,800,1400,2200,3500,5000].forEach(ms=>setTimeout(attachAll,ms));
setInterval(attachAll,900);
})();
