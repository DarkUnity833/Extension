(() => {
  'use strict';
  if (window.__VKE_TRANSCRIPT_SEARCH_V2__) return;
  window.__VKE_TRANSCRIPT_SEARCH_V2__ = true;
  const STATE={video:null,cues:[],signature:'',timer:0,observer:null};
  function roots(){const out=[document],seen=new Set();for(let i=0;i<out.length;i++){const r=out[i];if(!r||seen.has(r))continue;seen.add(r);try{r.querySelectorAll?.('*').forEach(e=>{if(e.shadowRoot&&!seen.has(e.shadowRoot))out.push(e.shadowRoot);});}catch{}}return out;}
  function activeVideo(){let best=null,score=-Infinity;for(const r of roots()){for(const v of r.querySelectorAll?.('video')||[]){const b=v.getBoundingClientRect?.();if(!b||b.width<160||b.height<90||b.bottom<0||b.right<0||b.top>innerHeight||b.left>innerWidth)continue;const a=b.width*b.height;const s=a+(v.paused?0:1e6)+(v.readyState>=3?120000:0)+(Number(v.duration)>0?120000:0);if(s>score){score=s;best=v;}}}return best;}
  function clean(x){return String(x||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();}
  function dedupe(cues){const raw=[];for(const c of Array.from(cues||[])){const text=clean(c?.text||c?.textContent||'');const start=Number(c?.startTime),end=Number(c?.endTime);if(text&&Number.isFinite(start))raw.push({start,end:Number.isFinite(end)?end:start,text});}return raw;}
  function read(v){if(!v)return;let best=[];try{for(const t of Array.from(v.textTracks||[])){if(t.kind&&t.kind!=='subtitles'&&t.kind!=='captions')continue;const c=dedupe(t.cues);if(c.length>best.length)best=c;}}catch{}if(!best.length)return;const sig=best.map(c=>`${c.start}|${c.end}|${c.text}`).join('\n');if(sig===STATE.signature)return;STATE.signature=sig;STATE.cues=best;window.dispatchEvent(new CustomEvent('vke-transcript-updated',{detail:{count:best.length,video:v}}));}
  function scan(){const v=activeVideo();if(v!==STATE.video){STATE.video=v;STATE.cues=[];STATE.signature='';try{STATE.observer?.disconnect();}catch{}if(v){try{STATE.observer=new MutationObserver(()=>read(v));STATE.observer.observe(v,{childList:true,subtree:true});}catch{} }window.dispatchEvent(new CustomEvent('vke-transcript-updated',{detail:{count:0,video:v}}));}read(v);}
  window.__VKE_TRANSCRIPT_SEARCH__={search:q=>{q=clean(q).toLowerCase();if(!q)return [];return STATE.cues.filter(c=>c.text.toLowerCase().includes(q)).slice(0,200)},getState:()=>({video:STATE.video,cues:STATE.cues.slice(),count:STATE.cues.length}),refresh:()=>read(STATE.video)};
  STATE.timer=setInterval(scan,300);scan();
})();
