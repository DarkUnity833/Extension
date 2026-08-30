// content-bridge.js — ISOLATED world
(() => {
  if (window.__vkeBridgeInit) return;
  window.__vkeBridgeInit = true;

  console.log('[VKE Bridge] Initialized');

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (!event.data) return;

    if (event.data.source === 'vke-clp' && event.data.type === 'CLP_API_VIDEO_GET') {
      const { type, id, requestId } = event.data;
      try {
        const result = await chrome.runtime.sendMessage({
          type: 'API_CALL',
          payload: { method: 'video.get', params: { videos: id, count: 1, extended: 1 } }
        });
        window.postMessage({
          source: 'vke-clp-bridge',
          type: 'CLP_API_VIDEO_GET_RESULT',
          requestId,
          response: result?.success ? result.response : null,
          error: result?.success ? null : (result?.error || 'VK API error')
        }, '*');
      } catch (e) {
        window.postMessage({
          source: 'vke-clp-bridge',
          type: 'CLP_API_VIDEO_GET_RESULT',
          requestId,
          response: null,
          error: e?.message || String(e)
        }, '*');
      }
      return;
    }

    if (event.data.source === 'vke-clp' && event.data.type === 'CLP_RESOLVE_PAGE_MEDIA') {
      const { requestId, urls, pageUrl } = event.data;
      try {
        const result = await chrome.runtime.sendMessage({ type: 'VKE_RESOLVE_PAGE_MEDIA', urls, pageUrl });
        window.postMessage({ source: 'vke-clp-bridge', type: 'CLP_RESOLVE_PAGE_MEDIA_RESULT', requestId, results: result?.ok ? result.results : [], error: result?.ok ? null : (result?.error || 'Media resolver error') }, '*');
      } catch (e) {
        window.postMessage({ source: 'vke-clp-bridge', type: 'CLP_RESOLVE_PAGE_MEDIA_RESULT', requestId, results: [], error: e?.message || String(e) }, '*');
      }
      return;
    }

    if (event.data.source !== 'vke-main') return;

    if (event.data.type === 'VKE_RESOLVE_PLAYER_MEDIA') {
      const { requestId, url, pageUrl } = event.data;
      try {
        const result = await chrome.runtime.sendMessage({ type: 'VKE_RESOLVE_PLAYER_MEDIA', url, pageUrl });
        window.postMessage({ source:'vke-bridge', type:'VKE_RESOLVE_PLAYER_MEDIA_RESULT', requestId, response: result?.ok ? result : null, error: result?.ok ? null : (result?.error || 'Player resolver error') }, '*');
      } catch (e) {
        window.postMessage({ source:'vke-bridge', type:'VKE_RESOLVE_PLAYER_MEDIA_RESULT', requestId, response:null, error:e?.message || String(e) }, '*');
      }
      return;
    }

    if (event.data.type === 'VKE_MEDIA_API') {
      const { requestId, method, params } = event.data;
      try {
        const result = await chrome.runtime.sendMessage({ type: 'API_CALL', payload: { method, params } });
        window.postMessage({ source: 'vke-bridge', type: 'VKE_MEDIA_API_RESULT', requestId, response: result?.success ? result.response : null, error: result?.success ? null : (result?.error || 'VK API error') }, '*');
      } catch (e) {
        window.postMessage({ source: 'vke-bridge', type: 'VKE_MEDIA_API_RESULT', requestId, response: null, error: e?.message || String(e) }, '*');
      }
      return;
    }

    const { type, payload, requestId } = event.data;
    let response = null;
    let error = null;

    try {
      if (type === 'GET_SETTINGS') {
        const data = await chrome.storage.local.get(['vkeSettings']);
        response = data.vkeSettings || {
          silentRead: true, silentWrite: true, offline: true,
          deletedMessages: true, bombs: true, editHistory: true,
          cacheHistory: true, hookBombs: true, nodeleteall: true, deletedIndicator: 'trash'
        };
      }
      else if (type === 'API_CALL') {
        response = await chrome.runtime.sendMessage({ type: 'API_CALL', payload });
      }
      else if (type === 'GET_CHAT_RULES') {
        const data = await chrome.storage.local.get(['vke_chat_rules_v1']);
        response = data.vke_chat_rules_v1 || {
          noRead: { enable: [], disable: [] },
          noTyping: { enable: [], disable: [] },
          noTrack: { disable: [] }
        };
      }
      else if (type === 'STORAGE_GET') {
        const data = await chrome.storage.local.get([payload.key]);
        response = data[payload.key] || payload.default || null;
      }
      else if (type === 'STORAGE_SET') {
        await chrome.storage.local.set({ [payload.key]: payload.value });
        response = { ok: true };
      }
      else if (type === 'STORAGE_DELETE') {
        await chrome.storage.local.remove([payload.key]);
        response = { ok: true };
      }
      // ---- НОВОЕ: доступ к кэшу сообщений/истории редактирования ----
      else if (type === 'GET_CACHED_MESSAGE') {
        response = await chrome.runtime.sendMessage({ type: 'GET_CACHED_MESSAGE', payload });
      } else if (type === 'GET_CACHED_CHAT') {
        response = await chrome.runtime.sendMessage({ type: 'GET_CACHED_CHAT', payload });
      }
      else if (type === 'GET_MESSAGE_VERSIONS') {
        response = await chrome.runtime.sendMessage({ type: 'GET_MESSAGE_VERSIONS', payload });
      }
      else if (type === 'RESOLVE_CMID') {
        response = await chrome.runtime.sendMessage({ type: 'RESOLVE_CMID', payload });
      }
      else if (type === 'CACHE_HISTORY_PAGE') {
        response = await chrome.runtime.sendMessage({ type: 'CACHE_HISTORY_PAGE', payload });
      }
      else if (type === 'RECORD_MESSAGE_TEXT') {
        response = await chrome.runtime.sendMessage({ type: 'RECORD_MESSAGE_TEXT', payload });
      }
    } catch (e) {
      error = e.message;
      console.error('[VKE Bridge] Error:', e);
    }

    window.postMessage({ source: 'vke-bridge', requestId, response, error }, '*');
  });

  // Слушаем изменения настроек из popup
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.vkeSettings) return;
    console.log('[VKE Bridge] Settings updated:', changes.vkeSettings.newValue);
    window.postMessage({ source: 'vke-bridge', type: 'SETTINGS_UPDATED', settings: changes.vkeSettings.newValue }, '*');
  });

  // ---- НОВОЕ: приём событий из background.js (LongPoll: удаление/правка/восстановление) ----
  // background.js рассылает их через chrome.tabs.sendMessage — здесь их
  // единственная точка входа в isolated world, дальше форвардим в MAIN
  // world content.js через postMessage (как и всё остальное в этом мосте).
  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (!message || typeof message.type !== 'string') return;
      if (!['VKE_MESSAGE_DELETED', 'VKE_MESSAGE_EDITED', 'VKE_MESSAGE_RESTORED', 'VKE_MSG_CACHED'].includes(message.type)) return;
      window.postMessage({ source: 'vke-bridge', type: message.type, payload: message }, '*');
    });
  } catch (e) {
    console.warn('[VKE Bridge] runtime.onMessage listener error:', e);
  }
})();