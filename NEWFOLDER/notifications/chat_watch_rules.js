// notifications/chat_watch_rules.js
// Персональные правила чата. Встраиваются только в настоящее меню VK,
// открытое ПКМ по строке чата. Не создаём собственных панелей.
(() => {
  'use strict';
  if (window.__vkeChatWatchRulesInit) return;
  window.__vkeChatWatchRulesInit = true;

  const KEY = 'vke_chat_rules_v1';
  const DEFAULTS = {
    noRead: { enable: [], disable: [] },
    noTyping: { enable: [], disable: [] },
    noTrack: { disable: [] }
  };

  let rules = structuredClone(DEFAULTS);
  let contextPeer = null;
  let contextPoint = { x: 0, y: 0 };
  let menuRetryTimer = null;
  let injecting = false;

  // VK's native menu gives its action rows a hover background. Our cloned
  // rows inherit most of the native classes, but VK's CSS can be scoped to
  // selectors that do not match after React re-renders. Keep a tiny fallback
  // so the three VKE rows behave visually like normal menu actions.
  function installHoverStyle() {
    if (document.getElementById('vke-chat-rules-hover-style')) return;
    const style = document.createElement('style');
    style.id = 'vke-chat-rules-hover-style';
    style.textContent = `
      .vke-chat-rule-item {
        position: relative;
        box-sizing: border-box;
        border-radius: 8px;
      }
      .vke-chat-rule-item:hover,
      .vke-chat-rule-item:focus-visible {
        background: var(--vkui--color_background_secondary, rgba(255,255,255,.08)) !important;
      }
      .vke-chat-rule-item:active {
        background: var(--vkui--color_background_tertiary, rgba(255,255,255,.12)) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function normalize(raw) {
    const r = structuredClone(DEFAULTS);
    if (!raw || typeof raw !== 'object') return r;
    for (const key of ['noRead', 'noTyping']) {
      const v = raw[key];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        r[key].enable = Array.from(new Set((v.enable || []).map(String)));
        r[key].disable = Array.from(new Set((v.disable || []).map(String)));
      } else if (Array.isArray(v)) {
        r[key].enable = Array.from(new Set(v.map(String)));
      }
    }
    if (Array.isArray(raw.noTrack)) r.noTrack.disable = Array.from(new Set(raw.noTrack.map(String)));
    else if (raw.noTrack?.disable) r.noTrack.disable = Array.from(new Set(raw.noTrack.disable.map(String)));
    return r;
  }

  async function load() {
    try {
      const res = await chrome.storage.local.get(KEY);
      rules = normalize(res[KEY]);
    } catch (_) {}
  }

  async function save() {
    try { await chrome.storage.local.set({ [KEY]: rules }); } catch (_) {}
    // Update MAIN-world interceptor immediately and refresh the already-open
    // native VK context menu without requiring a page reload.
    window.postMessage({ source: 'vke-chat-rules', type: 'RULES_UPDATED', rules }, '*');
    scheduleMenuRefresh();
  }

  async function getGlobal() {
    try {
      const res = await chrome.storage.local.get(['vkeSettings', 'vke_features_settings']);
      const legacy = res.vkeSettings || {};
      const enabled = res.vke_features_settings?.enabled || {};
      return {
        noRead: legacy.silentRead === true || enabled.noRead === true,
        noTyping: legacy.silentWrite === true || enabled.noTyping === true
      };
    } catch (_) {
      return { noRead: false, noTyping: false };
    }
  }

  function current(bucket, peer, global) {
    const b = rules[bucket] || { enable: [], disable: [] };
    const p = String(peer);
    if (b.enable.includes(p)) return true;
    if (b.disable.includes(p)) return false;
    return !!global;
  }

  function setOverride(bucket, peer, desired, global) {
    const b = rules[bucket];
    const p = String(peer);
    b.enable = b.enable.filter(x => x !== p);
    b.disable = b.disable.filter(x => x !== p);
    if (desired !== !!global) (desired ? b.enable : b.disable).push(p);
  }

  function toggleTrack(peer) {
    const p = String(peer);
    const idx = rules.noTrack.disable.indexOf(p);
    if (idx >= 0) rules.noTrack.disable.splice(idx, 1);
    else rules.noTrack.disable.push(p);
  }

  function findChatRow(target) {
    if (target?.closest?.('.ConvoMessage, .ConvoMessageWithoutBubble')) return null;
    const row = target?.closest?.('[data-itemkey^="convo_"]');
    return row || null;
  }

  function peerFromRow(row) {
    const item = row?.getAttribute('data-itemkey') || '';
    return item.startsWith('convo_') ? item.slice(6) : null;
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 100 && rect.height > 20;
  }

  function isNativeChatMenu(menu) {
    const text = (menu?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!text) return false;
    if (/ответить|переслать|копировать текст|пожаловаться|\bвыбрать\b|\bудалить\b/.test(text)) return false;
    return /отметить непрочитанным|закрепить чат|архивировать|очистить историю/.test(text);
  }

  function findBestChatMenu() {
    const all = Array.from(document.querySelectorAll('ul.ActionsMenu')).filter(visible);
    if (!all.length) return null;
    all.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const da = Math.hypot((ar.left + ar.width / 2) - contextPoint.x, (ar.top + ar.height / 2) - contextPoint.y);
      const db = Math.hypot((br.left + br.width / 2) - contextPoint.x, (br.top + br.height / 2) - contextPoint.y);
      return da - db;
    });
    return all.find(isNativeChatMenu) || null;
  }

  function removeInjected(menu) {
    menu?.querySelectorAll?.('.vke-chat-rule-item').forEach(n => n.remove());
  }

  function createItem(menu, text, onClick, actionName) {
    const template = Array.from(menu.querySelectorAll('button[role="menuitem"], .ActionsMenuAction')).find(el => {
      const t = (el.textContent || '').trim();
      return t && !/^закрыть$/i.test(t) && !el.classList.contains('vke-chat-rule-item');
    });
    if (!template) return null;

    const item = template.cloneNode(true);
    item.classList.add('vke-chat-rule-item');
    item.dataset.vkeRuleAction = actionName || '';
    item.removeAttribute('style');
    item.setAttribute('aria-label', text.replace(/^\S+\s+/, ''));
    item.setAttribute('tabindex', '0');
    item.setAttribute('role', 'menuitem');
    item.type = 'button';
    item.style.setProperty('pointer-events', 'auto', 'important');
    item.style.setProperty('cursor', 'pointer', 'important');
    item.innerHTML = '<i class="ActionsMenuAction__icon"><span aria-hidden="true"></span></i><span class="ActionsMenuAction__title"></span>';

    const m = text.match(/^(\S+)\s+(.*)$/);
    const icon = item.querySelector('.ActionsMenuAction__icon span');
    const label = item.querySelector('.ActionsMenuAction__title');
    if (icon) icon.textContent = m ? m[1] : '☑️';
    if (label) label.textContent = m ? m[2] : text;

    let fired = false;
    const activate = (ev) => {
      if (fired) return;
      fired = true;
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      ev?.stopImmediatePropagation?.();
      Promise.resolve().then(() => onClick()).catch(() => {}).finally(() => {
        setTimeout(() => { fired = false; }, 0);
      });
    };

    item.__vkeActivate = activate;
    item.addEventListener('pointerdown', ev => {
      if (ev.button === 0) activate(ev);
    }, true);
    item.addEventListener('mousedown', ev => {
      if (ev.button === 0) activate(ev);
    }, true);
    item.addEventListener('click', activate, true);
    item.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') activate(ev);
    }, true);
    return item;
  }

  const captureRulePointer = (ev) => {
    if (ev.button !== 0) return;
    const item = ev.target?.closest?.('.vke-chat-rule-item');
    if (!item || typeof item.__vkeActivate !== 'function') return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    item.__vkeActivate(ev);
  };
  // Window capture runs before VK's document/root handlers.
  window.addEventListener('pointerdown', captureRulePointer, true);
  document.addEventListener('pointerdown', captureRulePointer, true);

  async function injectIntoMenu(menu) {
    if (injecting || !menu || !contextPeer || !isNativeChatMenu(menu)) return;

    // The menu DOM survives while the rule is being changed.  The previous
    // implementation returned early when the same peer was already injected,
    // so the visible text/icon stayed stale until VK recreated the menu (most
    // often after a page reload).  Always rebuild our three items for the
    // current menu; this does NOT recreate VK's native menu, only our own rows.
    injecting = true;
    try {
      removeInjected(menu);
      const global = await getGlobal();
      const p = String(contextPeer);
      const noRead = current('noRead', p, global.noRead);
      const noTyping = current('noTyping', p, global.noTyping);
      const trackingOn = !rules.noTrack.disable.includes(p);

      const items = [
        createItem(menu, `${noRead ? '✅' : '☑️'} Нечиталка для этого чата: ${noRead ? 'включена' : 'выключена'}`, async () => {
          setOverride('noRead', p, !noRead, global.noRead);
          await save();
        }, 'noRead'),
        createItem(menu, `${noTyping ? '✅' : '☑️'} Неписалка для этого чата: ${noTyping ? 'включена' : 'выключена'}`, async () => {
          setOverride('noTyping', p, !noTyping, global.noTyping);
          await save();
        }, 'noTyping'),
        createItem(menu, `${trackingOn ? '🔔' : '🔕'} Попапы за этим чатом: ${trackingOn ? 'включены' : 'выключены'}`, async () => {
          toggleTrack(p);
          await save();
        }, 'noTrack')
      ].filter(Boolean);

      const closeNode = Array.from(menu.querySelectorAll('[role="menuitem"]')).find(el => {
        const t = (el.getAttribute('aria-label') || el.textContent || '').trim();
        return /^закрыть$/i.test(t) && el.closest('.vkuiVisuallyHidden__host');
      });
      const anchor = closeNode?.closest('span') || closeNode || null;
      for (const item of items) {
        if (anchor) menu.insertBefore(item, anchor);
        else menu.appendChild(item);
      }
      menu.dataset.vkeRulePeer = String(contextPeer);
    } finally {
      injecting = false;
    }
  }

  function scheduleMenuRefresh() {
    if (menuRetryTimer) cancelAnimationFrame(menuRetryTimer);
    menuRetryTimer = requestAnimationFrame(async () => {
      menuRetryTimer = null;
      const menu = findBestChatMenu();
      if (menu) await injectIntoMenu(menu);
    });
  }

  // Только ПКМ: ЛКМ продолжает обычное открытие чата.
  document.addEventListener('contextmenu', (e) => {
    const row = findChatRow(e.target);
    if (!row) return;
    const peer = peerFromRow(row);
    if (!peer) return;
    contextPeer = String(peer);
    contextPoint = { x: e.clientX, y: e.clientY };
    // VK создаёт меню после contextmenu. Достаточно короткой серии кадров,
    // а не сотен миллисекунд таймеров — это убирает мигание.
    scheduleMenuRefresh();
    setTimeout(scheduleMenuRefresh, 40);
    setTimeout(scheduleMenuRefresh, 100);
  }, true);

  const observer = new MutationObserver((mutations) => {
    if (!contextPeer || injecting) return;

    // Do NOT react to our own row removal/insertion. Rebuilding the three
    // VKE rows used to generate a mutation, which caused another rebuild and
    // made the native VK menu flicker.
    for (const m of mutations) {
      const added = Array.from(m.addedNodes || []).filter(n => n.nodeType === 1);
      const removed = Array.from(m.removedNodes || []).filter(n => n.nodeType === 1);
      const onlyOurRows = [...added, ...removed].length > 0 &&
        [...added, ...removed].every(n => n.classList?.contains('vke-chat-rule-item'));
      if (onlyOurRows) continue;

      // A notification-time submenu ("1 час / 1 день / навсегда") is also
      // an ActionsMenu, but it is NOT our chat menu. Never refresh the parent
      // menu merely because that submenu appeared or changed.
      const nativeChatMenuAdded = added.some(n => {
        if (n.matches?.('ul.ActionsMenu') && isNativeChatMenu(n)) return true;
        const nested = n.querySelector?.('ul.ActionsMenu');
        return !!nested && isNativeChatMenu(nested);
      });

      if (nativeChatMenuAdded) {
        scheduleMenuRefresh();
        break;
      }
    }
  });

  function start() {
    if (!document.body) return;
    installHoverStyle();
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once:true });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[KEY]) rules = normalize(changes[KEY].newValue);
    if (changes.vkeSettings || changes.vke_features_settings) scheduleMenuRefresh();
  });

  load().then(() => window.postMessage({ source:'vke-chat-rules', type:'RULES_UPDATED', rules }, '*'));
})();
