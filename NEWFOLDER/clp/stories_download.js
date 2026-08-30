// VKE stories downloader — stable v35
(function(){
'use strict';
if(window.__vkeStoriesDownloader35)return;window.__vkeStoriesDownloader35=true;

const STYLE=`
.clp-story-dl-btn{width:40px!important;height:40px!important;min-width:40px!important;min-height:40px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;background:rgba(35,38,42,.62)!important;border:1px solid rgba(255,255,255,.12)!important;border-radius:50%!important;cursor:pointer!important;color:#fff!important;margin:0!important;padding:0!important;box-sizing:border-box!important;z-index:2147483646!important;position:relative!important;flex:0 0 40px!important;right:auto!important;top:auto!important;transform:none!important}.clp-story-dl-btn:hover{background:rgba(60,64,70,.82)!important}.clp-story-dl-btn[disabled]{pointer-events:none!important;opacity:.92!important}.clp-story-dl-icon{width:24px!important;height:24px!important;fill:currentColor!important;pointer-events:none!important}.clp-story-ring{width:26px!important;height:26px!important;border-radius:50%!important;display:grid!important;place-items:center!important;background:conic-gradient(currentColor calc(var(--p,0)*1%),rgba(255,255,255,.2) 0)!important;position:relative!important}.clp-story-ring:after{content:'';position:absolute;inset:3px;border-radius:50%;background:rgba(35,38,42,.95)!important}.clp-story-ring>span{position:relative;z-index:1;font:700 8px/1 -apple-system,BlinkMacSystemFont,Roboto,sans-serif!important}.clp-story-spin{width:23px!important;height:23px!important;border:3px solid rgba(255,255,255,.25)!important;border-top-color:#fff!important;border-radius:50%!important;animation:clp-story-spin .7s linear infinite!important}@keyframes clp-story-spin{to{transform:rotate(360deg)}}
`;
const ICON=`<svg class="clp-story-dl-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16.5c-.3 0-.6-.1-.8-.3l-4.2-4.2a1 1 0 1 1 1.5-1.4l2.5 2.5V5a1 1 0 1 1 2 0v8.1l2.5-2.5a1 1 0 1 1 1.4 1.4l-4.2 4.2c-.2.2-.5.3-.7.3Z"/><path d="M19 19H5a1 1 0 1 1 0-2h14a1 1 0 1 1 0 2Z"/></svg>`;
if(!document.getElementById('clp-story-dl-style-v35')){const s=document.createElement('style');s.id='clp-story-dl-style-v35';s.textContent=STYLE;document.head.appendChild(s)}

let btn=null,busy=false,stopPoll=null,attachTimer=0,seq=0;
let lastStoryHref=location.href,lastStoryNavAt=Date.now();

function legacyActiveStory(){
  return document.querySelector('#stories_list .stories_item.active,.stories_item.active');
}
function legacyStoryVideo(item){
  const v=item?.querySelector?.('video.stories_video,video');
  return v&&visible(v)?v:null;
}
function legacyStoryPhoto(item){
  const p=item?.querySelector?.('.stories_photo');
  if(!p)return null;
  const bg=getComputedStyle(p).backgroundImage||p.style.backgroundImage||'';
  const u=bgUrl(bg);
  return u||null;
}
function legacyStoryMedia(){
  const item=legacyActiveStory();
  if(!item)return null;
  const v=legacyStoryVideo(item);
  if(v){const u=cleanUrl(v.currentSrc||v.src||v.querySelector?.('source')?.src||'');if(u)return {kind:'video',el:v};}
  const p=legacyStoryPhoto(item);
  if(p)return {kind:'image',url:p};
  return null;
}
function resolveStoryCore(){
  return new Promise(resolve=>{
    const id=`story_core_${Date.now()}_${++seq}`;
    let done=false;
    const finish=v=>{if(done)return;done=true;window.removeEventListener('message',on);clearTimeout(timer);resolve(v||null)};
    const on=e=>{if(e.source!==window||e.data?.type!=='VKE_MEDIA_RESOLVE_RESULT'||e.data.requestId!==id)return;finish(e.data.error?null:e.data.result)};
    window.addEventListener('message',on);
    window.postMessage({source:'vke-ui',type:'VKE_MEDIA_RESOLVE',requestId:id,scope:'story'},'*');
    const timer=setTimeout(()=>finish(null),10000);
  });
}

function isStoryViewer(){return !!document.querySelector('button[data-testid="stories_viewer_menu_icon"],[data-testid*="stories_viewer" i],.StoriesViewer,[class*="StoryViewer" i],[class*="StoriesViewer" i]')}
function menuButton(){return document.querySelector('button[data-testid="stories_viewer_menu_icon"],[data-testid="stories_viewer_menu_icon"]')}
function root(menu){
  if(!menu)return null;
  let p=menu.closest('[data-testid*="stories_viewer" i],.StoriesViewer,[class*="StoryViewer" i],[class*="StoriesViewer" i]');
  if(p)return p;
  p=menu.parentElement;
  for(let i=0;p&&i<24;i++,p=p.parentElement){
    if(p.querySelector('button[data-testid="stories_viewer_menu_icon"]') && (p.querySelector('video')||p.querySelector('img')||p.querySelector('[style*="background-image"]'))){return p;}
  }
  return menu.parentElement?.parentElement||menu.parentElement||null;
}
function visible(el){
  if(!el)return false;
  const r=el.getBoundingClientRect?.(); if(!r||r.width<40||r.height<40)return false;
  const cs=getComputedStyle(el); return cs.display!=='none'&&cs.visibility!=='hidden'&&Number(cs.opacity||1)>0;
}
function isDataImage(u){return /^data:image\/(?:png|jpe?g|webp|gif|avif);base64,/i.test(String(u||''))}
function isImageUrl(u){return /^(?:https?:\/\/|data:image\/)/i.test(String(u||'')) && !/sprite|emoji|avatar|thumb/i.test(String(u||''))}
function cleanUrl(u){if(!u)return ''; try{return decodeURIComponent(u).replace(/&amp;/g,'&')}catch{return String(u).replace(/&amp;/g,'&')}}
function bgUrl(v){const m=String(v||'').match(/^url\(["']?(.*?)["']?\)$/i);return m?cleanUrl(m[1]):''}
function scoreImage(el,u,container){
  if(!u||!isImageUrl(u))return -1e9;
  const r=el?.getBoundingClientRect?.();
  const area=r?r.width*r.height:0;
  let score=area;
  if(r){
    const cx=r.left+r.width/2,cy=r.top+r.height/2; score-=Math.hypot(cx-innerWidth/2,cy-innerHeight/2)*600;
    const ratio=r.height? r.width/r.height : 0; if(ratio>0.3&&ratio<0.9)score+=250000;
    if(ratio>0.42&&ratio<0.72)score+=350000;
  }
  const s=String(u).toLowerCase();
  if(/sun\d+-.*userapi|userapi\.com|vkuserphoto/i.test(s))score+=180000;
  if(/[?&]size=\d{3,4}x\d{3,4}/i.test(s))score+=100000;
  if(/[?&]cs=\d+x\d+/i.test(s)||/[?&]as=\d+x\d+/i.test(s)||/[?&]ava=1/i.test(s))score-=400000;
  if(container && container.contains(el))score+=150000;
  return score;
}
function exactSelectedStoryItem(){
  return document.querySelector('[data-testid="stories-gallery-selected-item"]') ||
         document.querySelector('[data-testid="stories_viewer"] [data-testid="stories-gallery-selected-item"]') ||
         document.querySelector('#stories_list .stories_item.active,.stories_item.active');
}
function storyCurrentPhoto(r){
  const exact=exactSelectedStoryItem() || r;
  if(!exact)return null;
  const candidates=[];
  for(const el of [...exact.querySelectorAll('img')]){
    const u=cleanUrl(el.currentSrc||el.src||el.getAttribute('src')||'');
    if(!u || !isImageUrl(u)) continue;
    const rr=el.getBoundingClientRect?.();
    const nw=Number(el.naturalWidth||0), nh=Number(el.naturalHeight||0);
    const ratio=(nh||rr?.height) ? (nw||rr.width)/(nh||rr.height) : 9;
    const size=Math.max(nw*nh,(rr?.width||0)*(rr?.height||0));
    if(size<40000 || ratio>0.95) continue;
    // Ignore VK's tiny blurred placeholder image; the actual story image is the large portrait image.
    const placeholder=/^data:image\/png/i.test(u) && nw>0 && nw<=64 && nh>0 && nh<=64;
    if(placeholder) continue;
    let score=size;
    if(ratio<0.82) score+=1000000;
    if(ratio<0.72) score+=700000;
    if(/^data:image\/(?:jpe?g|webp|avif)/i.test(u)) score+=250000;
    if(/(?:userapi\.com|vkuserphoto|sun\d+-)/i.test(u)) score+=200000;
    if(/[?&](?:quality=95|quality=96)/i.test(u)) score+=150000;
    candidates.push({el,u,score});
  }
  // Exact modern viewer can expose the photo as a CSS background rather than img.
  for(const el of [...exact.querySelectorAll('*')]){
    const rr=el.getBoundingClientRect?.();
    if(!rr || rr.width<180 || rr.height<220) continue;
    const bg=getComputedStyle(el).backgroundImage||el.style.backgroundImage||'';
    const u=bgUrl(bg);
    if(!u || !isImageUrl(u)) continue;
    const ratio=rr.width/rr.height;
    if(ratio>0.95) continue;
    candidates.push({el,u,score:rr.width*rr.height+700000});
  }
  candidates.sort((a,b)=>b.score-a.score);
  return candidates[0]?.u || null;
}
function storyVisibleVideo(r){
  const exacts=[...document.querySelectorAll('.stories_item.active video.stories_video,video.videoStoriesViewerPlayer')].filter(visible);
  if(exacts[0])return exacts[0];
  const vs=[...r.querySelectorAll('video')].filter(visible);
  const pv=vs.filter(v=>!v.paused&&!v.ended&&(v.currentSrc||v.src));
  (pv.length?pv:vs).sort((a,b)=>{const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();return br.width*br.height-ar.width*ar.height});
  return (pv.length?pv:vs)[0]||null;
}
function media(r){
  const v=storyVisibleVideo(r);
  if(v){const u=cleanUrl(v.currentSrc||v.src||v.querySelector?.('source')?.src||'');if(u)return {kind:'video',el:v};}
  const p=storyCurrentPhoto(r); if(p)return {kind:'image',url:p};
  const legacy=legacyStoryMedia();
  if(legacy)return legacy;
  return null;
}
function visual(mode,p=0){if(!btn)return;btn.disabled=true;if(mode==='spin'){btn.innerHTML='<span class="clp-story-spin"></span>';return}btn.innerHTML=`<span class="clp-story-ring" style="--p:${Math.max(0,Math.min(100,p))}"><span>${p?Math.round(p)+'%':'…'}</span></span>`}
function reset(){try{stopPoll?.()}catch{}stopPoll=null;busy=false;if(btn){btn.disabled=false;btn.innerHTML=ICON}}
function direct(url,name){
  return new Promise((resolve,reject)=>{
    try{
      chrome.runtime.sendMessage({type:'VKE_DIRECT_DOWNLOAD',url,filename:name},r=>{
        if(chrome.runtime.lastError){reject(new Error(chrome.runtime.lastError.message||'Extension context invalidated'));return}
        if(!r?.ok){reject(new Error(r?.error||'Не удалось начать скачивание'));return}
        stopPoll=window.__vkePollDownload?.(r.downloadId,d=>{const p=d.totalBytes>0?d.bytesReceived/d.totalBytes*100:0;visual('progress',p)},d=>{visual('progress',d.state==='complete'?100:0);setTimeout(reset,700);stopPoll=null});
        resolve(r.downloadId);
      });
    }catch(e){reject(e)}
  });
}
function fetchMediaBlobBackground(url,timeout=20000){
  return new Promise((resolve,reject)=>{
    let done=false;
    const id=`story_bg_${Date.now()}_${++seq}`;
    const finish=(err,val)=>{if(done)return;done=true;clearTimeout(timer);try{chrome.runtime.onMessage.removeListener(onMsg)}catch{};err?reject(err):resolve(val)};
    const onMsg=(msg)=>{if(msg?.type!=='VKE_MEDIA_BLOB_RESULT'||msg.requestId!==id)return;if(!msg?.ok)finish(new Error(msg.error||'background fetch failed'));else finish(null,msg.blob||null)};
    const timer=setTimeout(()=>finish(new Error('background media timeout')),timeout);
    try{chrome.runtime.onMessage.addListener(onMsg);chrome.runtime.sendMessage({type:'VKE_FETCH_MEDIA_BLOB',requestId:id,url,pageUrl:location.href},()=>{void chrome.runtime.lastError})}catch(e){finish(e)}
  });
}
function fetchMediaBlob(url){
  return new Promise((resolve,reject)=>{
    const id=`storyblob34_${Date.now()}_${++seq}`;
    let done=false;
    const cleanup=()=>{window.removeEventListener('message',on);clearTimeout(timer)};
    const finish=(err,val)=>{if(done)return;done=true;cleanup();err?reject(err):resolve(val)};
    function on(e){if(e.source!==window||e.data?.type!=='CLP_FETCH_BLOB_RESULT'||e.data.requestId!==id)return;e.data.error?finish(new Error(e.data.error)):finish(null,e.data.blob||null)}
    window.addEventListener('message',on); window.postMessage({type:'CLP_FETCH_BLOB_REQUEST',requestId:id,url},'*');
    const timer=setTimeout(()=>finish(new Error('История не получена за 15 с')),15000);
  });
}
async function downloadBlob(blob,name,mime){if(!blob||blob.size<1000)throw new Error('Пустой файл');const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000);}
function trackStoryRoute(){const h=location.href;if(h!==lastStoryHref){lastStoryHref=h;lastStoryNavAt=Date.now()}}
async function download(){
  trackStoryRoute();
  const m=menuButton(),r=root(m),legacy=legacyStoryMedia();
  let mm=legacy||media(r);
  if(!mm && !isStoryViewer()) throw new Error('История не открыта');
  const name=`vk_story_${Date.now()}`;
  if(mm?.kind==='image'){
    // Photo stories: do not use the global performance/image cache because it
    // can return an unrelated feed image. Try only the exact active-story image,
    // then fall back to a screenshot of the currently visible story.
    const u=cleanUrl(mm?.url||'');
    if(u && isDataImage(u)){
      try{const b=await fetch(u).then(r=>r.blob()); if(b?.size>10000){await downloadBlob(b,name+'.jpg','image/jpeg');return}}catch{}
    }
    if(u && /^https?:\/\//i.test(u)){
      try{const b=await fetchMediaBlobBackground(u); if(b?.size>10000){await downloadBlob(b,name+'.jpg',b.type||'image/jpeg');return}}catch{}
      try{await direct(u,name+'.jpg');return}catch{}
    }
    try{
      const shot=await new Promise((resolve,reject)=>{
        const id='story_shot_'+Date.now()+'_'+(++seq);
        const timer=setTimeout(()=>{window.removeEventListener('message',on);reject(new Error('Скриншот истории не получен'))},15000);
        const on=e=>{
          if(e.source!==window||e.data?.type!=='VKE_CAPTURE_VISIBLE_TAB_RESULT'||e.data.requestId!==id)return;
          clearTimeout(timer);window.removeEventListener('message',on);
          e.data.error?reject(new Error(e.data.error)):resolve(e.data.dataUrl);
        };
        window.addEventListener('message',on);
        window.postMessage({type:'VKE_CAPTURE_VISIBLE_TAB',requestId:id},'*');
      });
      if(shot){
        const rootBox=(r||document.querySelector('[data-testid="stories_viewer"],.StoriesViewer,[class*=StoryViewer i]'))?.getBoundingClientRect?.();
        const img=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=shot});
        const dpr=window.devicePixelRatio||1;
        const rr=rootBox&&rootBox.width>200&&rootBox.height>200?rootBox:{left:0,top:0,width:innerWidth,height:innerHeight};
        const c=document.createElement('canvas');c.width=Math.max(1,Math.round(rr.width*dpr));c.height=Math.max(1,Math.round(rr.height*dpr));
        const ctx=c.getContext('2d');
        ctx.drawImage(img,Math.round(rr.left*dpr),Math.round(rr.top*dpr),c.width,c.height,0,0,c.width,c.height);
        const blob=await new Promise(res=>c.toBlob(res,'image/jpeg',0.95));
        if(blob&&blob.size>10000){await downloadBlob(blob,name+'.jpg','image/jpeg');return;}
      }
    }catch(e){console.warn('[VKE STORY]',e?.message||e)}
    throw new Error('Не удалось получить фото истории');
  }
  const src=cleanUrl(mm.el.currentSrc||mm.el.src||mm.el.querySelector?.('source')?.src||'');
  console.log('[VKE STORY] video url',src);
  if(/^https?:\/\//i.test(src) && !/getVideoPreview|\/preview(?:[/?]|$)|\/recoding\//i.test(src)){try{await direct(src,name+'.mp4');return}catch{}}
  if(/^blob:/i.test(src)){try{const b=await fetchMediaBlob(src);await downloadBlob(b,name+'.mp4','video/mp4');return}catch{}}
  throw new Error('Активное видео не найдено');
}
function removeLegacyButtons(){
  document.querySelectorAll('#vk-stories-download-btn,.vke-media-dl-wrap[data-vke-media-download="story"],.vke-story-download-fixed,.vkdl-story-btn,.vk-stories-download-btn').forEach(x=>x.remove());
}
function attach(){
  const m=menuButton();
  removeLegacyButtons();
  if(!m){ if(btn?.parentNode) btn.remove(); btn=null; return; }
  const parent=m.parentElement; if(!parent)return;
  // Keep the button in the same native flex row. Do not change parent styles and
  // do not position it absolutely: that was the source of the 1–3 px jitter.
  if(!btn || !document.contains(btn)){
    btn=document.createElement('button');
    btn.className='clp-story-dl-btn';btn.type='button';btn.title='Скачать историю';btn.setAttribute('aria-label','Скачать историю');btn.innerHTML=ICON;
    btn.addEventListener('click',async e=>{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();if(busy)return;busy=true;visual('spin');try{await download();if(!stopPoll)setTimeout(reset,700)}catch(err){console.warn('[VKE STORY]',err?.message||err);reset()}},true);
  }
  // Remove duplicate buttons, keeping only this instance.
  document.querySelectorAll('.clp-story-dl-btn').forEach(x=>{if(x!==btn)x.remove()});
  if(btn.parentNode!==parent) parent.insertBefore(btn,m);
}
new MutationObserver(()=>{clearTimeout(attachTimer);attachTimer=setTimeout(attach,180)}).observe(document.documentElement,{childList:true,subtree:true});
setInterval(attach,1500);[0,100,250,500,1000,1800,3000].forEach(ms=>setTimeout(attach,ms));
})();
