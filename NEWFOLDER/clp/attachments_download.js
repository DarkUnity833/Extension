// VKE message attachment downloader — VK Next style dispatcher with live-media fallback.
(() => {
  'use strict';
  if (window.__vkeAttachmentDownloaderV5) return;
  window.__vkeAttachmentDownloaderV5 = true;

  const pending = new Set();
  const API_TIMEOUT = 15000;
  let seq = 0;

  function toast(text) {
    let x = document.querySelector('.vke-attachments-toast');
    if (!x) {
      x = document.createElement('div'); x.className = 'vke-attachments-toast';
      Object.assign(x.style,{position:'fixed',left:'50%',bottom:'24px',transform:'translateX(-50%)',zIndex:2147483647,background:'rgba(32,34,37,.96)',color:'#fff',padding:'9px 14px',borderRadius:'10px',font:'13px/18px -apple-system,BlinkMacSystemFont,Roboto,sans-serif'});
      document.body.appendChild(x);
    }
    x.textContent=text; clearTimeout(x._t); x._t=setTimeout(()=>x.remove(),2800);
  }
  function safe(v){try{return JSON.parse(JSON.stringify(v))}catch(_){return null}}
  function isUrl(v){return typeof v==='string'&&( /^https?:\/\//i.test(v) || /^data:image\/(?:png|jpe?g|webp|gif|avif);base64,/i.test(v) || /^blob:/i.test(v) )}
  function isGoodMediaUrl(v){return isUrl(v)&&!/\/preview(?:[/?]|$)|\/recoding\/|getVideoPreview|(?:^|[?&])(?:preview|is_preview|preview_only)=1/i.test(v)&&!/\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)/i.test(v)}
  function isVideoUrl(v){if(!isGoodMediaUrl(v))return false;if(/\.(?:mp4|m4v|webm)(?:[?#]|$)/i.test(v))return true;try{const x=new URL(v),h=x.hostname.toLowerCase(),t=x.searchParams.get('type');return /(?:vkvd\d*\.okcdn\.ru|okcdn\.ru|vkuser\.net|vk-cdn\.net|userapi\.com)/i.test(h)&&/^(?:1|3|5)$/.test(String(t||''))&&x.searchParams.has('id')}catch{return false}}
  function isVideoCandidate(v,key=''){
    if(!isUrl(v) || isPageVideoUrl?.(v)) return false;
    if(isVideoUrl(v)) return true;
    if(!/^https?:\/\//i.test(v)) return false;
    if(/\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)/i.test(v)) return false;
    const k=String(key||'').toLowerCase();
    if(/(?:mp4|video|stream|source|file|media|link)/i.test(k) && /(?:vkvd\d*\.okcdn\.ru|okcdn\.ru|vkuser\.net|vk-cdn\.net|userapi\.com)/i.test(new URL(v).hostname)) return true;
    return false;
  }
  function isAudioUrl(v){if(!isUrl(v)||/\/preview(?:[/?]|$)|getVideoPreview|\/recoding\//i.test(v))return false;if(/\.(?:ogg|mp3|m4a|aac|opus)(?:[?#]|$)/i.test(v))return true;try{const h=new URL(v).hostname.toLowerCase();return /(?:vkuseraudio|vkuser\.net|okcdn\.ru|userapi\.com)/i.test(h)}catch{return false}}
  function photoUrl(p){
    if(!p || typeof p!=='object') return null;
    const direct=[
      p.url,p.src,p.photo_url,p.photoUrl,p.original_url,p.originalUrl,
      p.photo_2560,p.photo_1280,p.photo_807,p.photo_604,p.photo_130,
      p.orig_photo?.url,p.orig_photo?.src,p.orig_photo?.photo_2560,
      p.orig_photo?.photo_1280,p.orig_photo?.photo_807,p.orig_photo?.photo_604,
      p.orig_photo?.photo_130
    ];
    for(const u of direct) if(typeof u==='string' && (/^data:image\//i.test(u)||/^https?:\/\//i.test(u))) return u;
    const sizes=[];
    for(const arr of [p.sizes,p.size,p.images,p.orig_photo?.sizes,p.photo?.sizes]) if(Array.isArray(arr)) sizes.push(...arr);
    sizes.sort((a,b)=>(Number(b?.width)||0)*(Number(b?.height)||0)-(Number(a?.width)||0)*(Number(a?.height)||0));
    for(const x of sizes){
      const u=x?.url||x?.src||x?.photo_2560||x?.photo_1280||x?.photo_807||x?.photo_604||x?.photo_130;
      if(typeof u==='string' && (/^data:image\//i.test(u)||/^https?:\/\//i.test(u))) return u;
    }
    return null;
  }

  // Forwarded messages can contain the photo several levels below the
  // attachment object. VK also sometimes sends a photo shell (owner_id/id
  // without sizes/URL). Resolve only photo-shaped objects and keep the search
  // bounded so we don't accidentally pick an unrelated image from the message.
  function findNestedPhoto(obj, depth=0, seen=new Set()){
    if(!obj || typeof obj!=='object' || depth>8 || seen.has(obj)) return null;
    seen.add(obj);
    const t=String(obj.type||'').toLowerCase();
    if(t==='photo' || obj.photo_2560 || obj.photo_1280 || obj.photo_807 ||
       obj.photo_604 || obj.photo_130 || obj.orig_photo || Array.isArray(obj.sizes)){
      const p=(t==='photo' && obj.photo && typeof obj.photo==='object') ? obj.photo : obj;
      if(p?.owner_id!=null && p?.id!=null) return p;
      if(photoUrl(p)) return p;
    }
    for(const k of ['photo','photos','attachment','attachments','wall','wall_reply','post','object','item','media','content','forwarded','fwd_messages','message']){
      const v=obj[k];
      if(Array.isArray(v)){
        for(const x of v){const hit=findNestedPhoto(x,depth+1,seen);if(hit)return hit;}
      }else if(v && typeof v==='object'){
        const hit=findNestedPhoto(v,depth+1,seen);if(hit)return hit;
      }
    }
    return null;
  }

  async function resolvePhotoAttachment(att, context){
    let p=att?.photo || (String(att?.type||'').toLowerCase()==='photo' ? att : null);
    if(!p || typeof p!=='object') p=findNestedPhoto(att);
    if(!p) return null;
    let u=photoUrl(p);
    if(u) return {photo:p,url:u};

    // Forwarded/older messages often contain only owner_id + id (+ access_key).
    // Ask VK for the exact photo instead of relying on the rendered thumbnail.
    const owner=p.owner_id ?? p.ownerId;
    const id=p.id ?? p.photo_id ?? p.photoId;
    if(owner!=null && id!=null){
      const access=p.access_key ?? p.accessKey ?? p.photo_access_key ?? p.access;
      const key=access ? `${owner}_${id}_${access}` : `${owner}_${id}`;
      try{
        const r=await api('photos.getById',{photos:key});
        const items=r?.items||r?.response?.items||r?.response||[];
        const got=Array.isArray(items)?items[0]:null;
        if(got){
          const gu=photoUrl(got);
          if(gu) return {photo:{...p,...got},url:gu};
        }
      }catch{}
    }

    // As a final exact-message fallback, refresh the current CMID and search
    // only that message for the matching photo id. This is important for
    // forwarded photos whose initial React object contains a stale shell.
    if(context?.peerId!=null && context?.cmid!=null){
      try{
        const r=await api('messages.getByConversationMessageId',{
          peer_id:Number(context.peerId),
          conversation_message_ids:String(context.cmid),
          extended:0
        });
        const msg=r?.items?.[0]||r?.response?.items?.[0]||null;
        const candidates=[];
        const walk=(x,d=0,seen=new Set())=>{
          if(!x||typeof x!=='object'||d>10||seen.has(x))return;
          seen.add(x);
          const t=String(x.type||'').toLowerCase();
          if(t==='photo' || x.photo_2560 || x.orig_photo || Array.isArray(x.sizes)){
            const q=x.photo&&typeof x.photo==='object'?x.photo:x;
            const qo=q?.owner_id??q?.ownerId, qi=q?.id??q?.photo_id??q?.photoId;
            if(String(qo)===String(owner)&&String(qi)===String(id)) candidates.push(q);
          }
          for(const k of Object.keys(x)){
            const v=x[k];
            if(v&&typeof v==='object') Array.isArray(v)?v.forEach(y=>walk(y,d+1,seen)):walk(v,d+1,seen);
          }
        };
        walk(msg);
        for(const q of candidates){
          const qu=photoUrl(q);
          if(qu)return {photo:q,url:qu};
          const qa=q?.access_key??q?.accessKey;
          const qkey=qa?`${owner}_${id}_${qa}`:`${owner}_${id}`;
          try{
            const rr=await api('photos.getById',{photos:qkey});
            const ii=rr?.items||rr?.response?.items||rr?.response||[];
            const got=Array.isArray(ii)?ii[0]:null, gu=photoUrl(got);
            if(gu)return {photo:{...q,...got},url:gu};
          }catch{}
        }
      }catch{}
    }
    return null;
  }
  function bestVideo(files){
    if(!files||typeof files!=='object')return null;
    const rows=[];
    for(const [k,v] of Object.entries(files)){
      if(!isVideoCandidate(v,k))continue;
      const m=String(k).match(/(?:mp4|url|file|video)[_-]?(\d+)/i);
      const q=m?Number(m[1]):0;
      if(q>0)rows.push({u:v,q});
    }
    for(const k of ['url','video_url','videoUrl','src','mp4','link_mp4','link_mp4_2160','link_mp4_1440','link_mp4_1080','link_mp4_720','link_mp4_480']) if(isVideoCandidate(files?.[k],k)) rows.push({u:files[k],q:0});
    rows.sort((a,b)=>b.q-a.q);
    return rows[0]?.u||null;
  }

  function recursiveMediaUrl(obj, kind, depth=0, seen=new Set()){
    if(!obj || depth>12 || seen.has(obj)) return null;
    if(typeof obj==='string') return (kind==='circle'||kind==='video') ? (isVideoUrl(obj)?obj:null) : (isAudioUrl(obj)?obj:null);
    if(typeof obj!=='object') return null;
    seen.add(obj);
    const preferred = kind==='circle' || kind==='video'
      ? ['link_mp4_2160','link_mp4_1440','link_mp4_1080','link_mp4_720','link_mp4_480','link_mp4','mp4_1080','mp4_720','mp4_480','mp4','video_url','videoUrl','video_message','videoMessage','files','video_files']
      : ['link_mp3','link_ogg','link_m4a','audio_url','audioUrl','url','src'];
    for(const k of preferred){
      const v=obj[k];
      if(typeof v==='string' && ((kind==='circle'||kind==='video')?isVideoCandidate(v,k):isAudioUrl(v))) return v;
    }
    if(obj.files && typeof obj.files==='object'){ const u=bestVideo(obj.files); if(u)return u; }
    for(const [k,v] of Object.entries(obj)){
      if(typeof v==='string' && /mp4|video|voice|audio|url|src|link/i.test(k)) {
        const ok = (kind==='circle'||kind==='video') ? isVideoCandidate(v,k) : isAudioUrl(v);
        if(ok) return v;
      }
      if(v && typeof v==='object'){ const u=recursiveMediaUrl(v,kind,depth+1,seen); if(u)return u; }
    }
    return null;
  }

  function recentCdnMedia(type, minAgeMs=0, maxAgeMs=30000){
    const out=[]; const add=u=>{if(typeof u!=='string'||!isUrl(u)||!isGoodMediaUrl(u))return; try{const x=new URL(u); const h=x.hostname.toLowerCase(); if(!/(?:vkvd\d*\.okcdn\.ru|okcdn\.ru|vkuser\.net|vk-cdn\.net|userapi\.com)/i.test(h))return; const isSigned=/^[35]$/.test(String(x.searchParams.get('type')||''))&&x.searchParams.has('id'); const media=/\.(?:mp4|m4v|webm)(?:[?#]|$)/i.test(u); if(type==='circle' && !(media||isSigned))return; if(type==='video' && !media)return; if(!out.includes(u))out.push(u)}catch{}}; try{const now=performance.timeOrigin+performance.now(); for(const e of performance.getEntriesByType('resource').slice(-500).reverse()){const st=performance.timeOrigin+(e.startTime||0),age=now-st;if(age<minAgeMs)continue;if(age>maxAgeMs)break;add(e?.name||'');if(out.length>=16)break}}catch{} return out;
  }

  async function pageApi(method,params){
    if(window.vkApi?.api&&typeof window.vkApi.api==='function'){
      try{return await window.vkApi.api(method,params||{})}catch(_){}
    }
    return null;
  }
  async function api(method, params) {
    const page = await pageApi(method,params);
    if(page!=null)return page;
    const id=`att_api_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve,reject)=>{
      const on=e=>{if(e.source!==window||e.data?.source!=='vke-bridge'||e.data?.type!=='VKE_MEDIA_API_RESULT'||e.data.requestId!==id)return;cleanup();e.data.error?reject(new Error(e.data.error)):resolve(e.data.response)};
      const cleanup=()=>{window.removeEventListener('message',on);clearTimeout(timer)};
      window.addEventListener('message',on);window.postMessage({source:'vke-main',type:'VKE_MEDIA_API',requestId:id,method,params},'*');
      const timer=setTimeout(()=>{cleanup();reject(new Error('API timeout'))},API_TIMEOUT);
    });
  }
  function storyFallbackUrl(){
    try{
      const c=window.__vkeStoryImageCache;
      if(Array.isArray(c)&&c.length) return c[c.length-1];
      const v=document.querySelector('.StoriesViewer video, .stories_viewer video, video.videoStoriesViewerPlayer, .videoStoriesViewerPlayer');
      if(v) return v.currentSrc||v.src||null;
      const imgs=[...document.querySelectorAll('img')].map(x=>x.currentSrc||x.src).filter(isUrl);
      return imgs[imgs.length-1]||null;
    }catch{return null}
  }

  async function downloadUrl(url,name){
    // VKE_DIRECT_DOWNLOAD handles both signed video/CDN URLs and ordinary image
    // files. The old guard accidentally rejected every non-video http(s) URL,
    // which made photo attachments fail while video attachments kept working.
    if(!isUrl(url) || isPageVideoUrl(url) || !/^https?:\/\//i.test(String(url||'')) && !/^data:image\//i.test(String(url||''))){
      throw new Error('Некорректная ссылка на медиа');
    }
    const r=await chrome.runtime.sendMessage({type:'VKE_DIRECT_DOWNLOAD',url,filename:name});
    if(!r?.ok)throw new Error(r?.error||'Не удалось начать скачивание');
    return r.downloadId;
  }

  function findMessageRoot(cmid){
    if(cmid==null)return null;
    const s=String(cmid);
    const candidates=document.querySelectorAll('[data-cmid],[data-conversation-message-id],[data-msgid],[data-message-id]');
    for(const el of candidates){
      const vals=[el.getAttribute('data-cmid'),el.getAttribute('data-conversation-message-id'),el.getAttribute('data-msgid'),el.getAttribute('data-message-id')];
      if(vals.some(v=>v===s))return el.closest('.ConvoMessage,.ConvoMessageWithoutBubble,[data-msgid],[data-message-id]')||el;
    }
    for(const el of document.querySelectorAll('.ConvoMessage,.ConvoMessageWithoutBubble')){
      for(const k of Object.keys(el)){
        if(!k.startsWith('__reactFiber$')&&!k.startsWith('__reactProps$'))continue;
        try{const hit=deepFind(el[k],obj=>String(obj?.cmid??obj?.conversation_message_id??obj?.conversationMessageId??'')===s);if(hit)return el}catch{}
      }
    }
    return null;
  }
  function deepFind(value,pred,depth=0,seen=new Set()){
    if(!value||depth>12||(typeof value!=='object'&&typeof value!=='function')||seen.has(value))return null;
    seen.add(value);
    try{if(pred(value))return value}catch{}
    let keys=[];try{keys=Object.keys(value).slice(0,180)}catch{return null}
    for(const k of keys){try{const v=value[k];const hit=v&&typeof v==='object'?deepFind(v,pred,depth+1,seen):null;if(hit)return hit}catch{}}
    return null;
  }
  function liveUrl(root,type){
    if(!root)return null;
    const media=root.querySelector(type==='circle'?'video':'video,audio');
    if(media){const src=media.currentSrc||media.src||media.querySelector?.('source')?.src;if(isGoodMediaUrl(src))return src}
    const hit=deepFind(root,()=>false); void hit;
    for(const el of root.querySelectorAll('video,audio')){
      const src=el.currentSrc||el.src||el.querySelector?.('source')?.src;
      if(/^https?:\/\//i.test(src)||/^blob:/i.test(src))return src;
    }
    return null;
  }
  function triggerLive(root,type){
    return new Promise((resolve,reject)=>{
      if(!root){reject(new Error('Сообщение не найдено'));return}
      const clpId=root.dataset.vkeMediaId||(root.dataset.vkeMediaId=`att_${Date.now()}_${++seq}`);
      const clientId=`att_live_${Date.now()}_${++seq}`;
      const timer=setTimeout(()=>{window.removeEventListener('message',on);reject(new Error('Не удалось получить ссылку'))},15000);
      const on=e=>{if(e.source!==window||e.data?.type!=='CLP_TRIGGER_RESULT'||e.data.clientId!==clientId)return;clearTimeout(timer);window.removeEventListener('message',on);e.data.error?reject(new Error(e.data.error)):resolve(e.data.url||null)};
      window.addEventListener('message',on);
      window.postMessage({type:'CLP_TRIGGER_PLAY',clientId,clpId,kind:type==='circle'?'circle':'voice',forceFresh:true},'*');
    });
  }
  function findMessageRootByAttachment(attachment){
    const owner=attachment?.owner_id ?? attachment?.ownerId;
    const id=attachment?.id ?? attachment?.video_id ?? attachment?.videoId;
    if(owner==null || id==null) return null;
    const so=String(owner), si=String(id);
    const roots=[...document.querySelectorAll('.ConvoMessage,.ConvoMessageWithoutBubble,[data-message-id],[data-msgid]')];
    for(const root of roots){
      let found=false;
      for(const k of Object.keys(root)){
        if(!k.startsWith('__reactFiber$')&&!k.startsWith('__reactProps$')) continue;
        try{
          const hit=deepFind(root[k],obj=>{
            if(!obj||typeof obj!=='object')return false;
            const t=String(obj.type||'').toLowerCase();
            const o=obj.owner_id ?? obj.ownerId;
            const v=obj.id ?? obj.video_id ?? obj.videoId;
            return String(o)===so && String(v)===si && (t==='video_message'||obj.video_message||obj.videoMessage||obj.video || obj.type==='video_message');
          });
          if(hit){found=true;break;}
        }catch{}
      }
      if(found) return root;
    }
    return null;
  }
  async function liveAttachment(cmid,type,rootHint=null){
    let root=rootHint&&document.contains(rootHint)?rootHint:findMessageRoot(cmid);
    // For circles NEVER fall back to a global .AttachVideoMessage scan. There can
    // be many circles in a chat and choosing one by visibility/size causes exactly
    // the wrong-file downloads reported by the user.
    if(!root)return null;
    const direct=liveUrl(root,type);
    if(direct)return direct;
    try{return await triggerLive(root,type)}catch{return null}
  }
  async function historyAttachmentFallback(context){
    if(context?.peerId==null||context?.cmid==null)return null;
    const peer_id=Number(context.peerId), cmid=Number(context.cmid);
    if(!Number.isFinite(peer_id)||!Number.isFinite(cmid))return null;
    const queries=[
      {peer_id,cmid,count:20,extended:1,media_type:'video',message_video:1},
      {peer_id,cmid,count:20,extended:1,media_type:'video'}
    ];
    for(const params of queries){
      try{
        const r=await api('messages.getHistoryAttachments',params);
        const items=r?.items||r?.response?.items||[];
        if(!Array.isArray(items))continue;
        for(const it of items){
          const vm=it?.video_message||it?.videoMessage;
          if(!vm)continue;
          const u=bestVideo(vm.files)||recursiveMediaUrl(vm,'circle');
          if(isVideoUrl(u))return {video_message:vm,url:u};
        }
      }catch{}
    }
    return null;
  }
  async function refreshExactMessageAttachment(context,type){
    if(context?.peerId==null||context?.cmid==null)return null;
    try{const r=await api('messages.getByConversationMessageId',{peer_id:Number(context.peerId),conversation_message_ids:String(context.cmid),extended:0});const msg=r?.items?.[0]||r?.response?.items?.[0]||null;const atts=Array.isArray(msg?.attachments)?msg.attachments:[];for(const a of atts){const t=String(a?.type||'').toLowerCase();if(type==='video_message'&&(t==='video_message'||a?.video_message||a?.videoMessage))return a.video_message||a.videoMessage||a; if(type==='video'&&(t==='video'||t==='clip')&&!a?.video_message&&!a?.videoMessage)return a[t]||a.video||a.clip||a}}catch{} return null;
  }
  function attachmentKind(att){
    if(!att || typeof att!=='object') return null;
    const t=String(att.type||'').toLowerCase();
    // VK circles are exposed as attachment.type=video with video.type=video_message.
    if(t==='video_message' || att.video_message || att.videoMessage) return 'video_message';
    if(t==='video' && String(att.video?.type||'').toLowerCase()==='video_message') return 'video_message';
    if(t==='photo') return 'photo';
    if(t==='video' || t==='clip') return t==='clip' ? 'clip' : 'video';
    if(t==='audio_message') return 'audio_message';
    if(t==='doc') return 'doc';
    if(t==='graffiti') return 'graffiti';
    if(t==='gift') return 'gift';
    if(t==='sticker' || t==='ugc_sticker') return t;
    if(t==='wall' || t==='wall_reply') return t;
    return t || null;
  }

  function normalizeAttachment(att){
    if(!att||typeof att!=='object')return att;
    if(att.video_message&&typeof att.video_message==='object')return {type:'video_message',video_message:att.video_message};
    if(att.videoMessage&&typeof att.videoMessage==='object')return {type:'video_message',video_message:att.videoMessage};
    if(String(att.type||'').toLowerCase()==='video' && String(att.video?.type||'').toLowerCase()==='video_message') {
      return {type:'video_message',video_message:att.video};
    }
    return att;
  }
  function exactVideoInRoot(root,type,expected){
    if(!root)return null;
    const videos=[...root.querySelectorAll('video')];
    const expectedId=expected?.owner_id!=null&&expected?.id!=null?`${expected.owner_id}_${expected.id}`:null;
    if(expectedId){
      for(const el of root.querySelectorAll('a[href],[data-video-id],[data-full-id]')){
        const raw=el.getAttribute('href')||el.getAttribute('data-video-id')||el.getAttribute('data-full-id')||'';
        if(raw.includes(`video${expectedId}`)||raw.includes(`clip${expectedId}`)){ const v=el.closest('.ConvoMessage,.ConvoMessageWithoutBubble,.AttachVideoMessage')?.querySelector('video'); if(v)return v; }
      }
    }
    const xs=videos.filter(v=>type==='video_message' ? !!v.closest('.AttachVideoMessage,[data-testid*="video-message" i],[class*="AttachVideoMessage" i]') : !!v.closest('.ConvoMessage,.ConvoMessageWithoutBubble') || !v.closest('.AttachVideoMessage'));
    if(type==='video_message') {
      const preferred=xs.find(v=>v.classList?.contains('AttachVideoMessage__video'));
      if(preferred) return preferred;
    }
    xs.sort((a,b)=>{const ap=!a.paused?1:0,bp=!b.paused?1:0;if(ap!==bp)return bp-ap;const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();return br.width*br.height-ar.width*ar.height});
    return xs[0]||null;
  }
    function fetchMediaBlobBackground(url,timeout=25000){
    // chrome.runtime.sendMessage returns the response through its callback/promise.
    // Listening on runtime.onMessage here never receives that response and was the
    // main reason circles could reach `1/1` without actually producing a file.
    return new Promise((resolve,reject)=>{
      const requestId=`att_bg_${Date.now()}_${++seq}`;
      const timer=setTimeout(()=>reject(new Error('background media timeout')),timeout);
      try{
        chrome.runtime.sendMessage({type:'VKE_FETCH_MEDIA_BLOB',requestId,url,pageUrl:location.href},response=>{
          clearTimeout(timer);
          const runtimeErr=chrome.runtime.lastError;
          if(runtimeErr){reject(new Error(runtimeErr.message||String(runtimeErr)));return;}
          if(!response?.ok){reject(new Error(response?.error||'background fetch failed'));return;}
          if(!response.blob){reject(new Error('background returned empty blob'));return;}
          resolve(response.blob);
        });
      }catch(e){clearTimeout(timer);reject(e)}
    });
  }

  function fetchMediaBlobPage(url,timeout=30000){
    return new Promise((resolve,reject)=>{
      const requestId=`att_media_${Date.now()}_${++seq}`;
      let done=false;
      let timer=null;
      const cleanup=()=>{if(timer)clearTimeout(timer);window.removeEventListener('message',on)};
      const finish=(ok,val)=>{if(done)return;done=true;cleanup();ok?resolve(val):reject(val)};
      const on=e=>{
        if(e.source!==window||e.data?.type!=='CLP_DOWNLOAD_MEDIA_RESULT'||e.data.requestId!==requestId)return;
        if(e.data.error) finish(false,new Error(e.data.error));
        else if(e.data.blob) finish(true,e.data.blob);
        else finish(false,new Error('Пустой media response'));
      };
      window.addEventListener('message',on);
      window.postMessage({type:'CLP_DOWNLOAD_MEDIA_REQUEST',requestId,url},'*');
      timer=setTimeout(()=>finish(false,new Error('media download timeout')),timeout);
    });
  }

  async function downloadCirclePage(url, name, root=null){
    if(!url) return false;
    if(/^https?:\/\//i.test(url)){
      // Canonical path: fetch the exact signed circle stream from the MAIN-world
      // page context and save the resulting blob. This mirrors the working
      // downloader approach and avoids treating chrome.downloads creation as a
      // successful media transfer when the CDN later rejects the stream.
      try{const b=await fetchMediaBlobPage(url);if(b&&b.size>1000)return saveCircleBlob(b,name)}catch{}
      try{const b=await fetchMediaBlobBackground(url);if(b&&b.size>1000)return saveCircleBlob(b,name)}catch{}
      try{const id=await downloadUrl(url,name);if(id!=null)return true}catch{}
      try{const b=await fetchBlobUrl(url);if(b&&b.size>1000)return saveCircleBlob(b,name)}catch{}
      if(root){try{const b=await captureCircle(root);if(b&&b.size>50000)return saveCircleCapture(b,name)}catch{}}
      return false;
    }
    if(/^blob:/i.test(url)){
      try{const b=await fetchBlobUrl(url);if(b&&b.size>1000)return saveCircleBlob(b,name)}catch{}
      if(root){try{const b=await captureCircle(root);if(b&&b.size>50000)return saveCircleCapture(b,name)}catch{}}
    }
    return false;
  }

  async function resolvePlayerMedia(playerUrl, pageUrl='') {
    if (!/^https?:\/\//i.test(String(playerUrl||''))) return [];
    return new Promise(resolve=>{
      const id=`att_player_${Date.now()}_${++seq}`;
      let done=false;
      const finish=v=>{if(done)return;done=true;window.removeEventListener('message',on);clearTimeout(timer);resolve(Array.isArray(v)?v:[])};
      const on=e=>{
        if(e.source!==window || e.data?.source!=='vke-bridge' || e.data?.type!=='VKE_RESOLVE_PLAYER_MEDIA_RESULT' || e.data.requestId!==id)return;
        finish(e.data.response?.rows||[]);
      };
      window.addEventListener('message',on);
      window.postMessage({source:'vke-main',type:'VKE_RESOLVE_PLAYER_MEDIA',requestId:id,url:playerUrl,pageUrl:pageUrl||location.href},'*');
      const timer=setTimeout(()=>finish([]),12000);
    });
  }
  function captureCircle(root) {
    return new Promise((resolve,reject)=>{
      const id=`att_circle_cap_${Date.now()}_${++seq}`;
      const timer=setTimeout(()=>{window.removeEventListener('message',on);reject(new Error('Кружок не удалось получить'))},30000);
      const on=e=>{
        if(e.source!==window || e.data?.type!=='CLP_CAPTURE_MEDIA_RESULT' || e.data.clientId!==id)return;
        clearTimeout(timer);window.removeEventListener('message',on);
        e.data.error?reject(new Error(e.data.error)):resolve(e.data.blob||null);
      };
      window.addEventListener('message',on);
      window.postMessage({type:'CLP_CAPTURE_MEDIA_REQUEST',clientId:id,scope:'circle'},'*');
    });
  }
  async function saveCircleBlob(blob,name) {
    if(!blob || blob.size<1000) throw new Error('Файл кружочка пустой');
    const type=String(blob.type||'video/mp4').toLowerCase();
    const ext=/webm/.test(type)?'webm':/mp4|quicktime|video\//.test(type)?'mp4':'bin';
    const u=URL.createObjectURL(blob);
    try{
      const a=document.createElement('a'); a.href=u; a.download=String(name||`video_message_${Date.now()}`).replace(/\.(?:bin|webm|mp4)$/i, `.${ext}`);
      document.body.appendChild(a); a.click(); a.remove();
      return true;
    } finally { setTimeout(()=>URL.revokeObjectURL(u),30000); }
  }

  async function saveCircleCapture(blob,name) {
    if(!blob || blob.size<50000) throw new Error('Запись кружка получилась пустой');
    const u=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=u;
    const ext=/webm/i.test(blob.type||'')?'webm':'mp4'; a.download=name.replace(/\.mp4$/i,`.${ext}`);
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),30000); return true;
  }

  function videoIdFromObject(v){
    const owner=v?.owner_id ?? v?.ownerId;
    const id=v?.id ?? v?.video_id ?? v?.videoId;
    if(owner!=null && id!=null && /^-?\d+$/.test(String(owner)) && /^\d+$/.test(String(id))) return `${owner}_${id}`;
    for(const x of [v?.full_id,v?.video_id_str,v?.videoIdStr,v?.url,v?.player,v?.player_url,v?.playerUrl]){
      if(typeof x!=='string') continue;
      const m=x.match(/(?:^|[/?#&])(video|clip)(-?\d+)_(\d+)/i);
      if(m) return `${m[2]}_${m[3]}`;
    }
    return null;
  }
  function isPageVideoUrl(u){
    if(typeof u!=='string'||!/^https?:\/\//i.test(u))return false;
    try{
      const x=new URL(u);
      const h=x.hostname.toLowerCase();
      return /(?:^|\.)vk\.ru$/.test(h) || /(?:^|\.)vk\.com$/.test(h) || /(?:^|\.)vkvideo\.ru$/.test(h);
    }catch{return false}
  }
  async function resolveExactVideoAttachment(v, context){
    const id=videoIdFromObject(v);
    if(!id) return null;
    try{
      const core=window.__vkeMediaCore;
      if(core?.resolveVideo && typeof core.resolveVideo==='function'){
        const data=await core.resolveVideo(id,false,context?.root||null);
        const q=Array.isArray(data?.qualities)?data.qualities.filter(x=>isVideoUrl(x?.url)).sort((a,b)=>Number(b.q||0)-Number(a.q||0)):[];
        if(q.length) return q[0].url;
      }
    }catch{}
    return null;
  }
  async function videoAttach(att, context){
    att=normalizeAttachment(att); const type=att.type; let v=att[type]||att.video_message||att.videoMessage||{}; let url=null;
    if(type==='video_message'){
      const exactRoot=findMessageRootByAttachment(v);
      if(exactRoot) context={...(context||{}),root:exactRoot};
    }
    // For an attachment context, the <video> inside the exact message row is
    // authoritative for BOTH ordinary private videos and circles. This avoids
    // resolving the route URL or a neighboring media item from global caches.
    if(context?.root){
      const el=exactVideoInRoot(context.root,type,v); const src=el?.currentSrc||el?.src||el?.querySelector?.('source')?.src||'';
      if(/^https?:\/\//i.test(src) && isVideoCandidate(src,'video')) url=src;
      if(type!=='video_message' && !url) url=await resolveExactVideoAttachment(v, context);
      if(!url&&/^blob:/i.test(src)){try{const blob=await fetchBlobUrl(src);if(blob?.size>1000){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=`${type==='video_message'?'video_message':'video'}_${v.owner_id||'0'}_${v.id||Date.now()}.mp4`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000);return true}}catch{}}
    }
    if(type==='video_message'&&!url&&context?.peerId!=null&&context?.cmid!=null){const fresh=await refreshExactMessageAttachment(context,type);if(fresh){v={...v,...fresh};url=bestVideo(v.files)||recursiveMediaUrl(v,'circle')||null}}
    if(!url) url=bestVideo(v.files)||recursiveMediaUrl(v,type==='video_message'?'circle':'video');
    if(type!=='video_message'&&!url&&v.owner_id!=null&&(v.id!=null||v.video_id!=null)){const vid=v.id!=null?v.id:v.video_id;const ak=v.access_key||v.accessKey||v.video_access_key||v.video_hash||null;const key=ak?`${v.owner_id}_${vid}_${ak}`:`${v.owner_id}_${vid}`;for(const method of ['video.getByIds','video.get']){try{const rr=await api(method,{videos:key,count:1,extended:1});const item=rr?.items?.[0]||rr?.response?.items?.[0]||rr?.response?.[0]||null;if(item){v={...v,...item};url=bestVideo(v.files)||recursiveMediaUrl(v,'video')||url}}catch{}if(url)break}}
    if(!url&&(v.player||v.player_url||v.playerUrl)){const rows=await resolvePlayerMedia(v.player||v.player_url||v.playerUrl);rows.sort((a,b)=>(Number(b.q)||0)-(Number(a.q)||0));url=rows[0]?.url||null}
    if(!url&&type==='video_message'&&context?.root){const el=exactVideoInRoot(context.root,'video_message',v);const src=el?.currentSrc||el?.src||'';if(/^https?:\/\//i.test(src)&&isVideoCandidate(src,'video'))url=src}
    if(!url&&type==='video_message') url=await liveAttachment(context?.cmid,'circle',context?.root);
    if(!url || isPageVideoUrl(url) || !isVideoCandidate(url,'video')) return false;
    if(type==='video_message') { const owner=v.owner_id ?? v.ownerId ?? '0'; const vid=v.id ?? v.video_id ?? Date.now(); return downloadCirclePage(url,`video_message_${owner}_${vid}.mp4`,context?.root||null); }
    await downloadUrl(url,`video_${v.owner_id||'0'}_${v.id||Date.now()}.mp4`); return true;
  }
  function isAdPromoText(v){return typeof v==='string' && /(^|[\s_./:-])(?:ad|ads|advert|advertisement|promo|promotion)(?:[\s_./:-]|$)/i.test(v)}
  async function one(att,context){
    if(att?.type==='dom_media'&&att.url){await downloadDomMedia(att);return true;}
    if(!att||typeof att!=='object')return false;
    if(context?.root){
      try{
        const rootText=`${context.root.className||''} ${context.root.id||''} ${context.root.getAttribute?.('data-testid')||''} ${context.root.getAttribute?.('aria-label')||''}`;
        if(/(^|[-_\s])(?:ad|ads|advert|advertisement|promo|promotion)(?:[-_\s]|$)/i.test(rootText)) return false;
      }catch{}
    }
    att=normalizeAttachment(att);
    try{for(const k of ['type','title','description','url','name']) if(isAdPromoText(att?.[k])) return false}catch{}
    switch(attachmentKind(att)){
      case 'photo':{
        const resolved=await resolvePhotoAttachment(att,context);
        if(!resolved?.url)return false;
        const p=resolved.photo||{};
        const ext=/^data:image\/png/i.test(resolved.url)||/\.png(?:[?#]|$)/i.test(resolved.url)?'png':
                  (/\.webp(?:[?#]|$)/i.test(resolved.url)?'webp':'jpg');
        await downloadUrl(resolved.url,`photo_${p.owner_id||p.ownerId||'0'}_${p.id||Date.now()}.${ext}`);
        return true;
      }
      case 'video':
      case 'video_message':return videoAttach(att,context);
      case 'clip':return videoAttach({type:'video',video:att.clip||{}},context);
      case 'audio_message':{const a=att.audio_message||{};let u=a.link_mp3||a.link_ogg;if(!u)u=await liveAttachment(context?.cmid,'voice',context?.root);if(!u)return false;await downloadUrl(u,`voice_${a.owner_id||'0'}_${a.id||Date.now()}.${/\.ogg(?:[?#]|$)/i.test(u)?'ogg':'mp3'}`);return true}
      case 'doc':{const d=att.doc||{};if(!d.url)return false;await downloadUrl(d.url,`doc_${d.owner_id||'0'}_${d.id||Date.now()}.${d.ext||'bin'}`);return true}
      case 'graffiti':{const g=att.graffiti||{};if(!g.url)return false;await downloadUrl(g.url,`graffiti_${g.id||Date.now()}.png`);return true}
      case 'gift':{const g=att.gift||{};const u=g.thumb_512||g.thumb_256||g.thumb_128||g.thumb_96||g.thumb_48;if(!u)return false;await downloadUrl(u,`gift_${g.id||Date.now()}.png`);return true}
      case 'sticker':
      case 'ugc_sticker':{const st=att[att.type]||{};const imgs=st.images_with_background||st.images||[];const u=[...imgs].sort((a,b)=>(b.width||0)-(a.width||0))[0]?.url;if(!u)return false;await downloadUrl(u,`sticker_${st.sticker_id||st.id||Date.now()}.png`);return true}
      case 'wall':
      case 'wall_reply':{
        const nested=att[att.type];
        const list=Array.isArray(nested)?nested:
          (nested&&typeof nested==='object' ? (
            Array.isArray(nested.attachments)?nested.attachments:
            Array.isArray(nested.wall?.attachments)?nested.wall.attachments:
            [nested]
          ):[]);
        let any=false;
        for(const x of list) any=(await one(x,context))||any;
        // Some forwarded posts are represented as a wall wrapper without a
        // conventional `type=photo` attachment. Extract a photo from that
        // wrapper and use the same exact resolver above.
        if(!any){
          const hit=findNestedPhoto(att);
          if(hit){
            const resolved=await resolvePhotoAttachment({type:'photo',photo:hit},context);
            if(resolved?.url){
              const p=resolved.photo||hit;
              const ext=/\.png(?:[?#]|$)/i.test(resolved.url)?'png':(/\.webp(?:[?#]|$)/i.test(resolved.url)?'webp':'jpg');
              await downloadUrl(resolved.url,`photo_${p.owner_id||p.ownerId||'0'}_${p.id||Date.now()}.${ext}`);
              any=true;
            }
          }
        }
        return any;
      }
      default:return false;
    }
  }
  
  function collectForwardedDomPhotos(root){
    const out=[];
    if(!root)return out;
    const links=root.querySelectorAll?.('.ForwardedMessagesList .AttachPhotos__link, .ForwardedMessageNew .AttachPhotos__link, a.AttachPhotos__link')||[];
    const seen=new Set();
    for(const a of links){
      try{
        const href=a.getAttribute('href')||'';
        const m=href.match(/(?:^|[?&])z=photo(-?\d+)_(-?\d+)(?:[/?&#]|$)/i) || href.match(/photo(-?\d+)_(-?\d+)/i);
        const img=a.querySelector('img');
        const url=img?.currentSrc||img?.src||'';
        if(!m && !url) continue;
        const owner=m?.[1]||'';
        const id=m?.[2]||'';
        const key=owner&&id?`${owner}_${id}`:url;
        if(seen.has(key))continue;
        seen.add(key);
        out.push({owner_id:owner||null,id:id||null,url:url||null,href});
      }catch{}
    }
    return out;
  }

  function collectDomMedia(root){
    const out=[];
    if(!root)return out;
    for(const el of root.querySelectorAll('img,video,source')){
      const u=el.currentSrc||el.src||el.getAttribute?.('src')||'';
      if(/^data:image\//i.test(u)||/^blob:/i.test(u)||/^https?:\/\//i.test(u)) out.push({type:'dom_media',url:u});
    }
    for(const el of root.querySelectorAll('*')){
      const bg=getComputedStyle(el).backgroundImage||'';
      const m=bg.match(/url\(["']?(data:image\/[^"')]+|blob:[^"')]+)/i);
      if(m) out.push({type:'dom_media',url:m[1]});
    }
    return out;
  }
  async function fetchBlobUrl(u){
    return new Promise((resolve,reject)=>{
      const id='vke_att_blob_'+Date.now()+'_'+Math.random();
      const timer=setTimeout(()=>{window.removeEventListener('message',on);reject(new Error('blob timeout'))},15000);
      function on(e){
        if(e.source!==window||e.data?.type!=='CLP_FETCH_BLOB_RESULT'||e.data.requestId!==id)return;
        clearTimeout(timer);window.removeEventListener('message',on);
        e.data.error?reject(new Error(e.data.error)):resolve(e.data.blob);
      }
      window.addEventListener('message',on);
      window.postMessage({type:'CLP_FETCH_BLOB_REQUEST',requestId:id,url:u},'*');
    });
  }
  async function downloadDomMedia(item){
    const u=item.url;
    if(/^blob:/i.test(u)){
      const b=await fetchBlobUrl(u);
      if(!b)throw new Error('empty blob');
      const x=URL.createObjectURL(b); const a=document.createElement('a'); a.href=x; a.download=`vk_media_${Date.now()}.${b.type.includes('png')?'png':'mp4'}`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(x),15000); return true;
    }
    if(/^data:image\//i.test(u)){
      const r=await fetch(u); const b=await r.blob();
      const x=URL.createObjectURL(b); const a=document.createElement('a'); a.href=x; a.download=`vk_image_${Date.now()}.${b.type.includes('png')?'png':'jpg'}`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(x),15000); return true;
    }
    await downloadUrl(u,`vk_media_${Date.now()}`); return true;
  }

async function all(raw,context){
    let atts=Array.isArray(raw)?raw:[];
    const forwardedDomPhotos=collectForwardedDomPhotos(context?.root);
    if(!atts.length && !forwardedDomPhotos.length){toast('Вложений не найдено');return{ok:0,seen:0};}

    // Context-menu circle: do the download directly, without relying on a
    // visible circle button. This is deliberate: circles must not render any
    // standalone download controls.
    const circleIndex=atts.findIndex(a=>attachmentKind(normalizeAttachment(a))==='video_message');
    let circleOk=false;
    if(circleIndex>=0){
      try{
        const okCircle=await videoAttach(atts[circleIndex],context);
        if(okCircle){ circleOk=true;
          toast('Скачивание кружка запущено');
          // Continue with other attachments in the same message, if present.
        }
      }catch(e){
        console.warn('[VKE Attach] circle',e?.message||e);
      }
    }

    toast(`Вложения: 0/${atts.length}`);let ok=0,seen=0;
    for(let i=0;i<atts.length;i++){
      const att=atts[i];
      // Circle was already processed above; do not trigger a second slow path.
      if(i===circleIndex) { seen++; if(circleOk) ok++; toast(`Вложения: ${ok}/${atts.length}`); continue; }
      seen++;
      try{if(await one(att,context))ok++}catch(e){console.warn('[VKE Attach]',e?.message||e)}
      toast(`Вложения: ${ok}/${atts.length}`);
    }
    // Forwarded photos are rendered by VK inside ForwardedMessagesList and can
    // still be absent from the serialized attachment object. In that case use
    // the exact photo link from the selected message row, then resolve the full
    // size by owner_id + id instead of downloading the 640px chat preview.
    if(forwardedDomPhotos.length){
      const known=new Set();
      for(const a of atts){
        const t=String(a?.type||'').toLowerCase();
        const p=a?.photo || (t==='photo'?a:null);
        const o=p?.owner_id ?? p?.ownerId;
        const i=p?.id ?? p?.photo_id ?? p?.photoId;
        if(o!=null&&i!=null) known.add(`${o}_${i}`);
      }
      for(const d of forwardedDomPhotos){
        const key=d.owner_id&&d.id?`${d.owner_id}_${d.id}`:d.url;
        if(!key||known.has(key))continue;
        let resolved=null;
        if(d.owner_id&&d.id){
          resolved=await resolvePhotoAttachment({type:'photo',photo:{owner_id:Number(d.owner_id),id:Number(d.id)}},context).catch(()=>null);
        }
        if(!resolved?.url && d.url) resolved={photo:{owner_id:d.owner_id,id:d.id},url:d.url};
        if(!resolved?.url)continue;
        try{
          const p=resolved.photo||{};
          const ext=/^data:image\/png/i.test(resolved.url)||/\.png(?:[?#]|$)/i.test(resolved.url)?'png':(/\.webp(?:[?#]|$)/i.test(resolved.url)?'webp':'jpg');
          await downloadUrl(resolved.url,`photo_${p.owner_id||d.owner_id||'0'}_${p.id||d.id||Date.now()}.${ext}`);
          ok++; known.add(key); seen++;
          toast(`Вложения: ${ok}/${Math.max(atts.length,ok)}`);
        }catch{}
      }
    }
    toast(ok?`Вложения: запущено ${ok}/${Math.max(atts.length,ok)}`:'Не удалось запустить скачивание вложений');
    return{ok,seen};
  }
  window.addEventListener('message',e=>{
    if(e.source!==window||e.data?.source!=='vke-main'||e.data?.type!=='VKE_DOWNLOAD_MESSAGE_ATTACHMENTS')return;
    const id=e.data.requestId;if(id&&pending.has(id))return;if(id)pending.add(id);
    const shared = id && window.__vkeAttachmentContexts?.get?.(id) || null;
    let markedRoot = null;
    try {
      const key = e.data.domKey;
      if (key) markedRoot = document.querySelector(`[data-vke-attachment-context="${CSS.escape(key)}"]`);
    } catch {}
    const context={cmid:e.data.cmid||shared?.cmid||null,peerId:e.data.peerId||shared?.peerId||null,root:markedRoot||shared?.element||null};
    all(safe(e.data.attachments)||[],context).finally(()=>{if(id)pending.delete(id)});
  });
})();
