// Shared download-progress helper (loaded as MAIN/isolated depending on manifest ordering).
// Intentionally self-contained; individual downloaders can also embed a fallback.
(function(){
  if (window.__vkeDownloadProgressHelper) return;
  window.__vkeDownloadProgressHelper = true;
  window.__vkePollDownload = function(downloadId, onUpdate, onDone){
    if (!downloadId || !chrome?.runtime?.sendMessage) return;
    let stopped=false;
    let timer=0;
    async function tick(){
      if(stopped)return;
      try{
        const r=await chrome.runtime.sendMessage({type:'VKE_DOWNLOAD_STATUS',downloadId});
        if(r?.ok){
          onUpdate?.(r);
          if(['complete','interrupted'].includes(r.state)){
            stopped=true;
            if(timer)clearTimeout(timer);
            onDone?.(r);
            return;
          }
        }
      }catch{}
      timer=setTimeout(tick,300);
    }
    tick();
    return ()=>{stopped=true;if(timer)clearTimeout(timer)};
  };
})();
