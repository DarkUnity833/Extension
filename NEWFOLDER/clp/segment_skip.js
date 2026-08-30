
(() => {
  'use strict';
  if (window.__VKE_SEGMENT_SKIP_V2__) return;
  window.__VKE_SEGMENT_SKIP_V2__ = true;

  const API = 'https://vkadskip-api.star-tech.dev';
  const VERSION = '7.2.34';
  const STORE_KEY = 'vke_segment_settings_v1';
  const USER_KEY = 'vke_segment_user_id_v1';
  const BUTTON_ID='vke-segment-settings-button-v1';
  const PANEL_ID='vke-segment-panel-v1';
  const TL_ID='vke-segment-timeline-v1';

  const CATS = {
    3:{key:'intro',name:'Интро / вступление',color:'#695ff0',skip:true},
    4:{key:'sponsor',name:'Реклама / спонсорский сегмент',color:'#da6275',skip:true},
    5:{key:'self_promotion',name:'Самореклама',color:'#dbad63',skip:true},
    6:{key:'credits',name:'Концовка / титры',color:'#64b469',skip:false},
  };

  let settings={enabled:true, showTimeline:true, categories:{3:true,4:true,5:true,6:false}};
  try{Object.assign(settings,JSON.parse(localStorage.getItem(STORE_KEY)||'{}'));}catch{}
  let current={video:null,id:null,duration:0,segments:[],loadedFor:null,loadedDuration:0,transcript:[],transcriptLoadedFor:null,transcriptAttemptAt:0,transcriptAdHints:[]};
  let transcriptNetInstalled=false;
  let transcriptResourceScanAt=0;
  let skipState=new Map();
  let observer=null, timer=0, apiSeq=0;
  let transcriptDebugLastAt=0;
  let lastDetectedVideoKey='';

  function uid(){
    try{
      const k=localStorage.getItem(USER_KEY); if(k)return k;
      const v=crypto.randomUUID?.() || 'vke-'+Math.random().toString(36).slice(2)+'-'+Date.now();
      localStorage.setItem(USER_KEY,v); return v;
    }catch{return 'vke-'+Math.random().toString(36).slice(2);}
  }
  const userId=uid();
  function save(){try{localStorage.setItem(STORE_KEY,JSON.stringify(settings));}catch{}}
  function category(id){return CATS[Number(id)]||{name:'Другое',color:'#999',skip:false};}

  function roots(){
    const out=[document],seen=new Set();
    for(let i=0;i<out.length;i++){
      const r=out[i]; if(!r||seen.has(r))continue; seen.add(r);
      r.querySelectorAll?.('*').forEach(e=>e.shadowRoot&&out.push(e.shadowRoot));
    }
    return out;
  }
  function videos(){
    const out=[];
    for(const r of roots()){
      for(const v of r.querySelectorAll?.('video.player-media, vk-video-player video, video')||[]){
        const b=v.getBoundingClientRect?.();
        if(!b||b.width<160||b.height<90||b.bottom<0||b.right<0||b.top>innerHeight||b.left>innerWidth)continue;
        out.push(v);
      }
    }
    return [...new Set(out)];
  }
  function activeVideo(){
    const vids=videos();
    // On normal VK Video pages always prefer the real main player over
    // previews/miniplayers. This is important because the transcript is
    // attached to the actual player video.
    if(location.pathname.toLowerCase()!=='/clip' && !location.pathname.toLowerCase().startsWith('/clip-') && !location.pathname.toLowerCase().startsWith('/clip/')) {
      const mainCandidates=[];
      for(const v of vids){
        try{
          if(v.matches?.('video.player-media') && v.closest?.('vk-video-player')) mainCandidates.push(v);
        }catch{}
      }
      if(mainCandidates.length){
        const playing=mainCandidates.find(v=>!v.paused && !v.ended);
        if(playing)return playing;
        mainCandidates.sort((a,b)=>((b.getBoundingClientRect().width*b.getBoundingClientRect().height)-(a.getBoundingClientRect().width*a.getBoundingClientRect().height)));
        return mainCandidates[0];
      }
    }
    let best=null,score=-Infinity;
    for(const v of vids){
      const b=v.getBoundingClientRect(); const area=b.width*b.height;
      const inClip=!!v.closest?.('[data-testid="clips-feed-item"]');
      const inMain=!!v.closest?.('vk-video-player,[data-testid="video-player"]');
      let s=area;
      if(inMain) s+=1800000;
      if(inClip) s+=(isClipPage()?650000:-900000);
      if(v.matches?.('video.player-media')) s+=800000;
      if(!v.paused) s+=2000000;
      if(v.readyState>=3) s+=160000;
      if(Number.isFinite(v.duration)&&v.duration>0) s+=140000;
      try{s+=Number(v.textTracks?.length||0)*60000;}catch{}
      if(s>score){score=s;best=v;}
    }
    return best;
  }
  function extractId(v){
    const dec=(s)=>{try{return decodeURIComponent(String(s))}catch{return String(s)}};
    const test=(s)=>{
      const h=dec(s||'');
      let m=h.match(/[?&#]z=video(-?\d+_\d+)/i)||h.match(/[?&#]video(?:_id)?=(-?\d+_\d+)/i)||h.match(/(?:^|[\/#])video(-?\d+_\d+)/i)||h.match(/video[_-](-?\d+_\d+)/i);
      return m?.[1]||null;
    };
    const href=test(location.href); if(href)return href;
    let p=v;
    for(let i=0;p&&i<16;i++,p=p.parentElement){
      const id=test(p.id); if(id)return id;
      const ds=p.dataset||{};
      for(const k of ['videoId','video_id','videoid','clipId','clip_id','snapKey','snap_key']){
        const x=String(ds[k]||''); const got=test(x)||(/^-?\d+_\d+$/.test(x)?x:null); if(got)return got;
      }
      const snap=String(p.getAttribute?.('data-snap-key')||'');
      const snapMatch=snap.match(/(-?\d+_\d+)/);
      if(snapMatch?.[1]) return snapMatch[1];
      for(const a of p.querySelectorAll?.('a[href]')||[]){const got=test(a.getAttribute('href'));if(got)return got;}
    }
    for(const r of roots()){
      const e=r.querySelector?.('[data-video-id],[data-video_id],[data-videoid]');
      if(e){for(const k of ['videoId','video_id','videoid']){const x=String(e.dataset?.[k]||e.getAttribute?.('data-'+k)||'');if(/^-?\d+_\d+$/.test(x))return x;}}
      for(const a of r.querySelectorAll?.('a[href*="video-"],a[href*="/video"]')||[]){const got=test(a.getAttribute('href'));if(got)return got;}
    }
    return null;
  }


  async function api(path,init={},query={}){
    // MAIN world cannot reliably CORS-fetch the AD SKIP service from vkvideo.ru.
    // Ask the extension isolated bridge/service worker to perform the request.
    const id=++apiSeq;
    const payload={id,path,method:init.method||'GET',headers:Object.fromEntries(new Headers(init.headers||{}).entries()),body:typeof init.body==='string'?init.body:null,query};
    return await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{window.removeEventListener('vke-segment-api-response',onResponse);reject(new Error('API timeout'));},12000);
      const onResponse=(ev)=>{
        const d=ev.detail||{}; if(d.id!==id)return;
        clearTimeout(timeout); window.removeEventListener('vke-segment-api-response',onResponse);
        if(d.ok){resolve({status:Number(d.status)||200,ok:true,json:async()=>d.data,text:async()=>JSON.stringify(d.data)});} else reject(new Error(d.error||('HTTP '+d.status)));
      };
      window.addEventListener('vke-segment-api-response',onResponse);
      window.dispatchEvent(new CustomEvent('vke-segment-api-request',{detail:payload}));
    });
  }


  async function loadSegments(id,duration){
    if(!id)return;
    if(current.loadedFor!==id){ console.info('[VKE SEGMENTS] Запрашиваю сегменты:', id, 'duration=', duration); }
    const d=Number.isFinite(duration)&&duration>0?Number(duration):0;
    // Не фиксируем videoId как загруженный, пока duration ещё неизвестен:
    // VK сначала создаёт <video>, а duration появляется чуть позже.
    if(current.loadedFor===id && current.loadedDuration>0 && (d<=0 || Math.abs(current.loadedDuration-d)<1))return;
    if(d<=0)return;
    current.segments=[]; current.loadedFor=null; current.loadedDuration=0;
    try{
      const r=await api('/video-calculated',{method:'GET'}, {video_id:id,duration:Math.round(d)});
      if(r.status===204){current.segments=[];current.loadedFor=id;current.loadedDuration=d;renderTimeline();console.info('[VKE SEGMENTS] API вернул 204, сегментов нет');return;}
      if(!r.ok)throw new Error('HTTP '+r.status);
      const data=await r.json();
      const raw=Array.isArray(data)?data:(Array.isArray(data?.segments)?data.segments:Array.isArray(data?.data)?data.data:[]);
      current.segments=raw.map(s=>({
        category_id:Number(s?.category_id),start:Number(s?.start),end:Number(s?.end)
      })).filter(s=>CATS[s.category_id]&&Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.end>s.start).sort((a,b)=>a.start-b.start);
      current.loadedFor=id; current.loadedDuration=d; renderTimeline();
      console.info('[VKE SEGMENTS] Загружено:', current.segments.length);
    }catch(e){
      console.warn('[VKE SEGMENTS] Ошибка:', e?.message||String(e));
      // Do not poison the cache on network/CORS/temporary failures. Retry later.
      current.loadedFor=null; current.loadedDuration=0; current.segments=[]; renderTimeline();
    }
  }

  // --- VK Video transcript acquisition (ported/adapted from the user's
  // Transcript extension architecture, but kept local to the VKE segment engine).
  // VK often exposes captions only after the player has initialized its tracks;
  // therefore we inspect every reachable shadow root, temporarily enable tracks,
  // read live TextTrack cues and then fall back to <track src> resources.
  let transcriptSeq=0;
  let transcriptPromise=null;
  let lastTranscriptLog='';

  function reachableRoots(){
    const out=[document], seen=new Set();
    for(let i=0;i<out.length;i++){
      const r=out[i]; if(!r||seen.has(r)) continue; seen.add(r);
      try{
        r.querySelectorAll?.('*').forEach(el=>{
          if(el.shadowRoot&&!seen.has(el.shadowRoot)) out.push(el.shadowRoot);
        });
      }catch{}
    }
    return out;
  }

  function allVideos(){
    const out=[];
    for(const r of reachableRoots()){
      try{ for(const v of r.querySelectorAll?.('video')||[]) out.push(v); }catch{}
    }
    return [...new Set(out)];
  }

  function parseVttText(text){
    const lines=String(text||'').replace(/^\uFEFF/,'').replace(/\r/g,'').split('\n');
    const cues=[]; let i=0;
    const toSec=(v)=>{
      const x=String(v).trim().replace(',', '.');
      const m=x.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/); if(!m)return NaN;
      const h=Number(m[1]||0), mm=Number(m[2]), ss=Number(m[3]), ms=Number((m[4]||'0').padEnd(3,'0'));
      return h*3600+mm*60+ss+ms/1000;
    };
    while(i<lines.length){
      let line=lines[i].trim();
      if(!line || /^WEBVTT/i.test(line) || /^NOTE/i.test(line) || /^STYLE/i.test(line) || /^REGION/i.test(line)){i++;continue;}
      if(!line.includes('-->') && i+1<lines.length && lines[i+1].includes('-->')){i++; line=lines[i].trim();}
      if(line.includes('-->')){
        const m=line.match(/([^\s]+)\s*-->\s*([^\s]+)/); const a=toSec(m?.[1]), b=toSec(m?.[2]); i++;
        const buf=[]; while(i<lines.length && lines[i].trim()){buf.push(lines[i].trim());i++;}
        const text=buf.join(' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
        if(Number.isFinite(a)&&Number.isFinite(b)&&b>a&&text) cues.push({start:a,end:b,text});
      } else i++;
    }
    return cues;
  }

  function parseSrtText(text){
    const blocks=String(text||'').replace(/\r/g,'').trim().split(/\n\s*\n/); const out=[];
    const sec=(v)=>{const m=String(v).trim().replace(',', '.').match(/^(\d+):(\d{2}):(\d{2})\.(\d{1,3})$/);return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3])+Number((m[4]||'0').padEnd(3,'0'))/1000:NaN;};
    for(const b of blocks){const l=b.split('\n');const ti=l.find(x=>x.includes('-->'));if(!ti)continue;const m=ti.match(/([^\s]+)\s*-->\s*([^\s]+)/);const a=sec(m?.[1]),e=sec(m?.[2]);const t=l.slice(l.indexOf(ti)+1).join(' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();if(Number.isFinite(a)&&Number.isFinite(e)&&e>a&&t)out.push({start:a,end:e,text:t});}return out;
  }

  function cleanCueText(value){
    return String(value??'').replace(/<\/?c[^>]*>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\{[^}]*\}/g,' ').replace(/\s+/g,' ').trim();
  }

  function normalizeCues(cues){
    const rows=[]; const seen=new Set();
    for(const c of cues||[]){
      const start=Number(c?.startTime??c?.start??0), end=Number(c?.endTime??c?.end??0), text=cleanCueText(c?.text??c?.payload?.text??c?.cueText??'');
      if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||!text)continue;
      const key=`${Math.round(start*10)}|${Math.round(end*10)}|${text.toLowerCase()}`; if(seen.has(key))continue; seen.add(key); rows.push({start,end,text});
    }
    rows.sort((a,b)=>a.start-b.start||a.end-b.end);
    return rows;
  }

  function looksLikeTranscriptResource(url){
    return /(?:\.vtt(?:[?#]|$)|\.srt(?:[?#]|$)|subtitle|caption|captions|transcript|timedtext|texttrack|\.ttml(?:[?#]|$))/i.test(String(url||''));
  }

  async function bridgeFetchText(url){
    const id=++transcriptSeq;
    return await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{window.removeEventListener('vke-fetch-text-response',on);reject(new Error('subtitle bridge timeout'));},10000);
      const on=(ev)=>{const d=ev.detail||{};if(d.id!==id)return;clearTimeout(timeout);window.removeEventListener('vke-fetch-text-response',on);d.ok?resolve(d):reject(new Error(d.error||('HTTP '+d.status)));};
      window.addEventListener('vke-fetch-text-response',on);
      window.dispatchEvent(new CustomEvent('vke-fetch-text-request',{detail:{id,url}}));
    });
  }

  function emitTranscriptDebug(message, extra){
    const suffix=extra===undefined?'':extra;
    const line=message+suffix;
    if(line===lastTranscriptLog)return; lastTranscriptLog=line;
    console.info('[VKE TRANSCRIPT]',message,extra??'');
  }

  function inspectTrackElements(){
    const urls=[];
    for(const r of reachableRoots()){
      try{for(const el of r.querySelectorAll?.('track[src],track')||[]){const src=el.currentSrc||el.src||el.getAttribute('src'); if(src&&looksLikeTranscriptResource(src)) urls.push(src);}}
      catch{}
    }
    return [...new Set(urls)];
  }

  function transcriptCandidates(preferred){
    const list=allVideos();
    list.sort((a,b)=>{
      const score=(v)=>{
        let s=0;
        if(v===preferred)s+=2_000_000;
        const r=v.getBoundingClientRect?.(); const area=r?Math.max(0,r.width*r.height):0;
        s+=area;
        if(!v.paused)s+=1_500_000;
        if(v.readyState>=2)s+=100_000;
        if(Number(v.duration)>0)s+=100_000;
        try{s+=Number(v.textTracks?.length||0)*40_000;}catch{}
        const inClip=!!v.closest?.('[data-testid="clips-feed-item"]');
        const inMain=!!v.closest?.('vk-video-player,[data-testid="video-player"]');
        if(inClip && !location.pathname.toLowerCase().startsWith('/clip'))s-=500_000;
        if(inClip)s+=250_000;
        if(inMain)s+=750_000;
        try{s+=Number(v.textTracks?.length||0)*250_000;}catch{}
        return s;
      };
      return score(b)-score(a);
    });
    return list;
  }

  function trackUrlsFromAllRoots(){
    const urls=[];
    for(const r of reachableRoots()){
      try{
        for(const el of r.querySelectorAll?.('track[src],track')||[]){
          const src=el.currentSrc||el.src||el.getAttribute('src');
          if(src) urls.push(src);
        }
      }catch{}
    }
    return [...new Set(urls)];
  }


  function publishTranscript(cues, id, source='vk_text_tracks'){
    try{
      if(!Array.isArray(cues)||!cues.length||!id||current.id!==id)return false;
      const normalized=normalizeCues(cues);
      if(!normalized.length)return false;
      const prev=current.transcript||[];
      if(prev.length>=normalized.length && current.transcriptLoadedFor===id)return false;
      current.transcript=normalized;
      current.transcriptLoadedFor=id;
      current.transcriptAdHints=[];
      const v=current.video, dur=Number(v?.duration)||0;
      emitTranscriptDebug(`Текст загружен: ${normalized.length} cue`,`; источник ${source}; покрытие до ${fmt(normalized[normalized.length-1].end)}`);
      try{window.dispatchEvent(new CustomEvent('vke-transcript-updated',{detail:{count:normalized.length,videoId:id}}));}catch{}
      try{window.dispatchEvent(new CustomEvent('vke-transcript-ready',{detail:{videoId:id,cues:normalized.map(x=>({start:x.start,end:x.end,text:x.text}))}}));}catch{}
      return true;
    }catch{return false;}
  }

  function installTranscriptNetworkCapture(){
    if(transcriptNetInstalled)return;
    transcriptNetInstalled=true;
    console.info('[VKE TRANSCRIPT] Перехват текстовых дорожек установлен');
    const consume=(url,text)=>{
      try{
        if(!looksLikeTranscriptResource(url)||!current.id)return;
        console.info('[VKE TRANSCRIPT] Найден ресурс:', String(url).slice(0,220));
        let parsed=parseVttText(text); if(!parsed.length)parsed=parseSrtText(text);
        if(parsed.length)publishTranscript(parsed,current.id,'network');
      }catch{}
    };
    try{
      const nativeFetch=window.fetch;
      if(typeof nativeFetch==='function'){
        window.fetch=function(...args){
          const p=nativeFetch.apply(this,args);
          Promise.resolve(p).then(r=>{
            const u=String(r?.url||args?.[0]?.url||args?.[0]||'');
            if(!looksLikeTranscriptResource(u)||!r?.clone)return;
            r.clone().text().then(t=>consume(u,t)).catch(()=>{});
          }).catch(()=>{});
          return p;
        };
      }
    }catch{}
    try{
      const X=window.XMLHttpRequest, open=X?.prototype?.open, send=X?.prototype?.send;
      if(open&&send){
        X.prototype.open=function(method,url,...rest){this.__vkeTranscriptUrl=String(url||'');return open.call(this,method,url,...rest);};
        X.prototype.send=function(...args){
          try{this.addEventListener('load',()=>{const u=String(this.__vkeTranscriptUrl||this.responseURL||'');if(looksLikeTranscriptResource(u))consume(u,typeof this.responseText==='string'?this.responseText:'');},{once:true});}catch{}
          return send.apply(this,args);
        };
      }
    }catch{}
  }

  async function scanTranscriptResources(v){
    if(!v||!current.id)return [];
    const urls=[];
    try{
      for(const r of reachableRoots())for(const e of r.querySelectorAll?.('track[src],track')||[]){const u=e.currentSrc||e.src||e.getAttribute('src');if(u)urls.push(u);}
    }catch{}
    try{for(const e of performance.getEntriesByType('resource')||[]){const u=e?.name;if(u&&looksLikeTranscriptResource(u))urls.push(u);}}catch{}
    const unique=[...new Set(urls)];
    for(const u of unique.slice(-12)){
      let text='';
      try{const r=await fetch(u,{credentials:'include'});if(r?.ok)text=await r.text();}catch{}
      if(!text){try{text=String((await bridgeFetchText(u))?.text||'');}catch{}}
      if(text){let p=parseVttText(text);if(!p.length)p=parseSrtText(text);if(p.length&&publishTranscript(p,current.id,'resource'))return p;}
    }
    return [];
  }

  installTranscriptNetworkCapture();

  async function readTextTracks(v){
    if(!v)return [];
    emitTranscriptDebug('Проверяю TextTracks у активного плеера');
    let best=[];
    try{
      const tracks=v.textTracks;
      if(!tracks||!tracks.length)return [];
      emitTranscriptDebug(`TextTracks обнаружены: ${tracks.length}`);
      for(let i=0;i<tracks.length;i++){
        const track=tracks[i]; if(track.kind&&track.kind!=='subtitles'&&track.kind!=='captions')continue;
        const previous=track.mode;
        try{if(track.mode==='disabled')track.mode='showing';}catch{}
        try{
          const deadline=Date.now()+12000;
          while(Date.now()<deadline&&current.video===v){
            let parsed=[]; try{parsed=normalizeCues(track.cues?Array.from(track.cues):[]);}catch{}
            if(parsed.length){
              if(parsed.length>best.length)best=parsed;
              publishTranscript(parsed,current.id,'TextTrack');
              const dur=Number(v.duration)||0;
              if(!dur||parsed[parsed.length-1].end>=dur*.8)break;
            }
            await new Promise(r=>setTimeout(r,250));
          }
        }catch(e){emitTranscriptDebug('Ошибка чтения TextTracks:',e?.message||String(e));}
        try{track.mode='hidden';}catch{try{track.mode=previous;}catch{}}
      }
    }catch{}
    return best;
  }

  async function loadTranscriptFromVideo(v){
    if(!v) return [];
    let best=[];
    const startedAt=Date.now();
    const maxWait=20000;

    // Prefer the exact active player first. This mirrors the GitHub transcript
    // implementation: locate the player video, inspect TextTracks, temporarily
    // enable disabled tracks as hidden, and wait for cues to materialize.
    const initialCandidates=transcriptCandidates(v).slice(0,12);
    const candidates=[v,...initialCandidates.filter(x=>x!==v)];

    for(const candidate of candidates){
      if(!candidate || !candidate.textTracks) continue;
      try{
        const tracks=Array.from(candidate.textTracks||[]);
        for(const track of tracks){
          if(track.kind && track.kind!=='subtitles' && track.kind!=='captions') continue;
          const previousMode=track.mode;
          try{
            if(track.mode==='disabled') track.mode='hidden';
          }catch{}

          let parsed=[];
          try{
            parsed=normalizeCues(track.cues ? Array.from(track.cues) : []);
            if(!parsed.length){
              const deadline=Math.min(startedAt+maxWait,Date.now()+8000);
              while(Date.now()<deadline){
                if(current.video!==v) return best;
                try{
                  if(track.cues && track.cues.length){
                    parsed=normalizeCues(Array.from(track.cues));
                    if(parsed.length) break;
                  }
                }catch{}
                await new Promise(resolve=>setTimeout(resolve,250));
              }
            }
          }catch(e){
            emitTranscriptDebug('Ошибка чтения TextTracks:',e?.message||String(e));
          }

          if(parsed.length>best.length) best=parsed;
          try{ track.mode='hidden'; }catch{ try{ track.mode=previousMode; }catch{} }

          if(best.length){
            const lastEnd=best[best.length-1].end;
            const dur=Number(candidate.duration)||0;
            if(!dur || lastEnd>=dur*0.8) return best;
          }
          if(Date.now()-startedAt>=maxWait) break;
        }
      }catch{}
      if(Date.now()-startedAt>=maxWait) break;
    }

    await scanTranscriptResources(v);

    // VK may create <track> elements after TextTrackList becomes visible.
    // Fetch their actual resources immediately instead of waiting a full minute.
    const trackUrls=[];
    for(const candidate of candidates){
      try{
        for(const el of candidate.querySelectorAll?.('track[src],track')||[]){
          const src=el.currentSrc||el.src||el.getAttribute('src');
          if(src) trackUrls.push(src);
        }
      }catch{}
    }
    for(const url of [...new Set(trackUrls.concat(trackUrlsFromAllRoots()))]){
      try{
        const r=await bridgeFetchText(url);
        const text=String(r.text||'');
        let parsed=parseVttText(text);
        if(!parsed.length) parsed=parseSrtText(text);
        if(parsed.length>best.length) best=parsed;
        if(best.length){
          const dur=Number(v.duration)||0;
          const coverage=best[best.length-1].end/(dur||best[best.length-1].end);
          if(coverage>=0.8) return best;
        }
      }catch{}
    }

    return best;
  }

  async function loadTranscript(){
    const expectedId=current.id;
    if(!expectedId){ console.info('[VKE TRANSCRIPT] Пропуск: videoId ещё не определён'); return false; }
    if(current.video && !current.video.isConnected){ console.info('[VKE TRANSCRIPT] Пропуск: video недействителен'); return false; }
    emitTranscriptDebug('Начинаю поиск текста видео', `; videoId=${expectedId}`);
    if(!expectedId)return false;
    if(current.transcriptLoadedFor===expectedId && current.transcript.length)return true;
    if(transcriptPromise)return transcriptPromise;
    if(Date.now()-Number(current.transcriptAttemptAt||0)<5000)return false;
    current.transcriptAttemptAt=Date.now();
    const initialVideo=current.video;
    const initialId=expectedId;
    transcriptPromise=(async()=>{
      try{
        console.info('[VKE TRANSCRIPT] Ищу TextTrack, <track src> и transcript-ресурсы…');
        const cues=await loadTranscriptFromVideo(initialVideo);
        if(current.id!==initialId)return false;
        if(cues.length){
          publishTranscript(cues,expectedId,'loader');
          emitTranscriptDebug(`Текст загружен: ${cues.length} cue`,`; покрытие до ${fmt(cues[cues.length-1].end)}`);
          try{
            window.dispatchEvent(new CustomEvent('vke-transcript-updated',{detail:{count:cues.length,videoId:expectedId}}));
            window.dispatchEvent(new CustomEvent('vke-transcript-ready',{detail:{videoId:expectedId,cues:cues.map(x=>({start:x.start,end:x.end,text:x.text}))}}));
          }catch{}
          return true;
        }
        emitTranscriptDebug('Текст видео не найден после всех способов поиска');
        try{window.dispatchEvent(new CustomEvent('vke-transcript-updated',{detail:{count:0,videoId:expectedId}}));}catch{}
        return false;
      }finally{ transcriptPromise=null; }
    })();
    return transcriptPromise;
  }

  const AD_WORDS = [
    /спонсор/i,/спонсиру(ет|ют|ем|етcя)/i,/реклам/i,/промокод/i,/скидк/i,/по\s+промокоду/i,
    /переходите\s+по\s+ссылке/i,/ссылка\s+в\s+описании/i,/по\s+ссылке/i,/партн[её]р/i,
    /подписывайтесь\s+на\s+канал/i,/ставьте\s+лайк/i,/магазин/i,/купить/i
  ];

  function detectTextAdHints(){
    if(!current.transcript.length)return;
    const hits=[];
    for(const c of current.transcript){
      const hit=AD_WORDS.some(re=>re.test(c.text));
      if(hit)hits.push(c);
    }
    if(!hits.length)return;
    // Group nearby cue hits into local yellow "possible ad" hints.
    const groups=[]; let g=null;
    for(const c of hits){
      if(!g||c.start-g.end>3){g={start:c.start,end:c.end,text: c.text};groups.push(g);}else{g.end=Math.max(g.end,c.end);g.text+=' '+c.text;}
    }
    current.transcriptAdHints=groups.filter(x=>x.end-x.start>=1);
    if(current.id && current.transcriptAdHints.length) emitTranscriptDebug(`Подозрительные по тексту: ${current.transcriptAdHints.length} фрагм.`);
  }

  function renderTranscriptAdHints(){
    // Yellow hints are local only; they do not become server segments and never
    // affect normal AdSkip skipping. This is deliberately diagnostic for now.
    const tl=findTimelineSlider(current.video); if(!tl)return;
    const host=tl.parentElement||tl; let layer=host.querySelector(':scope > #vke-transcript-hints-v1');
    if(!layer){layer=document.createElement('div');layer.id='vke-transcript-hints-v1';host.style.position=host.style.position||'relative';host.appendChild(layer);}
    layer.style.cssText='position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;z-index:31;';
    layer.innerHTML=''; const dur=current.duration||current.video?.duration||0; if(!dur)return;
    for(const h of current.transcriptAdHints||[]){const s=document.createElement('span');s.style.cssText=`position:absolute;top:0;bottom:0;left:${h.start/dur*100}%;width:${Math.max(.15,(h.end-h.start)/dur*100)}%;background:#4aa3ff;opacity:.9;border-radius:2px;`;layer.appendChild(s);}
  }

  // --- End transcript layer ---

  async function createSegment(payload){
    const r=await api('/markup',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({...payload,user_id:userId})
    });
    if(r.status!==204&&!r.ok)throw new Error('HTTP '+r.status);
  }

  async function vote(seg,vote){
    try{
      await api('/vote',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({
          video_id:current.id,category_id:Number(seg.category_id),
          start:Number(seg.start),end:Number(seg.end),vote:!!vote,user_id:userId
        })
      });
      return true;
    }catch{return false;}
  }

  function findControls(v){
    if(!v)return null;
    const root=v.getRootNode?.();
    const direct=root?.querySelector?.('.controls-right');
    if(direct)return direct;
    let n=v;
    for(let i=0;i<24&&n;i++){
      const parent=n.parentNode||n.parentElement;
      const c=parent?.querySelector?.('.controls-right'); if(c)return c;
      if(parent?.host){const c2=parent.host.shadowRoot?.querySelector?.('.controls-right');if(c2)return c2;n=parent.host;}
      else n=parent;
    }
    for(const r of roots()){const c=r.querySelector?.('.controls-right');if(c)return c;}
    return null;
  }

  function ensureShadowStyle(root){
    if(!root?.querySelector)return;
    if(root.querySelector('style[data-vke-segment-shadow-style]'))return;
    const st=document.createElement('style');st.setAttribute('data-vke-segment-shadow-style','1');
    st.textContent=`
      #${BUTTON_ID}-wrap{display:flex!important;align-items:center!important;height:100%!important;flex:0 0 auto!important}
      #${BUTTON_ID}{width:40px!important;height:40px!important;min-width:40px!important;min-height:40px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;padding:0!important;margin:0 0 0 4px!important;border:0!important;border-radius:50%!important;background:transparent!important;color:#fff!important;cursor:pointer!important}
      #${BUTTON_ID}:hover,#${BUTTON_ID}.vke-btn-hover{background:rgba(255,255,255,.13)!important;opacity:1!important} #${BUTTON_ID}.vke-btn-active{background:rgba(81,129,184,.22)!important;box-shadow:0 0 0 1px rgba(81,129,184,.28),0 0 14px rgba(81,129,184,.18)!important;opacity:1!important} #${BUTTON_ID}.vke-btn-active{background:rgba(81,129,184,.22)!important;box-shadow:0 0 0 1px rgba(81,129,184,.28),0 0 14px rgba(81,129,184,.18)!important;opacity:1!important}
      #${BUTTON_ID} svg{width:21px!important;height:21px!important;display:block!important;fill:currentColor!important}
    `; root.appendChild(st);
  }

  function gearSvg(){return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m19.43 12.98 1.23.96-1.5 2.6-1.49-.6a7.53 7.53 0 0 1-1.3.75L16.2 18.3h-3l-.23-1.61a7.53 7.53 0 0 1-1.3-.75l-1.49.6-1.5-2.6 1.23-.96a7.1 7.1 0 0 1 0-1.96l-1.23-.96 1.5-2.6 1.49.6c.4-.3.84-.55 1.3-.75L13.2 5.3h3l.23 1.61c.46.2.9.45 1.3.75l1.49-.6 1.5 2.6-1.23.96a7.1 7.1 0 0 1 0 1.96ZM14.7 12a2.7 2.7 0 1 0-5.4 0 2.7 2.7 0 0 0 5.4 0Z"/></svg>`}

  function injectButton(v){
    const c=findControls(v); if(!c)return;
    ensureShadowStyle(c.getRootNode?.()||c);
    if(c.querySelector?.('#'+BUTTON_ID+'-wrap'))return;
    const wrap=document.createElement('div'); wrap.id=BUTTON_ID+'-wrap'; wrap.className='btn-container vke-extension-btn-container';
    const tooltip=document.createElement('div'); tooltip.className='tooltip-wrapper s-23 full-width';
    const b=document.createElement('button'); b.id=BUTTON_ID; b.type='button'; b.className='btn s-26';
    b.setAttribute('aria-label','Метки и пропуск сегментов'); b.setAttribute('title','Сегменты видео'); b.innerHTML=gearSvg();
    b.style.cssText='width:40px;height:40px;min-width:40px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:50%;background:rgba(255,255,255,.06);color:#fff;cursor:pointer;transition:background .16s ease,box-shadow .16s ease,opacity .16s ease;opacity:.82;';
    b.addEventListener('mouseenter',()=>b.style.background='rgba(127,127,127,.16)',true); b.addEventListener('mouseleave',()=>b.style.background='transparent',true);
    b.addEventListener('mouseenter',()=>b.classList.add('vke-btn-hover'),true); b.addEventListener('mouseleave',()=>b.classList.remove('vke-btn-hover'),true);
    b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openPanel(b);},true); updateButtonState();
    tooltip.appendChild(b); wrap.appendChild(tooltip);
    const context=c.querySelector?.('[data-testid="btn-context-menu"]'); const target=context?.closest?.('.btn-container')||context?.parentElement;
    if(target&&target.parentNode===c)c.insertBefore(wrap,target);else c.appendChild(wrap);
  }

  function findControlsRoot(v){
    if(!v)return null;
    const selectors=['.controls-left','[class*="controls-left"]','[data-testid*="controls-left"]','[class*="video-controls"]'];
    for(const r of roots()){
      for(const sel of selectors){
        try{const e=r.querySelector?.(sel);if(e)return e;}catch{}
      }
    }
    let n=v;
    for(let i=0;i<18&&n;i++,n=n.parentElement){
      const e=n.querySelector?.('.controls-left,[class*="controls-left"],[data-testid*="controls-left"]');
      if(e)return e;
    }
    return null;
  }

  function findVolumeAnchor(v,root){
    const selectors=['[data-testid*="volume"]','[aria-label*="громк" i]','[aria-label*="volume" i]','[class*="volume"]','[class*="Volume"]'];
    for(const sel of selectors){
      try{const e=root?.querySelector?.(sel)||root?.parentElement?.querySelector?.(sel);if(e)return e;}catch{}
    }
    return null;
  }

  function formatTranscriptLine(cue){
    return `<span class="vke-txt-hit-time">[${escapeHtml(fmt(cue.start))}]</span> <span class="vke-txt-hit-text">${escapeHtml(cue.text)}</span>`;
  }

  function closeTranscriptSearchPanel(){
    const p=document.getElementById('vke-transcript-search-panel-v1');
    if(p)p.remove();
    document.removeEventListener('pointerdown',outsideTranscriptSearch,true);
  }

  function outsideTranscriptSearch(e){
    const p=document.getElementById('vke-transcript-search-panel-v1');
    const b=document.getElementById('vke-transcript-search-button-v1');
    if(p&&!p.contains(e.target)&&e.target!==b)closeTranscriptSearchPanel();
  }

  function openTranscriptSearch(anchor){
    closeTranscriptSearchPanel();
    const p=document.createElement('div'); p.id='vke-transcript-search-panel-v1';
    p.innerHTML=`<div class="vke-txt-search-head"><strong>Поиск по словам в тексте</strong><button type="button" data-close>×</button></div>
      <input class="vke-txt-search-input" type="search" autocomplete="off" placeholder="Введите слово или фразу…">
      <div class="vke-txt-search-status" data-status>Ищем дорожку…</div>
      <div class="vke-txt-search-results" data-results></div>`;
    document.body.appendChild(p);
    const input=p.querySelector('.vke-txt-search-input'), status=p.querySelector('[data-status]'), results=p.querySelector('[data-results]');
    const render=()=>{
      const q=String(input?.value||'').trim().toLocaleLowerCase('ru-RU');
      const cues=Array.isArray(current.transcript)?current.transcript:[];
      if(!cues.length){status.textContent='Текст видео ещё не загружен. Ищем дорожку…';results.innerHTML='';if(current.id&&!transcriptPromise)loadTranscript();return;}
      status.textContent=`Текст загружен: ${cues.length} фрагм.`;
      if(!q){results.innerHTML='<div class="vke-txt-search-empty">Введите слово или фразу.</div>';return;}
      const terms=q.split(/\s+/).filter(Boolean);
      const matches=cues.filter(c=>{const t=String(c.text||'').toLocaleLowerCase('ru-RU');return terms.every(term=>t.includes(term));}).slice(0,150);
      if(!matches.length){results.innerHTML='<div class="vke-txt-search-empty">Ничего не найдено.</div>';return;}
      results.innerHTML=matches.map((c,i)=>`<button type="button" class="vke-txt-hit" data-i="${i}">${formatTranscriptLine(c)}</button>`).join('');
      results.querySelectorAll('[data-i]').forEach(btn=>btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const c=matches[Number(btn.dataset.i)];if(c){safeTime(Math.max(0,Number(c.start||0)-1));closeTranscriptSearchPanel();}},true));
    };
    input?.addEventListener('input',render);
    p.querySelector('[data-close]').addEventListener('click',()=>closeTranscriptSearchPanel());
    render();
    const ar=anchor?.getBoundingClientRect?.();
    if(ar){p.style.left=Math.max(8,Math.min(innerWidth-p.offsetWidth-8,ar.left))+'px';p.style.bottom=Math.max(8,innerHeight-ar.top+10)+'px';}
    requestAnimationFrame(()=>document.addEventListener('pointerdown',outsideTranscriptSearch,true));
    setTimeout(()=>input?.focus(),0);
  }

  function injectTranscriptSearchButton(v){
    const root=findControlsRoot(v); if(!root)return;
    if(root.querySelector?.('#vke-transcript-search-button-v1'))return;
    const btn=document.createElement('button');
    btn.type='button'; btn.id='vke-transcript-search-button-v1'; btn.className='vke-transcript-search-button';
    btn.setAttribute('aria-label','Поиск по словам в тексте'); btn.title='Поиск по словам в тексте';
    btn.innerHTML='<span class="vke-transcript-search-label">Поиск по словам в тексте</span>';
    btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openTranscriptSearch(btn);},true);
    const volume=findVolumeAnchor(v,root);
    if(volume&&volume.parentNode===root)root.insertBefore(btn,volume);else{
      const time=root.querySelector?.('[class*="time"],[data-testid*="time"]');
      if(time?.parentNode===root) time.parentNode.insertBefore(btn,time.nextSibling); else root.appendChild(btn);
    }
    const updateState=()=>{const n=current.transcript?.length||0;btn.classList.toggle('vke-transcript-ready',n>0);};
    window.addEventListener('vke-transcript-updated',updateState);
    updateState();
  }

  function panelBase(){
    let p=document.getElementById(PANEL_ID); if(p)p.remove();
    p=document.createElement('div');p.id=PANEL_ID;
    p.className='vke-segment-panel';
    return p;
  }

  function updateButtonState(){ const b=document.getElementById(BUTTON_ID); if(b) b.classList.toggle('vke-btn-active', !!settings.enabled); }

  function openPanel(anchor){
    const p=panelBase();
    const segHtml=current.segments.length?current.segments.map((s,i)=>{
      const cat=category(s.category_id);
      return `<div class="vke-seg-item" data-i="${i}">
        <span class="vke-seg-dot" style="background:${cat.color}"></span>
        <button class="vke-seg-jump">${cat.name}<span>${fmt(s.start)}–${fmt(s.end)}</span></button>
        <span class="vke-seg-votes"><button data-v="1">✓</button><button data-v="0">×</button></span>
      </div>`;
    }).join(''):'<div class="vke-seg-empty">Для этого видео ещё нет отмеченных сегментов.</div>';

    p.innerHTML=`
      <div class="vke-seg-head"><strong>Сегменты видео</strong><button data-close>×</button></div>
      <label class="vke-seg-toggle"><span>Включить пропуск</span><input type="checkbox" data-enabled ${settings.enabled?'checked':''}></label>
      <label class="vke-seg-toggle"><span>Показывать сегменты на таймлайне</span><input type="checkbox" data-timeline ${settings.showTimeline?'checked':''}></label>
      <div class="vke-seg-cats">${Object.entries(CATS).map(([id,c])=>`<label><span><i style="background:${c.color}"></i>${c.name}</span><input type="checkbox" data-cat="${id}" ${settings.categories[id]?'checked':''}></label>`).join('')}</div>
      <div class="vke-seg-list">${segHtml}</div>
      <button class="vke-seg-primary" data-add>＋ Отметить текущий сегмент</button>`;
    document.body.appendChild(p);

    p.querySelector('[data-close]').onclick=()=>{p._vkeSearchCleanup?.();p.remove();};

    p.querySelector('[data-enabled]').onchange=e=>{settings.enabled=e.target.checked;save(); updateButtonState();};
    p.querySelector('[data-timeline]').onchange=e=>{settings.showTimeline=e.target.checked;save();renderTimeline();};
    p.querySelectorAll('[data-cat]').forEach(x=>x.onchange=()=>{settings.categories[x.dataset.cat]=x.checked;save();});
    p.querySelector('[data-add]').onclick=()=>openEditor();

    p.querySelectorAll('.vke-seg-jump').forEach(btn=>btn.onclick=()=>{
      const i=Number(btn.parentElement.dataset.i),s=current.segments[i];
      if(current.video)safeTime(Math.max(0,Number(s.start||0)-1));
    });
    p.querySelectorAll('[data-v]').forEach(btn=>btn.onclick=async()=>{
      const item=btn.closest('.vke-seg-item'); const s=current.segments[Number(item.dataset.i)];
      btn.disabled=true; await vote(s,btn.dataset.v==='1'); btn.disabled=false;
    });

    const r=anchor.getBoundingClientRect();
    let x=Math.min(innerWidth-p.offsetWidth-12,Math.max(12,r.right-p.offsetWidth));
    let y=Math.max(12,r.top-p.offsetHeight-10); if(y<12)y=Math.min(innerHeight-p.offsetHeight-12,r.bottom+10);
    p.style.left=x+'px';p.style.top=y+'px';
    requestAnimationFrame(()=>document.addEventListener('pointerdown',outside,true));
  }

  function outside(e){
    const p=document.getElementById(PANEL_ID),b=document.getElementById(BUTTON_ID);
    if(p&&!p.contains(e.target)&&e.target!==b){p.remove();document.removeEventListener('pointerdown',outside,true);}
  }

  function openEditor(){
    const old=document.getElementById(PANEL_ID); if(old)old.remove();
    const p=panelBase();
    const now=Math.max(0,Math.round(current.video?.currentTime||0));
    const end=Math.min(Math.max(now+10,now+1),current.duration||now+10);
    p.innerHTML=`<div class="vke-seg-head"><strong>Добавить сегмент</strong><button data-close>×</button></div>
      <label>Начало<input data-start value="${fmt(now)}"></label>
      <label>Конец<input data-end value="${fmt(end)}"></label>
      <label>Тип<select data-cat>${Object.entries(CATS).map(([id,c])=>`<option value="${id}">${c.name}</option>`).join('')}</select></label>
      <div class="vke-seg-presets"><button data-p="start">Текущая → начало</button><button data-p="end">Текущая → конец</button></div>
      <button class="vke-seg-primary" data-save>Отправить сегмент</button>
      <div class="vke-seg-error"></div>`;
    document.body.appendChild(p);
    p.querySelector('[data-close]').onclick=()=>p.remove();
    p.querySelector('[data-p="start"]').onclick=()=>p.querySelector('[data-start]').value=fmt(now);
    p.querySelector('[data-p="end"]').onclick=()=>p.querySelector('[data-end]').value=fmt(now);
    p.querySelector('[data-save]').onclick=async()=>{
      const s=parseTime(p.querySelector('[data-start]').value),e=parseTime(p.querySelector('[data-end]').value),cat=Number(p.querySelector('[data-cat]').value);
      const err=p.querySelector('.vke-seg-error');
      if(!(e>s)){err.textContent='Конец должен быть позже начала.';return;}
      if(current.duration&&e>current.duration){err.textContent='Сегмент выходит за пределы видео.';return;}
      const btn=p.querySelector('[data-save]');btn.disabled=true;
      try{
        await createSegment({video_id:current.id,category_id:cat,data:{intervals:[{start:Math.round(s),end:Math.round(e)}]},duration:current.duration||undefined});
        current.segments.push({category_id:cat,start:Math.round(s),end:Math.round(e)});
        current.segments.sort((a,b)=>a.start-b.start); renderTimeline();
        p.remove();
        alert('Сегмент отправлен. После обработки он станет общим для пользователей.');
      }catch{err.textContent='Не удалось отправить сегмент.';btn.disabled=false;}
    };
  }

  function escapeHtml(value){
    return String(value||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function fmt(x){
    x=Math.max(0,Math.round(Number(x)||0));const s=x%60,m=Math.floor(x/60)%60,h=Math.floor(x/3600),pad=n=>String(n).padStart(2,'0');
    return h?`${h}:${pad(m)}:${pad(s)}`:`${m}:${pad(s)}`;
  }
  function parseTime(v){
    const p=String(v).trim().split(':').map(x=>Number(x));
    if(p.some(Number.isNaN)||p.length>3)return NaN;
    if(p.length===1)return p[0]; if(p.length===2)return p[0]*60+p[1]; return p[0]*3600+p[1]*60+p[2];
  }
  function safeTime(t){try{current.video.currentTime=Math.max(0,Math.min(current.duration||1e9,t));current.video.play?.();}catch{}}

  function findTimelineSlider(v){
    if(!v)return null;
    const candidates=[];
    for(const r of roots()){
      r.querySelectorAll?.('[data-testid="progress_bar"], .timeline-slider, [aria-label="Ползунок временной шкалы"]')?.forEach(x=>candidates.push(x));
    }
    let best=null,bestScore=-Infinity;
    const vb=v.getBoundingClientRect?.();
    for(const el of [...new Set(candidates)]){
      if(!el?.isConnected)continue;
      const b=el.getBoundingClientRect?.(); if(!b||b.width<120||b.height<2)continue;
      const bars=el.querySelector?.('.bars');
      const score=(vb?Math.max(0,1000-Math.hypot((b.left+b.right)/2-(vb.left+vb.right)/2,(b.top+b.bottom)/2-(vb.top+vb.bottom)/2)):0)+(bars?500:0)+(el.matches?.('[data-testid="progress_bar"]')?1000:0);
      if(score>bestScore){bestScore=score;best=el;}
    }
    return best;
  }

  function renderTimeline(){
    const old=document.querySelector?.('#'+TL_ID);
    if(!settings.showTimeline||!current.video){old?.remove();return;}
    const tl=findTimelineSlider(current.video);
    if(!tl){old?.remove();return;}
    const host=tl.querySelector?.('.bars')||tl;
    if(getComputedStyle(host).position==='static') host.style.position='relative';
    let layer=host.querySelector?.('#'+TL_ID);
    if(!layer){
      layer=document.createElement('div');
      layer.id=TL_ID; layer.setAttribute('aria-hidden','true');
      host.appendChild(layer);
    }
    layer.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:9999;overflow:hidden;border-radius:inherit;';
    const dur=current.duration;
    layer.innerHTML='';
    if(!dur||!current.segments.length)return;
    for(const s of current.segments){
      const b=document.createElement('span');
      const cat=category(s.category_id);
      b.className='vke-seg-mark';
      b.style.cssText=`position:absolute;top:0;bottom:0;left:${Math.max(0,Math.min(100,s.start/dur*100))}%;width:${Math.max(.12,Math.min(100,(s.end-s.start)/dur*100))}%;background:${cat.color};opacity:.78;box-shadow:0 0 2px rgba(0,0,0,.25);`;
      layer.appendChild(b);
    }
  }


  function isCategoryEnabled(categoryId){
    const id=Number(categoryId);
    if(!CATS[id]) return false;
    return settings.categories[id] !== false;
  }

  function shouldSkip(seg){
    return settings.enabled && isCategoryEnabled(seg.category_id) && !!CATS[Number(seg.category_id)]?.skip;
  }

  // VK AD SKIP-compatible bundling/barrier semantics:
  // enabled segments that touch within 150 ms are treated as one block;
  // a disabled/non-skippable category acts as a barrier.
  const MERGE_GAP=0.15;
  const LATE_ENTRY_LIMIT=3;
  const BARRIER_SUGGESTION_MIN=5;
  let lastRunnerKey='';
  let lastRunnerAt=0;
  let suggestedBarrierKey='';
  let activeBarrier=null;

  function buildSkipBundle(list,index){
    const first=list[index];
    if(!first) return null;
    if(!shouldSkip(first)) return {skipped:[],mergedEndTrue:NaN,barrier:first};
    const skipped=[{start:first.start,end:first.end,categoryId:first.category_id}];
    let mergedEnd=first.end;
    let barrier=null;
    for(let i=index+1;i<list.length;i++){
      const seg=list[i];
      if(!seg || seg.start>mergedEnd+MERGE_GAP) break;
      if(!shouldSkip(seg)){
        barrier={start:seg.start,end:seg.end,categoryId:seg.category_id};
        break;
      }
      skipped.push({start:seg.start,end:seg.end,categoryId:seg.category_id});
      if(seg.end>mergedEnd) mergedEnd=seg.end;
    }
    return {skipped,mergedEndTrue:mergedEnd,barrier};
  }

  function runnerKey(videoId,bundle,barrier){
    const a=bundle.map(x=>`${x.start}-${x.end}-${x.categoryId}`).join('|');
    const b=barrier?`${barrier.start}-${barrier.end}-${barrier.categoryId}`:'none';
    return `${videoId}:bundle:${a}::barrier:${b}`;
  }

  function seekTo(t){
    try{
      const target=Math.max(0,Math.min(Number.isFinite(current.video?.duration)?current.video.duration:1e12,t));
      if(Math.abs((current.video?.currentTime||0)-target)<0.01)return;
      current.video.currentTime=target;
    }catch{}
  }

  function processSegments(now){
    if(!current.id || !current.segments.length) return;
    const v=current.video;
    if(!v || !v.isConnected || v.paused || v.ended || v.seeking || !Number.isFinite(now)) return;
    for(let i=0;i<current.segments.length;i++){
      const seg=current.segments[i];
      if(!seg || now<seg.start || now>=seg.end) continue;
      if(now-seg.start>LATE_ENTRY_LIMIT) return;
      if(activeBarrier){
        if(now<activeBarrier.start || now>=activeBarrier.end) activeBarrier=null;
      }
      const bundle=buildSkipBundle(current.segments,i);
      if(!bundle) return;
      const key=runnerKey(current.id,bundle.skipped,bundle.barrier);
      const perf=performance.now();
      if(key===lastRunnerKey && perf-lastRunnerAt<300) return;
      lastRunnerKey=key;
      lastRunnerAt=perf;

      if(bundle.skipped.length){
        const target=Math.max(bundle.mergedEndTrue+0.01,now);
        seekTo(target);
      }

      if(bundle.barrier && (bundle.barrier.end-bundle.barrier.start)>=BARRIER_SUGGESTION_MIN){
        const barrierKey=`${current.id}:barrier:${bundle.barrier.start}-${bundle.barrier.end}-${bundle.barrier.categoryId}`;
        if(barrierKey!==suggestedBarrierKey){
          suggestedBarrierKey=barrierKey;
          activeBarrier={start:bundle.barrier.start,end:bundle.barrier.end};
          // The original service uses a suggestion notification here. VKE keeps
          // the behavior silent unless the user opens the segment panel.
        }
      }
      return;
    }
  }

  function resetRunner(){
    skipState.clear();
    lastRunnerKey='';
    lastRunnerAt=0;
    suggestedBarrierKey='';
    activeBarrier=null;
  }

  function extensionContextAlive(){
    try { return !!(chrome?.runtime?.id); } catch { return false; }
  }

  // Independent transcript bootstrap. Do not depend on the segment engine's
  // visibility-filtered activeVideo() pass: VK can keep the real player outside
  // the current viewport while its transcript/textTracks are initialized.
  let transcriptBootstrapVideo = null;
  let transcriptBootstrapId = null;
  let transcriptBootstrapTimer = 0;

  function findVKMainPlayerVideo(){
    const candidates=[];
    const isClipNode=v=>{
      try{return !!v.closest?.('[data-testid="clips-feed-item"],[data-testid="clipcontainer-video"],.ClipsFeedControlsLayout__root--ZtEMP')}catch{return false;}
    };
    const isAdNode=v=>{
      try{return !!v.closest?.('.ads-container,[data-testid="ad-container"],.ad-container,[class*="advert"]')}catch{return false;}
    };
    for(const r of reachableRoots()){
      try{
        for(const v of r.querySelectorAll?.('video')||[]){
          if(!v?.isConnected || isAdNode(v)) continue;
          // The transcript belongs to the main VK Video player.  Do not require
          // a specific custom-element wrapper: VK has changed that wrapper more
          // than once while keeping video.player-media and data-testid markers.
          candidates.push(v);
        }
      }catch{}
    }
    if(!candidates.length) return null;
    const clipPage = /\/clip(?:[-/]|$)/i.test(location.pathname);
    candidates.sort((a,b)=>{
      const score=v=>{
        let n=0;
        try{
          const host=v.closest?.('vk-video-player,[data-testid="video-player"],[data-testid="video-player-container"]');
          if(host)n+=7_000_000;
          if(v.matches?.('video.player-media'))n+=2_500_000;
          if(v.matches?.('.vke-force-fill-video'))n+=900_000;
          if(v.currentSrc)n+=650_000;
          if(v.readyState>=1)n+=280_000;
          if(Number(v.duration)>0)n+=300_000;
          if(!v.paused&&!v.ended)n+=1_500_000;
          try{n+=Number(v.textTracks?.length||0)*500_000;}catch{}
          const r=v.getBoundingClientRect?.();
          const area=r?Math.max(0,r.width*r.height):0;
          n+=Math.min(area,6_000_000);
          if(isClipNode(v)){ n += clipPage ? 500_000 : -8_000_000; }
          if(r){
            if(r.width<160||r.height<90)n-=4_000_000;
            if(r.bottom<0||r.right<0||r.top>innerHeight||r.left>innerWidth)n-=1_500_000;
          }
        }catch{}
        return n;
      };
      return score(b)-score(a);
    });
    return candidates[0]||null;
  }

  function transcriptBootstrapStep(){
    if(!extensionContextAlive()) return;
    const v=findVKMainPlayerVideo();
    if(v && v!==transcriptBootstrapVideo){
      transcriptBootstrapVideo=v;
      current.video=v;
      current.id=extractId(v) || current.id || extractId(document.body) || (location.href.match(/video(-?\d+_\d+)/i)?.[1]||null);
      current.duration=Number(v.duration)||current.duration||0;
      transcriptBootstrapId=current.id;
      current.transcript=[];
      current.transcriptLoadedFor=null;
      current.transcriptAttemptAt=0;
      console.info('[VKE TRANSCRIPT] Активный VK Video найден:', current.id || '(videoId не найден)', 'readyState=', v.readyState, 'src=', !!v.currentSrc, 'tracks=', (()=>{try{return v.textTracks?.length||0}catch{return 0}})());
      try{
        const retry=()=>{
          current.duration=Number(v.duration)||current.duration||0;
          current.transcriptAttemptAt=0;
          if(current.id && !transcriptPromise) loadTranscript();
        };
        v.addEventListener('loadedmetadata',retry,{once:false});
        v.addEventListener('durationchange',()=>{current.duration=Number(v.duration)||current.duration||0;}, {passive:true});
        v.addEventListener('canplay',retry,{once:false});
        v.addEventListener('progress',retry,{once:false});
        try{v.textTracks?.addEventListener?.('addtrack',retry);}catch{}
      }catch{}
    }
    if(v && current.id){
      try{
        if(v.textTracks?.length){
          const hasPlayable=[...v.textTracks].some(t=>t.kind==='subtitles'||t.kind==='captions');
          if(hasPlayable && current.transcriptLoadedFor!==current.id && !transcriptPromise){
            current.transcriptAttemptAt=0;
            loadTranscript();
          }
        }
      }catch{}
      if(current.transcriptLoadedFor!==current.id && !transcriptPromise && Date.now()-Number(current.transcriptAttemptAt||0)>=1500){
        loadTranscript();
      }
    }
  }

  function startTranscriptBootstrap(){
    if(transcriptBootstrapTimer) return;
    transcriptBootstrapStep();
    transcriptBootstrapTimer=setInterval(transcriptBootstrapStep,500);
  }

  function tick(){
    if(!extensionContextAlive()){
      timer=0;
      try{ document.getElementById(PANEL_ID)?.remove(); }catch{}
      return;
    }
    const v=activeVideo();
    if(v!==current.video){
      document.getElementById(PANEL_ID)?.remove();
      current.video=v;
      current.id=v?extractId(v):null;
      current.duration=Number.isFinite(v?.duration)?v.duration:0;
      current.loadedFor=null;
      current.loadedDuration=0;
      current.transcript=[];
      current.transcriptLoadedFor=null;
      current.transcriptAttemptAt=0;
      current.transcriptAdHints=[];
      resetRunner();
      if(v){injectButton(v);renderTimeline();
        lastDetectedVideoKey=`${current.id||'no-id'}:${Math.round(current.duration||0)}`;
        console.info('[VKE SEGMENTS] Активное видео:', current.id, 'duration=', current.duration);
      }
    } else if(v){
      injectButton(v);
      injectTranscriptSearchButton(v);
    }
    if(!v){timer=setTimeout(tick,250);return;}
    if(v.duration&&current.duration!==v.duration){current.duration=v.duration;renderTimeline();}
    if(current.id)loadSegments(current.id,current.duration);
    // Transcript acquisition is driven by the independent bootstrap above.

    detectTextAdHints();
    renderTranscriptAdHints();
    observeAds();
    if(v)renderTimeline();
    if(!v.paused&&!v.seeking&&!v.ended&&settings.enabled){
      processSegments(v.currentTime);
    }
    timer=setTimeout(tick,80);
  }


  // --- Advertisement diagnostics / prevention helpers ---
  const adState=new WeakMap();
  let lastAdActionAt=0;
  function adLikeElement(el){
    if(!(el instanceof Element))return false;
    const cls=String(el.className||''); const id=String(el.id||''); const aria=String(el.getAttribute?.('aria-label')||'');
    const test=(cls+' '+id+' '+aria).toLowerCase();
    return /(^|[-_\s])(ad|ads|advert|advertisement|commercial)([-_\s]|$)/i.test(test)||/реклам|оцените\s+vk\s+video/i.test(test)||el.matches?.('.ads-container,[data-testid="ad-container"]');
  }
  function visibleAdElement(el){
    if(!adLikeElement(el))return false;
    try{
      const cs=getComputedStyle(el),b=el.getBoundingClientRect();
      return cs.display!=='none'&&cs.visibility!=='hidden'&&Number(cs.opacity||1)>0.01&&b.width>20&&b.height>20;
    }catch{return false;}
  }
  function hideAdLayer(el){
    try{
      el.dataset.vkeAdSuppressed='1';
      el.style.setProperty('display','none','important');
      el.style.setProperty('visibility','hidden','important');
      el.style.setProperty('pointer-events','none','important');
      el.querySelectorAll?.('video,audio').forEach(m=>{try{m.pause();m.muted=true;m.volume=0;}catch{}});
    }catch{}
  }
  function findMainContentVideo(exclude){
    let best=null,score=-Infinity;
    for(const v of allVideos()){
      if(v===exclude)continue;
      const b=v.getBoundingClientRect?.(); if(!b||b.width<160||b.height<90)continue;
      let ad=false,n=v; for(let i=0;i<8&&n;i++,n=n.parentElement){if(adLikeElement(n)){ad=true;break;}}
      if(ad)continue;
      const area=b.width*b.height;
      const s=area+(v.paused?0:1e6)+(v.readyState>=3?150000:0)+(Number(v.duration)>0?100000:0)+(v.classList?.contains('player-media')?200000:0);
      if(s>score){score=s;best=v;}
    }
    return best;
  }
  function attemptSkipVkAd(){
    const now=Date.now(); if(now-lastAdActionAt<700)return false;
    const nodes=[];
    for(const r of reachableRoots()){
      for(const sel of ['.ads-container','[data-testid="ad-container"]']){
        try{r.querySelectorAll?.(sel).forEach(e=>{if(visibleAdElement(e)&&!nodes.includes(e))nodes.push(e);});}catch{}
      }
    }
    if(!nodes.length)return false;
    lastAdActionAt=now;
    console.info('[VKE AD DEBUG] VK ad layer detected; suppressing playback layer');
    nodes.forEach(hideAdLayer);
    const main=findMainContentVideo(null);
    if(main){
      try{main.muted=false; if(main.volume===0)main.volume=0.01;}catch{}
      try{main.play?.().catch?.(()=>{});}catch{}
    }
    return true;
  }
  function observeAds(){
    try{
      for(const r of reachableRoots()){
        try{r.querySelectorAll?.('[data-testid="qoe-btn"]').forEach(el=>{try{el.remove();}catch{try{el.style.setProperty('display','none','important');}catch{}}});}catch{}
      }
      attemptSkipVkAd();
      allVideos().forEach(v=>{
        const src=v.currentSrc||v.src||''; const state=adState.get(v)||{};
        const parentAd=(()=>{let n=v;for(let i=0;i<8&&n;i++,n=n.parentElement){if(adLikeElement(n))return true;}return false;})();
        const mediaAd=/(?:ad|advert|commercial|vast|vmg|prebid)/i.test(src);
        if(parentAd||mediaAd){
          if(!state.logged || state.src!==src){
            console.info('[VKE AD DEBUG] AD media detected',{src, currentTime:Number(v.currentTime||0),duration:Number(v.duration||0),muted:v.muted,volume:v.volume,paused:v.paused,parentAd});
            state.logged=true; state.src=src; adState.set(v,state);
          }
          try{v.pause();v.muted=true;v.volume=0;}catch{}
        }
      });
    }catch{}
  }

  const css=document.createElement('style');
  css.textContent=`
    #${BUTTON_ID}{width:40px!important;height:40px!important;min-width:40px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;padding:0!important;margin:0 0 0 4px!important;border:0!important;border-radius:50%!important;background:transparent!important;color:inherit!important;cursor:pointer!important}
    #${BUTTON_ID}:hover,#${BUTTON_ID}.vke-btn-hover{background:rgba(255,255,255,.13)!important;opacity:1!important} #${BUTTON_ID}.vke-btn-active{background:rgba(81,129,184,.22)!important;box-shadow:0 0 0 1px rgba(81,129,184,.28),0 0 14px rgba(81,129,184,.18)!important;opacity:1!important} #${BUTTON_ID}.vke-btn-active{background:rgba(81,129,184,.22)!important;box-shadow:0 0 0 1px rgba(81,129,184,.28),0 0 14px rgba(81,129,184,.18)!important;opacity:1!important}
    #${BUTTON_ID} svg{width:21px!important;height:21px!important;fill:currentColor!important}
    #vke-transcript-search-button-v1{height:30px!important;min-width:0!important;max-width:220px!important;padding:0 10px!important;margin:0 6px!important;border:0!important;border-radius:7px!important;background:rgba(255,255,255,.08)!important;color:#fff!important;cursor:pointer!important;font:500 12px/30px -apple-system,BlinkMacSystemFont,Roboto,sans-serif!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;vertical-align:middle!important;opacity:.86!important;transition:background .15s ease,opacity .15s ease!important;flex:0 1 auto!important;order:5!important}
    #vke-transcript-search-button-v1:hover{background:rgba(255,255,255,.15)!important;opacity:1!important}
    #vke-transcript-search-button-v1.vke-transcript-ready{background:rgba(81,129,184,.18)!important}
    .vke-transcript-search-label{display:block!important;overflow:hidden!important;text-overflow:ellipsis!important}
    #vke-transcript-search-panel-v1{position:fixed!important;z-index:2147483647!important;width:430px!important;max-height:min(560px,calc(100vh - 40px))!important;overflow:hidden!important;display:flex!important;flex-direction:column!important;padding:12px!important;border-radius:14px!important;background:#222!important;color:#fff!important;box-shadow:0 14px 50px rgba(0,0,0,.6)!important;font:13px/18px -apple-system,BlinkMacSystemFont,Roboto,sans-serif!important}
    #vke-transcript-search-panel-v1 *{box-sizing:border-box!important}
    .vke-txt-search-head{display:flex!important;align-items:center!important;justify-content:space-between!important;margin-bottom:8px!important;font-size:14px!important}
    .vke-txt-search-head button{border:0!important;background:none!important;color:#aaa!important;font-size:21px!important;line-height:20px!important;cursor:pointer!important}
    .vke-txt-search-input{width:100%!important;height:36px!important;padding:7px 10px!important;border-radius:9px!important;border:1px solid #444!important;background:#151515!important;color:#fff!important;outline:none!important}
    .vke-txt-search-status{padding:8px 2px!important;color:#aaa!important;font-size:11px!important}
    .vke-txt-search-results{overflow:auto!important;min-height:0!important;display:flex!important;flex-direction:column!important;gap:4px!important}
    .vke-txt-hit{display:block!important;width:100%!important;text-align:left!important;border:0!important;border-radius:8px!important;background:rgba(255,255,255,.05)!important;color:#fff!important;padding:8px 9px!important;cursor:pointer!important;font:13px/18px -apple-system,BlinkMacSystemFont,Roboto,sans-serif!important}
    .vke-txt-hit:hover{background:rgba(81,129,184,.22)!important}
    .vke-txt-hit-time{color:#8bb9e8!important;font-variant-numeric:tabular-nums!important}
    .vke-txt-hit-text{color:#fff!important}
    .vke-txt-search-empty{color:#aaa!important;padding:16px 4px!important;text-align:center!important}
    [data-testid="qoe-btn"]{display:none!important;visibility:hidden!important;pointer-events:none!important}
    #${PANEL_ID}{position:fixed!important;z-index:2147483647!important;width:360px!important;max-height:min(600px,calc(100vh - 24px))!important;overflow:auto!important;padding:14px!important;border-radius:14px!important;background:#222!important;color:#fff!important;box-shadow:0 14px 50px rgba(0,0,0,.6)!important;font:13px/18px -apple-system,BlinkMacSystemFont,Roboto,sans-serif!important}
    #${PANEL_ID} *{box-sizing:border-box!important}
    .vke-seg-head{display:flex!important;align-items:center!important;justify-content:space-between!important;margin-bottom:10px!important;font-size:15px!important}
    .vke-seg-head button{border:0!important;background:transparent!important;color:#aaa!important;font-size:20px!important;cursor:pointer!important}
    .vke-seg-toggle,.vke-seg-cats label{display:flex!important;align-items:center!important;justify-content:space-between!important;padding:6px 0!important}
    .vke-seg-cats{border-top:1px solid rgba(255,255,255,.08)!important;border-bottom:1px solid rgba(255,255,255,.08)!important;margin:8px 0!important;padding:6px 0!important}
    .vke-seg-cats i{display:inline-block!important;width:8px!important;height:8px!important;border-radius:2px!important;margin-right:7px!important}
    .vke-seg-list{display:flex!important;flex-direction:column!important;gap:5px!important;margin:10px 0!important}
    .vke-seg-item{display:flex!important;align-items:center!important;gap:6px!important;background:rgba(255,255,255,.05)!important;border-radius:8px!important;padding:5px!important}
    .vke-seg-dot{width:8px!important;height:8px!important;border-radius:50%!important;flex:0 0 auto!important}
    .vke-seg-jump{flex:1!important;min-width:0!important;background:none!important;border:0!important;color:#fff!important;text-align:left!important;cursor:pointer!important}
    .vke-seg-jump span{display:block!important;color:#aaa!important;font-size:11px!important}
    .vke-seg-votes{display:flex!important;gap:2px!important}.vke-seg-votes button{border:0!important;background:#333!important;color:#fff!important;border-radius:6px!important;cursor:pointer!important}
    .vke-seg-primary{width:100%!important;border:0!important;border-radius:9px!important;padding:9px!important;background:#5181b8!important;color:#fff!important;font-weight:600!important;cursor:pointer!important}
    .vke-seg-primary:disabled{opacity:.55!important}.vke-seg-empty{color:#aaa!important;padding:12px 4px!important;text-align:center!important}
    #${PANEL_ID} label{display:block!important;margin:8px 0!important}
    #${PANEL_ID} label>input,#${PANEL_ID} select{margin-top:4px!important;width:100%!important;background:#151515!important;color:#fff!important;border:1px solid #444!important;border-radius:8px!important;padding:8px!important}
    .vke-seg-presets{display:flex!important;gap:4px!important;margin:6px 0 10px!important}.vke-seg-presets button{flex:1!important;background:#333!important;color:#ddd!important;border:0!important;border-radius:7px!important;padding:6px!important;cursor:pointer!important}
    .vke-seg-error{color:#ff6b6b!important;margin-top:7px!important}
    #${TL_ID}{position:absolute!important;left:0!important;right:0!important;bottom:0!important;height:6px!important;pointer-events:none!important;z-index:30!important;overflow:hidden!important;border-radius:4px!important}
    .vke-seg-mark{position:absolute!important;top:1px!important;bottom:1px!important;min-width:2px!important;opacity:1!important;border-radius:2px!important}
  `;
  (document.head||document.documentElement).appendChild(css);
  observer=new MutationObserver(()=>{observeAds();const v=activeVideo();if(v)injectButton(v);});
  // TextTrack can be attached several seconds after the <video> appears.
  // Listen for addtrack/change and immediately retry the transcript loader.
  try{
    document.addEventListener('addtrack',()=>{
      if(current.id && current.video && !transcriptPromise){
        console.info('[VKE TRANSCRIPT] Событие addtrack — повторяю поиск');
        current.transcriptAttemptAt=0;
        loadTranscript();
      }
    }, true);
  }catch{}
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('fullscreenchange',()=>setTimeout(()=>{const v=activeVideo();if(v){current.video=v;injectButton(v);renderTimeline();}},50),{passive:true});
  startTranscriptBootstrap();
  tick();
})();
