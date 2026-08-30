// message_state_guard.js — VKE v12
// MAIN world / document_start
//
// Goal: prevent ONLY real message-deletion events from reaching VK React.
// Event 10002 is a generic "set message flags" event; it must NOT be blocked
// unless flags contain 128 (deleted) or 131072 (deleted for everyone).
(() => {
  'use strict';

  if (window.__VKE_MESSAGE_STATE_GUARD_V12__) return;
  window.__VKE_MESSAGE_STATE_GUARD_V12__ = true;

  const TAG = '[VKE Guard]';
  const DELETE_TYPE = 10002;
  const LEGACY_FLAG_TYPE = 2;
  const DELETE_FLAGS = 128 | 131072;
  const vkHostRe = /(^|\.)vk\.(?:com|ru)$/i;

  function postDelete(type, payload) {
    try {
      window.postMessage({ source: 'vke-delete-guard', type, payload }, '*');
    } catch (_) {}
  }

  function isDelete10002(update) {
    return Array.isArray(update) && Number(update[0]) === DELETE_TYPE &&
      (Number(update[2]) & DELETE_FLAGS) !== 0;
  }

  function isLegacyDelete(update) {
    return Array.isArray(update) && Number(update[0]) === LEGACY_FLAG_TYPE &&
      (Number(update[2]) & DELETE_FLAGS) !== 0;
  }

  function emitDeleteUpdate(update, transport) {
    const type = Number(update[0]);
    if (type === DELETE_TYPE) {
      const cmid = update[1];
      const flags = Number(update[2]) || 0;
      const peerId = update[3] ?? update[4] ?? null;
      if (cmid == null || peerId == null) return;
      console.log(TAG, 'INTERCEPTED DELETE BEFORE REACT', { type, peerId, cmid, flags, transport });
      postDelete('DELETE_UPDATE', { peer_id: peerId, cmid: String(cmid), flags, transport });
      return;
    }

    const messageId = update[1];
    const flags = Number(update[2]) || 0;
    const peerId = update[3] ?? update[4] ?? null;
    if (messageId == null || peerId == null) return;
    console.log(TAG, 'INTERCEPTED LEGACY DELETE BEFORE REACT', { peerId, messageId, flags, transport });
    postDelete('LEGACY_DELETE_UPDATE', { peer_id: peerId, message_id: String(messageId), flags, transport });
  }

  // VK web responses are not always {updates:[...]}. Depending on the current
  // messenger bundle they may be nested under response/data/payload or passed
  // as arrays inside another object. Walk the JSON tree and remove ONLY actual
  // deletion events. This is intentionally limited by depth to avoid touching
  // arbitrary application data.
  function filterDeep(value, transport, depth = 0) {
    if (depth > 10 || value == null || typeof value !== 'object') {
      return { value, changed: false };
    }

    if (Array.isArray(value)) {
      let changed = false;
      const out = [];
      for (const item of value) {
        if (isDelete10002(item) || isLegacyDelete(item)) {
          changed = true;
          emitDeleteUpdate(item, transport);
          continue;
        }
        const r = filterDeep(item, transport, depth + 1);
        if (r.changed) changed = true;
        out.push(r.value);
      }
      return { value: changed ? out : value, changed };
    }

    let changed = false;
    const out = { ...value };
    for (const [key, item] of Object.entries(value)) {
      if (!item || typeof item !== 'object') continue;
      const r = filterDeep(item, transport, depth + 1);
      if (r.changed) {
        changed = true;
        out[key] = r.value;
      }
    }
    return { value: changed ? out : value, changed };
  }

  function filterTopLevelPayload(data, transport) {
    return filterDeep(data, transport, 0);
  }

  function safeJsonParse(text) {
    if (typeof text !== 'string') return null;
    let s = text.replace(/^\uFEFF/, '').trim();
    // A few VK endpoints wrap JSON in a harmless anti-JSON-hijacking prefix.
    s = s.replace(/^(?:while\s*\(1\)\s*;|\)\]\}',?\s*|for\s*\(;;\);)+/i, '').trim();
    if (!s || (s[0] !== '{' && s[0] !== '[')) return null;
    try { return JSON.parse(s); } catch (_) { return null; }
  }

  function isCandidateUrl(url) {
    try {
      const u = new URL(String(url), location.href);
      const host = u.hostname;
      const sameVk = host === location.hostname || vkHostRe.test(host);
      if (!sameVk) return false;
      const s = `${u.pathname}${u.search}`.toLowerCase();
      return /(?:act=a_check|longpoll|lp\.|\/im(?:\/|_|\?|$)|imps|im\.wss|eh\.vk|lpserver|messages\.getlongpollserver)/i.test(s);
    } catch (_) {
      const s = String(url || '');
      return /(?:act=a_check|longpoll|lp\.|\/im(?:\/|_|\?|$)|imps|im\.wss|eh\.vk|lpserver|messages\.getlongpollserver)/i.test(s);
    }
  }

  function isDeleteRequestUrl(url) {
    return /(?:^|[/?&])messages\.delete(?:[/?&]|$)/i.test(String(url || ''));
  }

  // ---------------- fetch ----------------
  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = async function vkeGuardFetch(input, init) {
      const url = typeof input === 'string' ? input : input?.url || '';
      const response = await nativeFetch.apply(this, arguments);

      // The web messenger has moved its long-polling between several hosts and
      // endpoints. Do not rely on one URL shape. We inspect only same-origin /
      // VK responses and only parse text that is actually JSON-like.
      try {
        const u = new URL(String(url), location.href);
        const sameVk = u.origin === location.origin || /(^|\.)vk\.(?:com|ru)$/i.test(u.hostname);
        if (!sameVk) return response;

        const clone = response.clone();
        const text = await clone.text();
        const data = safeJsonParse(text);
        if (data == null) return response;

        const r = filterTopLevelPayload(data, 'fetch');
        if (!r.changed) return response;

        console.warn(TAG, 'filtered delete update from fetch response:', String(url));
        const body = JSON.stringify(r.value);
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      } catch (_) {
        return response;
      }
    };
  }

  // ---------------- XHR ----------------
  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  const xhrAdd = XMLHttpRequest.prototype.addEventListener;
  const xhrRemove = XMLHttpRequest.prototype.removeEventListener;

  XMLHttpRequest.prototype.open = function vkeGuardOpen(method, url, ...rest) {
    this.__vkeGuardUrl = String(url || '');
    return xhrOpen.call(this, method, url, ...rest);
  };

  // We cannot safely rewrite native responseText. We therefore use XHR only as
  // a transport observer for debugging/legacy paths; fetch/WS do the actual
  // response filtering. This avoids the page-freeze behaviour caused by trying
  // to redefine responseText/response on a native XHR object.
  XMLHttpRequest.prototype.send = function vkeGuardSend(body) {
    if (isDeleteRequestUrl(this.__vkeGuardUrl)) {
      try {
        console.log(TAG, 'delete request observed:', this.__vkeGuardUrl);
        postDelete('DELETE_REQUEST_OBSERVED', { url: this.__vkeGuardUrl });
      } catch (_) {}
    }
    return xhrSend.call(this, body);
  };

  // ---------------- WebSocket ----------------
  const NativeWebSocket = window.WebSocket;

  function filterWsDataSync(data) {
    if (typeof data !== 'string') return null;
    const parsed = safeJsonParse(data);
    if (parsed == null) return null;
    const r = filterTopLevelPayload(parsed, 'ws');
    return r.changed ? JSON.stringify(r.value) : null;
  }

  async function filterWsData(data) {
    if (typeof data === 'string') return filterWsDataSync(data);
    if (data instanceof Blob) {
      try {
        const text = await data.text();
        const filtered = filterWsDataSync(text);
        return filtered == null ? null : filtered;
      } catch (_) { return null; }
    }
    if (data instanceof ArrayBuffer) {
      try {
        const text = new TextDecoder().decode(new Uint8Array(data));
        const filtered = filterWsDataSync(text);
        return filtered == null ? null : filtered;
      } catch (_) { return null; }
    }
    return null;
  }

  function wrappedMessageEvent(event, data) {
    return new MessageEvent('message', {
      data,
      origin: event.origin,
      lastEventId: event.lastEventId,
      source: event.source,
      ports: event.ports
    });
  }

  if (typeof NativeWebSocket === 'function') {
    const PatchedWebSocket = function VkeWebSocket(url, protocols) {
      const ws = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
      const nativeAdd = ws.addEventListener.bind(ws);
      const nativeRemove = ws.removeEventListener.bind(ws);
      const wrappers = new Map();

      ws.addEventListener = function(type, listener, options) {
        if (type !== 'message' || typeof listener !== 'function') {
          return nativeAdd(type, listener, options);
        }
        const wrapped = async function(event) {
          const filtered = await filterWsData(event.data);
          if (filtered == null) return listener.call(ws, event);
          return listener.call(ws, wrappedMessageEvent(event, filtered));
        };
        wrappers.set(listener, wrapped);
        return nativeAdd(type, wrapped, options);
      };

      ws.removeEventListener = function(type, listener, options) {
        const wrapped = wrappers.get(listener);
        if (wrapped) {
          wrappers.delete(listener);
          return nativeRemove(type, wrapped, options);
        }
        return nativeRemove(type, listener, options);
      };

      // onmessage is a separate delivery path in many VK bundles.
      let onmessageUser = null;
      Object.defineProperty(ws, 'onmessage', {
        configurable: true,
        enumerable: true,
        get() { return onmessageUser; },
        set(fn) { onmessageUser = typeof fn === 'function' ? fn : null; }
      });
      nativeAdd('message', async (event) => {
        if (typeof onmessageUser !== 'function') return;
        const filtered = await filterWsData(event.data);
        onmessageUser.call(ws, filtered == null ? event : wrappedMessageEvent(event, filtered));
      });

      return ws;
    };

    PatchedWebSocket.prototype = NativeWebSocket.prototype;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
      try { PatchedWebSocket[k] = NativeWebSocket[k]; } catch (_) {}
    }
    window.WebSocket = PatchedWebSocket;
  }

  console.log(TAG, 'v12 initialized: delete-only filtering; 10002 non-delete flags preserved; fetch/XHR/WS protected');
})();
