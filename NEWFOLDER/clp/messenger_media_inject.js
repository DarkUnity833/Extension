(function(){
'use strict';

const originalFetch=window.__vkeOriginalFetch||window.fetch;
const originalOpen=XMLHttpRequest.prototype.open;
const originalSend=XMLHttpRequest.prototype.send;
const waiting=new Map();
const lastSeen={voice:null,circle:null,video:null};
const lastSeenAt={voice:0,circle:0,video:0};
setInterval(()=>{const now=Date.now();for(const k of Object.keys(lastSeenAt)){if(now-lastSeenAt[k]>60000){lastSeen[k]=null;lastSeenAt[k]=0}}for(const [id,v] of waiting){if(now-(v.time||now)>30000)waiting.delete(id)}},30000);
const CDN_RE=/(?:^|\.)(?:vkuserphoto|vkuseraudio|vkuser(?:video)?|vkvd\d+|okcdn\.ru|vk-cdn\.net|userapi\.com|psv\d+\.|st\d+\.|sun\d+-|vk\d+-\d+\.vkuser\.net)/i;
const EXT_RE=/\.(?:ogg|mp3|m4a|mp4)(?:[?#].*)?$/i;
function str(v){try{return typeof v==='string'?v:(v?.url||String(v||''))}catch{return ''}}
function isCdn(u){return /^https?:\/\//i.test(u)&&CDN_RE.test(u)}
function classify(u,kindHint){if(!isCdn(u))return null;try{const x=new URL(u);const type=x.searchParams.get('type');if(/^(?:ogg|mp3|m4a)(?:$)/i.test(x.pathname.split('.').pop()||''))return 'voice';if(/\.(ogg|mp3|m4a)(?:[?#]|$)/i.test(u))return 'voice';if(/\.mp4(?:[?#]|$)/i.test(u))return kindHint==='video'?'video':'circle';if(kindHint==='circle' && /^(?:3|5)$/.test(String(type||'')) && x.searchParams.has('id'))return 'circle';if(kindHint==='voice' && /^(?:3|5)$/.test(String(type||'')) && x.searchParams.has('id'))return 'voice';return kindHint||null}catch{return kindHint||null}}
function emit(clientId,kind,url){if(!url)return;lastSeen[kind]=url;lastSeenAt[kind]=Date.now();if(clientId){window.postMessage({type:'CLP_MSG_MEDIA_URL',clientId,kind,url},'*')} }
function report(url,kindHint){const u=str(url);if(!u||!isCdn(u))return;const hint=kindHint||null;for(const [cid,state] of waiting){const kind=classify(u,state.kind)||hint;if(kind&&kind===state.kind){waiting.delete(cid);emit(cid,kind,u);return}}if(hint&&classify(u,hint)===hint)lastSeen[hint]=u}

window.fetch=new Proxy(originalFetch,{apply(target,thisArg,args){const u=str(args[0]);if(/stats\.vk-portal\.net/i.test(u))return target.apply(thisArg,args);if(u)report(u);return target.apply(thisArg,args).then(r=>{try{report(r?.url||u)}catch{}return r})}});
XMLHttpRequest.prototype.open=function(method,url,...rest){this.__vkeMediaUrl=str(url);this.__vkeStatsBypass=/stats\.vk-portal\.net/i.test(this.__vkeMediaUrl);return originalOpen.call(this,method,url,...rest)};
XMLHttpRequest.prototype.send=function(...args){if(this.__vkeStatsBypass)return originalSend.apply(this,args);report(this.__vkeMediaUrl||'');return originalSend.apply(this,args)};
try{const d=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');if(d?.set){Object.defineProperty(HTMLMediaElement.prototype,'src',{get:d.get,set(v){report(str(v));return d.set.call(this,v)},configurable:true,enumerable:true})}}catch{}

function getMedia(container,kind){
  if(!container)return '';
  const els=[...container.querySelectorAll(kind==='voice'?'audio':'video')];
  els.sort((a,b)=>{
    const ap=kind==='voice'?(a.readyState>0?1:0):(a.paused?0:1),bp=kind==='voice'?(b.readyState>0?1:0):(b.paused?0:1);
    if(ap!==bp)return bp-ap;
    const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();
    return br.width*br.height-ar.width*ar.height;
  });
  for(const el of els){const u=el.currentSrc||el.src||el.querySelector?.('source')?.src;if(u&&!isExpired(u))return u}
  return '';
}
function isExpired(u){try{const x=new URL(u);const raw=x.searchParams.get('expires')||x.searchParams.get('expire');if(!raw)return false;const n=Number(raw);if(!Number.isFinite(n))return false;return Date.now()>(n>1e12?n:n*1000)}catch{return false}}
function watchMedia(container,kind,clientId,play){
  const startedAt=Date.now();
  const deadline=startedAt+18000;
  const timer=setInterval(()=>{
    const src=getMedia(container,kind);
    if(src&&isCdn(src)&&!isExpired(src)){
      clearInterval(timer);
      if(waiting.has(clientId)){waiting.delete(clientId);emit(clientId,kind,src);setTimeout(()=>{try{play?.click()}catch{}},150)}
      return;
    }
    // Accept a newly observed URL only when it appeared after this request began.
    if(lastSeen[kind]&&lastSeenAt[kind]>=startedAt&&!isExpired(lastSeen[kind])&&waiting.has(clientId)){
      const u=lastSeen[kind];waiting.delete(clientId);emit(clientId,kind,u);setTimeout(()=>{try{play?.click()}catch{}},150);clearInterval(timer);return;
    }
    // Some VK media URLs never surface through fetch/XHR but do appear in the
    // Performance timeline. Prefer only resources that started after this click.
    try{
      const entries=performance.getEntriesByType('resource').slice(-200);
      for(let i=entries.length-1;i>=0;i--){
        const u=entries[i]?.name||'';
        if((entries[i]?.startTime||0)+performance.timeOrigin<startedAt) break;
        if(isCdn(u)&&((kind==='voice'&&(/\.(?:ogg|m4a|mp3)(?:[?#]|$)/i.test(u)||/[?&]type=(?:3|5)(?:&|$)/i.test(u)))||(kind==='circle'&&(/\.mp4(?:[?#]|$)/i.test(u)||/[?&]type=(?:3|5)(?:&|$)/i.test(u))))){
          if(waiting.has(clientId)&&!isExpired(u)){waiting.delete(clientId);emit(clientId,kind,u);clearInterval(timer);return;}
        }
      }
    }catch{}
    if(Date.now()>deadline){clearInterval(timer);if(waiting.has(clientId)){waiting.delete(clientId);window.postMessage({type:'CLP_TRIGGER_RESULT',clientId,error:'timeout'},'*')}}
  },100);
}
function getContainer(id){try{return document.querySelector(`[data-vke-media-id="${CSS.escape(id)}"]`)}catch{return null}}
window.addEventListener('message',e=>{if(e.source!==window)return;const d=e.data;if(d?.type!=='CLP_TRIGGER_PLAY'||!d.clientId)return;const kind=d.kind==='circle'?'circle':(d.kind==='video'?'video':'voice');const c=getContainer(d.clpId);if(!c){window.postMessage({type:'CLP_TRIGGER_RESULT',clientId:d.clientId,error:'no_container'},'*');return}
  let src=getMedia(c,kind);if(src&&isCdn(src)){emit(d.clientId,kind,src);return}
  const play=kind==='voice'?c.querySelector('.AttachVoice__play'):c.querySelector('.AttachVideoMessage__playBtn, .AttachVideoMessage__video, button[aria-label*="Проигр" i], button[aria-label*="Play" i]');
  if(!play){window.postMessage({type:'CLP_TRIGGER_RESULT',clientId:d.clientId,error:'no_playBtn'},'*');return}
  waiting.set(d.clientId,{kind,time:Date.now()});
  try{
    const media=c.querySelector(kind==='voice'?'audio':'video');
    if(media){
      if(kind==='voice' && media.readyState===0) { try{media.load()}catch{} }
      if(media.paused){ Promise.resolve(media.play()).catch(()=>{try{play.click()}catch{}}); }
      else { try{media.currentTime=0}catch{}; Promise.resolve(media.play()).catch(()=>{}); }
    }else{ play.click(); }
  }catch{try{play.click()}catch{}}
  watchMedia(c,kind,d.clientId,play);
});

// Catch dynamically assigned currentSrc/src and media playback, including extension-less CDN URLs.
new MutationObserver(()=>{document.querySelectorAll('audio,video').forEach(el=>{const u=el.currentSrc||el.src;if(!u||!isCdn(u))return;let kind='circle';if(el.matches('audio'))kind='voice';else if(el.closest('.AttachVideoMessage'))kind='circle';else if(el.closest('.AttachVideo,.ConvoMessage,.ConvoMessageWithoutBubble'))kind='video';lastSeen[kind]=u;lastSeenAt[kind]=Date.now();})}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','data-src','data-url']});
setInterval(()=>{document.querySelectorAll('audio,video').forEach(el=>{const u=el.currentSrc||el.src;if(u&&isCdn(u)){let k='circle';if(el.matches('audio'))k='voice';else if(!el.closest('.AttachVideoMessage')&&el.closest('.AttachVideo,.ConvoMessage,.ConvoMessageWithoutBubble'))k='video';if(lastSeen[k]!==u){lastSeen[k]=u;lastSeenAt[k]=Date.now()}}})},250);
})();
