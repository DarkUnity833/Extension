// deleted_edited_ui.js — MAIN world
(() => {
    if (window.__vkeDeletedEditedUiInit) return;
    window.__vkeDeletedEditedUiInit = true;
    console.log('[VKE UI] deleted_edited_ui.js starting...');

    let reqCounter = 0;
    const pending = new Map();

    function bridgeCall(type, payload) {
        return new Promise((resolve) => {
            const requestId = `r${++reqCounter}`;
            pending.set(requestId, resolve);
            window.postMessage({ source: 'vke-main', type, payload, requestId }, '*');
            setTimeout(() => { if (pending.has(requestId)) { pending.delete(requestId); resolve(null); } }, 8000);
        });
    }

    window.addEventListener('message', (e) => {
        if (e.source !== window) return;
        const d = e.data;
        if (!d || d.source !== 'vke-bridge') return;

        if (d.requestId && pending.has(d.requestId)) {
            pending.get(d.requestId)(d.response);
            pending.delete(d.requestId);
            return;
        }

        if (d.type === 'VKE_MESSAGE_DELETED') handleDeletedEvent(d.payload);
        else if (d.type === 'VKE_MESSAGE_EDITED') handleEditedEvent(d.payload);
        else if (d.type === 'VKE_MESSAGE_RESTORED') handleRestoredEvent(d.payload);
        else if (d.type === 'SETTINGS_UPDATED' && d.settings) uiSettings = { ...uiSettings, ...d.settings };
    });

    function getPeerId() {
        let m = location.pathname.match(/\/(?:im\/convo|convo)\/(-?\d+)/);
        if (m) return m[1];
        m = location.search.match(/[?&]sel=(-?\d+)/);
        if (m) return m[1];
        return null;
    }

    function getFiber(el) {
        for (const key of Object.keys(el)) {
            if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) return el[key];
        }
        return null;
    }

    function extractMessageFromFiber(fiber) {
        let current = fiber, depth = 0;
        while (current && depth < 50) {
            const props = current.memoizedProps || current.pendingProps;
            const raw = props?.message || props?.msg;
            const nested = raw?.message || raw?.msg;
            const candidate = (raw && typeof raw === 'object') ? raw : nested;
            if (candidate && typeof candidate === 'object') {
                const cmid = candidate.cmid ?? candidate.conversation_message_id ?? candidate.conversationMessageId;
                if (cmid !== undefined && cmid !== null) {
                    return { raw: candidate, cmid, messageId: candidate.id ?? candidate.message_id, peerId: candidate.peerId ?? candidate.peer_id };
                }
            }
            current = current.return;
            depth++;
        }
        return null;
    }


    // ---- Context-menu history -------------------------------------------------
    let contextMessage = null;
    let contextPoint = { x: 0, y: 0 };
    let historyMenuTimers = [];
    let uiSettings = { editHistory: true };

    function findMessageContext(target) {
        const path = typeof target?.composedPath === 'function' ? target.composedPath() : [];
        const candidates = [];
        for (const node of path) if (node?.nodeType === 1) candidates.push(node);
        let node = target?.nodeType === 1 ? target : target?.parentElement;
        while (node) {
            candidates.push(node);
            if (node === document.body) break;
            node = node.parentElement;
        }

        const seen = new Set();
        for (const el of candidates) {
            if (!el || seen.has(el)) continue;
            seen.add(el);
            const possible = [];
            if (el.matches?.('.ConvoMessage, .ConvoMessageWithoutBubble')) possible.push(el);
            for (const q of el.querySelectorAll?.('.ConvoMessage, .ConvoMessageWithoutBubble') || []) possible.push(q);
            for (const msgEl of possible) {
                try {
                    const fiber = getFiber(msgEl);
                    const info = fiber ? extractMessageFromFiber(fiber) : null;
                    if (info?.cmid != null) {
                        return { peerId: info.peerId ?? getPeerId(), cmid: String(info.cmid), messageId: info.messageId ?? null, element: msgEl };
                    }
                } catch (_) {}

                // React Fiber can be absent while the native menu is opening.
                // Keep a deterministic DOM fallback for current VK builds.
                const rawCmid = msgEl.getAttribute?.('data-cmid') ||
                  msgEl.getAttribute?.('data-conversation-message-id') ||
                  msgEl.closest?.('[data-cmid]')?.getAttribute?.('data-cmid') ||
                  msgEl.closest?.('[data-item]')?.getAttribute?.('data-item');
                if (rawCmid && /^\d+$/.test(String(rawCmid))) {
                    return { peerId: getPeerId(), cmid: String(rawCmid), messageId: null, element: msgEl };
                }
            }
        }
        return null;
    }

    function clearHistoryMenuTimers() {
        for (const timer of historyMenuTimers) clearTimeout(timer);
        historyMenuTimers = [];
    }

    function cleanupHistoryMenuItem() {
        document.querySelectorAll('.vke-context-history-item').forEach((node) => node.remove());
    }

    function actualActionMenu(root) {
        if (!root) return null;
        if (root.matches?.('ul.ActionsMenu, [role="menu"]')) {
            return root.matches?.('ul.ActionsMenu') ? root : (root.querySelector?.('ul.ActionsMenu') || root);
        }
        return root.querySelector?.('ul.ActionsMenu') || root.querySelector?.('[role="menu"]') || null;
    }

    function isHistoryHost(el) {
        return !!el?.querySelector?.('[role="menuitem"],button,.ActionsMenuAction');
    }

    function isMessageActionMenu(menu) {
        if (!menu) return false;
        const text = (menu.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        // Chat-list menu must never receive the message-history action.
        if (/отметить непрочитанным.*закрепить чат|закрепить чат.*архивировать/.test(text) &&
            !/ответить|переслать|копировать текст|пожаловаться|\bвыбрать\b|\bудалить\b/.test(text)) return false;
        return /ответить|переслать|копировать текст|пожаловаться|\bвыбрать\b|\bудалить\b/.test(text);
    }

    function menuVisible(root) {
        if (!root || !root.isConnected) return false;
        const s = getComputedStyle(root);
        const r = root.getBoundingClientRect?.();
        return s.display !== 'none' && s.visibility !== 'hidden' && !!r && r.width > 100 && r.height > 20;
    }

    function findBestMenu() {
        const direct = document.querySelectorAll('ul.ActionsMenu');
        const candidates = [];
        for (const ul of direct) {
            if (menuVisible(ul)) candidates.push(ul);
        }
        if (!candidates.length) {
            const roleMenus = document.querySelectorAll('[role="menu"]');
            for (const n of roleMenus) if (menuVisible(n)) {
                const ul = n.querySelector?.('ul.ActionsMenu');
                candidates.push(ul && menuVisible(ul) ? ul : n);
            }
        }
        if (!candidates.length) return null;

        candidates.sort((a,b) => {
            const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
            const da = Math.hypot((ar.left+ar.width/2)-contextPoint.x, (ar.top+ar.height/2)-contextPoint.y);
            const db = Math.hypot((br.left+br.width/2)-contextPoint.x, (br.top+br.height/2)-contextPoint.y);
            return da-db;
        });
        return candidates[0];
    }

    function startHistoryMenuWatch() {
        clearHistoryMenuTimers();
        if (!contextMessage || !stateHasEditHistory()) return;

        const tryInject = () => {
            if (!contextMessage || !stateHasEditHistory()) return;
            const menu = findBestMenu();
            if (!menu || !isHistoryHost(menu)) return;
            makeHistoryMenuItem(menu);
        };
        requestAnimationFrame(tryInject);
        setTimeout(tryInject, 40);
        setTimeout(tryInject, 120);
    }

    function captureMessageContext(e) {
        if (e?.button != null && e.button !== 2) return;
        const msg = findMessageContext(e.target);
        if (!msg) return;
        contextMessage = msg;
        contextPoint = { x: e.clientX, y: e.clientY };
    }

    function onContextMenu(e) {
        const msg = findMessageContext(e.target);
        contextPoint = { x: e.clientX, y: e.clientY };
        if (!msg) {
            contextMessage = null;
            clearHistoryMenuTimers();
            return;
        }
        contextMessage = msg;
        startHistoryMenuWatch();
    }

    function makeHistoryMenuItem(menu) {
        if (!menu || !contextMessage || !stateHasEditHistory()) return;
        const actionMenu = actualActionMenu(menu);
        if (!actionMenu || !isMessageActionMenu(actionMenu) || actionMenu.querySelector('.vke-context-history-item')) return;

        const template = Array.from(actionMenu.querySelectorAll('button[role="menuitem"], .ActionsMenuAction')).find(el => {
            const t = (el.textContent || '').trim().toLowerCase();
            return t && !/^закрыть$/.test(t);
        });
        if (!template) return;

        const item = template.cloneNode(true);
        item.classList.add('vke-context-history-item');
        item.dataset.vkeHistoryCmid = String(contextMessage.cmid);
        item.removeAttribute('style');
        item.setAttribute('aria-label', 'История редактирования');
        item.setAttribute('tabindex', '0');
        item.type = 'button';
        item.innerHTML = '<i class="ActionsMenuAction__icon"><span aria-hidden="true">🕘</span></i><span class="ActionsMenuAction__title">История редактирования</span>';

        const icon = item.querySelector('.ActionsMenuAction__icon');
        if (icon) {
            icon.style.fontSize = '16px';
            icon.style.display = 'inline-flex';
            icon.style.alignItems = 'center';
            icon.style.justifyContent = 'center';
        }

        const activate = (ev) => {
            ev?.preventDefault?.();
            ev?.stopPropagation?.();
            ev?.stopImmediatePropagation?.();
            const msg = contextMessage;
            clearHistoryMenuTimers();
            setTimeout(() => openHistoryDialog(msg), 0);
        };
        item.addEventListener('click', activate, true);
        item.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') activate(ev); }, true);

        const closeNode = Array.from(actionMenu.querySelectorAll('[role="menuitem"]')).find(el => {
            const t = (el.getAttribute('aria-label') || el.textContent || '').trim();
            return /^закрыть$/i.test(t) && el.closest('.vkuiVisuallyHidden__host');
        });
        if (closeNode) actionMenu.insertBefore(item, closeNode.closest('span') || closeNode);
        else actionMenu.appendChild(item);
    }

    function stateHasEditHistory() {
        return uiSettings.editHistory !== false;
    }

    function formatHistoryDate(value) {
        const n = Number(value);
        const ms = n > 1e12 ? n : n * 1000;
        const d = new Date(ms);
        if (!Number.isFinite(d.getTime())) return '';
        return d.toLocaleString('ru-RU', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    async function openHistoryDialog(info) {
        if (!info?.peerId || info.cmid == null) return;

        let versions = await bridgeCall('GET_MESSAGE_VERSIONS', {
            peerId: info.peerId,
            cmid: info.cmid
        });
        if (!Array.isArray(versions)) versions = [];
        if (!versions.length) {
            const cached = await bridgeCall('GET_CACHED_MESSAGE', { peerId: info.peerId, cmid: info.cmid });
            if (Array.isArray(cached?.versions)) versions = cached.versions;
            else if (Array.isArray(cached?.edits) && cached.edits.length) {
                versions = cached.edits.map(v => ({ text:v?.text || '', date:v?.date || 0 }));
                if (cached?.text != null) versions.push({ text:cached.text, date:cached.lastEditedAt || cached.date || 0 });
            }
        }

        document.querySelector('.vke-history-backdrop')?.remove();

        const backdrop = document.createElement('div');
        backdrop.className = 'vke-history-backdrop';
        backdrop.style.cssText = [
            'position:fixed','inset:0','z-index:2147483646',
            'display:flex','align-items:center','justify-content:center',
            'background:rgba(0,0,0,.45)','padding:20px','box-sizing:border-box'
        ].join(';');

        const dialog = document.createElement('div');
        dialog.className = 'vke-history-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.style.cssText = [
            'width:min(560px,92vw)','max-height:80vh','overflow:auto',
            'background:var(--vkui--color_background_modal,#202124)',
            'color:var(--vkui--color_text_primary,#fff)',
            'border-radius:14px','box-shadow:0 18px 60px rgba(0,0,0,.45)',
            'padding:18px','box-sizing:border-box'
        ].join(';');

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;';
        const title = document.createElement('div');
        title.textContent = 'История редактирования';
        title.style.cssText = 'font-size:18px;font-weight:600;';
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = '✕';
        close.setAttribute('aria-label', 'Закрыть');
        close.style.cssText = 'border:0;background:transparent;color:inherit;cursor:pointer;font-size:18px;padding:6px 8px;border-radius:8px;';
        close.onclick = () => backdrop.remove();
        header.append(title, close);

        const body = document.createElement('div');
        if (!versions.length) {
            const empty = document.createElement('div');
            empty.textContent = 'История пока не сохранена.';
            empty.style.cssText = 'padding:18px 4px;opacity:.7;';
            body.appendChild(empty);
        } else {
            versions.forEach((version, index) => {
                const row = document.createElement('div');
                row.style.cssText = 'padding:12px 0;border-top:1px solid rgba(255,255,255,.08);';
                const meta = document.createElement('div');
                meta.textContent = `${index + 1}. ${formatHistoryDate(version?.date)}`.trim();
                meta.style.cssText = 'font-size:12px;opacity:.58;margin-bottom:6px;';
                const text = document.createElement('div');
                text.textContent = version?.text ?? '';
                text.style.cssText = 'font-size:14px;line-height:1.4;white-space:pre-wrap;overflow-wrap:anywhere;';
                row.append(meta, text);
                body.appendChild(row);
            });
        }

        dialog.append(header, body);
        backdrop.appendChild(dialog);
        backdrop.addEventListener('click', (ev) => {
            if (ev.target === backdrop) backdrop.remove();
        });
        document.body.appendChild(backdrop);
    }

    document.addEventListener('pointerdown', captureMessageContext, true);
    document.addEventListener('mousedown', captureMessageContext, true);
    document.addEventListener('contextmenu', onContextMenu, true);

    const menuObserver = new MutationObserver((mutations) => {
        if (!contextMessage || !stateHasEditHistory()) return;
        for (const m of mutations) {
            if (m.addedNodes?.length) {
                const hasMenu = Array.from(m.addedNodes).some(n => n.nodeType === 1 && (n.matches?.('ul.ActionsMenu, [role="menu"]') || n.querySelector?.('ul.ActionsMenu')));
                if (hasMenu) {
                    setTimeout(() => {
                        const menu = findBestMenu();
                        if (menu && isMessageActionMenu(actualActionMenu(menu))) makeHistoryMenuItem(menu);
                    }, 0);
                    break;
                }
            }
        }
    });
    try {
        menuObserver.observe(document.documentElement, { childList: true, subtree: true });
    } catch (_) {}

    // Clean up history items that may have been left in message rows by an
    // older version. The history action itself remains available in the real
    // context menu when the user opens it.
    document.querySelectorAll('.vke-context-history-item').forEach((node) => node.remove());
    bridgeCall('GET_SETTINGS').then((settings) => {
        if (settings && typeof settings === 'object') uiSettings = { ...uiSettings, ...settings };
    });

    function normalizeNativeEditedLabels(root = document) {
        const nodes = root.querySelectorAll?.('.ConvoMessageWithoutBubble__editedLabel, [class*="ConvoMessageWithoutBubble__editedLabel"]') || [];
        for (const node of nodes) {
            const text = (node.textContent || '').trim();
            if (text !== '(ред.)' && text !== 'ред.' && text !== 'изменено') continue;

            node.textContent = '(ред.)';
            node.setAttribute('title', 'Изменено');

            node.classList.add('vke-edited-label-right');
            node.style.setProperty('display', 'inline', 'important');
            node.style.setProperty('text-align', 'inherit', 'important');
            node.style.setProperty('margin', '0', 'important');
            node.style.setProperty('padding', '0', 'important');
            node.style.setProperty('white-space', 'nowrap', 'important');
            // The content renderer owns the two-column deleted-message status
            // layout. Do not move the native label here or it can fight React.
            const infoBlock = node.closest('.ConvoMessageBottomInfo, .ConvoMessage__info, .ConvoMessageInfoWithoutBubbles, .ConvoMessageInfo');
            if (infoBlock?.classList.contains('vke-message-status-line')) return;
        }
    }

    function findMessageElement(peerId, cmid) {
        const elements = document.querySelectorAll('.ConvoMessage, .ConvoMessageWithoutBubble');
        for (const el of elements) {
            const fiber = getFiber(el);
            if (!fiber) continue;
            const msg = extractMessageFromFiber(fiber);
            if (msg && String(msg.cmid) === String(cmid) && (msg.peerId === undefined || String(msg.peerId) === String(peerId))) {
                return el;
            }
        }
        return null;
    }

    function markIcon(el, kind, title) {
        const infoBlock = el.querySelector('.ConvoMessageBottomInfo, .ConvoMessage__info, .ConvoMessageInfoWithoutBubbles, .ConvoMessageInfo');
        if (!infoBlock) return;

        // Deleted/bomb status is rendered by content.js in the native VK row.
        // Do not create another marker here — doing so produced a duplicate
        // "Удаленное сообщение" label and pushed the timestamp out of place.
        if (kind === 'deleted' || kind === 'bomb') {
            infoBlock.querySelectorAll('.vke-deleted-marker, .vke-bomb-marker, .vke-native-deleted-marker').forEach(node => node.remove());
            return;
        }

        // VK already renders the native '(ред.)' label. Replace only its
        // text so the native layout, timestamp and history placement remain intact.
        normalizeNativeEditedLabels(infoBlock);
    }

    function handleDeletedEvent(payload) {
        const { peer_id: peerId, cmid, text, is_bomb } = payload;
        
        // Сначала пытаемся найти элемент в DOM
        const el = findMessageElement(peerId, cmid);
        
        if (el) {
            markIcon(el, is_bomb ? 'bomb' : 'deleted', text || undefined);
            
            // Попытка восстановить текст, если он скрыт
            const textEl = el.querySelector('.MessageText, .ConvoMessage__text');
            if (textEl && text && (textEl.innerText.includes('удалено') || textEl.innerText.trim() === '')) {
                 textEl.innerText = text;
            }
        } else {
            // Если элемента нет в DOM (например, мы проскроллили вверх), 
            // мы НЕ создаем сноски внизу, чтобы не ломать верстку.
            // Сообщение просто останется "удаленным" в памяти, и когда пользователь до него доскроллит,
            // MutationObserver в content.js или повторный вызов обработчика его пометит.
            console.log('[VKE UI] Сообщение не найдено в DOM (возможно, вне экрана):', cmid);
        }
    }

    function handleRestoredEvent(payload) {
        const { cmid } = payload;
        // Убираем маркеры, если сообщение восстановлено
        const el = findMessageElement(getPeerId(), cmid);
        if (el) {
            el.style.opacity = '1';
            el.style.filter = 'none';
            el.querySelector('.vke-deleted-marker, .vke-bomb-marker')?.remove();
        }
    }

    async function handleEditedEvent(payload) {
        const { peer_id: peerId, cmid, versionsCount } = payload;
        const el = findMessageElement(peerId, cmid);
        if (el) {
            markIcon(el, 'edited', `Отредактировано (версий: ${versionsCount})`);
            normalizeNativeEditedLabels(el);
        }
    }

    // Keep VK's native edited label stable after React re-renders.
    const editedLabelObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.type !== 'childList' && m.type !== 'characterData') continue;
            const target = m.target?.nodeType === 1 ? m.target : m.target?.parentElement;
            if (target) normalizeNativeEditedLabels(target);
        }
    });
    try {
        editedLabelObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    } catch (_) {}
    normalizeNativeEditedLabels(document);



        console.log('[VKE UI] deleted_edited_ui.js loaded');
})();