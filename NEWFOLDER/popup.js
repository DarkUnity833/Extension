document.addEventListener('DOMContentLoaded', async () => {
  const authStatus = document.getElementById('authStatus');
  const authBtn = document.getElementById('authBtn');
  const clearDataBtn = document.getElementById('clearDataBtn');
  const deletedIndicatorSelect = document.getElementById('deletedIndicatorSelect');

  const toggles = {
    silentRead: document.getElementById('silentReadToggle'),
    silentWrite: document.getElementById('silentWriteToggle'),
    offline: document.getElementById('offlineToggle'),
    deletedMessages: document.getElementById('deletedMessagesToggle'),
    bombs: document.getElementById('bombsToggle'),
    editHistory: document.getElementById('editHistoryToggle'),
    cacheHistory: document.getElementById('cacheHistoryToggle')
  };

  const popupToggles = {
    popupNewMsg: document.getElementById('popupNewMsgToggle'),
    popupRead: document.getElementById('popupReadToggle'),
    popupTyping: document.getElementById('popupTypingToggle'),
    popupVoice: document.getElementById('popupVoiceToggle')
  };

  const FEATURE_KEY = 'vkeSettings';
  const NOTIFY_KEY = 'vke_features_settings';

  const DEFAULTS = {
    silentRead: true, silentWrite: true, offline: true,
    deletedMessages: true, bombs: true, editHistory: true,
    cacheHistory: true, hookBombs: true, nodeleteall: true,
    deletedIndicator: 'trash'
  };
  const NOTIFY_DEFAULTS = {
    enabled: {
      noRead: false,
      noTyping: false,
      partialOnline: false,
      showDeleted: true,
      saveBombs: true,
      popupNewMsg: true,
      popupRead: true,
      popupTyping: true,
      popupVoice: true
    }
  };

  async function loadSettings() {
    const [featureRes, notifyRes] = await Promise.all([
      chrome.storage.local.get([FEATURE_KEY]),
      chrome.storage.local.get([NOTIFY_KEY])
    ]);
    const settings = { ...DEFAULTS, ...(featureRes[FEATURE_KEY] || {}) };
    // Keep notification settings compatible with both old and new installs.

    Object.keys(toggles).forEach(key => {
      if (toggles[key]) toggles[key].checked = settings[key] !== false;
    });
    if (deletedIndicatorSelect) {
      deletedIndicatorSelect.value = ['trash','cross','text'].includes(settings.deletedIndicator)
        ? settings.deletedIndicator : 'trash';
    }

    const ns = {
      ...NOTIFY_DEFAULTS,
      ...(notifyRes[NOTIFY_KEY] || {}),
      enabled: { ...NOTIFY_DEFAULTS.enabled, ...((notifyRes[NOTIFY_KEY] || {}).enabled || {}) }
    };
    Object.keys(popupToggles).forEach(key => {
      if (popupToggles[key]) popupToggles[key].checked = ns.enabled[key] !== false;
    });
  }

  async function saveFeatureSettings() {
    const current = (await chrome.storage.local.get([FEATURE_KEY]))[FEATURE_KEY] || {};
    const settings = {
      ...DEFAULTS, ...current,
      silentRead: toggles.silentRead.checked,
      silentWrite: toggles.silentWrite.checked,
      offline: toggles.offline.checked,
      deletedMessages: toggles.deletedMessages.checked,
      bombs: toggles.bombs.checked,
      editHistory: toggles.editHistory.checked,
      cacheHistory: toggles.cacheHistory.checked,
      deletedIndicator: deletedIndicatorSelect?.value || 'trash',
      hookBombs: toggles.bombs.checked,
      nodeleteall: toggles.deletedMessages.checked
    };
    await chrome.storage.local.set({ [FEATURE_KEY]: settings });
  }

  async function saveNotifySettings() {
    const current = (await chrome.storage.local.get([NOTIFY_KEY]))[NOTIFY_KEY] || {};
    const enabled = { ...NOTIFY_DEFAULTS.enabled, ...(current.enabled || {}) };
    delete enabled.backgroundKeepAlive;
    delete enabled.popupCircle;
    delete enabled.popupMedia;
    Object.keys(popupToggles).forEach(key => {
      if (popupToggles[key]) enabled[key] = popupToggles[key].checked;
    });
    await chrome.storage.local.set({ [NOTIFY_KEY]: { ...NOTIFY_DEFAULTS, ...current, enabled } });

  }

  Object.values(toggles).forEach(toggle => toggle?.addEventListener('change', saveFeatureSettings));
  deletedIndicatorSelect?.addEventListener('change', saveFeatureSettings);
  Object.values(popupToggles).forEach(toggle => toggle?.addEventListener('change', saveNotifySettings));

  async function checkAuth() {
    let response = null;
    try { response = await chrome.runtime.sendMessage({ type:'AUTH_STATUS' }); } catch (_) {}
    // Fallback for an already authorized installation whose old background state
    // is not warm yet: a stored token is the same local auth signal used by VKE BG.
    let tokenPresent = !!response?.tokenPresent;
    if (!tokenPresent) {
      try {
        const local = await chrome.storage.local.get(['vkToken']);
        tokenPresent = !!local.vkToken;
      } catch (_) {}
    }
    if (tokenPresent || response?.authorized) {
      authStatus.textContent = '✅ Авторизован';
      authStatus.classList.add('authorized');
      authBtn.style.display = 'none';
    } else {
      authStatus.textContent = '❌ Не авторизован';
      authStatus.classList.remove('authorized');
      authBtn.style.display = 'block';
    }
  }

  authBtn.addEventListener('click', async () => {
    authBtn.disabled=true; authBtn.textContent='⏳ Авторизация...';
    try {
      const response=await chrome.runtime.sendMessage({type:'AUTH_START'});
      if (response?.success) await checkAuth();
      else alert('Ошибка авторизации: ' + (response?.error || 'Неизвестно'));
    } catch (e) { alert('Ошибка: '+e.message); }
    finally { authBtn.disabled=false; authBtn.textContent='🔑 Авторизоваться (Kate Mobile)'; }
  });

  clearDataBtn.addEventListener('click', async e => {
    e.preventDefault();
    if (!confirm('Удалить все сохранённые данные (историю, удалённые сообщения, правила и уведомления)?')) return;
    await chrome.storage.local.remove([
      'VKNDeletedMessages','VKNExpiredMessages','StorageMessages',
      'vke_notification_history_v1','vke_notify_dedupe_v1','vke_chat_rules_v1'
    ]);
    alert('Данные очищены');
  });

  await loadSettings();
  await checkAuth();
});
