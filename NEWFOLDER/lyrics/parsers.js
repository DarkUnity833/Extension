(function(){
'use strict';

const SOURCES = ['lrclib','genius','azlyrics','musixmatch','lyricsfreak','muzexo'];
const clean = t => String(t || '')
  .replace(/\r\n/g,'\n').replace(/\r/g,'\n').replace(/\u00a0/g,' ')
  .replace(/[ \t]+\n/g,'\n').replace(/\n{4,}/g,'\n\n\n').trim();

function plain(text){
  return clean(text).split('\n').map(x=>x.trim()).filter(Boolean).map(text=>({time:null,text}));
}

function parseLRC(text){
  const rows=[];
  for(const raw of clean(text).split('\n')){
    const matches=[...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if(!matches.length) continue;
    const lyric=raw.replace(/(?:\[(?:\d{1,3}):(?:\d{2})(?:[.:]\d{1,3})?\])+/g,'').trim();
    if(!lyric) continue;
    for(const m of matches){
      const frac=(m[3]||'0').padEnd(3,'0').slice(0,3);
      rows.push({time:Number(m[1])*60+Number(m[2])+Number(frac)/1000,text:lyric});
    }
  }
  return rows.sort((a,b)=>a.time-b.time);
}

function requestHTML(url,useProxy=true,timeoutMs=10000){
  return new Promise((resolve,reject)=>{
    let done=false;
    const timer=setTimeout(()=>{if(done)return;done=true;reject(new Error('Таймаут запроса'))},timeoutMs);
    chrome.runtime.sendMessage({type:'CLP_FETCH_HTML',url,useProxy},response=>{
      if(done)return;
      done=true;clearTimeout(timer);
      if(chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if(!response) return reject(new Error('Нет ответа от background'));
      if(response.error) return reject(new Error(response.error));
      resolve(response.html || '');
    });
  });
}

function docFrom(html){
  html=String(html||'').replace(/<base[^>]*>/gi,'');
  return new DOMParser().parseFromString(html,'text/html');
}

function isBlockedPage(html){
  return /just a moment|challenge-platform|attention required|cf-challenge|access denied|403 forbidden|cloudflare|verify you are human/i.test(html||'');
}

async function ddgLinks(query,domain){
  const html=await requestHTML('https://html.duckduckgo.com/html/?q='+encodeURIComponent(query),true);
  const doc=docFrom(html);
  const out=[];
  for(const a of doc.querySelectorAll('a[href]')){
    let href=a.getAttribute('href')||'';
    try{
      const u=new URL(href, 'https://html.duckduckgo.com');
      const uddg=u.searchParams.get('uddg');
      href=uddg?decodeURIComponent(uddg):u.href;
    }catch{}
    if(!/^https?:\/\//i.test(href)) continue;
    if(domain){try{if(!new URL(href).hostname.toLowerCase().includes(domain))continue;}catch{continue;}}
    if(!out.includes(href)) out.push(href);
    if(out.length>=10) break;
  }
  return out;
}

function normalize(s){
  return String(s||'').toLowerCase().replace(/\(.*?\)|\[.*?\]/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
}
function relevant(query,candidate){
  const q=normalize(query).split(' ').filter(x=>x.length>=2);
  const c=normalize(candidate);
  if(!q.length||!c)return 0;
  let score=0;
  for(const w of q){
    if(c===w)score+=3;
    else if(c.split(' ').includes(w))score+=2;
    else if(c.includes(w))score+=1;
  }
  return score/(q.length*2.2);
}
function extractText(el){
  const out=[];
  const blocks=/^(div|p|li|tr|section|article|h[1-6]|header|footer|pre)$/i;
  const walk=node=>{
    if(node.nodeType===Node.TEXT_NODE){out.push(node.nodeValue||'');return;}
    if(node.nodeType!==Node.ELEMENT_NODE)return;
    const tag=node.tagName.toLowerCase();
    if(tag==='script'||tag==='style'||tag==='noscript')return;
    if(tag==='br'){out.push('\n');return;}
    const block=blocks.test(tag); if(block)out.push('\n');
    node.childNodes.forEach(walk);
    if(block)out.push('\n');
  };
  walk(el);
  return clean(out.join(''));
}

function cleanGenius(text,title){
  const bad=/^(\d+\s+)?contributors?$|^embed$|^you might also like|^more on genius|^translations?$|\blyrics?\b/i;
  const titleNorm=normalize(title);
  return clean(text.split('\n').filter((line,i)=>{
    const s=line.trim(); if(!s)return true;
    if(i<12 && bad.test(s))return false;
    if(/^\[.*\]$/.test(s) && /(lyrics?|songtext|paroles|letra|testo|translation|перевод|текст песни)/i.test(s))return false;
    if(titleNorm && /^\[.*\]$/.test(s)) return !normalize(s).includes(titleNorm.split(' ')[0]);
    return true;
  }).join('\n'));
}

async function genius(title,artist){
  const q=(artist+' '+title).trim();
  const candidates=[];
  const add=u=>{try{const x=new URL(u,'https://genius.com');if(/genius\.com$/i.test(x.hostname)&&/-lyrics\/?$/i.test(x.pathname)&&!candidates.includes(x.href))candidates.push(x.href);}catch{}};
  for(const u of await ddgLinks(q+' site:genius.com lyrics','genius.com')) add(u);
  try{
    const html=await requestHTML('https://genius.com/search?q='+encodeURIComponent(q),true), doc=docFrom(html);
    for(const a of doc.querySelectorAll('a[href]')) add(a.getAttribute('href')||'');
  }catch{}
  let bestScore=0,lastErr=null;
  candidates.sort((a,b)=>relevant(q,b)-relevant(q,a));
  for(const u of candidates.slice(0,6)){
    try{
      const html=await requestHTML(u,true);
      if(isBlockedPage(html)&&!/(Lyrics__Container|lyrics-container|data-lyrics-container)/i.test(html))continue;
      const doc=docFrom(html);
      const selectors=['[data-lyrics-container="true"]','[class*="Lyrics__Container"]','.lyrics','.song_body-lyrics','[class*="lyrics__content"]','div[class*="Lyrics"]'];
      let text='';
      for(const sel of selectors){const nodes=[...doc.querySelectorAll(sel)];if(nodes.length){text=nodes.map(extractText).join('\n\n');break;}}
      if(!text){
        const candidatesEls=[...doc.querySelectorAll('div,section,article')];
        let best='';
        for(const el of candidatesEls){const t=extractText(el);if(t.length>120 && t.split('\n').filter(Boolean).length>=5 && t.length>best.length)best=t;}
        text=best;
      }
      text=cleanGenius(text,title);
      if(text.length>20) return {lines:plain(text),hasTimestamps:false,source:'genius'};
    }catch(e){lastErr=e;}
  }
  throw lastErr||new Error('Genius: текст не найден');
}

async function scrape(title,artist,domain,selectors,name){
  const links=await ddgLinks(`${artist} ${title} site:${domain} lyrics`,domain);
  let lastErr=null;
  for(const url of links){
    try{
      const html=await requestHTML(url,true); if(isBlockedPage(html))continue;
      const doc=docFrom(html); let best='';
      for(const sel of selectors){for(const node of doc.querySelectorAll(sel)){const t=extractText(node);if(t.length>best.length)best=t;}}
      if(best.length>20)return {lines:plain(best),hasTimestamps:false,source:name};
    }catch(e){lastErr=e;}
  }
  throw lastErr||new Error(name+': текст не найден');
}

const P={
  lrclib:async(title,artist)=>{
    const exact='https://lrclib.net/api/get?artist_name='+encodeURIComponent(artist)+'&track_name='+encodeURIComponent(title);
    let data=null;
    try{data=JSON.parse(await requestHTML(exact,false));}catch{}
    if(!data){
      const search='https://lrclib.net/api/search?q='+encodeURIComponent((artist+' '+title).trim());
      const list=JSON.parse(await requestHTML(search,false));
      if(!Array.isArray(list)||!list.length)throw new Error('LRCLIB: не найдено');
      const na=normalize(artist),nt=normalize(title);
      list.sort((a,b)=>{
        const sa=(normalize(a.artistName).includes(na)?2:0)+(normalize(a.trackName).includes(nt)?2:0)+(a.syncedLyrics?1:0);
        const sb=(normalize(b.artistName).includes(na)?2:0)+(normalize(b.trackName).includes(nt)?2:0)+(b.syncedLyrics?1:0);
        return sb-sa;
      });
      data=list[0];
    }
    const synced=data?.syncedLyrics||'';
    const lines=synced?parseLRC(synced):plain(data?.plainLyrics||'');
    if(!lines.length)throw new Error('LRCLIB: текст не найден');
    return {lines,hasTimestamps:!!synced,source:'lrclib'};
  },
  genius,
  azlyrics:(t,a)=>scrape(t,a,'azlyrics.com',['.col-xs-12.col-lg-8.text-center div:not([class])','.ringtone + div'],'AZLyrics'),
  musixmatch:(t,a)=>scrape(t,a,'musixmatch.com',['[data-testid*="lyrics"]','[class*="Lyrics__Container"]','[class*="lyrics__content"]'],'Musixmatch'),
  lyricsfreak:(t,a)=>scrape(t,a,'lyricsfreak.com',['#content .lyrictxt','#content .dn','.lyrictxt','.song-content'],'LyricsFreak'),
  muzexo:(t,a)=>scrape(t,a,'muzexo.com',['.text-lyrics','.lyrics-text','.song-text','article'],'Muzexo')
};
window.CLP_PARSERS=P;
console.log('[CLP] parsers loaded:',SOURCES.join(', '));
})();
