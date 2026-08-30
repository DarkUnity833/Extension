// vkefeatures/popup_notify.js
(() => {
  if (window.VkePopup) return;

  const CONTAINER_ID = 'vke-popup-container';
  const ANIM_MS = 300;
  const ICONS = { typing: '✏️', read: '✅', newMsg: '💬', voice: '🎙️' };

  const persistentCards = new Map();
  const STORAGE_KEY = 'vke_notification_history_v1';
  const MAX_HISTORY = 30;

  let notificationHistory = [];
  let historyLoaded = false;

  async function loadHistory() {
    try {
      const res = await chrome.storage.local.get([STORAGE_KEY]);
      notificationHistory = res[STORAGE_KEY] || [];
    } catch (e) {
      notificationHistory = [];
    }
    historyLoaded = true;
  }

  async function saveHistory() {
    try { await chrome.storage.local.set({ [STORAGE_KEY]: notificationHistory }); }
    catch (e) {}
  }

  // Фон чистит эту же запись, когда закрываются ВСЕ вкладки ВК (см.
  // background_notifier.js). Слушаем изменения, чтобы дропдаун истории
  // сразу отражал очистку, если он открыт в момент, когда закрылась
  // последняя другая вкладка.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) {
      notificationHistory = changes[STORAGE_KEY].newValue || [];
    }
  });

  loadHistory();

  // ---------- Порт до фонового скрипта ----------
  // Держим постоянное соединение, чтобы background_notifier.js знал, что вкладка
  // жива, и видел актуальный url даже при SPA-переходах ВК (без перезагрузки страницы,
  // на которых обычный onMessage/query по url может не успевать обновиться).
  let port = null;
  let lastUrl = location.href;

  function connectPort() {
    try {
      port = chrome.runtime.connect({ name: 'vke-tab-port' });
      port.postMessage({ type: 'VKE_TAB_HEARTBEAT', url: location.href });
      port.onDisconnect.addListener(() => {
        port = null;
        // Service worker мог заснуть/перезапуститься - переподключаемся.
        setTimeout(connectPort, 500);
      });
    } catch (e) {
      setTimeout(connectPort, 1000);
    }
  }
  connectPort();

  function heartbeatIfNavigated() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      try { port?.postMessage({ type: 'VKE_TAB_HEARTBEAT', url: location.href }); } catch (e) {}
    }
  }
  setInterval(heartbeatIfNavigated, 1000);
  window.addEventListener('popstate', heartbeatIfNavigated);

  // ---------- Отправка событий в фон (никакого локального рендера здесь) ----------
  function notify(opts) {
    try {
      chrome.runtime?.sendMessage?.({
        type: 'VKE_NOTIFY_EVENT',
        ts: Date.now(),
        opts
      });
    } catch (e) {}
  }

  function requestHide(persistentKey) {
    try {
      chrome.runtime?.sendMessage?.({
        type: 'VKE_HIDE_EVENT',
        persistentKey
      });
    } catch (e) {}
  }

  // Единственный путь отрисовки - команда от background. Content-скрипт
  // никогда сам не решает показать попап при вызове show(): он лишь сообщает
  // о событии, а рисует то, что реально прикажет фон (после дедупа/роутинга).
  chrome.runtime?.onMessage?.addListener((msg) => {
    if (msg?.type !== 'VKE_SHOW_POPUP') return;
    if (msg.payload?.action === 'hide') hideLocal(msg.payload.persistentKey);
    else renderPopup(msg.payload.opts || msg.payload);
  });

  function show(opts) {
    notify(opts);
  }

  function hide(persistentKey) {
    requestHide(persistentKey);
  }

  function ensureContainer() {
    let c = document.getElementById(CONTAINER_ID);
    if (!c) {
      c = document.createElement('div');
      c.id = CONTAINER_ID;
      Object.assign(c.style, {
        position: 'fixed', top: '64px', left: '16px', zIndex: 999999,
        display: 'flex', flexDirection: 'column', gap: '8px', pointerEvents: 'none'
      });
      (document.body || document.documentElement).appendChild(c);
    }
    return c;
  }

  function openChatWithoutReload(peerId, dropdownElem) {
    if (dropdownElem) dropdownElem.style.display = 'none';
    const targetUrl = '/im?sel=' + peerId;

    if (window.history && window.history.pushState) {
      window.history.pushState({ loc: targetUrl }, '', targetUrl);
      window.dispatchEvent(new PopStateEvent('popstate', { state: { loc: targetUrl } }));

      if (typeof window.nav?.go === 'function') {
        window.nav.go(targetUrl, { unbug: 1 });
      } else {
        let dummyLink = document.getElementById('vke-router-helper');
        if (!dummyLink) {
          dummyLink = document.createElement('a');
          dummyLink.id = 'vke-router-helper';
          dummyLink.style.display = 'none';
          document.body.appendChild(dummyLink);
        }
        dummyLink.href = targetUrl;
        dummyLink.click();
      }
    } else {
      window.location.href = targetUrl;
    }
  }

  function renderHistory(container, dropdownElem) {
    container.innerHTML = '<div style="font-weight:600; padding:4px 8px 12px; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;"><span>История уведомлений VKE</span><span id="vke-clear-history" style="font-size:11px; color:#888; cursor:pointer;">Очистить</span></div>';

    const clearBtn = container.querySelector('#vke-clear-history');
    if (clearBtn) {
      clearBtn.onclick = (e) => {
        e.stopPropagation();
        notificationHistory = [];
        saveHistory();
        renderHistory(container, dropdownElem);
      };
    }

    if (notificationHistory.length === 0) {
      container.innerHTML += '<div style="padding:12px; color:#888; font-size:13px; text-align:center;">Пока пусто</div>';
      return;
    }

    const listContainer = document.createElement('div');
    listContainer.style.maxHeight = '320px';
    listContainer.style.overflowY = 'auto';

    [...notificationHistory].reverse().forEach(item => {
      const el = document.createElement('div');
      Object.assign(el.style, {
        padding: '8px', borderBottom: '1px solid rgba(255,255,255,0.05)',
        fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '4px',
        cursor: item.peerId ? 'pointer' : 'default', borderRadius: '6px'
      });

      if (item.peerId) {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openChatWithoutReload(item.peerId, dropdownElem);
        });
        el.addEventListener('mouseenter', () => el.style.background = 'rgba(255,255,255,0.08)');
        el.addEventListener('mouseleave', () => el.style.background = 'transparent');
      }

      el.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong style="color:#fff; font-size:12.5px;">${ICONS[item.type] || '🔔'} ${escapeHtml(item.title)}</strong>
          <span style="color:#888; font-size:11px;">${item.time}</span>
        </div>
        <div style="color:#aaa; line-height:1.3; font-size:12px; word-break:break-word;">
          ${escapeHtml(item.text)}
        </div>
      `;
      listContainer.appendChild(el);
    });
    container.appendChild(listContainer);
  }

  function injectHistoryMenu() {
    if (document.getElementById('vke-history-menu-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'vke-history-menu-btn';
    btn.title = 'VKE — история уведомлений';
    btn.innerHTML = `🔔`;
    Object.assign(btn.style, {
      position: 'fixed',
      top: '8px',
      left: '8px',
      zIndex: 999999,
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      border: 'none',
      background: '#2a2b2f',
      color: '#fff',
      fontSize: '16px',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,.4)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'opacity 0.2s'
    });
    btn.onmouseenter = () => btn.style.opacity = '0.7';
    btn.onmouseleave = () => btn.style.opacity = '1';

    let dropdown = document.getElementById('vke-history-dropdown');
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.id = 'vke-history-dropdown';
      Object.assign(dropdown.style, {
        display: 'none', position: 'fixed', top: '52px', left: '8px',
        width: '320px', background: '#222226', borderRadius: '10px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 1000000,
        border: '1px solid rgba(255,255,255,0.1)', padding: '12px', color: '#fff',
        fontFamily: 'system-ui, sans-serif'
      });
      document.body.appendChild(dropdown);
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = dropdown.style.display === 'block';
      dropdown.style.display = isVisible ? 'none' : 'block';
      if (!isVisible) {
        if (!historyLoaded) {
          loadHistory().then(() => renderHistory(dropdown, dropdown));
        } else {
          renderHistory(dropdown, dropdown);
        }
      }
    });

    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && e.target !== btn) {
        dropdown.style.display = 'none';
      }
    });

    document.body.appendChild(btn);
  }

  const observer = new MutationObserver(() => {
    heartbeatIfNavigated();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  // Один раз при старте, больше не нужен setInterval — кнопка fixed
  if (document.body) injectHistoryMenu();
  else document.addEventListener('DOMContentLoaded', injectHistoryMenu);

  function renderPopup({ type = 'newMsg', title = '', text = '', peerId = null, duration = 4000, persistentKey = null } = {}) {
    const container = ensureContainer();

    if (type !== 'typing') {
      const now = new Date();
      const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
      notificationHistory.push({ type, title, text, peerId, time: timeStr });
      if (notificationHistory.length > MAX_HISTORY) notificationHistory.shift();
      saveHistory();
    }

    if (persistentKey && persistentCards.has(persistentKey)) {
      const card = persistentCards.get(persistentKey);
      card.querySelector('.vke-popup-title').textContent = title;
      card.querySelector('.vke-popup-text').textContent = text;
      return;
    }

    const card = document.createElement('div');
    card.className = 'vke-popup-card';
    Object.assign(card.style, {
      background: 'rgba(30, 30, 34, 0.95)', color: 'rgb(255, 255, 255)',
      borderRadius: '10px', padding: '10px 14px', minWidth: '220px', maxWidth: '340px',
      boxShadow: 'rgba(0, 0, 0, 0.35) 0px 4px 16px', fontSize: '13px',
      fontFamily: 'system-ui, sans-serif', display: 'flex', alignItems: 'flex-start',
      gap: '10px', pointerEvents: 'auto', cursor: 'pointer', opacity: '0',
      transform: 'translateX(-20px)', transition: '300ms'
    });

    card.innerHTML = `
      <span style="font-size:18px;line-height:1;margin-top:2px;">${ICONS[type] || '🔔'}</span>
      <span class="vke-content-wrapper" style="display:flex;flex-direction:column;overflow:hidden;flex:1;">
        <strong class="vke-popup-title" style="font-size:12.5px;margin-bottom:2px;">${escapeHtml(title)}</strong>
        <span class="vke-popup-text" style="opacity:.75;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.4;transition:all 0.2s;">${escapeHtml(text)}</span>
      </span>`;

    let timerId;
    let isExpanded = false;

    const startTimer = () => {
      if (duration && !persistentKey) {
        timerId = setTimeout(() => fadeOut(card), duration);
      }
    };
    const stopTimer = () => {
      if (timerId) clearTimeout(timerId);
    };

    card.addEventListener('mouseenter', stopTimer);
    card.addEventListener('mouseleave', startTimer);

    card.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.target.classList.contains('vke-open-chat-btn')) {
        openChatWithoutReload(peerId, null);
        return;
      }

      if (!isExpanded) {
        isExpanded = true;
        const textSpan = card.querySelector('.vke-popup-text');
        textSpan.style.whiteSpace = 'normal';
        textSpan.style.overflow = 'visible';

        if (peerId) {
          const btn = document.createElement('button');
          btn.className = 'vke-open-chat-btn';
          btn.textContent = 'Открыть чат';
          Object.assign(btn.style, {
            marginTop: '8px', padding: '4px 10px', background: 'var(--vkui--color_background_accent, #2b7de9)',
            color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer',
            fontSize: '11px', fontWeight: '500', alignSelf: 'flex-start'
          });
          card.querySelector('.vke-content-wrapper').appendChild(btn);
        }
      }
    });

    container.appendChild(card);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        card.style.opacity = '1';
        card.style.transform = 'translateX(0)';
      });
    });

    if (persistentKey) { persistentCards.set(persistentKey, card); return; }
    startTimer();
  }

  function hideLocal(persistentKey) {
    const card = persistentCards.get(persistentKey);
    if (!card) return;
    persistentCards.delete(persistentKey);
    fadeOut(card);
  }

  function fadeOut(card) {
    card.style.opacity = '0';
    card.style.transform = 'translateX(-20px)';
    setTimeout(() => card.remove(), ANIM_MS);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  window.VkePopup = { show, hide };
})();