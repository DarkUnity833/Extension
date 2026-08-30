// content.js - MAIN world - ВСЯ логика расширения
(() => {
  if (window.__vkeInit) return;
  window.__vkeInit = true;

  console.log('[VKE] Initializing...');

  const CONFIG = {
    features: {
      silentRead: true,
      silentWrite: true,
      offline: true,
      deletedMessages: true,
      bombs: true,
      editHistory: true,
      deletedIndicator: 'trash'
    }
  };

  const state = {
    settings: { ...CONFIG.features },
    // { peerId: { cmid: { text, date, deleted, edits[], isBomb } } }
    messageCache: {},
    currentPeerId: null,
    isOnline: true,
    inactivityTimer: null,
    hydratedPeers: new Set(),
    chatRules: { noRead:{enable:[],disable:[]}, noTyping:{enable:[],disable:[]} }
  };

  // DOM templates for messages that VK/React removed. We keep a deep clone
  // of the ORIGINAL VK subtree, so React has no Fiber ownership over the
  // restored visual node and cannot immediately delete it again.
  const detachedMessages = new Map();

  // cmid -> React-owned message row captured BEFORE VK processes 10002.
  // We keep the DOM node reference, never a visual clone, so after React
  // reconciles the delete we can decorate the exact row it already owns.
  const pendingDeletedRows = new Map();

  // The network guard blocks the real deletion update before React. We do NOT
  // patch Node.removeChild/replaceChild/Element.remove here: doing so makes
  // React believe removal succeeded while the DOM node remains, which causes
  // virtual-list freezes/reconciliation loops. The exact native VK row is kept
  // alive by filtering the update itself.
  const pendingDeleteKeys = new Map();

  function latchDelete(peerId, cmid) {
    if (peerId == null || cmid == null) return;
    const key = `${peerId}:${cmid}`;
    pendingDeleteKeys.set(key, Date.now());
    setTimeout(() => {
      const t = pendingDeleteKeys.get(key);
      if (t && Date.now() - t > 30000) pendingDeleteKeys.delete(key);
    }, 32000);
  }

  function hasDeleteLatch(peerId, cmid) {
    return pendingDeleteKeys.has(`${peerId}:${cmid}`);
  }

  // Reload-safe visual snapshots. The authoritative message data stays in the
  // background cache; this only preserves the original VK DOM template long
  // enough to reconstruct a deleted row after a full page reload.
  const PERSISTED_SNAPSHOT_PREFIX = 'vke_deleted_dom_snapshot_v1:';
  const PERSISTED_SNAPSHOT_MAX_HTML = 350000;

  function persistedSnapshotKey(peerId, cmid) {
    return `${PERSISTED_SNAPSHOT_PREFIX}${String(peerId)}:${String(cmid)}`;
  }

  function savePersistedSnapshot(peerId, cmid, template, height = 48) {
    if (!peerId || cmid == null || !template) return;
    try {
      const html = template.outerHTML || '';
      if (!html || html.length > PERSISTED_SNAPSHOT_MAX_HTML) return;
      localStorage.setItem(
        persistedSnapshotKey(peerId, cmid),
        JSON.stringify({
          html,
          height: Math.max(1, Number(height) || 48),
          savedAt: Date.now()
        })
      );
    } catch (_) {}
  }

  function loadPersistedSnapshot(peerId, cmid) {
    if (!peerId || cmid == null) return null;
    try {
      const raw = localStorage.getItem(persistedSnapshotKey(peerId, cmid));
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data?.html) return null;

      const holder = document.createElement('template');
      holder.innerHTML = data.html.trim();
      const template = holder.content.firstElementChild;
      if (!template) return null;

      return {
        template,
        height: Math.max(1, Number(data.height) || 48),
        savedAt: Number(data.savedAt) || 0
      };
    } catch (_) {
      return null;
    }
  }

  function deletePersistedSnapshot(peerId, cmid) {
    try {
      localStorage.removeItem(persistedSnapshotKey(peerId, cmid));
    } catch (_) {}
  }

  // ============ НАСТРОЙКИ ============
  // ВАЖНО: content.js работает в MAIN world, где chrome.storage НЕДОСТУПЕН
  // физически (это ограничение браузера). Раньше здесь стоял прямой вызов
  // chrome.storage?.local?.get?.(...), который в MAIN world тихо ничего не
  // делает — из-за этого настройки никогда не применялись. Настоящий канал
  // — postMessage мост через content-bridge.js (isolated world), который
  // имеет доступ к chrome.storage и пересылает данные через window.postMessage.
  let settingsRequestId = 0;
  const pendingSettingsRequests = new Map();

  // Generic MAIN -> isolated bridge call. Used for persistent message/bomb
  // metadata because MAIN world has no direct chrome.storage/runtime access.
  let bridgeRequestId = 100000;
  const pendingBridgeCalls = new Map();

  function bridgeCall(type, payload) {
    const requestId = ++bridgeRequestId;
    return new Promise((resolve) => {
      pendingBridgeCalls.set(requestId, resolve);
      window.postMessage({ source: 'vke-main', type, payload, requestId }, '*');
      setTimeout(() => {
        if (pendingBridgeCalls.has(requestId)) {
          pendingBridgeCalls.delete(requestId);
          resolve(null);
        }
      }, 8000);
    });
  }

  function requestSettingsFromBridge() {
    const requestId = ++settingsRequestId;
    return new Promise((resolve) => {
      pendingSettingsRequests.set(requestId, resolve);
      window.postMessage({ source: 'vke-main', type: 'GET_SETTINGS', requestId }, '*');
      setTimeout(() => {
        if (pendingSettingsRequests.has(requestId)) {
          pendingSettingsRequests.delete(requestId);
          resolve(null);
        }
      }, 2000);
    });
  }

  function decorateNativeDeletedRow(peerId, cmid, isBomb) {
    const el = findLiveMessageElement(peerId, cmid);
    if (!el) return false;
    const wrapper = el.closest('.ConvoHistory__messageWrapper') || el;
    wrapper.dataset.vkeDeleted = '1';
    wrapper.dataset.vkeDeletedCmid = String(cmid);
    wrapper.style.opacity = '0.6';
    wrapper.style.transition = 'opacity .12s ease';

    return true;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    const d = event.data;

    // Ответ на GET_SETTINGS
    if (d.source === 'vke-bridge' && d.requestId && pendingSettingsRequests.has(d.requestId)) {
      const resolve = pendingSettingsRequests.get(d.requestId);
      pendingSettingsRequests.delete(d.requestId);
      resolve(d.response);
      if (d.response) {
        Object.assign(state.settings, d.response);
        console.log('[VKE] Settings loaded via bridge:', state.settings);
        renderDeletedMessages();
      }
      return;
    }

    if (d.source === 'vke-bridge' && d.requestId && pendingBridgeCalls.has(d.requestId)) {
      const resolve = pendingBridgeCalls.get(d.requestId);
      pendingBridgeCalls.delete(d.requestId);
      resolve(d.response);
      return;
    }

    // DELETE GUARD: message_state_guard.js runs before this script and prevents
    // VK/React from ever receiving deletion updates (10002/legacy delete).
    // The guard still notifies us with the exact cmid/peerId so we can capture
    // the existing React-owned row and decorate it in place.
    if (d.source === 'vke-delete-guard' && d.type === 'DELETE_UPDATE' && d.payload) {
      const peerId = d.payload.peer_id ?? getCurrentPeerId();
      const cmid = String(d.payload.cmid);
      latchDelete(peerId, cmid);
      // The delete update has already been removed from the page-facing stream,
      // so the original React row remains exactly where VK put it. Only decorate
      // that row; never clone/reinsert it.
      setTimeout(() => decorateNativeDeletedRow(peerId, cmid, false), 0);
      syncCachedMessageFromBridge(peerId, cmid).then(() => {
        setTimeout(() => decorateNativeDeletedRow(peerId, cmid, false), 0);
      }).catch(() => {});
      return;
    }

    if (d.source === 'vke-delete-guard' && d.type === 'LEGACY_DELETE_UPDATE' && d.payload) {
      const peerId = d.payload.peer_id ?? getCurrentPeerId();
      const messageId = d.payload.message_id;
      bridgeCall('RESOLVE_CMID', { peerId, messageId }).then(cmid => {
        if (cmid == null) return;
        const c = String(cmid);
        latchDelete(peerId, c);
        setTimeout(() => decorateNativeDeletedRow(peerId, c, false), 0);
        syncCachedMessageFromBridge(peerId, c).then(() => {
          setTimeout(() => decorateNativeDeletedRow(peerId, c, false), 0);
        }).catch(() => {});
      }).catch(() => {});
      return;
    }

    // Events from background -> isolated bridge -> MAIN. These are the
    // authoritative persistent-cache events for deletion/edit/bomb lifecycle.
    if (d.source === 'vke-bridge' && d.type === 'VKE_MESSAGE_DELETED' && d.payload) {
      const peerId = d.payload.peer_id;
      const cmid = d.payload.cmid;
      latchDelete(peerId, cmid);
      decorateNativeDeletedRow(peerId, cmid, !!d.payload.is_bomb);
      syncCachedMessageFromBridge(peerId, cmid);
      setTimeout(() => {
        const msg = state.messageCache[peerId]?.[cmid];
        if (!msg?.deleted) return;
        const row = findRenderedMessageRow(peerId, cmid);
        if (row) renderCachedMessageIntoExistingRow(peerId, cmid, row, msg, !!msg.isBomb);
      }, 80);
      return;
    }
    if (d.source === 'vke-bridge' && d.type === 'VKE_MESSAGE_EDITED' && d.payload) {
      syncCachedMessageFromBridge(d.payload.peer_id, d.payload.cmid);
      return;
    }
    if (d.source === 'vke-bridge' && d.type === 'VKE_MESSAGE_RESTORED' && d.payload) {
      removePersistentDeletedOverlay(d.payload.peer_id, d.payload.cmid);
      syncCachedMessageFromBridge(d.payload.peer_id, d.payload.cmid);
      return;
    }
    if (d.source === 'vke-bridge' && (d.type === 'VKE_MSG_CACHED' || d.type === 'VKE_BOMB_MARKED') && d.payload) {
      syncCachedMessageFromBridge(d.payload.peer_id ?? d.payload.peerId, d.payload.cmid);
      return;
    }

    // Живое обновление настроек из popup (content-bridge.js шлёт это при
    // chrome.storage.onChanged)
    if (d.source === 'vke-bridge' && d.type === 'SETTINGS_UPDATED' && d.settings) {
      Object.assign(state.settings, d.settings);
      console.log('[VKE] Settings updated via bridge:', state.settings);
      renderDeletedMessages();
    }
  });

  requestSettingsFromBridge();
  // На случай, если мост ещё не успел проинициализироваться к моменту
  // первого запроса — повторяем попытку.
  [500, 1500].forEach(delay => setTimeout(requestSettingsFromBridge, delay));

  // ================= REACT FIBER HELPER =================
  // Вместо сравнения текста/времени в DOM (хрупко: не совпадает форматирование,
  // эмодзи, обрезка) — достаём cmid/peerId напрямую из пропсов React-компонента,
  // как это делает сам VK внутри модуля 85199/95728.
  const FiberHelper = {
    getFiberKey(el) {
      if (!el) return null;
      for (const k in el) {
        if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) return k;
      }
      return null;
    },
    getMessageProps(el) {
      const key = this.getFiberKey(el);
      if (!key) return null;
      let fiber = el[key], depth = 0;
      while (fiber && depth < 25) {
        const props = fiber.memoizedProps || fiber.pendingProps;
        if (props && typeof props === 'object' && props.message && typeof props.message === 'object') {
          const msg = props.message;
          if (msg.cmid !== undefined) {
            return { cmid: msg.cmid, peerId: msg.peerId, raw: msg };
          }
        }
        fiber = fiber.return;
        depth++;
      }
      return null;
    },
    extractText(msg) {
      if (!msg) return '';
      if (Array.isArray(msg.chunks)) return msg.chunks.filter(c => c.kind === 'Text').map(c => c.text).join('');
      return msg.text || '';
    }
  };

  // ============ БЛОКИРОВКА DELETE-UPDATE ДО REACT ============
  // Важнее не возвращать удалённый DOM, а вообще не дать VK/React
  // получить delete-update. Наш MAIN world всё равно видит update первым,
  // сохраняет сообщение и помечает его удалённым. Для активной бомбочки
  // delete-update пропускаем после истечения TTL.
  function getCachedByMessageId(peerId, messageId) {
    const chat = state.messageCache[peerId];
    if (!chat) return null;
    for (const msg of Object.values(chat)) {
      if (msg && (String(msg.id) === String(messageId) || String(msg.messageId) === String(messageId))) {
        return msg;
      }
    }
    return null;
  }

  function isModernDeleteUpdate(update) {
    // Current VK IM LongPoll event:
    // [10002, conversation_message_id, flags, peer_id]
    return Array.isArray(update) &&
      Number(update[0]) === 10002 &&
      typeof update[1] !== 'undefined' &&
      typeof update[2] === 'number';
  }

  function isLegacyDeleteUpdate(update) {
    if (!Array.isArray(update) || Number(update[0]) !== 2 || typeof update[2] !== 'number') {
      return false;
    }
    const flags = Number(update[2]);
    return (flags & 128) === 128 || (flags & 131072) === 131072;
  }

  function markModernDeleteFromStream(update) {
    const cmid = update[1];
    const flags = Number(update[2]);
    const peerId = update[3] ?? update[4] ?? getCurrentPeerId();
    if (!peerId || !cmid) return;

    const isDeleted = (flags & 128) === 128 || (flags & 131072) === 131072;
    if (!isDeleted) return;

    // First try the in-memory record. If the message isn't hydrated yet,
    // ask background storage for the authoritative cached copy.
    const local = state.messageCache[peerId]?.[cmid];
    if (local) {
      local.deleted = true;

      // Capture the React-owned row BEFORE VK receives the update. This is the
      // important part: after 10002 React may replace the inner content, but
      // the conversation row itself is still the correct physical position.
      const live = findLiveMessageElement(peerId, cmid);
      const row = live?.closest?.('.ConvoHistory__messageWrapper') || live;
      if (row?.isConnected) pendingDeletedRows.set(`${peerId}:${cmid}`, row);

      console.log('[VKE] 10002 delete captured:', peerId, cmid);
      setTimeout(() => renderDeletedMessages(), 120);
      setTimeout(() => renderDeletedMessages(), 350);
      return;
    }

    // VK's 10002 uses cmid directly, so GET_CACHED_MESSAGE is the correct
    // lookup even when the message is not currently rendered.
    // Try to capture the row even when the in-memory cache has not hydrated yet.
    const live = findLiveMessageElement(peerId, cmid);
    const row = live?.closest?.('.ConvoHistory__messageWrapper') || live;
    if (row?.isConnected) pendingDeletedRows.set(`${peerId}:${cmid}`, row);

    syncCachedMessageFromBridge(peerId, cmid).then(() => {
      const msg = state.messageCache[peerId]?.[cmid];
      if (msg) {
        msg.deleted = true;
        console.log('[VKE] 10002 delete cached:', peerId, cmid);
        setTimeout(() => renderDeletedMessages(), 120);
      }
      // Background may persist the modern 10002 a few milliseconds later.
      // Retry once so a just-deleted message is not lost due to the race.
      setTimeout(() => syncCachedMessageFromBridge(peerId, cmid), 300);
    }).catch(() => {});
  }

  function shouldSuppressDeleteUpdate(update) {
    // Kept as a compatibility helper for older callers, but deletion updates
    // are intentionally NEVER suppressed anymore. VK must render the native
    // deleted row so VKE can decorate that exact React-owned position.
    if (!state.settings.deletedMessages) return false;
    if (isModernDeleteUpdate(update)) {
      markModernDeleteFromStream(update);
      return false;
    }
    if (!isLegacyDeleteUpdate(update)) return false;

    const messageId = update[1];
    const peerId = update[3] ?? update[4];
    const cached = getCachedByMessageId(peerId, messageId);
    if (!cached) return false;

    if (cached.isBomb && cached.bombExpiresAt && Date.now() < cached.bombExpiresAt) {
      cached.deleted = false;
      return false;
    }

    cached.deleted = true;
    console.log('[VKE] Legacy delete captured:', peerId, messageId);
    setTimeout(renderDeletedMessages, 60);
    return false;
  }

  function filterLongPollUpdatesForVK(updates) {
    if (!Array.isArray(updates)) return updates;

    // IMPORTANT: deletion updates must reach VK/React.
    // VKE only observes/caches them. Suppressing 10002/2 here prevents VK from
    // mounting its native deleted-message row, which is exactly the row whose
    // position we need to reuse. Returning the original update also keeps VK's
    // virtualized list/reconciliation in control of the DOM.
    handleLongPollUpdates(updates);
    return updates;
  }

  function createFilteredLongPollResponse(response, data) {
    try {
      const filtered = { ...data, updates: filterLongPollUpdatesForVK(data.updates) };
      return new Response(JSON.stringify(filtered), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    } catch (e) {
      console.warn('[VKE] Failed to rebuild LongPoll response:', e);
      return response;
    }
  }


  function normalizeChatRules(raw) {
    const out = { noRead:{enable:[],disable:[]}, noTyping:{enable:[],disable:[]} };
    if (!raw || typeof raw !== 'object') return out;
    for (const bucket of ['noRead','noTyping']) {
      const v = raw[bucket];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        out[bucket].enable = [...(v.enable || [])].map(String);
        out[bucket].disable = [...(v.disable || [])].map(String);
      } else if (Array.isArray(v)) {
        out[bucket].enable = v.map(String);
      }
    }
    return out;
  }

  function chatRuleValue(bucket, peerId, globalValue) {
    const p = String(peerId ?? '');
    const rule = state.chatRules?.[bucket] || { enable:[], disable:[] };
    if (rule.enable?.includes(p)) return true;
    if (rule.disable?.includes(p)) return false;
    return !!globalValue;
  }

  function applyChatRules(raw) {
    state.chatRules = normalizeChatRules(raw);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (d?.source === 'vke-chat-rules' && d.type === 'RULES_UPDATED') {
      applyChatRules(d.rules);
    }
  });

  // ============ LIVE EDIT HISTORY CAPTURE ============
  const observedMessageTexts = new Map();
  const observedMessageTimers = new Map();

  function rememberRenderedMessageText(el) {
    try {
      const info = FiberHelper.getMessageProps(el);
      if (!info?.cmid) return;
      const peerId = info.peerId ?? getCurrentPeerId();
      if (!peerId) return;
      const text = FiberHelper.extractText(info.raw || {});
      if (typeof text !== 'string') return;

      const key = `${peerId}:${info.cmid}`;
      const prev = observedMessageTexts.get(key);
      if (prev === undefined) {
        observedMessageTexts.set(key, text);
        return;
      }
      if (prev === text) return;

      observedMessageTexts.set(key, text);
      const oldTimer = observedMessageTimers.get(key);
      if (oldTimer) clearTimeout(oldTimer);
      observedMessageTimers.set(key, setTimeout(() => {
        observedMessageTimers.delete(key);
        bridgeCall('RECORD_MESSAGE_TEXT', {
          peerId,
          cmid: String(info.cmid),
          text,
          date: Math.floor(Date.now() / 1000)
        }).catch(() => {});
      }, 30));
    } catch (_) {}
  }

  function scanRenderedMessageTexts(root = document) {
    const nodes = root.querySelectorAll?.('.ConvoMessage, .ConvoMessageWithoutBubble, .im-mess') || [];
    for (const el of nodes) rememberRenderedMessageText(el);
  }

  let editScanTimer = null;
  const editObserver = new MutationObserver(() => {
    if (editScanTimer) return;
    editScanTimer = setTimeout(() => {
      editScanTimer = null;
      scanRenderedMessageTexts();
    }, 50);
  });
  try {
    editObserver.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true
    });
  } catch (_) {}
  setTimeout(scanRenderedMessageTexts, 250);
  setTimeout(scanRenderedMessageTexts, 1000);

  // ============ ПЕРЕХВАТ FETCH ============
  const origFetch = window.fetch;

  window.fetch = async function(...args) {
    const input = args[0];
    const url = typeof input === 'string' ? input : input?.url || '';
    const options = args[1] || {};
    let body = options.body;

    // VK increasingly uses fetch(new Request(...)) instead of the older
    // fetch(url, { body }) form. Read a cloned Request body without consuming
    // the real request.
    if (body == null && typeof Request !== 'undefined' && input instanceof Request) {
      try {
        body = await input.clone().text();
      } catch (_) {}
    }

    if (url.includes('act=a_check') || url.includes('lp.vk.com')) {
      const response = await origFetch.apply(this, args);
      try {
        const clone = response.clone();
        const data = await clone.json();
        if (data?.updates) return createFilteredLongPollResponse(response, data);
      } catch (e) {}
      return response;
    }

    if (url.includes('/method/')) {
      const methodMatch = url.match(/\/method\/([a-zA-Z.]+)/);
      const method = methodMatch?.[1];
      const params = parseRequestBody(body);
      const peerId = params.peer_id || params.peer;

      if ((method === 'messages.markAsRead' || method === 'messages.resetUpdatesCounter') && chatRuleValue('noRead', peerId, state.settings.silentRead)) {
        return createFakeResponse(1);
      }
      if (method === 'messages.setActivity' && chatRuleValue('noTyping', peerId, state.settings.silentWrite)) {
        return createFakeResponse(1);
      }
      if (method === 'account.setOnline' && state.settings.offline) {
        return createFakeResponse(1);
      }
    }

    if (url.includes('/method/messages.getHistory')) {
      const response = await origFetch.apply(this, args);
      try {
        const clone = response.clone();
        const data = await clone.json();
        if (data?.response?.items) {
          const params = parseRequestBody(body);
          const peerId = params.peer_id;
          if (peerId) cacheMessages(peerId, data.response.items);
        }
      } catch (e) {}
      return response;
    }

    return origFetch.apply(this, args);
  };

  // ============ ПЕРЕХВАТ WEBSOCKET ============
  const OrigWebSocket = window.WebSocket;

  function filterWebSocketEvent(event, ws) {
    try {
      const data = JSON.parse(event.data);
      if (!data?.updates) return event;
      const filtered = filterLongPollUpdatesForVK(data.updates);
      if (filtered.length === data.updates.length) return event;
      const replacement = { ...data, updates: filtered };
      const clonedEvent = new MessageEvent('message', {
        data: JSON.stringify(replacement),
        origin: event.origin,
        lastEventId: event.lastEventId,
        source: event.source,
        ports: event.ports
      });
      return clonedEvent;
    } catch (e) {
      return event;
    }
  }

  window.WebSocket = function(url, protocols) {
    const ws = protocols ? new OrigWebSocket(url, protocols) : new OrigWebSocket(url);

    const originalAddEventListener = ws.addEventListener.bind(ws);
    ws.addEventListener = function(type, listener, options) {
      if (type === 'message' && typeof listener === 'function') {
        const wrappedListener = function(event) {
          listener.call(ws, filterWebSocketEvent(event, ws));
        };
        return originalAddEventListener(type, wrappedListener, options);
      }
      return originalAddEventListener(type, listener, options);
    };

    // VK может использовать ws.onmessage вместо addEventListener. Перехватываем
    // и этот путь, не меняя поведение остальных WebSocket событий.
    try {
      let userOnMessage = null;
      Object.defineProperty(ws, 'onmessage', {
        configurable: true,
        enumerable: true,
        get() { return userOnMessage; },
        set(fn) {
          userOnMessage = typeof fn === 'function' ? fn : null;
          ws.__vkeOnMessageHandler = userOnMessage;
          ws.removeEventListener?.('__vke_dummy__', () => {});
        }
      });

      const nativeAdd = ws.addEventListener.bind(ws);
      nativeAdd('message', (event) => {
        const fn = ws.__vkeOnMessageHandler;
        if (typeof fn === 'function') fn.call(ws, filterWebSocketEvent(event, ws));
      });
    } catch (e) {}

    return ws;
  };
  window.WebSocket.prototype = OrigWebSocket.prototype;
  window.WebSocket.CONNECTING = OrigWebSocket.CONNECTING;
  window.WebSocket.OPEN = OrigWebSocket.OPEN;
  window.WebSocket.CLOSING = OrigWebSocket.CLOSING;
  window.WebSocket.CLOSED = OrigWebSocket.CLOSED;

  // ============ ПЕРЕХВАТ XHR ============
  const origXHROpen = XMLHttpRequest.prototype.open;
  const origXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._url = url;
    this._method = method;
    return origXHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function(body) {
    if (this._url?.includes('/method/')) {
      const method = this._url.match(/\/method\/([a-zA-Z.]+)/)?.[1];

      const params = parseRequestBody(body);
      const peerId = params.peer_id || params.peer;
      if ((method === 'messages.markAsRead' || method === 'messages.resetUpdatesCounter') && chatRuleValue('noRead', peerId, state.settings.silentRead)) {
        mockXHRResponse(this, 1); return;
      }
      if (method === 'messages.setActivity' && chatRuleValue('noTyping', peerId, state.settings.silentWrite)) {
        mockXHRResponse(this, 1); return;
      }
      if (method === 'account.setOnline' && state.settings.offline) {
        mockXHRResponse(this, 1); return;
      }
    }
    return origXHRSend.apply(this, [body]);
  };

  // ============ LONG POLL ============
  // Реальные коды VK LongPoll: 4 — новое сообщение, 2/3 — изменение/сброс
  // флагов (используем как триггер проверки удаления, т.к. точная битовая
  // маска официально не документирована).
  function handleLongPollUpdates(updates) {
    for (const update of updates) {
      const type = Number(update[0]);
      if (type === 4) handleMessageNew(update);
      else if (type === 10002) {
        markModernDeleteFromStream(update);
      } else if (type === 10003) {
        // 10003 is the corresponding flag-reset/restore event. Do not suppress it.
        handleMessageFlagsChanged(update);
      } else if (type === 2 || type === 3) {
        handleMessageFlagsChanged(update);
      } else if (type === 5) {
        handleMessageEdited(update);
      }
    }
  }

  function handleMessageNew(update) {
    const messageId = update[1];
    const flags = update[2];
    const peerId = update[3];
    const ts = update[4];
    const text = update[5] || '';
    const extra = (update[6] && typeof update[6] === 'object') ? update[6] : {};
    const cmid = extra.cmid || messageId;

    if (!peerId) return;
    if (!state.messageCache[peerId]) state.messageCache[peerId] = {};

    const existing = state.messageCache[peerId][cmid];
    const ttl = Number(extra.expire_ttl ?? extra.ttl);
    const isActiveBomb = Number.isFinite(ttl) && ttl > 0;
    const isExpiredBomb = extra.is_expired === true || (extra.expire_ttl === 0 && !!extra.is_expired);
    const bombExpiresAt = isActiveBomb ? Date.now() + ttl * 1000 : (existing?.bombExpiresAt || null);
    const isBomb = isActiveBomb || isExpiredBomb || !!existing?.isBomb;

    if (existing) {
      if (existing.text !== text && text) {
        if (state.settings.editHistory && existing.text) {
          existing.edits.push({ text: existing.text, date: Date.now() });
        }
        existing.text = text;
      }
      existing.id = messageId || existing.id;
      existing.date = ts || existing.date;
      if (isBomb) existing.isBomb = true;
      if (bombExpiresAt) existing.bombExpiresAt = bombExpiresAt;
      if (isExpiredBomb) existing.deleted = true;
      // An active bomb is NOT a deleted message.
    } else {
      state.messageCache[peerId][cmid] = {
        id: messageId, cmid, text, date: ts,
        deleted: isExpiredBomb,
        edits: [], isBomb,
        bombExpiresAt
      };
    }

    if (isActiveBomb) {
      scheduleBombExpiry(peerId, cmid, bombExpiresAt);
    }
    if (isBomb) {
      detectBombIcons();
      renderDeletedMessages();
    }
  }


  // Коды 2/3 не только про удаление — подтверждаем реальное удаление тем,
  // что сообщение с этим cmid у нас уже закэшировано, и просто помечаем его.
  // (Полноценная проверка через messages.getById недоступна из MAIN world
  // без токена — здесь используем эвристику по наличию в кэше.)
  function handleMessageEdited(update) {
    const messageId = update[1];
    const peerId = update[3];
    const ts = update[4];
    const newText = update[5] || '';
    if (!peerId) return;
    const chat = state.messageCache[peerId];
    if (!chat) return;
    for (const cmid of Object.keys(chat)) {
      const msg = chat[cmid];
      if (String(msg.id) !== String(messageId)) continue;
      if (String(msg.text || '') === String(newText)) return;
      if (state.settings.editHistory && msg.text !== undefined) {
        msg.edits ||= [];
        msg.edits.push({ text: msg.text || '', date: (msg.date || ts || Math.floor(Date.now()/1000)) * 1000 });
      }
      msg.text = newText;
      msg.date = ts || msg.date;
      return;
    }
  }

  function handleMessageFlagsChanged(update) {
    const messageId = update[1];
    const flags = update[2];
    const peerId = update[3] || update[4];
    if (!peerId || typeof flags !== 'number') return;

    const FLAG_DELETED = 128;
    const FLAG_DELETED_FOR_ALL = 131072;
    const isDeleted = (flags & FLAG_DELETED) === FLAG_DELETED || (flags & FLAG_DELETED_FOR_ALL) === FLAG_DELETED_FOR_ALL;
    if (!isDeleted) return;

    const chat = state.messageCache[peerId];
    if (!chat) return;

    // messageId в событии 2/3 — это message_id, а не cmid. У нас в кэше
    // сообщения индексированы по cmid, поэтому ищем совпадение по id.
    for (const cmid in chat) {
      if (String(chat[cmid].id) === String(messageId) && !chat[cmid].deleted) {
        chat[cmid].deleted = true;
        console.log('[VKE] Message marked as deleted:', cmid);
        setTimeout(renderDeletedMessages, 60);
        return;
      }
    }
  }

  function cacheMessages(peerId, items) {
    if (!state.messageCache[peerId]) state.messageCache[peerId] = {};

    for (const item of items) {
      const cmid = item.conversation_message_id || item.id;
      const ttl = Number(item.expire_ttl);
      const isBomb = Number.isFinite(ttl) && ttl > 0;
      const existing = state.messageCache[peerId][cmid];

      if (!existing) {
        state.messageCache[peerId][cmid] = {
          id: item.id, cmid, text: item.text || '', date: item.date,
          deleted: false, edits: [], isBomb,
          bombExpiresAt: isBomb ? Date.now() + ttl * 1000 : null,
          fromId: item.from_id
        };
      } else {
        const incomingText = item.text || existing.text || '';
        if (state.settings.editHistory && String(existing.text || '') !== String(incomingText)) {
          existing.edits ||= [];
          const lastEditText = existing.edits[existing.edits.length - 1]?.text;
          if (lastEditText !== existing.text) {
            existing.edits.push({
              text: existing.text || '',
              date: Number(existing.date || item.date || Math.floor(Date.now()/1000)) * 1000
            });
          }
        }
        existing.id = item.id || existing.id;
        existing.text = incomingText;
        existing.date = item.date || existing.date;
        if (isBomb) {
          existing.isBomb = true;
          existing.bombExpiresAt = Date.now() + ttl * 1000;
          scheduleBombExpiry(peerId, cmid, existing.bombExpiresAt);
        }
      }

      if (isBomb) {
        scheduleBombExpiry(peerId, cmid, state.messageCache[peerId][cmid].bombExpiresAt);
      }
    }
  }

  function versionsToEdits(versions, fallbackEdits = []) {
    if (!Array.isArray(versions) || !versions.length) return Array.isArray(fallbackEdits) ? fallbackEdits : [];
    // background stores the original text as versions[0] and appends every
    // edited text after it; the last entry is the current version.
    if (versions.length <= 1) return [];
    return versions.slice(0, -1).map(v => ({
      text: v?.text || '',
      date: Number(v?.date || 0) * 1000
    }));
  }

  async function hydrateCurrentPeer(peerId) {
    if (!peerId || state.hydratedPeers.has(String(peerId))) return;
    const chat = await bridgeCall('GET_CACHED_CHAT', { peerId });
    if (chat && typeof chat === 'object') {
      state.messageCache[peerId] ||= {};
      for (const [cmid, msg] of Object.entries(chat)) {
        const old = state.messageCache[peerId][cmid];
        const versions = Array.isArray(msg?.versions) ? msg.versions : [];
        state.messageCache[peerId][cmid] = {
          ...(old || {}),
          ...msg,
          cmid: msg?.cmid ?? cmid,
          edits: versionsToEdits(versions, old?.edits),
          isBomb: !!msg?.is_bomb || !!old?.isBomb,
          bombExpiresAt: msg?.bomb_expires_at ?? old?.bombExpiresAt ?? null,
          deleted: !!msg?.is_deleted || !!old?.deleted
        };
        if (state.messageCache[peerId][cmid].isBomb && state.messageCache[peerId][cmid].bombExpiresAt) {
          scheduleBombExpiry(peerId, cmid, state.messageCache[peerId][cmid].bombExpiresAt);
        }
      }
    }
    state.hydratedPeers.add(String(peerId));
  }

  async function syncCachedMessageFromBridge(peerId, cmid) {
    if (!peerId || cmid === undefined || cmid === null) return;
    const msg = await bridgeCall('GET_CACHED_MESSAGE', { peerId, cmid });
    if (!msg) return;

    if (!state.messageCache[peerId]) state.messageCache[peerId] = {};
    const old = state.messageCache[peerId][cmid];

    state.messageCache[peerId][cmid] = {
      ...(old || { cmid, edits: [] }),
      ...msg,
      cmid: msg.cmid ?? cmid,
      edits: versionsToEdits(msg.versions, msg.edits ?? old?.edits),
      isBomb: !!msg.is_bomb || !!old?.isBomb,
      bombExpiresAt: msg.bomb_expires_at ?? old?.bombExpiresAt ?? null,
      deleted: !!msg.is_deleted || !!old?.deleted
    };

    if (state.messageCache[peerId][cmid].isBomb && state.messageCache[peerId][cmid].bombExpiresAt) {
      scheduleBombExpiry(peerId, cmid, state.messageCache[peerId][cmid].bombExpiresAt);
    }

    if (state.messageCache[peerId][cmid].deleted) {
      // React owns the live row. Do not create a detached clone here; wait for
      // VK's delete reconciliation and decorate the native row instead.
      setTimeout(renderDeletedMessages, 60);
    } else {
      renderDeletedMessages();
    }
  }

  const bombTimers = new Map();

  function scheduleBombExpiry(peerId, cmid, expiresAt) {
    if (!expiresAt || expiresAt <= Date.now()) {
      if (expiresAt && expiresAt <= Date.now()) {
        const msg = state.messageCache[peerId]?.[cmid];
        if (msg?.isBomb) {
          msg.deleted = true;
          renderDeletedMessages();
        }
      }
      return;
    }

    const key = `${peerId}:${cmid}`;
    const oldTimer = bombTimers.get(key);
    if (oldTimer) clearTimeout(oldTimer);

    const delay = Math.min(Math.max(expiresAt - Date.now() + 50, 50), 2147483647);
    bombTimers.set(key, setTimeout(() => {
      bombTimers.delete(key);
      const msg = state.messageCache[peerId]?.[cmid];
      if (!msg?.isBomb) return;
      if (msg.bombExpiresAt && Date.now() < msg.bombExpiresAt) {
        scheduleBombExpiry(peerId, cmid, msg.bombExpiresAt);
        return;
      }
      msg.deleted = true;
      renderDeletedMessages();
    }, delay));
  }

  function detectBombIcons() {
    if (!state.settings.bombs) return;

    const selectors = [
      '.ConvoMessageInfoWithoutBubbles__bombIcon',
      'svg.vkuiIcon--bomb_12',
      'svg[class*="bomb_12"]'
    ].join(',');

    document.querySelectorAll(selectors).forEach(icon => {
      const el = icon.closest('.ConvoMessage, .ConvoMessageWithoutBubble');
      if (!el) return;

      const info = FiberHelper.getMessageProps(el);
      if (!info?.cmid) return;

      const peerId = info.peerId ?? getCurrentPeerId();
      if (!peerId) return;

      const raw = info.raw || {};
      const ttl = Number(raw.expire_ttl ?? raw.ttl);
      const existing = state.messageCache[peerId]?.[info.cmid];
      const expiresAt = existing?.bombExpiresAt ||
        (Number.isFinite(ttl) && ttl > 0 ? Date.now() + ttl * 1000 : null);
      const alreadyKnownBomb = !!existing?.isBomb;
      const expiryChanged = !!expiresAt && existing?.bombExpiresAt !== expiresAt;

      if (!state.messageCache[peerId]) state.messageCache[peerId] = {};
      const msg = state.messageCache[peerId][info.cmid] ||= {
        id: raw.id,
        cmid: info.cmid,
        text: FiberHelper.extractText(raw),
        date: raw.date,
        deleted: false,
        edits: [],
        isBomb: false,
        bombExpiresAt: null,
        fromId: raw.from_id
      };

      msg.isBomb = true;
      if (expiresAt) msg.bombExpiresAt = expiresAt;
      if (msg.bombExpiresAt) scheduleBombExpiry(peerId, info.cmid, msg.bombExpiresAt);

      // Persist only on the first icon detection or when VK supplied a new
      // expiry. This prevents the MutationObserver from spamming storage.
      if (!alreadyKnownBomb || expiryChanged) {
        bridgeCall('MARK_BOMB', {
          peerId,
          cmid: info.cmid,
          messageId: raw.id,
          expireTtl: Number.isFinite(ttl) && ttl > 0 ? ttl : null,
          text: FiberHelper.extractText(raw) || msg.text || '',
          date: raw.date || msg.date
        });
      }

      // Active bomb: use the native message row when possible, so VK keeps the
      // message in its normal flow. Only fall back to the old persistent clone
      // mechanism if the row itself has already disappeared.
      if (msg.bombExpiresAt && Date.now() < msg.bombExpiresAt) {
        const row = findRenderedMessageRow(peerId, info.cmid);
        if (row) renderCachedMessageIntoExistingRow(peerId, info.cmid, row, msg, true);
        else createPersistentDeletedOverlay(peerId, info.cmid, el, msg, true);
      }
    });
  }


  function findLiveMessageElement(peerId, cmid) {
    if (cmid == null) return null;
    const container = document.querySelector('.ConvoHistory__content, .ConvoStack__content, .im-chat-container');
    if (!container) return null;
    const target = String(cmid);
    let found = null;
    container.querySelectorAll('.ConvoMessage, .ConvoMessageWithoutBubble, .im-mess').forEach(el => {
      if (found) return;
      const info = FiberHelper.getMessageProps(el);
      if (info && String(info.cmid) === target && (peerId == null || String(info.peerId ?? getCurrentPeerId()) === String(peerId))) {
        found = el;
      }
    });
    return found;
  }

  // ============ СОХРАНЕНИЕ УДАЛЁННОГО СООБЩЕНИЯ В ПОТОКЕ ==========
  // Ключевая идея: не накладывать fixed-оверлей поверх чата. Перед удалением
  // мы ставим нулевой по высоте spacer ровно перед message-node. Когда VK
  // действительно убирает message-node, spacer получает его исходную высоту.
  // Поэтому поток сообщений НЕ сжимается, а независимый clone находится
  // непосредственно в этом spacer и едет вместе с историей естественным DOM.
  const persistentDeletedOverlays = new Map();

  function getMessageVisualRoot(el) {
    if (!el) return null;
    // Prefer the stable VK message wrapper. Recreating this wrapper keeps the
    // exact horizontal alignment/spacing of the original message row.
    const wrapper = el.closest?.('.ConvoHistory__messageWrapper');
    if (wrapper) return wrapper;
    if (el.matches?.('.ConvoMessage, .ConvoMessageWithoutBubble, .im-mess')) return el;
    return el.querySelector?.('.ConvoMessage, .ConvoMessageWithoutBubble, .im-mess') || el.closest?.('.ConvoMessage, .ConvoMessageWithoutBubble, .im-mess') || el;
  }

  function copyMediaState(source, clone) {
    if (!source || !clone) return;
    // Canvas-based stickers/previews are blank after cloneNode(true).
    try {
      const srcCanvases = source.matches?.('canvas') ? [source] : Array.from(source.querySelectorAll?.('canvas') || []);
      const dstCanvases = clone.matches?.('canvas') ? [clone] : Array.from(clone.querySelectorAll?.('canvas') || []);
      for (let i = 0; i < Math.min(srcCanvases.length, dstCanvases.length); i++) {
        const srcCanvas = srcCanvases[i];
        const dstCanvas = dstCanvases[i];
        const dataUrl = srcCanvas.toDataURL?.('image/png');
        if (!dataUrl) continue;
        const img = document.createElement('img');
        img.src = dataUrl;
        img.width = srcCanvas.width;
        img.height = srcCanvas.height;
        img.style.cssText = 'display:block;max-width:100%;height:auto;';
        dstCanvas.replaceWith(img);
      }
    } catch (e) {}

    const tags = ['img', 'audio', 'video', 'source'];
    for (const tag of tags) {
      const srcNodes = source.matches?.(tag) ? [source] : Array.from(source.querySelectorAll?.(tag) || []);
      const dstNodes = clone.matches?.(tag) ? [clone] : Array.from(clone.querySelectorAll?.(tag) || []);
      for (let i = 0; i < Math.min(srcNodes.length, dstNodes.length); i++) {
        const src = srcNodes[i], dst = dstNodes[i];
        try {
          const current = src.currentSrc || src.src || src.getAttribute('src');
          if (current && (!dst.getAttribute('src') || dst.getAttribute('src') === '')) dst.setAttribute('src', current);
          if (tag === 'video' && src.poster) dst.setAttribute('poster', src.poster);
          if (tag === 'audio' || tag === 'video') dst.controls = true;
        } catch (e) {}
      }
    }

    try {
      const srcEls = [source, ...Array.from(source.querySelectorAll?.('*') || [])];
      const dstEls = [clone, ...Array.from(clone.querySelectorAll?.('*') || [])];
      for (let i = 0; i < Math.min(srcEls.length, dstEls.length); i++) {
        const bg = getComputedStyle(srcEls[i]).backgroundImage;
        if (bg && bg !== 'none') dstEls[i].style.backgroundImage = bg;
      }
    } catch (e) {}
  }

  function sanitizeDeletedClone(source, clone, msg, isBomb, holderHeight = 0) {
    if (!clone) return;

    clone.removeAttribute?.('data-vke-processed');
    clone.removeAttribute?.('data-vke-persistent-deleted');
    clone.style.cssText +=
      ';display:block!important;position:relative!important;top:auto!important;left:auto!important;' +
      'width:100%!important;max-width:100%!important;box-sizing:border-box!important;' +
      'margin:0!important;transform:none!important;z-index:0!important;pointer-events:auto!important;' +
      'opacity:1!important;filter:none!important;font-style:normal!important;';

    if (holderHeight > 0) {
      clone.style.minHeight = '0px';
    }

    clone.querySelectorAll?.(
      '.vke-persistent-deleted-badge, .vke-persistent-bomb-badge, ' +
      '.vke-deleted-badge, .vke-bomb-badge'
    ).forEach(n => n.remove?.());

    copyMediaState(source, clone);

    // Keep text non-italic.
    clone.querySelectorAll?.('*').forEach(node => {
      if (node.style) node.style.fontStyle = 'normal';
    });

    const textEl = clone.querySelector?.(
      '.MessageText, .ConvoMessage__text, .im-mess-stack--text'
    );

    // Only restore plain text if VK replaced it by the deleted placeholder.
    // Rich attachments are kept from the original DOM subtree.
    if (textEl && msg?.text) {
      const current = textEl.textContent || '';
      if (!current.trim() || /сообщение\s+(удалено|исчезло)/i.test(current)) {
        textEl.textContent = msg.text;
      }
    }

    clone.querySelectorAll?.('audio, video').forEach(media => {
      try {
        media.controls = true;
        media.autoplay = false;
        media.loop = false;
        media.style.pointerEvents = 'auto';
        const src = media.currentSrc || media.src || media.getAttribute('src');
        if (src) media.setAttribute('src', src);
        media.load?.();
      } catch (_) {}
    });

    // An active bomb is shown as the original message, without "deleted".
    if (!msg?.deleted) return;

    const infoBlock = clone.querySelector?.(
      '.ConvoMessageBottomInfo, .ConvoMessage__info, .ConvoMessageInfoWithoutBubbles'
    );
    if (!infoBlock) return;

    const date = infoBlock.querySelector?.(
      '.ConvoMessageInfoWithoutBubbles__date, [class*="__date"]'
    );

    // Place time on the right and deleted label directly below it.
    infoBlock.style.display = 'flex';
    infoBlock.style.flexDirection = 'column';
    infoBlock.style.alignItems = 'flex-end';
    infoBlock.style.justifyContent = 'flex-start';
    infoBlock.style.gap = '1px';
    infoBlock.style.fontStyle = 'normal';

    if (date) {
      date.style.order = '0';
      date.style.float = 'none';
      date.style.display = 'block';
      date.style.marginLeft = 'auto';
      date.style.marginRight = '0';
      date.style.alignSelf = 'flex-end';
    }

    const status = document.createElement('div');
    status.className = isBomb
      ? 'vke-persistent-bomb-badge'
      : 'vke-persistent-deleted-badge';
    status.textContent = isBomb ? '💣 Сгорело' : '🗑️ Удалённое сообщение';
    status.style.cssText =
      'display:block!important;order:1;margin:0!important;padding:0!important;' +
      'font-size:11px!important;line-height:14px!important;font-style:normal!important;' +
      'font-weight:400!important;color:#fff!important;opacity:.78!important;' +
      'white-space:nowrap!important;text-align:right!important;align-self:flex-end!important;';

    infoBlock.appendChild(status);
  }

  function createPersistentDeletedOverlay(peerId, cmid, sourceEl, msg, isBomb=false) {
    if (!peerId || cmid == null || !sourceEl || !msg) return false;
    if (!msg.deleted && !msg.isBomb) return false;

    // When VK still owns the real message node, never create a floating clone.
    // Capture the original subtree and let the normal render path reuse the
    // native React row or restore the snapshot after removal.
    captureMessageBeforeRemoval(sourceEl);
    return true;
  }

  function createPersistentOverlayFromSnapshot(peerId, cmid, record, msg, isBomb=false) {
    if (!record?.template || !msg) return false;
    if (!msg.deleted && !msg.isBomb) return false;

    const key = `${peerId}:${cmid}`;
    const existing = persistentDeletedOverlays.get(key);
    if (existing?.holder?.isConnected) {
      existing.removed = true;
      if (existing.clone) {
        sanitizeDeletedClone(existing.source || record.template, existing.clone, msg, isBomb, existing.height);
        existing.clone.style.opacity = '0.62';
        existing.clone.style.filter = 'grayscale(0.2)';
      }
      return true;
    }

    let parent = record.parent?.isConnected ? record.parent : null;
    if (!parent) {
      const container = document.querySelector('.ConvoHistory__content, .ConvoStack__content, .im-chat-container');
      if (!container) return false;
      parent = container;
    }

    const height = Math.max(1, Math.round(record.initialRect?.height || 48));

    const holder = document.createElement('div');
    holder.dataset.vkeDeletedHolder = key;
    holder.style.cssText =
      `display:block!important;position:relative!important;width:100%!important;` +
      `height:${height}px!important;min-height:${height}px!important;` +
      `box-sizing:border-box!important;margin:0!important;padding:0!important;` +
      `overflow:visible!important;`;

    let clone;
    try { clone = record.template.cloneNode(true); } catch (e) { return false; }

    sanitizeDeletedClone(record.template, clone, msg, isBomb, height);
    clone.style.position = 'relative';
    clone.style.top = 'auto';
    clone.style.left = 'auto';
    clone.style.width = '100%';
    clone.style.height = 'auto';
    clone.style.minHeight = '0';
    clone.style.margin = '0';
    clone.style.zIndex = '0';
    clone.style.opacity = '0.62';
    clone.style.filter = 'grayscale(0.2)';

    holder.appendChild(clone);

    // VK's conversation is virtualized: the original sibling/index becomes stale
    // after React reconciles the list. Always prefer a LIVE cmid-based neighbour.
    // This prevents a restored message from falling to the bottom after the first
    // React render.
    let inserted = false;
    try {
      const logical = findLogicalInsertPoint(cmid, parent);
      if (logical?.parent?.isConnected) {
        parent = logical.parent;
        if (logical.before?.parentNode === parent) {
          parent.insertBefore(holder, logical.before);
          inserted = true;
        } else if (logical.after?.parentNode === parent) {
          parent.insertBefore(holder, logical.after.nextSibling);
          inserted = true;
        }
      }

      if (!inserted && record.nextSibling?.parentNode === parent) {
        parent.insertBefore(holder, record.nextSibling);
        inserted = true;
      }

      if (!inserted && record.previousSibling?.parentNode === parent) {
        parent.insertBefore(holder, record.previousSibling.nextSibling);
        inserted = true;
      }

      if (!inserted && Number.isInteger(record.childIndex) && record.childIndex >= 0) {
        const children = parent.children || [];
        const anchor = children[Math.min(record.childIndex, children.length)];
        if (anchor) {
          parent.insertBefore(holder, anchor);
          inserted = true;
        } else if (children.length === record.childIndex) {
          parent.appendChild(holder);
          inserted = true;
        }
      }
    } catch (_) {}

    // Never blindly append to the chat root. If there is no logical neighbour,
    // leave the holder out rather than producing the old bottom-of-chat artefact.
    // The next render cycle retries once VK mounts the surrounding rows.
    if (!inserted) {
      holder.remove();
      return false;
    }

    persistentDeletedOverlays.set(key, {
      peerId,
      cmid,
      key,
      source: null,
      parent,
      holder,
      clone,
      height,
      childIndex: Number.isInteger(record.childIndex) ? record.childIndex : -1,
      nextSibling: record.nextSibling || null,
      previousSibling: record.previousSibling || null,
      removed: true,
      createdAt: Date.now(),
      isBomb: !!isBomb
    });

    console.log('[VKE] Deleted message restored at original DOM position:', peerId, cmid);
    return true;
  }

  function removePersistentDeletedOverlay(peerId, cmid) {
    const key = `${peerId}:${cmid}`;
    const rec = persistentDeletedOverlays.get(key);
    if (!rec) return;

    if (rec.source?.isConnected && rec.source.dataset.vkeHiddenDeleted === key) {
      rec.source.style.visibility = '';
      delete rec.source.dataset.vkeHiddenDeleted;
    }

    rec.clone?.remove?.();
    rec.holder?.remove?.();
    persistentDeletedOverlays.delete(key);
    deletePersistedSnapshot(peerId, cmid);
  }

  function refreshPersistentDeletedOverlays() {
    for (const [key, rec] of persistentDeletedOverlays) {
      const cached = state.messageCache[rec.peerId]?.[rec.cmid];
      if (!cached || (!cached.deleted && !cached.isBomb)) {
        removePersistentDeletedOverlay(rec.peerId, rec.cmid);
        continue;
      }

      if (cached.isBomb && cached.bombExpiresAt && Date.now() < cached.bombExpiresAt) {
        if (rec.holder) {
          rec.holder.style.height = rec.removed ? `${rec.height}px` : '0px';
          rec.holder.style.minHeight = rec.holder.style.height;
        }
        if (rec.clone) sanitizeDeletedClone(rec.source, rec.clone, cached, true, rec.height);
        continue;
      }

      if (!cached.deleted) continue;

      // Deleted messages are rendered only inside VK's own React row. Never
      // recreate a detached holder here; doing so creates a second visual node.
      if (rec.holder && !rec.source?.isConnected) {
        rec.holder.remove?.();
        persistentDeletedOverlays.delete(key);
      }
    }
  }

  function createPersistentOverlayFromRecord(peerId, cmid) {
    const record = detachedMessages.get(`${peerId}:${cmid}`);
    const msg = state.messageCache[peerId]?.[cmid];
    if (!record || !msg || (!msg.deleted && !msg.isBomb)) return false;
    return createPersistentOverlayFromSnapshot(peerId, cmid, record, msg, !!msg.isBomb);
  }

  // Find the React row that VK renders after a delete. In current VK builds
  // the row can keep data-cmid/data-msg-id even though its contents have been
  // replaced by the "message disappeared" UI. Reusing that row is preferable
  // to any overlay/spacer because React keeps its place in the conversation.
  function findRenderedMessageRow(peerId, cmid) {
    const pending = pendingDeletedRows.get(`${peerId}:${cmid}`);
    if (pending?.isConnected) return pending;

    const container = document.querySelector('.ConvoHistory__content, .ConvoStack__content, .im-chat-container');
    if (!container || cmid == null) return null;
    const target = String(cmid);

    const virtualItem = container.querySelector?.(`[data-itemkey="${CSS.escape(target)}"]`);
    if (virtualItem) {
      const article = virtualItem.querySelector?.('article.ConvoHistory__messageBlock');
      if (article) return article.querySelector?.('.ConvoHistory__messageWrapper') || article;
    }

    const attrCandidates = container.querySelectorAll('[data-cmid], [data-msg-id]');
    for (const el of attrCandidates) {
      const a = el.getAttribute?.('data-cmid');
      const b = el.getAttribute?.('data-msg-id');
      if (String(a ?? b ?? '') !== target) continue;
      return el.closest?.('.ConvoHistory__messageWrapper, .ConvoMessage, .ConvoMessageWithoutBubble, .im-mess') || el;
    }

    const candidates = container.querySelectorAll('.ConvoMessage, .ConvoMessageWithoutBubble, .im-mess');
    for (const el of candidates) {
      const info = FiberHelper.getMessageProps(el);
      if (info && String(info.cmid) === target && (peerId == null || String(info.peerId ?? getCurrentPeerId()) === String(peerId))) {
        return el.closest?.('.ConvoHistory__messageWrapper') || el;
      }
    }

    // Last fallback: VK's deleted-message row is still usually a message row
    // containing this exact text. Only use it when there is a single match in
    // the current viewport so unrelated system messages cannot be hijacked.
    const textRows = Array.from(container.querySelectorAll('.ConvoMessage, .ConvoMessageWithoutBubble, .im-mess')).filter(el => /сообщени[ея]\s+(исчезло|удалено)/i.test(el.textContent || ''));
    return textRows.length === 1 ? (textRows[0].closest?.('.ConvoHistory__messageWrapper') || textRows[0]) : null;
  }

  function renderCachedMessageIntoExistingRow(peerId, cmid, row, msg, isBomb = false) {
    if (!row || !msg || !row.isConnected) return false;

    const key = `${peerId}:${cmid}`;
    const messageEl = row.matches?.('.ConvoMessage, .ConvoMessageWithoutBubble, .im-mess')
      ? row
      : row.querySelector?.('.ConvoMessage, .ConvoMessageWithoutBubble, .im-mess');
    const target = messageEl || row;

    // Remove only leftovers from an older VKE renderer. The current renderer
    // never inserts a second message subtree.
    row.querySelectorAll?.('[data-vke-deleted-inline]').forEach(n => n.remove?.());
    row.querySelectorAll?.('[data-vke-hidden-deleted="1"]').forEach(n => {
      n.style.visibility = '';
      n.style.pointerEvents = '';
      n.removeAttribute('data-vke-hidden-deleted');
    });

    const textEl = target.querySelector?.('.MessageText, .ConvoMessage__text, .im-mess-stack--text');
    if (textEl && msg.text) {
      // The row itself stays owned by VK/React. We only change the existing
      // text node; no clone, no wrapper replacement, no append to the flow.
      textEl.textContent = msg.text;
    }

    const infoBlock = target.querySelector?.(
      '.ConvoMessageBottomInfo, .ConvoMessage__info, .ConvoMessageInfoWithoutBubbles'
    );
    if (infoBlock) renderDeletedStatus(infoBlock, msg, !!msg.isBomb);


    const wrapper = target.closest?.('.ConvoHistory__messageWrapper') || row;
    wrapper.style.opacity = '0.62';
    wrapper.style.filter = 'grayscale(0.2)';
    wrapper.dataset.vkeDeletedNative = key;

    const rec = persistentDeletedOverlays.get(key);
    if (rec) {
      rec.source = wrapper;
      rec.removed = false;
    }

    return true;
  }

  // ============ ВИЗУАЛЬНАЯ ЗАЩИТА БЕЗ ВМЕШАТЕЛЬСТВА В REACT ============
  // Не патчим removeChild/remove/replaceChild: это ломает reconciliation VK и
  // само по себе не удерживает сообщение. Удалённое сообщение показывается
  // отдельной копией вне React-дерева.
  function protectDeletedMessageNode(peerId, cmid) {
    if (!peerId || cmid == null) return false;
    const msg = state.messageCache[peerId]?.[cmid];
    if (!msg?.deleted) return false;
    if (msg.isBomb && msg.bombExpiresAt && Date.now() < msg.bombExpiresAt) return false;

    const key = `${peerId}:${cmid}`;
    const live = findLiveMessageElement(peerId, cmid);

    // Critical: do NOT hide/replace the live React node here. Take a snapshot
    // first, then let React finish its own state transition. If it later removes
    // the node, MutationObserver will place our static copy at the exact saved
    // parent/index. If React keeps a row, renderCachedMessageIntoExistingRow()
    // will use this snapshot instead of the already-deleted VK placeholder.
    if (live) {
      return decorateNativeDeletedRow(peerId, cmid, false);
    }

    return false;
  }


  function removeInlineHistoryButtons(root = document) {
    const rows = root.querySelectorAll?.('.ConvoMessage, .ConvoMessageWithoutBubble') || [];
    for (const row of rows) {
      const candidates = row.querySelectorAll?.('button, a, span, div') || [];
      for (const node of candidates) {
        if (node.closest?.('[role="menu"], [role="menuitem"], [data-radix-menu-content]')) continue;
        const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
        if (text !== 'История') continue;
        // Only remove compact inline action nodes. Context-menu items live
        // outside the message subtree and are deliberately left untouched.
        const rect = node.getBoundingClientRect?.();
        const clickable = node.matches?.('button, a') || node.getAttribute?.('role') === 'button';
        if (clickable || (rect && rect.width < 180 && rect.height < 40)) {
          node.remove?.();
        }
      }
    }
  }

  function fiberMessageInfoFromAncestors(el) {
    let node = el;
    for (let i = 0; node && i < 8; i++, node = node.parentElement) {
      try {
        const info = FiberHelper.getMessageProps(node);
        if (info?.cmid != null) return info;
      } catch (_) {}
    }
    return null;
  }

  function restoreExpiredBombPlaceholder(root = document) {
    if (!state.settings.bombs) return;
    const placeholders = root.querySelectorAll?.('article.ExpiredMessage, .ExpiredMessage') || [];
    for (const placeholder of placeholders) {
      const info = fiberMessageInfoFromAncestors(placeholder);
      const peerId = info?.peerId ?? getCurrentPeerId();
      const cmid = info?.cmid;
      if (!peerId || cmid == null) continue;
      const msg = state.messageCache[peerId]?.[cmid];
      if (!msg?.isBomb || !msg.text) continue;

      // ExpiredMessage is only VK's visual placeholder. Keep the native row and
      // replace the placeholder's text/icon in-place with our cached message.
      const textTarget = placeholder.querySelector('.ExpiredMessage__text');
      if (textTarget) {
        textTarget.textContent = msg.text;
      }
      const icon = placeholder.querySelector('.ExpiredMessage__icon');
      if (icon) icon.innerHTML = '<span aria-hidden="true" style="font-size:16px;line-height:1">💣</span>';

      const row = placeholder.closest('.ConvoHistory__messageWrapper, .ConvoHistory__messageBlock, .ConvoMessage, .ConvoMessageWithoutBubble') || placeholder;
      row.style.opacity = '0.62';
      row.style.filter = 'grayscale(0.2)';
      row.dataset.vkeBombRestored = `${peerId}:${cmid}`;
    }
  }

  // ============ РЕНДЕР УДАЛЁННЫХ СООБЩЕНИЙ (Fiber-based) ============
  function renderDeletedMessages() {
    removeInlineHistoryButtons(document);
    restoreExpiredBombPlaceholder(document);
    if (!state.settings.deletedMessages) return;

    const peerId = getCurrentPeerId();
    if (!peerId) return;

    if (!state.messageCache[peerId]) state.messageCache[peerId] = {};
    if (!state.hydratedPeers.has(String(peerId))) {
      hydrateCurrentPeer(peerId).then(() => renderDeletedMessages());
    }

    const chat = state.messageCache[peerId];
    const container = document.querySelector('.ConvoHistory__content, .ConvoStack__content');
    if (!container) return;

    const now = Date.now();
    const foundCmids = new Set();

    // First, detect VK's native bomb icon. This is more reliable than guessing
    // from text, timestamps or LongPoll flags.
    detectBombIcons();

    container.querySelectorAll('.ConvoMessage, .ConvoMessageWithoutBubble').forEach(el => {
      const info = FiberHelper.getMessageProps(el);
      if (!info) return;

      const cmid = info.cmid;
      const cached = chat[cmid];
      if (!cached) return;

      const bombExpired = !!(
        cached.isBomb &&
        cached.bombExpiresAt &&
        now >= cached.bombExpiresAt
      );

      if (bombExpired) {
        cached.deleted = true;
      }

      if (!cached.deleted && cached.isBomb) {
        scheduleBombExpiry(peerId, cmid, cached.bombExpiresAt);
        const existing = persistentDeletedOverlays.get(`${peerId}:${cmid}`);
        if (!el.isConnected && detachedMessages.has(`${peerId}:${cmid}`)) {
          restoreDetachedMessage(peerId, cmid);
        } else if (!existing && el.isConnected) {
          // Active bomb: keep the real VK row when present.
        }
        return;
      }

      if (!cached.deleted) return;

      foundCmids.add(String(cmid));
      const pending = pendingDeletedRows.get(`${peerId}:${cmid}`);
      const row = (pending?.isConnected ? pending : null) || findRenderedMessageRow(peerId, cmid);
      if (row) {
        renderCachedMessageIntoExistingRow(peerId, cmid, row, cached, !!cached.isBomb);
        if (pending?.isConnected) pendingDeletedRows.delete(`${peerId}:${cmid}`);
      } else {
        // Do NOT recreate a deleted message as a detached clone. With VK's
        // virtualized messenger that creates a second layout tree and is exactly
        // what caused rows to jump right/down or overlap. We wait until VK mounts
        // the real row again; the network guard is responsible for keeping the
        // delete transition out of React.
      }

      if (state.settings.editHistory && !cached.deleted) {
        arrangeEditedOnlyMeta(el, peerId, cmid);
      }
    });

    // IMPORTANT: do not recreate deleted messages as detached clones. If VK has
    // already virtualized the row away, wait until VK mounts it again. Creating a
    // second DOM subtree here is what caused messages to jump to the right/bottom
    // and could also create a render/MutationObserver loop.
    for (const [key, row] of pendingDeletedRows) {
      if (!key.startsWith(`${peerId}:`)) continue;
      if (!row?.isConnected) pendingDeletedRows.delete(key);
    }
  }

  function rememberRemovedMessageNode(node, parent, nextSibling) {
    if (!node || node.nodeType !== 1) return;

    const candidates = [];
    try {
      if (node.matches?.('.ConvoMessage, .ConvoMessageWithoutBubble')) {
        candidates.push(node);
      } else {
        node.querySelectorAll?.('.ConvoMessage, .ConvoMessageWithoutBubble').forEach(el => candidates.push(el));
      }
    } catch (e) {}

    for (const el of candidates) {
      const info = FiberHelper.getMessageProps(el);
      if (!info?.cmid) continue;
      const peerId = info.peerId ?? getCurrentPeerId();
      if (!peerId) continue;

      const key = `${peerId}:${info.cmid}`;
      const cached = state.messageCache[peerId]?.[info.cmid];
      const persistent = persistentDeletedOverlays.get(key);
      let clone;
      try { clone = el.cloneNode(true); } catch (e) { continue; }

      const old = detachedMessages.get(key);
      const scrollHost = old?.scrollHost || getScrollHost(el);
      const isWindowScroll = scrollHost === document.scrollingElement || scrollHost === document.documentElement;
      let initialRect = old?.initialRect;
      const currentRect = el.getBoundingClientRect();
      if (!initialRect) {
        if (currentRect.width && currentRect.height) {
          initialRect = {
            top: currentRect.top,
            left: currentRect.left,
            width: currentRect.width,
            height: currentRect.height
          };
        }
      }
      const initialScrollTop = old?.initialScrollTop ?? (isWindowScroll ? (window.scrollY || document.documentElement.scrollTop || 0) : (scrollHost?.scrollTop || 0));
      const initialScrollLeft = old?.initialScrollLeft ?? (isWindowScroll ? (window.scrollX || document.documentElement.scrollLeft || 0) : (scrollHost?.scrollLeft || 0));

      if (persistent) {
        persistent.removed = true;
        if (persistent.holder) {
          persistent.holder.style.height = `${Math.max(persistent.height || 1, Math.round(currentRect.height || 0))}px`;
          persistent.holder.style.minHeight = persistent.holder.style.height;
        }
        if (persistent.source === el) {
          persistent.source = null;
        }
      }

      const root = getMessageVisualRoot(el) || el;
      const rootParent = root.parentNode || el.parentNode || parent;
      const rootIndex = rootParent
        ? Array.prototype.indexOf.call(rootParent.children || [], root)
        : -1;

      detachedMessages.set(key, {
        peerId, cmid: info.cmid, template: root.cloneNode(true),
        parent: rootParent,
        nextSibling: root.nextSibling || nextSibling || null,
        previousSibling: root.previousSibling || null,
        childIndex: rootIndex,
        removedAt: Date.now(),
        isBomb: !!cached?.isBomb || !!root.querySelector?.('.ConvoMessageInfoWithoutBubbles__bombIcon, svg.vkuiIcon--bomb_12, svg[class*="bomb_12"]'),
        rootWasMessage: true,
        scrollHost,
        initialRect,
        initialScrollTop,
        initialScrollLeft
      });

      savePersistedSnapshot(
        peerId,
        info.cmid,
        root,
        initialRect?.height || currentRect.height || 48
      );
    }
  }

  // Capture the geometry BEFORE React removes/replaces a message. We do not
  // cancel the DOM operation; this hook only takes a snapshot for the overlay.
  function captureMessageBeforeRemoval(node) {
    if (!node || node.nodeType !== 1) return;
    let candidates = [];
    try {
      if (node.matches?.('.ConvoMessage, .ConvoMessageWithoutBubble')) candidates = [node];
      else candidates = Array.from(node.querySelectorAll?.('.ConvoMessage, .ConvoMessageWithoutBubble') || []);
    } catch (e) { return; }

    for (const el of candidates) {
      const info = FiberHelper.getMessageProps(el);
      if (!info?.cmid) continue;
      const peerId = info.peerId ?? getCurrentPeerId();
      if (!peerId) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const scrollHost = getScrollHost(el);
      const isWindowScroll = scrollHost === document.scrollingElement || scrollHost === document.documentElement;
      const key = `${peerId}:${info.cmid}`;
      let clone;
      try { clone = el.cloneNode(true); } catch (e) { continue; }
      const cached = state.messageCache[peerId]?.[info.cmid];
      const root = getMessageVisualRoot(el) || el;
      const rootParent = root.parentNode || el.parentNode;
      const rootIndex = rootParent
        ? Array.prototype.indexOf.call(rootParent.children || [], root)
        : -1;

      detachedMessages.set(key, {
        ...(detachedMessages.get(key) || {}),
        peerId, cmid: info.cmid, template: root.cloneNode(true),
        parent: rootParent,
        nextSibling: root.nextSibling,
        previousSibling: root.previousSibling,
        childIndex: rootIndex,
        removedAt: Date.now(),
        isBomb: !!cached?.isBomb || !!root.querySelector?.('.ConvoMessageInfoWithoutBubbles__bombIcon, svg.vkuiIcon--bomb_12, svg[class*="bomb_12"]'),
        rootWasMessage: true,
        scrollHost,
        initialRect: { top: r.top, left: r.left, width: r.width, height: r.height },
        initialScrollTop: isWindowScroll ? (window.scrollY || document.documentElement.scrollTop || 0) : (scrollHost?.scrollTop || 0),
        initialScrollLeft: isWindowScroll ? (window.scrollX || document.documentElement.scrollLeft || 0) : (scrollHost?.scrollLeft || 0)
      });

      savePersistedSnapshot(
        peerId,
        info.cmid,
        root,
        r.height || 48
      );
    }
  }

  function findLogicalInsertPoint(cmid, preferredParent = null) {
    const container = document.querySelector('.ConvoHistory__content, .ConvoStack__content, .im-chat-container');
    if (!container || cmid == null) return null;

    const target = Number(cmid);
    if (!Number.isFinite(target)) return null;

    let bestNext = null;
    let bestNextValue = Infinity;
    let bestPrev = null;
    let bestPrevValue = -Infinity;
    const seen = new Set();

    const candidates = container.querySelectorAll(
      '[data-cmid], [data-msg-id], .ConvoMessage, .ConvoMessageWithoutBubble, .im-mess'
    );

    for (const el of candidates) {
      if (!el || el.nodeType !== 1 || el.hasAttribute?.('data-vke-deleted-holder')) continue;

      let value = null;
      const attrCmid = el.getAttribute?.('data-cmid');
      const attrMsgId = el.getAttribute?.('data-msg-id');
      if (attrCmid != null && /^-?\d+$/.test(String(attrCmid))) value = Number(attrCmid);
      else if (attrMsgId != null && /^-?\d+$/.test(String(attrMsgId))) value = Number(attrMsgId);

      if (!Number.isFinite(value)) {
        const info = FiberHelper.getMessageProps(el);
        if (info?.cmid != null) value = Number(info.cmid);
      }

      if (!Number.isFinite(value) || value === target) continue;

      const root = el.closest?.('.ConvoHistory__messageWrapper') ||
        (el.matches?.('.ConvoMessage, .ConvoMessageWithoutBubble, .im-mess') ? el : null);
      if (!root || !root.parentNode || seen.has(root)) continue;
      seen.add(root);

      if (value > target && value < bestNextValue) {
        bestNextValue = value;
        bestNext = root;
      } else if (value < target && value > bestPrevValue) {
        bestPrevValue = value;
        bestPrev = root;
      }
    }

    const nextSame = bestNext && bestNext.parentNode === preferredParent ? bestNext : null;
    const prevSame = bestPrev && bestPrev.parentNode === preferredParent ? bestPrev : null;

    if (nextSame) return { parent: preferredParent, before: nextSame, after: null };
    if (prevSame) return { parent: preferredParent, before: null, after: prevSame };
    if (bestNext) return { parent: bestNext.parentNode, before: bestNext, after: null };
    if (bestPrev) return { parent: bestPrev.parentNode, before: null, after: bestPrev };
    return null;
  }

  function findInsertAnchor(container, cmid) {
    return findLogicalInsertPoint(cmid, container)?.before || null;
  }

  // Only restore persisted snapshots that belong to the currently mounted
  // virtual-scroll range. This prevents old cached deletions from appearing
  // underneath unrelated dates/messages after reload.
  function isCmidNearCurrentRange(container, cmid) {
    if (!container || cmid == null) return false;
    const target = Number(cmid);
    if (!Number.isFinite(target)) return false;

    let min = Infinity;
    let max = -Infinity;
    const seen = new Set();

    container.querySelectorAll('.ConvoMessage, .ConvoMessageWithoutBubble, [data-cmid], [data-msg-id]').forEach(el => {
      if (!el || el.hasAttribute?.('data-vke-deleted-holder')) return;

      const root = el.closest?.('.ConvoHistory__messageWrapper') ||
        (el.matches?.('.ConvoMessage, .ConvoMessageWithoutBubble') ? el : null);
      if (!root || seen.has(root)) return;
      seen.add(root);

      let value = null;
      const a = root.getAttribute?.('data-cmid') ?? el.getAttribute?.('data-cmid');
      const b = root.getAttribute?.('data-msg-id') ?? el.getAttribute?.('data-msg-id');
      if (a != null && /^\d+$/.test(String(a))) value = Number(a);
      else if (b != null && /^\d+$/.test(String(b))) value = Number(b);

      if (!Number.isFinite(value)) {
        const info = FiberHelper.getMessageProps(el);
        if (info?.cmid != null) value = Number(info.cmid);
      }

      if (!Number.isFinite(value)) return;
      min = Math.min(min, value);
      max = Math.max(max, value);
    });

    if (min === Infinity || max === -Infinity) return false;

    // Deleted messages are normally adjacent to their live neighbours. A small
    // numeric margin also covers the first/last deleted row of the viewport.
    return target >= min - 20 && target <= max + 20;
  }

  function restoreDetachedMessage(peerId, cmid) {
    const key = `${peerId}:${cmid}`;
    const msg = state.messageCache[peerId]?.[cmid];
    if (!msg) return false;

    const existing = persistentDeletedOverlays.get(key);
    if (existing?.holder?.isConnected) return true;

    let record = detachedMessages.get(key);

    // After a full reload detachedMessages is empty. Rehydrate the original
    // visual template from localStorage and place it using live cmid neighbours.
    if (!record) {
      const persisted = loadPersistedSnapshot(peerId, cmid);
      if (!persisted) return false;

      record = {
        peerId: String(peerId),
        cmid: String(cmid),
        template: persisted.template,
        parent: null,
        nextSibling: null,
        previousSibling: null,
        childIndex: -1,
        removedAt: persisted.savedAt || Date.now(),
        isBomb: !!msg.isBomb,
        rootWasMessage: true,
        scrollHost: null,
        initialRect: { height: persisted.height },
        initialScrollTop: 0,
        initialScrollLeft: 0
      };
      detachedMessages.set(key, record);
    }

    const container = document.querySelector('.ConvoHistory__content, .ConvoStack__content, .im-chat-container');
    if (!record.parent?.isConnected && !isCmidNearCurrentRange(container, cmid)) return false;
    return createPersistentOverlayFromSnapshot(peerId, cmid, record, msg, !!msg.isBomb);
  }


  function getDeletedIndicatorMarkup(isBomb = false) {
    if (isBomb) return '<span aria-hidden="true">💣</span>';
    const mode = state.settings.deletedIndicator || 'trash';
    if (mode === 'cross') return '<span aria-hidden="true">✕</span>';
    if (mode === 'text') return '<span>Удалено</span>';
    return '<span aria-hidden="true">🗑️</span>';
  }

  function normalizeNativeEditedDate(infoBlock, forceEdited = false) {
    if (!infoBlock) return null;
    const date = infoBlock.querySelector('.ConvoMessageInfoWithoutBubbles__date, [class*="ConvoMessageInfoWithoutBubbles__date"], [class*="__date"]');
    if (!date) return null;

    const editedNodes = Array.from(infoBlock.querySelectorAll('.ConvoMessageWithoutBubble__editedLabel, [class*="ConvoMessageWithoutBubble__editedLabel"]'));
    const hasEdited = forceEdited || editedNodes.length > 0 || /(^|\s)ред\.(?:\s|$)/i.test((date.textContent || '').replace(/\s+/g, ' ').trim());

    if (!hasEdited) return date;

    const timeNode = date.querySelector('[aria-hidden="true"]');
    const hiddenNode = date.querySelector('.vkuiVisuallyHidden__host, .vkuiRootComponent__host');
    if (timeNode) {
      // Keep the real VK time/accessible relative-time nodes, rebuild only the
      // visual prefix exactly like native VK: "ред. · 16:59".
      const timeClone = timeNode.cloneNode(true);
      const hiddenClone = hiddenNode ? hiddenNode.cloneNode(true) : null;
      date.replaceChildren();

      const edited = document.createElement('span');
      edited.className = 'ConvoMessageWithoutBubble__editedLabel';
      edited.textContent = 'ред.';
      edited.setAttribute('title', 'Изменено');
      date.appendChild(edited);
      date.appendChild(document.createTextNode(' · '));
      date.appendChild(timeClone);
      if (hiddenClone) date.appendChild(hiddenClone);

      editedNodes.forEach(n => n.remove());
    } else if (editedNodes[0]) {
      editedNodes[0].textContent = 'ред.';
      editedNodes[0].setAttribute('title', 'Изменено');
      editedNodes.slice(1).forEach(n => n.remove());
    }
    return date;
  }

  function arrangeDeletedEditedMeta(infoBlock) {
    if (!infoBlock) return;
    const edited = infoBlock.querySelector('.ConvoMessageWithoutBubble__editedLabel, [class*="ConvoMessageWithoutBubble__editedLabel"]');
    renderDeletedStatus(infoBlock, null, false);
    if (edited) normalizeNativeEditedDate(infoBlock, true);
  }


  function renderDeletedStatus(infoBlock, msg, isBomb = false) {
    if (!infoBlock) return;
    infoBlock.classList.add('vke-message-status-line');

    // Remove only VKE-owned status nodes. Never touch VK's native date node.
    infoBlock.querySelectorAll(
      '.vke-native-deleted-marker, .vke-deleted-marker, .vke-bomb-marker, ' +
      '.vke-deleted-meta, .vke-deleted-status-left, .vke-deleted-status-right, ' +
      '.vke-native-deleted-badge, .vke-deleted-badge, .vke-bomb-badge'
    ).forEach(n => n.remove());

    // Remove any stale textual VK/VKE "deleted" label that was left beside the
    // timestamp by an older renderer. The deleted state itself is represented
    // only by the selected icon/text marker below.
    Array.from(infoBlock.children || []).filter(node => {
      const t = (node.textContent || '').replace(/\s+/g, ' ').trim();
      return /^(?:Удал[её]нное сообщение|Сообщение удалено|Сообщение исчезло)$/i.test(t);
    }).forEach(n => n.remove());

    const edited = !isBomb && !!msg?.edits?.length;
    const date = normalizeNativeEditedDate(infoBlock, edited);
    if (!date) return;

    const indicator = document.createElement('span');
    indicator.className = isBomb ? 'vke-bomb-badge' : 'vke-deleted-badge';
    indicator.setAttribute('aria-label', isBomb ? 'Сгоревшее сообщение' : 'Удалённое сообщение');
    indicator.title = isBomb ? 'Сгоревшее сообщение' : 'Удалённое сообщение';
    indicator.innerHTML = isBomb
      ? '<span aria-hidden="true">💣</span>'
      : getDeletedIndicatorMarkup(false);

    // Keep VK's native date layout. Put the marker immediately after the date
    // instead of creating a second column/label which could shift the time.
    date.style.display = 'inline-flex';
    date.style.alignItems = 'center';
    date.style.whiteSpace = 'nowrap';
    date.appendChild(document.createTextNode(' '));
    date.appendChild(indicator);

    [date, indicator].forEach(node => {
      node.style.setProperty('pointer-events', 'none', 'important');
      node.style.setProperty('position', 'relative', 'important');
      node.style.setProperty('z-index', '20', 'important');
    });
  }


  function applyDeletedVisualState(el, isBomb, peerId = getCurrentPeerId(), cmid = null) {
    const msg = peerId ? state.messageCache[peerId]?.[cmid ?? FiberHelper.getMessageProps(el)?.cmid] : null;
    const text = msg?.text;
    const textEl = el.querySelector('.MessageText, .ConvoMessage__text, .im-mess-stack--text');
    if (textEl && text && (!textEl.textContent.trim() || /удалено|сообщение исчез/i.test(textEl.textContent))) {
      textEl.textContent = text;
    }
    const wrapper = el.closest('.ConvoHistory__messageWrapper') || el;
    wrapper.style.opacity = '0.62';
    wrapper.style.filter = 'grayscale(0.25)';
    const infoBlock = el.querySelector('.ConvoMessageBottomInfo, .ConvoMessage__info, .ConvoMessageInfoWithoutBubbles');
    if (infoBlock) renderDeletedStatus(infoBlock, msg, isBomb);
  }


  function arrangeEditedOnlyMeta(el, peerId, cmid) {
    const infoBlock = el.querySelector('.ConvoMessageBottomInfo, .ConvoMessage__info, .ConvoMessageInfoWithoutBubbles');
    if (!infoBlock) return;
    normalizeNativeEditedDate(infoBlock, false);
    infoBlock.querySelectorAll('.vke-deleted-status-right, .vke-deleted-status-left').forEach(n => n.remove());
  }


  // ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ============
  function parseRequestBody(body) {
    if (body == null) return {};
    try {
      if (typeof body === 'string') {
        const trimmed = body.trim();
        if (trimmed.startsWith('{')) return JSON.parse(trimmed);
        const params = new URLSearchParams(body);
        const result = {};
        for (const [key, value] of params) result[key] = value;
        return result;
      }
      if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
        const result = {};
        for (const [key, value] of body) result[key] = value;
        return result;
      }
      if (typeof FormData !== 'undefined' && body instanceof FormData) {
        const result = {};
        for (const [key, value] of body.entries()) {
          result[key] = typeof value === 'string' ? value : (value?.name || '');
        }
        return result;
      }
      if (typeof body === 'object') {
        return body;
      }
    } catch (_) {}
    return {};
  }

  function createFakeResponse(data) {
    return new Response(JSON.stringify({ response: data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  function mockXHRResponse(xhr, data) {
    setTimeout(() => {
      Object.defineProperty(xhr, 'readyState', { value: 4, writable: false });
      Object.defineProperty(xhr, 'status', { value: 200, writable: false });
      Object.defineProperty(xhr, 'statusText', { value: 'OK', writable: false });
      Object.defineProperty(xhr, 'responseText', { value: JSON.stringify({ response: data }), writable: false });
      Object.defineProperty(xhr, 'response', { value: JSON.stringify({ response: data }), writable: false });
      xhr.dispatchEvent(new Event('readystatechange'));
      xhr.dispatchEvent(new Event('load'));
      xhr.dispatchEvent(new Event('loadend'));
      if (xhr.onload) xhr.onload();
    }, 0);
  }

  function getCurrentPeerId() {
    const match = location.pathname.match(/\/(?:im\/convo|convo)\/(-?\d+)/) || location.search.match(/sel=(-?\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  // Return the actual scrolling element used by VK's conversation view.
  // The previous build called getScrollHost() without defining it; that exception
  // aborted MutationObserver processing exactly when React removed a message.
  function getScrollHost(el) {
    let node = el?.parentElement || null;
    while (node && node !== document.body && node !== document.documentElement) {
      try {
        const cs = getComputedStyle(node);
        const canScrollY = /(auto|scroll|overlay)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight;
        const canScrollX = /(auto|scroll|overlay)/.test(cs.overflowX) && node.scrollWidth > node.clientWidth;
        if (canScrollY || canScrollX) return node;
      } catch (_) {}
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement || document.body;
  }

  // IMPORTANT: never monkey-patch Node.removeChild/replaceChild/Element.remove.
  // Doing so causes React reconciliation/virtualization loops and page freezes.
  // Deletion preservation is a network-layer problem; DOM removal hooks stay untouched.
  window.__vkeRemovalSnapshotHooks = false;


  // ============ НАБЛЮДАТЕЛЬ ЗА DOM ============
  // ВАЖНО: скрипт грузится с run_at: document_start, когда document.body
  // ещё может быть null. observer.observe(null, ...) кидал TypeError и
  // ОБРЫВАЛ весь остальной код инициализации — из-за этого re-render после
  // реального удаления сообщения никогда не срабатывал, и пометка "мусорки"
  // не успевала подставиться до того, как VK убирал DOM-узел сообщения.
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (!mutation.removedNodes?.length) continue;

      for (const node of mutation.removedNodes) {
        if (node?.nodeType !== 1) continue;

        const removedHolderKey = node.getAttribute?.('data-vke-deleted-holder');
        if (removedHolderKey) {
          const rec = persistentDeletedOverlays.get(removedHolderKey);
          if (rec && !rec.source?.isConnected) {
            const cached = state.messageCache[rec.peerId]?.[rec.cmid];
            if (cached?.deleted || cached?.isBomb) {
              // React removed our static holder. Put it back into the SAME
              // parent at the SAME logical child position, not at the chat root.
              const parent = rec.parent?.isConnected
                ? rec.parent
                : mutation.target?.nodeType === 1
                  ? mutation.target
                  : null;

              if (parent && rec.holder) {
                try {
                  // Recalculate the insertion point on every React reconciliation.
                  // Never use a stale child index as the primary anchor.
                  const logical = findLogicalInsertPoint(rec.cmid, parent);
                  if (logical?.parent?.isConnected) {
                    rec.parent = logical.parent;
                    if (logical.before?.parentNode === rec.parent) {
                      rec.parent.insertBefore(rec.holder, logical.before);
                    } else if (logical.after?.parentNode === rec.parent) {
                      rec.parent.insertBefore(rec.holder, logical.after.nextSibling);
                    } else {
                      throw new Error('No live logical neighbour');
                    }
                  } else if (rec.nextSibling && rec.nextSibling.parentNode === parent) {
                    parent.insertBefore(rec.holder, rec.nextSibling);
                  } else if (rec.previousSibling && rec.previousSibling.parentNode === parent) {
                    parent.insertBefore(rec.holder, rec.previousSibling.nextSibling);
                  } else {
                    throw new Error('No live restore anchor');
                  }

                  rec.holder.style.height = `${Math.max(1, rec.height)}px`;
                  rec.holder.style.minHeight = rec.holder.style.height;
                  rec.removed = true;
                } catch (_) {
                  // Do not append to the end: the next mutation/render will retry.
                }
              }
            }
          }
          continue;
        }

        // A real deleted row leaving the DOM means another VK path performed
        // the transition outside the guarded update stream. Do not reinsert a
        // clone here. Recreating the node is what previously produced overlap,
        // bottom-of-list drift and virtual-scroll corruption. The next mounted
        // native row will be decorated by renderDeletedMessages().
      }
    }

    if (window.vkeRenderTimeout) clearTimeout(window.vkeRenderTimeout);
    window.vkeRenderTimeout = setTimeout(() => {
      const peerId = getCurrentPeerId();
      if (peerId) {
        for (const [key, record] of detachedMessages) {
          if (Date.now() - record.removedAt > 600000) {
            detachedMessages.delete(key);
            continue;
          }

          const [p, cmid] = key.split(':');
          const cached = state.messageCache[p]?.[cmid];
          if (!cached) continue;

          // Do not restore deleted messages as detached DOM clones. VK's
          // virtualized React list must remain the sole owner of message rows.
          // Detached records are kept only as non-visual history/snapshots.
          if (cached.isBomb && cached.bombExpiresAt && Date.now() >= cached.bombExpiresAt) {
            cached.deleted = true;
          }
        }
      }

      refreshPersistentDeletedOverlays();
      renderDeletedMessages();
    }, 16);
  });

  function startObserving() {
    if (!document.body) {
      requestAnimationFrame(startObserving);
      return;
    }
    observer.observe(document.body, { childList: true, subtree: true });
    renderDeletedMessages();
    window.addEventListener('resize', refreshPersistentDeletedOverlays, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserving);
  } else {
    startObserving();
  }

  // Minimal local styles for the static deleted-message copy. This intentionally
  // stays inside content.js so styles.css and unrelated features remain untouched.
  if (!document.getElementById('vke-deleted-message-runtime-style')) {
    const style = document.createElement('style');
    style.id = 'vke-deleted-message-runtime-style';
    style.textContent = `
      .vke-message-status-line {
        display:inline-flex !important;
        align-items:center !important;
        width:auto !important;
        min-width:0 !important;
        box-sizing:border-box !important;
      }
      .vke-deleted-status-left,
      .vke-deleted-status-right {
        display:flex !important;
        flex-direction:column !important;
        min-width:0 !important;
        box-sizing:border-box !important;
      }
      .vke-deleted-status-left {
        align-items:flex-start !important;
        justify-content:flex-start !important;
        min-width:0 !important;
      }
      .vke-deleted-status-right {
        align-items:center !important;
        justify-content:flex-start !important;
        text-align:right !important;
        white-space:nowrap !important;
      }
      .vke-message-status-line > .vke-deleted-status-left,
      .vke-message-status-line > .vke-deleted-status-right {
        margin:0 !important;
      }
      .vke-deleted-status-label,
      .vke-native-deleted-badge,
      .vke-deleted-badge,
      .vke-bomb-badge {
        display:inline-flex !important;
        align-items:center !important;
        gap:3px !important;
        margin:0 !important;
        padding:0 !important;
        min-width:0 !important;
        white-space:nowrap !important;
        line-height:14px !important;
        font:inherit !important;
      }
      .vke-deleted-indicator {
        display:inline-flex !important;
        margin-left:3px !important;
        vertical-align:middle !important;
        line-height:14px !important;
      }

      [data-vke-deleted-holder] {
        display: block !important;
        width: 100% !important;
        box-sizing: border-box !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      [data-vke-deleted-inline] {
        font-style: normal !important;
        opacity: 0.62 !important;
        filter: grayscale(0.2) !important;
      }
      .vke-persistent-deleted-badge,
      .vke-persistent-bomb-badge {
        color: #fff !important;
        font-style: normal !important;
        font-weight: 400 !important;
        text-align: right !important;
      }
      [data-vke-deleted-holder] audio,
      [data-vke-deleted-holder] video {
        pointer-events: auto !important;
      }
    `;
    (document.head || document.documentElement)?.appendChild(style);
  }

  console.log('[VKE] Initialized successfully (Fiber-based lookup)');
})();

// VKE promo game blocker
(() => {
  if (window.__vkePromoBlocker) return;
  window.__vkePromoBlocker = true;
  const hide = () => {
    document.querySelectorAll('.apps_feedRightAppsBlock__single_app--promo, .apps_feedRightAppsBlock.apps_feedRightAppsBlock_single_app--promo, [data-testid="feed_apps_right_block"]').forEach(el => {
      if (el.querySelector('[data-app_id="54661725"]') || /Надувайте словесные пузыри/.test(el.textContent || '')) el.remove();
    });
  };
  hide();
  new MutationObserver(hide).observe(document.documentElement,{childList:true,subtree:true});
})();
