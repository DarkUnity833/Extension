(() => {
  'use strict';
  if (window.__VKE_SEGMENT_BRIDGE_V1__) return;
  window.__VKE_SEGMENT_BRIDGE_V1__ = true;
  let bridgeDead=false;
  function contextAlive(){
    if(bridgeDead) return false;
    try { return !!(chrome?.runtime?.id); } catch { bridgeDead=true; return false; }
  }

  function dispatchResponse(name, detail){
    try { window.dispatchEvent(new CustomEvent(name,{detail})); } catch {}
  }

  function sendMessageSafe(message, responseEvent, id){
    if(!contextAlive()){
      dispatchResponse(responseEvent,{id,ok:false,error:'Extension context invalidated'});
      return;
    }
    try {
      chrome.runtime.sendMessage(message, (resp) => {
        const err = chrome.runtime.lastError;
        dispatchResponse(responseEvent, err
          ? {id,ok:false,error:err.message}
          : (resp || {id,ok:false,error:'No response'}));
      });
    } catch (e) {
      dispatchResponse(responseEvent,{id,ok:false,error:String(e?.message||e)});
    }
  }

  window.addEventListener('vke-segment-api-request', (ev) => {
    const d = ev.detail || {};
    if (!d.id || typeof d.path !== 'string') return;
    sendMessageSafe({type:'VKE_SEGMENT_API', payload:d}, 'vke-segment-api-response', d.id);
  });

  window.addEventListener('vke-fetch-text-request', (ev) => {
    const d = ev.detail || {};
    if (!d.id || typeof d.url !== 'string') return;
    sendMessageSafe({type:'VKE_FETCH_TEXT', id:d.id, url:d.url, pageUrl:location.href}, 'vke-fetch-text-response', d.id);
  });
})();
