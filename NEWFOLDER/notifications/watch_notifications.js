// notifications/watch_notifications.js
// Изолированный DOM-наблюдатель VKE.
// Поддерживаем только: входящее сообщение, прочитано, печатает, записывает голосовое.
// Кружки и отправка медиа намеренно НЕ отслеживаются и отсутствуют в настройках.
(() => {
  'use strict';
  if (window.__vkeNotificationsWatcherInit) return;
  window.__vkeNotificationsWatcherInit = true;

  const SETTINGS_KEY = 'vke_features_settings';
  const RULES_KEY = 'vke_chat_rules_v1';
  const SEL_ROW = '[data-itemkey^="convo_"]';
  const SEL_STATUS_ICON = '.ConvoListItem__outStatusIcon, .ConvoMessageBottomInfo__outStatusIcon';
  const SEL_PREVIEW = '.ConvoListItem__message, .ConvoListItem__content, [class*="ConvoListItem__message"], [class*="ConvoListItem__preview"]';

  const RE_TYPING = /^(?:печатает|пишет|набирает|typing|is typing|are typing)(?:…|\.\.\.)?$/i;
  const RE_TYPING_ANY = /(?:печатает|пишет|набирает|typing|is typing|are typing|набирает сообщение|печатает сообщение)/i;
  const RE_VOICE_TEXT = /(?:записыва(?:ет|ю)|recording)\s+(?:голосов(?:ое|ую)(?:\s+сообщение)?|voice(?:\s+message)?|audio)/i;
  const RE_VOICE_META = /(?:voice|audio|record|recording|голосов)/i;

  const OWN_PREFIX_RE = /^(вы|you)\s*:/i;
  const WARMUP_MS = 3500;
  const HIDE_GRACE_MS = 1200;
  const SCAN_MS = 1200;

  let settings = { enabled: { popupNewMsg:true, popupRead:true, popupTyping:true, popupVoice:true } };
  let rules = { noRead:{enable:[],disable:[]}, noTyping:{enable:[],disable:[]}, noTrack:{disable:[]} };
  const bootTime = Date.now();
  const chatReadState = new Map();
  const chatLastMsg = new Map();
  const activeActivity = new Map();
  const pendingHide = new Map();
  const dedupe = new Map();

  function now() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  function once(key) {
    const n = Date.now();
    for (const [k, t] of dedupe) if (n - t > 15000) dedupe.delete(k);
    if (dedupe.has(key)) return false;
    dedupe.set(key, n);
    return true;
  }

  function normalizeRules(raw) {
    const out = { noRead:{enable:[],disable:[]}, noTyping:{enable:[],disable:[]}, noTrack:{disable:[]} };
    if (!raw || typeof raw !== 'object') return out;
    for (const bucket of ['noRead','noTyping']) {
      const v = raw[bucket];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        out[bucket].enable = Array.from(new Set((v.enable || []).map(String)));
        out[bucket].disable = Array.from(new Set((v.disable || []).map(String)));
      } else if (Array.isArray(v)) {
        out[bucket].enable = Array.from(new Set(v.map(String)));
      }
    }
    if (Array.isArray(raw.noTrack)) out.noTrack.disable = Array.from(new Set(raw.noTrack.map(String)));
    else if (raw.noTrack?.disable) out.noTrack.disable = Array.from(new Set(raw.noTrack.disable.map(String)));
    return out;
  }

  async function loadConfig() {
    try {
      const res = await chrome.storage.local.get([SETTINGS_KEY, RULES_KEY]);
      settings = { enabled: { ...(settings.enabled || {}), ...(res[SETTINGS_KEY]?.enabled || {}) } };
      rules = normalizeRules(res[RULES_KEY]);
    } catch (_) {}
  }

  function globalEnabled(key) {
    return settings?.enabled?.[key] !== false;
  }

  function trackingEnabled(peerId) {
    return !rules?.noTrack?.disable?.includes(String(peerId));
  }

  function ruleOverride(peerId, bucket, global) {
    const p = String(peerId);
    const b = rules?.[bucket] || { enable:[], disable:[] };
    if (b.enable?.includes(p)) return true;
    if (b.disable?.includes(p)) return false;
    return !!global;
  }

  function currentPeerId() {
    const q = new URLSearchParams(location.search);
    const sel = q.get('sel');
    if (sel) return sel;
    const m = location.pathname.match(/\/im\/convo\/(-?\d+)/);
    return m ? m[1] : null;
  }

  function peerIdOf(el) {
    const row = el?.closest?.(SEL_ROW);
    if (row) return row.getAttribute('data-itemkey').replace(/^convo_/, '');
    return currentPeerId();
  }

  function chatNameOf(el) {
    const row = el?.closest?.(SEL_ROW);
    const title = row?.querySelector?.('.ConvoTitle__title,.ConvoTitle__author,[class*="ConvoTitle__name"],[class*="ConvoTitle__title"]');
    const name = title?.textContent?.trim();
    if (name && !/^\d+$/.test(name)) return name;
    // Open conversation header fallback.
    const header = document.querySelector('[class*="ConvoHeader"] [class*="Title"], [class*="ConvoHeader"] [class*="name"], header [class*="Title"]');
    const headerName = header?.textContent?.trim();
    if (headerName && headerName.length < 80) return headerName.replace(/\s+/g, ' ');
    return 'Собеседник';
  }

  function notify(opts) {
    if (opts.peerId && !trackingEnabled(opts.peerId)) return;
    window.VkePopup?.show?.(opts);
  }

  function activityTitle(type, name) {
    return type === 'voice' ? `${name} записывает голосовое` : `${name} печатает...`;
  }

  function activityText(type) {
    return type === 'voice' ? 'Идёт запись голосового сообщения' : '';
  }

  function metaText(node) {
    const parts = [];
    const add = (v) => { if (v) parts.push(String(v)); };
    add(node?.getAttribute?.('aria-label'));
    add(node?.getAttribute?.('title'));
    add(node?.getAttribute?.('data-testid'));
    add(node?.getAttribute?.('data-tooltip-content'));
    add(typeof node?.className === 'string' ? node.className : '');
    node?.querySelectorAll?.('[aria-label],[title],[data-testid]')?.forEach?.(n => {
      add(n.getAttribute('aria-label'));
      add(n.getAttribute('title'));
      add(n.getAttribute('data-testid'));
    });
    return parts.join(' ').toLowerCase();
  }

  function detectActivityType(text, node) {
    const t = (text || '').replace(/\s+/g, ' ').trim();
    const meta = metaText(node);
    if (RE_VOICE_TEXT.test(t) || (RE_VOICE_META.test(meta) && /record|recording|записыва/.test(meta))) return 'voice';
    if (RE_TYPING.test(t) || RE_TYPING_ANY.test(t) || /typing|is-typing|печатает|пишет|набирает/.test(meta)) return 'typing';
    return null;
  }

  function candidateNodes(root) {
    const out = [];
    if (!root) return out;
    const selectors = [
      '[class*="typing"]', '[class*="Typing"]', '[data-testid*="typing"]',
      '[aria-label*="печатает" i]', '[aria-label*="пишет" i]', '[aria-label*="набирает" i]', '[aria-label*="typing" i]',
      '[title*="печатает" i]', '[title*="пишет" i]', '[title*="набирает" i]',
      '[class*="voice"]', '[class*="Voice"]', '[class*="record"]', '[class*="Record"]', '[class*="recording"]', '[class*="Recording"]',
      '[data-testid*="voice"]', '[data-testid*="record"]',
      '.ConvoListItem__message', '.ConvoListItem__content', '[class*="ConvoListItem__preview"]'
    ];
    for (const sel of selectors) {
      try { root.querySelectorAll(sel).forEach(n => out.push(n)); } catch (_) {}
    }
    return Array.from(new Set(out));
  }

  function findActivityNode(root) {
    const direct = detectActivityType(root?.textContent, root);
    if (direct) return direct;
    for (const node of candidateNodes(root)) {
      const type = detectActivityType(node.textContent, node);
      if (type) return type;
    }
    return null;
  }

  function addActivity(el, hintedType = null) {
    const peerId = peerIdOf(el);
    if (!peerId || !trackingEnabled(peerId)) return;
    const type = hintedType || findActivityNode(el);
    if (!type) return;

    const settingKey = type === 'voice' ? 'popupVoice' : 'popupTyping';
    if (!globalEnabled(settingKey)) return;

    // Popup tracking is independent from the no-typing privacy rule.
    // A chat may suppress typing receipts while still being watched for popups.

    const p = String(peerId);
    const previous = activeActivity.get(p);
    if (previous === type) return;
    if (pendingHide.has(p)) {
      clearTimeout(pendingHide.get(p));
      pendingHide.delete(p);
    }

    activeActivity.set(p, type);
    notify({
      type,
      title: activityTitle(type, chatNameOf(el)),
      text: activityText(type),
      peerId,
      persistentKey: `activity:${type}:${p}`,
      duration: null
    });
  }

  function scheduleActivityHide(el) {
    const peerId = peerIdOf(el);
    if (!peerId) return;
    const p = String(peerId);
    const type = activeActivity.get(p);
    if (!type || pendingHide.has(p)) return;
    pendingHide.set(p, setTimeout(() => {
      pendingHide.delete(p);
      activeActivity.delete(p);
      window.VkePopup?.hide?.(`activity:${type}:${p}`);
    }, HIDE_GRACE_MS));
  }

  function handleReadIcon(el) {
    if (!globalEnabled('popupRead')) return;
    const peerId = peerIdOf(el);
    if (!peerId || !trackingEnabled(peerId)) return;
    const html = el.innerHTML || '';
    const isRead = html.includes('check_double_outline_16') || (html.match(/<path/g) || []).length >= 2;
    const p = String(peerId);
    const prev = chatReadState.get(p);
    chatReadState.set(p, isRead);
    if (prev === false && isRead && once(`read:${p}`)) {
      notify({ type:'read', title:`${chatNameOf(el)} — Прочитано`, text:`Сообщение прочитано в ${now()}`, peerId, duration:4000 });
    }
  }

  function handlePreview(el) {
    if (!globalEnabled('popupNewMsg') || Date.now() - bootTime < WARMUP_MS) return;
    const row = el.closest?.(SEL_ROW);
    if (!row) return;
    const peerId = row.getAttribute('data-itemkey')?.replace(/^convo_/, '');
    if (!peerId || !trackingEnabled(peerId)) return;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || OWN_PREFIX_RE.test(text)) return;
    if (findActivityNode(el)) return;

    const prev = chatLastMsg.get(peerId);
    chatLastMsg.set(peerId, text);
    if (prev == null || prev === text) return;
    if (once(`msg:${peerId}:${text}`)) notify({ type:'newMsg', title:`${chatNameOf(el)} · ${now()}`, text, peerId, duration:6000 });
  }

  function scanRows() {
    document.querySelectorAll(SEL_ROW).forEach(row => {
      const type = findActivityNode(row);
      if (type) addActivity(row, type);
      else scheduleActivityHide(row);
      // New-message and read popups are now sourced from User LongPoll in
      // the service worker, so the DOM observer does not emit duplicates.
    });

    // Open conversation header/status fallback. This catches typing/recording
    // even when the chat list preview is not currently visible.
    const bodyCandidates = document.querySelectorAll('[class*="ConvoHeader"], [class*="ConversationHeader"], [role="status"], [aria-live]');
    for (const node of bodyCandidates) {
      const type = findActivityNode(node);
      if (type) addActivity(node, type);
    }
  }

  const observer = new MutationObserver((mutations) => {
    let scan = false;
    for (const m of mutations) {
      if (m.addedNodes?.length || m.removedNodes?.length || m.type === 'characterData' || m.type === 'attributes') { scan = true; break; }
    }
    if (!scan) return;
    clearTimeout(observer._scanTimer);
    observer._scanTimer = setTimeout(scanRows, 0);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[SETTINGS_KEY]) settings = { enabled: { ...(settings.enabled || {}), ...(changes[SETTINGS_KEY].newValue?.enabled || {}) } };
    if (changes[RULES_KEY]) rules = normalizeRules(changes[RULES_KEY].newValue);
  });

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data?.source === 'vke-chat-rules' && e.data?.type === 'RULES_UPDATED') rules = normalizeRules(e.data.rules);
  });

  async function start() {
    await loadConfig();
    observer.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class','style','aria-label','title','data-testid'], characterData:true });
    scanRows();
    setInterval(scanRows, SCAN_MS);
  }

  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once:true });
})();
