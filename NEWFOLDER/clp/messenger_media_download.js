(function(){
'use strict';

const STYLE=`
.vke-voice-host{position:relative!important;overflow:visible!important}
.vke-msg-dl{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:30px!important;height:30px!important;min-width:30px!important;min-height:30px!important;border:0!important;border-radius:50%!important;background:transparent!important;color:var(--vkui--color_icon_secondary,#818c99)!important;cursor:pointer!important;padding:0!important;position:relative!important;z-index:120!important;margin-left:6px!important;flex:0 0 30px!important}
.vke-msg-dl:hover{background:var(--vkui--color_background_secondary_alpha,rgba(0,0,0,.08))!important;color:var(--vkui--color_text_primary,#000)!important}
.vke-msg-dl svg{width:18px!important;height:18px!important;fill:currentColor!important;pointer-events:none!important}
.vke-msg-dl.is-loading{pointer-events:none!important;opacity:.78!important}
.vke-msg-dl.is-loading svg{display:none!important}
.vke-msg-dl.is-loading:after{content:"";width:13px;height:13px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:vke-msg-spin .7s linear infinite;display:block}.vke-msg-ring,.vke-circle-ring{width:22px!important;height:22px!important;border-radius:50%!important;display:grid!important;place-items:center!important;background:conic-gradient(currentColor calc(var(--p,0)*1%),rgba(127,127,127,.22) 0)!important;position:relative!important}.vke-msg-ring:after,.vke-circle-ring:after{content:"";position:absolute;inset:3px;border-radius:50%;background:rgba(255,255,255,.92)!important}.vke-circle-ring:after{background:rgba(0,0,0,.78)!important}.vke-msg-ring>span,.vke-circle-ring>span{position:relative;z-index:1;font:700 7px/1 -apple-system,BlinkMacSystemFont,Roboto,sans-serif!important}
@keyframes vke-msg-spin{to{transform:rotate(360deg)}}
.vke-circle-host{position:relative!important;overflow:visible!important}
.vke-circle-dl{position:absolute!important;top:8px!important;left:8px!important;width:30px!important;height:30px!important;border:0!important;border-radius:50%!important;background:rgba(0,0,0,.58)!important;color:#fff!important;display:flex!important;align-items:center!important;justify-content:center!important;cursor:pointer!important;z-index:120!important;padding:0!important}
.vke-circle-dl:hover{background:rgba(0,0,0,.8)!important}.vke-circle-dl svg{width:18px!important;height:18px!important;fill:currentColor!important}.vke-circle-dl.is-loading{pointer-events:none!important;opacity:.95!important}.vke-circle-dl.is-loading svg{display:none!important}.vke-circle-dl.is-loading:after{content:"";width:13px;height:13px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:vke-msg-spin .7s linear infinite;display:block}
.vke-media-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:rgba(32,34,37,.96);color:#fff;border-radius:10px;padding:9px 16px;font:13px/18px -apple-system,BlinkMacSystemFont,Roboto,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25)}
`;
const ICON=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a1 1 0 0 1 1 1v9.2l2.5-2.5a1 1 0 1 1 1.4 1.4l-4.2 4.2a1 1 0 0 1-1.4 0l-4.2-4.2a1 1 0 1 1 1.4-1.4l2.5 2.5V4a1 1 0 1 1 2 0v9.2l2.5-2.5a1 1 0 1 1 1.4 1.4l-4.2 4.2a1 1 0 0 1-1.4 0l-4.2-4.2a1 1 0 1 1 1.4-1.4l2.5 2.5V4a1 1 0 0 1 1-1z"/><path d="M5 19a1 1 0 1 1 0-2h14a1 1 0 1 1 0 2z"/></svg>`;
if(!document.getElementById('vke-msg-media-style')){const s=document.createElement('style');s.id='vke-msg-media-style';s.textContent=STYLE;document.head.appendChild(s)}

let seq=0;let pollStop=null;
const waiters=new Map();
function toast(t){let x=document.querySelector('.vke-media-toast');if(!x){x=document.createElement('div');x.className='vke-media-toast';document.body.appendChild(x)}x.textContent=t;clearTimeout(x._t);x._t=setTimeout(()=>x.remove(),2200)}
function ensureId(el){return el.dataset.vkeMediaId||(el.dataset.vkeMediaId=`m${++seq}`)}
function trigger(el,kind){const clpId=ensureId(el);return new Promise((resolve,reject)=>{const clientId=`m_${Date.now()}_${++seq}`;const timer=setTimeout(()=>{waiters.delete(clientId);reject(new Error('timeout'))},15000);waiters.set(clientId,{resolve,reject,timer});window.postMessage({type:'CLP_TRIGGER_PLAY',clientId,clpId,kind,forceFresh:true},'*')})}
function isUrl(v){return typeof v==='string'&&/^https?:\/\//i.test(v)}
function expired(u){try{const q=new URL(u).searchParams.get('expires')||new URL(u).searchParams.get('expire');if(!q)return false;const n=Number(q);return Number.isFinite(n)&&Date.now()>(n>1e12?n:n*1000)}catch{return false}}
function blobFetch(url){return new Promise((resolve,reject)=>{const requestId=`msgblob_${Date.now()}_${++seq}`;const on=e=>{if(e.source!==window||e.data?.type!=='CLP_FETCH_BLOB_RESULT'||e.data.requestId!==requestId)return;window.removeEventListener('message',on);clearTimeout(timer);e.data.error?reject(new Error(e.data.error)):resolve(e.data.blob)};window.addEventListener('message',on);window.postMessage({type:'CLP_FETCH_BLOB_REQUEST',requestId,url},'*');const timer=setTimeout(()=>{window.removeEventListener('message',on);reject(new Error('Не удалось получить blob'))},15000)})}
function saveBlob(blob,name,button,label){const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),15000);toast(`${label}: готово`);setTimeout(()=>{button.disabled=false;button.innerHTML=ICON;button._busy=false},700)}
async function dlUrl(url,name,button,label){const r=await chrome.runtime.sendMessage({type:'VKE_DIRECT_DOWNLOAD',url,filename:name});if(!r?.ok)throw new Error(r?.error||'Не удалось начать скачивание');if(pollStop)pollStop();button.classList.remove('is-loading');button.disabled=true;button.innerHTML='<span class="'+(button.classList.contains('vke-msg-dl')?'vke-msg-ring':'vke-circle-ring')+'" style="--p:0"><span>…</span></span>';pollStop=window.__vkePollDownload?.(r.downloadId,d=>{const p=d.totalBytes>0?d.bytesReceived/d.totalBytes*100:0;const ring=button.querySelector('.vke-msg-ring,.vke-circle-ring');if(ring){ring.style.setProperty('--p',p);ring.querySelector('span').textContent=p?Math.round(p)+'%':'…'}},d=>{const ok=d.state==='complete';const ring=button.querySelector('.vke-msg-ring,.vke-circle-ring');if(ring){ring.style.setProperty('--p',ok?100:0);ring.querySelector('span').textContent=ok?'✓':'!'}toast(ok?`${label}: готово`:`${label}: ошибка`);setTimeout(()=>{button.disabled=false;button.innerHTML=ICON},700);pollStop=null})}
function deepFind(obj,kind,depth=0){if(!obj||typeof obj!=='object'||depth>12)return null;for(const [k,v] of Object.entries(obj)){if(typeof v==='string'&&isUrl(v)&&!expired(v)){if(kind==='voice'&&(/voice|audio|ogg|mp3|m4a/i.test(k)||/\.(ogg|mp3|m4a)(?:[?#]|$)/i.test(v)))return v;if(kind==='circle'&&(/videoMessage|video_message|circle|mp4/i.test(k)||/\.mp4(?:[?#]|$)/i.test(v)))return v}else if(v&&typeof v==='object'){const hit=deepFind(v,kind,depth+1);if(hit)return hit}}return null}
function fiberFind(root,kind){const nodes=[root,...root.querySelectorAll('*')].slice(0,1800);for(const n of nodes){for(const k of Object.keys(n)){if(k.startsWith('__reactProps$')||k.startsWith('__reactFiber$')){try{const hit=deepFind(n[k],kind);if(hit)return hit}catch{}}}}return null}
function findVoice(root){const a=root.querySelector('audio');const src=a?.currentSrc||a?.src;if((isUrl(src)||/^blob:/i.test(src||''))&&!expired(src))return src;return fiberFind(root,'voice')}
function findCircle(root){const vids=[...root.querySelectorAll('video')].sort((a,b)=>{const av=a.paused?0:1,bv=b.paused?0:1; if(av!==bv)return bv-av; const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect(); return (br.width*br.height)-(ar.width*ar.height)}); for(const v of vids){const src=v.currentSrc||v.src||v.querySelector?.('source')?.src;if((isUrl(src)||/^blob:/i.test(src||''))&&!expired(src))return src} return fiberFind(root,'circle')}
async function waitForMedia(root,kind,timeout=12000){
  if(!root)return null;
  const pick=()=>{
    const list=[...root.querySelectorAll(kind==='voice'?'audio':'video')].filter(x=>{
      const src=x.currentSrc||x.src||x.querySelector?.('source')?.src;
      return src&&!expired(src);
    });
    list.sort((a,b)=>{
      const ap=kind==='voice'?(a.readyState>0?1:0):(a.paused?0:1), bp=kind==='voice'?(b.readyState>0?1:0):(b.paused?0:1);
      if(ap!==bp)return bp-ap;
      const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();
      return br.width*br.height-ar.width*ar.height;
    });
    return list[0]?.currentSrc||list[0]?.src||list[0]?.querySelector?.('source')?.src||null;
  };
  let u=pick(); if(u)return u;
  const play=root.querySelector(kind==='voice'?'.AttachVoice__play, .AttachVoice__playButton, button[aria-label*="Проигр" i],button[aria-label*="Play" i]':'.AttachVideoMessage__playBtn,.AttachVideoMessage__video,button[aria-label*="Проигр" i],button[aria-label*="Play" i]');
  const media=root.querySelector(kind==='voice'?'audio':'video');
  try{
    if(media){media.load?.(); await Promise.race([media.play?.().catch(()=>{}),new Promise(r=>setTimeout(r,1500))]);}
    else play?.click();
  }catch{}
  const started=Date.now();
  while(Date.now()-started<timeout){
    u=pick(); if(u)return u;
    await new Promise(r=>setTimeout(r,120));
  }
  return null;
}
async function downloadVoice(root,button){let url='';try{url=await trigger(root,'voice')}catch{} if(!url)url=findVoice(root);if(!url)url=await waitForMedia(root,'voice');if(!url)throw new Error('Ссылка не найдена');if(/^blob:/i.test(url)){const blob=await blobFetch(url);if(!blob||blob.size<1000)throw new Error('Голосовое пустое');saveBlob(blob,`vk_voice_${Date.now()}.ogg`,button,'Голосовое');return}await dlUrl(url,`vk_voice_${Date.now()}.ogg`,button,'Голосовое')}
async function downloadCircle(root,button){let url='';try{url=await trigger(root,'circle')}catch{} if(!url)url=findCircle(root);if(!url)url=await waitForMedia(root,'circle');if(!url)throw new Error('Ссылка на кружок не найдена');if(/^blob:/i.test(url)){const blob=await blobFetch(url);if(!blob||blob.size<1000)throw new Error('Кружок пустой');saveBlob(blob,`vk_circle_${Date.now()}.mp4`,button,'Кружок');return}await dlUrl(url,`vk_circle_${Date.now()}.mp4`,button,'Кружок')}

function decodeMany(s){let out=String(s||'');for(let i=0;i<3;i++){try{const d=decodeURIComponent(out);if(d===out)break;out=d}catch{break}}return out}
function normalize(owner,id){if(owner==null||id==null)return null;let o=String(owner),v=String(id);if(!/^-?\d+$/.test(o)||!/^\-?\d+$/.test(v))return null;return `${o}_${v}`}
function parseId(v){let s=decodeMany(v);let m=s.match(/(?:^|[/?#&])(?:clip|video)(-?\d+)_(\d+)/i)||s.match(/(-?\d+)_(\d+)(?:$|[^\d])/);return m?normalize(m[1],m[2]):null}
function makeBtn(cls,title,handler){const b=document.createElement('button');b.className=cls;b.type='button';b.title=title;b.setAttribute('aria-label',title);b.innerHTML=ICON;b.addEventListener('click',async e=>{e.preventDefault();e.stopPropagation();if(b._busy)return;b._busy=true;b.classList.add('is-loading');try{await handler(b);if(!b.disabled){toast(title+' сохранено')}}catch(err){toast(err?.message||'Не удалось скачать');b.disabled=false;b.classList.remove('is-loading');b.innerHTML=ICON}finally{if(!b.disabled)b._busy=false}});return b}
function addVoice(root){void root;}
function addCircle(root){ return; /* disabled: circles are context-menu only */
 /* circles are context-menu only */ }

function process(){
 document.querySelectorAll('.vke-msg-dl,.vke-circle-dl').forEach(x=>x.remove());
 document.querySelectorAll('[data-message-id], .ConvoMessage, .im-mess, [class*=ConvoMessage]').forEach(n=>{
  const txt=n.textContent||'';
  /* Circle download UI intentionally disabled. */
 });
}
window.addEventListener('message',e=>{if(e.source!==window)return;const d=e.data;if(d?.type==='CLP_MSG_MEDIA_URL'&&d.clientId){const w=waiters.get(d.clientId);if(w){clearTimeout(w.timer);waiters.delete(d.clientId);w.resolve(d.url)}}if(d?.type==='CLP_TRIGGER_RESULT'&&d.clientId){const w=waiters.get(d.clientId);if(w){clearTimeout(w.timer);waiters.delete(d.clientId);w.reject(new Error(d.error||'Не удалось получить ссылку'))}}});

let t=0;const observer=new MutationObserver(()=>{clearTimeout(t);t=setTimeout(process,120)});observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['href','data-video-id','data-clip-id','data-vk-video-id']});
[0,200,600,1200,2500,5000].forEach(ms=>setTimeout(process,ms));
})();
