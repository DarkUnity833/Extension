// vkefeatures/background_keepalive.js

const VK_IM_URL = 'https://vk.ru/im';
const LOGIN_URL_RE = /\/\/(login|id)\.vk\.(ru|com)|\/login(\?|$)/i;

const HEARTBEAT_ALARM = 'vke_im_window_heartbeat';
const STATE_KEY = 'vke_hidden_window_id';
const SETTINGS_KEY = 'vke_features_settings';

async function isKeepAliveEnabled() {
  const res = await chrome.storage.local.get([SETTINGS_KEY]);
  const s = res[SETTINGS_KEY] || {};
  return s.enabled?.backgroundKeepAlive !== false; // дефолт = true
}

// -------- Инициализация --------
chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

const VK_TAB_URL_PATTERNS = ["https://vk.com/*", "https://*.vk.com/*", "https://vk.ru/*", "https://*.vk.ru/*"];

async function init() {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
  // НЕ создаём окно сразу при старте браузера — оно должно появляться только
  // после того, как пользователь реально открыл сайт ВК. Исключение: если
  // сессия браузера восстановила уже открытую вкладку vk.ru/vk.com при
  // старте — это тоже считается "сайт уже открыт".
  if (!(await isKeepAliveEnabled())) return;
  const existingVkTabs = await chrome.tabs.query({ url: VK_TAB_URL_PATTERNS });
  if (existingVkTabs.length > 0) {
    await ensureHiddenImWindow();
  }
}

// Открываем фоновое окно в момент, когда пользователь впервые за эту сессию
// браузера заходит на любую страницу ВК — не раньше.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading' && changeInfo.status !== 'complete') return;
  const url = changeInfo.url || tab.url || '';
  if (!/^https:\/\/(?:[\w-]+\.)?vk\.(ru|com)\//.test(url)) return;
  if (!(await isKeepAliveEnabled())) return;
  await ensureHiddenImWindow();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== HEARTBEAT_ALARM) return;
  if (await isKeepAliveEnabled()) {
    await ensureHiddenImWindow();
    await checkAuthState();
  } else {
    await closeHiddenImWindow();
  }
});

// -------- Создание/удаление окна --------
let creatingWindow = false;

async function ensureHiddenImWindow() {
  if (creatingWindow) return;

  const { [STATE_KEY]: savedId } = await chrome.storage.local.get(STATE_KEY);

  if (savedId != null) {
    try {
      await chrome.windows.get(savedId);
      return; // живо
    } catch (e) {
      await chrome.storage.local.remove(STATE_KEY);
    }
  }

  creatingWindow = true;
  try {
    // ВАЖНО: type:'normal' — только в normal-окнах Chrome инжектирует content scripts.
    // type:'popup' content scripts не получает, поэтому typing_read_watch там не работал.
    // Прячем окно размером 1x1 в угол экрана — пользователь не видит, но вкладка полноценная.
    const win = await chrome.windows.create({
      url: VK_IM_URL,
      type: 'normal',
      focused: false,
      width: 1,
      height: 1,
      left: -10,
      top: -10
    });
    await chrome.storage.local.set({ [STATE_KEY]: win.id });
    console.log('[VKE BG] Hidden IM window created (normal):', win.id);
  } catch (e) {
    console.error('[VKE BG] Cannot create hidden window:', e);
  } finally {
    creatingWindow = false;
  }
}

async function closeHiddenImWindow() {
  const { [STATE_KEY]: savedId } = await chrome.storage.local.get(STATE_KEY);
  if (savedId == null) return;
  try { await chrome.windows.remove(savedId); } catch (e) {}
  await chrome.storage.local.remove(STATE_KEY);
}

// Если окно закрыл пользователь — пересоздаём (если опция включена)
chrome.windows.onRemoved.addListener(async (windowId) => {
  const { [STATE_KEY]: savedId } = await chrome.storage.local.get(STATE_KEY);
  if (savedId !== windowId) return;
  await chrome.storage.local.remove(STATE_KEY);
  if (await isKeepAliveEnabled()) {
    await ensureHiddenImWindow();
  }
});

// -------- Команды от popup (тумблер) --------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'VKE_BG_ENABLE') {
    ensureHiddenImWindow().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'VKE_BG_DISABLE') {
    closeHiddenImWindow().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// -------- Детекция авторизации (бейдж !) --------
async function checkAuthState() {
  const { [STATE_KEY]: savedId } = await chrome.storage.local.get(STATE_KEY);
  if (savedId == null) { updateBadge(false); return; }

  let tabs;
  try { tabs = await chrome.tabs.query({ windowId: savedId }); } catch (e) { return; }
  const tab = tabs[0];
  if (!tab) return;

  updateBadge(LOGIN_URL_RE.test(tab.url || ''));
}

function updateBadge(needsAuth) {
  if (needsAuth) {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#e64646' });
    chrome.action.setTitle({ title: 'VKE — нужно войти в фоновом окне ВК' });
  } else {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'VKE' });
  }
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== 'complete') return;
  const { [STATE_KEY]: savedId } = await chrome.storage.local.get(STATE_KEY);
  if (savedId == null || tab.windowId !== savedId) return;
  await checkAuthState();
});