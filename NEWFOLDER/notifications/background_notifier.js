// vkefeatures/background_notifier.js
//
// Единый источник правды (Single Source of Truth) для попап-уведомлений VKE.
// Контент-скрипт (popup_notify.js) НИЧЕГО не решает сам: он либо шлёт сюда
// сырое событие (VKE_NOTIFY_EVENT / VKE_HIDE_EVENT), либо получает команду
// на отрисовку (VKE_SHOW_POPUP). Здесь и только здесь происходит:
//   - дедупликация одинаковых/повторных событий,
//   - отсечение устаревших (старых) уведомлений,
//   - выбор, в какую именно вкладку слать попап.

(() => {
  const MAX_EVENT_AGE_MS = 8000;      // старше этого - считаем событие неактуальным и дропаем
  const DEDUPE_TTL_MS = 5000;         // окно, в котором повторный eventId игнорируется
  const TAB_TTL_MS = 90_000;          // сколько храним вкладку как "живую" без обновлений

  const VK_URL_PATTERNS = ["https://*.vk.com/*", "https://*.vk.ru/*"];

  /** eventId -> timestamp когда обработали (для дедупа) */
  const seenEvents = new Map();

  /** tabId -> { url, lastSeen } — реальные вкладки ВК, знаем о них через порт-коннект */
  const liveTabs = new Map();

  const NOTIFICATION_HISTORY_KEY = 'vke_notification_history_v1';
  const NOTIFY_DEDUPE_KEY = 'vke_notify_dedupe_v1';
  const CLOSE_GRACE_MS = 10_000; // не чистим сразу - иначе обычный reload одной вкладки триггерил бы очистку

  let closeGraceTimer = null;

  function scheduleHistoryCleanup() {
    if (closeGraceTimer) clearTimeout(closeGraceTimer);
    closeGraceTimer = setTimeout(async () => {
      closeGraceTimer = null;
      // Перепроверяем на всякий случай — вдруг за грейс-период открылась новая вкладка ВК
      if (liveTabs.size > 0) return;
      const vkTabs = await chrome.tabs.query({ url: VK_URL_PATTERNS }).catch(() => []);

      if (vkTabs.length > 0) return; // вкладка есть, просто content-script ещё не законнектился

      try {
        await chrome.storage.local.set({ [NOTIFICATION_HISTORY_KEY]: [], [NOTIFY_DEDUPE_KEY]: {} });
        console.log('[VKE BG] Все вкладки ВК закрыты - история уведомлений очищена');
      } catch (e) {}
    }, CLOSE_GRACE_MS);
  }

  function cancelHistoryCleanup() {
    if (closeGraceTimer) {
      clearTimeout(closeGraceTimer);
      closeGraceTimer = null;
    }
  }

  // ---------- Учёт живых вкладок ----------
  // Контент-скрипт держит постоянный Port. Это переживает SPA-навигацию внутри ВК
  // (в отличие от разового onMessage), поэтому даже если пользователь скачет
  // по разделам без перезагрузки, фон знает, что вкладка жива и какой у неё url.
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'vke-tab-port') return;
    const tabId = port.sender?.tab?.id;
    if (tabId == null) return;

    liveTabs.set(tabId, { url: port.sender.tab.url || '', lastSeen: Date.now() });
    if (liveTabs.size > 0) cancelHistoryCleanup();

    port.onMessage.addListener((msg) => {
      if (msg?.type === 'VKE_TAB_HEARTBEAT') {
        const entry = liveTabs.get(tabId) || {};
        entry.url = msg.url || entry.url || '';
        entry.lastSeen = Date.now();
        liveTabs.set(tabId, entry);
      }
    });

    port.onDisconnect.addListener(async () => {
      liveTabs.delete(tabId);
      if (liveTabs.size === 0) scheduleHistoryCleanup();
    });
  });

  chrome.tabs.onRemoved.addListener((tabId) => liveTabs.delete(tabId));

  function pruneStaleTabs() {
    const now = Date.now();
    for (const [tabId, entry] of liveTabs) {
      if (now - entry.lastSeen > TAB_TTL_MS) liveTabs.delete(tabId);
    }
  }

  function pruneSeenEvents() {
    const now = Date.now();
    for (const [id, ts] of seenEvents) {
      if (now - ts > DEDUPE_TTL_MS) seenEvents.delete(id);
    }
  }

  // ---------- Определение куда слать ----------
  // События теперь приходят только из реальных вкладок пользователя.
  async function resolveTargetTabIds(sourceTabId) {
    pruneStaleTabs();
    const vkTabs = await chrome.tabs.query({ url: VK_URL_PATTERNS });
    const targets = new Set();

    try {
      const focused = await chrome.windows.getLastFocused({ populate:false, windowTypes:['normal'] });
      const active = vkTabs.find(t => t.windowId === focused.id && t.active);
      if (active) targets.add(active.id);
    } catch (_) {}

    if (targets.size === 0 && sourceTabId != null && vkTabs.some(t => t.id === sourceTabId)) targets.add(sourceTabId);
    if (targets.size === 0) {
      const anyActive = vkTabs.find(t => t.active);
      if (anyActive) targets.add(anyActive.id);
    }
    if (targets.size === 0) for (const id of liveTabs.keys()) targets.add(id);
    return [...targets];
  }

  function sendToTab(tabId, message) {
    chrome.tabs.sendMessage(tabId, message).catch(() => {
      // вкладка могла закрыться/перезагрузиться между resolve и send - не критично
      liveTabs.delete(tabId);
    });
  }

  // ---------- Обработка входящих событий ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'VKE_NOTIFY_EVENT') {
      handleNotifyEvent(msg, sender);
      return;
    }

    if (msg.type === 'VKE_HIDE_EVENT') {
      handleHideEvent(msg, sender);
      return;
    }
  });

  async function handleNotifyEvent(msg, sender) {
    pruneSeenEvents();

    const opts = msg.opts || {};
    const now = Date.now();
    const eventTs = typeof msg.ts === 'number' ? msg.ts : now;

    // 1. Отсекаем старые/неактуальные события
    if (now - eventTs > MAX_EVENT_AGE_MS) {
      return;
    }

    // 2. Дедупликация: по явному eventId, если не задан - строим стабильный
    //    ключ из содержимого + persistentKey (округляя время до секунды).
    const eventId = msg.eventId
      || `${opts.persistentKey || ''}|${opts.type || ''}|${opts.peerId || ''}|${opts.title || ''}|${opts.text || ''}`;

    if (seenEvents.has(eventId)) {
      return; // уже обработали такое же событие недавно
    }
    seenEvents.set(eventId, now);

    // 3. Роутинг: решаем куда слать, и слать ровно один раз на вкладку
    const sourceTabId = sender?.tab?.id;
    const targets = await resolveTargetTabIds(sourceTabId);

    for (const tabId of targets) {
      sendToTab(tabId, { type: 'VKE_SHOW_POPUP', payload: { opts } });
    }
  }

  async function handleHideEvent(msg, sender) {
    const sourceTabId = sender?.tab?.id;
    const targets = await resolveTargetTabIds(sourceTabId);
    for (const tabId of targets) {
      sendToTab(tabId, { type: 'VKE_SHOW_POPUP', payload: { action: 'hide', persistentKey: msg.persistentKey } });
    }
  }

  // ---------- Входящие события из User LongPoll ----------
  // Эти события приходят прямо в service worker через Kate Mobile API/User LP,
  // поэтому уведомления больше не зависят от того, находится ли пользователь
  // на /im, /feed или вообще на другой странице VK.
  const activityNames = new Map();
  const activityHideTimers = new Map();

  async function getNotifyConfig() {
    try {
      const res = await chrome.storage.local.get(['vke_features_settings', 'vkeSettings', 'vke_chat_rules_v1']);
      const ns = res.vke_features_settings || {};
      const enabled = { popupNewMsg:true, popupRead:true, popupTyping:true, popupVoice:true, ...(ns.enabled || {}) };
      const fs = res.vkeSettings || {};
      const rules = res.vke_chat_rules_v1 || {};
      return { enabled, rules, fs };
    } catch (_) {
      return { enabled:{popupNewMsg:true,popupRead:true,popupTyping:true,popupVoice:true}, rules:{}, fs:{} };
    }
  }

  function trackingAllowed(peerId, rules) {
    const p = String(peerId ?? '');
    const disabled = rules?.noTrack?.disable;
    return !(Array.isArray(disabled) && disabled.map(String).includes(p));
  }

  function popupEnabled(type, enabled) {
    const key = `popup${type === 'newMsg' ? 'NewMsg' : type === 'read' ? 'Read' : type === 'typing' ? 'Typing' : 'Voice'}`;
    return enabled[key] !== false;
  }

  async function getUserName(userId) {
    const uid = Number(userId);
    if (!Number.isFinite(uid) || uid <= 0) return 'Собеседник';
    if (activityNames.has(uid)) return activityNames.get(uid);
    try {
      const token = (await chrome.storage.local.get(['vkToken'])).vkToken;
      if (!token) return 'Собеседник';
      const url = `https://api.vk.com/method/users.get?user_ids=${encodeURIComponent(uid)}&fields=first_name,last_name&access_token=${encodeURIComponent(token)}&v=5.199`;
      const res = await fetch(url);
      const json = await res.json();
      const u = json?.response?.[0];
      const name = [u?.first_name, u?.last_name].filter(Boolean).join(' ').trim();
      if (name) {
        activityNames.set(uid, name);
        return name;
      }
    } catch (_) {}
    return `ID ${uid}`;
  }

  async function emitBackgroundPopup(opts) {
    const cfg = await getNotifyConfig();
    const peerId = opts?.peerId;
    if (peerId != null && !trackingAllowed(peerId, cfg.rules)) return;
    if (!popupEnabled(opts?.type || 'newMsg', cfg.enabled)) return;

    const targets = await resolveTargetTabIds(null);
    for (const tabId of targets) {
      sendToTab(tabId, { type:'VKE_SHOW_POPUP', payload:{ opts } });
    }
  }

  function hideActivity(type, peerId) {
    const key = `activity:${type}:${peerId}`;
    const targetsPromise = resolveTargetTabIds(null);
    targetsPromise.then(targets => {
      for (const tabId of targets) sendToTab(tabId, { type:'VKE_SHOW_POPUP', payload:{ action:'hide', persistentKey:key } });
    }).catch(() => {});
  }

  function scheduleActivityHide(type, peerId, delay = 6500) {
    const key = `${type}:${peerId}`;
    const old = activityHideTimers.get(key);
    if (old) clearTimeout(old);
    activityHideTimers.set(key, setTimeout(() => {
      activityHideTimers.delete(key);
      hideActivity(type, peerId);
    }, delay));
  }

  async function onLongPollEvent(event) {
    if (!Array.isArray(event) || !event.length) return;
    const code = Number(event[0]);
    const cfg = await getNotifyConfig();

    // Legacy User LongPoll events.
    if (code === 61) {
      const userId = event[1];
      const peerId = userId;
      if (!popupEnabled('typing', cfg.enabled) || !trackingAllowed(peerId, cfg.rules)) return;
      const name = await getUserName(userId);
      await emitBackgroundPopup({ type:'typing', title:`${name} печатает...`, text:'', peerId, persistentKey:`activity:typing:${peerId}`, duration:null });
      scheduleActivityHide('typing', peerId, 6500);
      return;
    }

    if (code === 62) {
      const userId = event[1];
      const chatId = Number(event[2]);
      const peerId = Number.isFinite(chatId) ? 2000000 + chatId : chatId;
      if (!popupEnabled('typing', cfg.enabled) || !trackingAllowed(peerId, cfg.rules)) return;
      const name = await getUserName(userId);
      await emitBackgroundPopup({ type:'typing', title:`${name} печатает...`, text:'', peerId, persistentKey:`activity:typing:${peerId}`, duration:null });
      scheduleActivityHide('typing', peerId, 6500);
      return;
    }

    if (code === 64) {
      const userId = event[1];
      const peerId = event[2];
      if (!popupEnabled('voice', cfg.enabled) || !trackingAllowed(peerId, cfg.rules)) return;
      const name = await getUserName(userId);
      await emitBackgroundPopup({ type:'voice', title:`${name} записывает голосовое`, text:'Идёт запись голосового сообщения', peerId, persistentKey:`activity:voice:${peerId}`, duration:null });
      scheduleActivityHide('voice', peerId, 7500);
      return;
    }

    if (code === 6 || code === 10006) {
      // 6: peer_id, local_id/cmid — we read incoming. Keep as a generic
      // read event; 10006 is the modern history equivalent.
      const peerId = code === 6 ? event[1] : event[1];
      if (!popupEnabled('read', cfg.enabled) || !trackingAllowed(peerId, cfg.rules)) return;
      await emitBackgroundPopup({ type:'read', title:'Сообщение прочитано', text:`В ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`, peerId, duration:4000 });
      return;
    }

    if (code === 7 || code === 10007) {
      const peerId = code === 7 ? event[1] : event[1];
      if (!popupEnabled('read', cfg.enabled) || !trackingAllowed(peerId, cfg.rules)) return;
      await emitBackgroundPopup({ type:'read', title:'Сообщение прочитано', text:`В ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`, peerId, duration:4000 });
      return;
    }
  }

  globalThis.VkeBackgroundNotify = { onLongPollEvent, emitBackgroundPopup };

  // ---------- Периодическая чистка ----------
  chrome.alarms.create('vke_heartbeat', { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'vke_heartbeat') {
      pruneStaleTabs();
      pruneSeenEvents();
    }
  });
})();