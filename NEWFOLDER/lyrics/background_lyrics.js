// clp/background_lyrics.js — сетевой слой для парсеров текстов.
// Service worker MV3. Прямой fetch к доменам из host_permissions идёт
// БЕЗ CORS (как same-origin), поэтому preflight не нужен.
// Прокси — аварийный fallback.
'use strict';

var TIMEOUT_DIRECT = 9000;
var TIMEOUT_PROXY  = 7000;

// Минимальные CORS-safe заголовки. НЕ ставим User-Agent / Cache-Control /
// Sec-Fetch-* / Accept-Encoding / Connection — они либо forbidden, либо
// триггерят preflight для доменов вне host_permissions.
var HEADERS = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
};

function fetchWithTimeout(url, options, timeoutMs) {
    options = options || {};
    var controller = new AbortController();
    var tid = setTimeout(function () { controller.abort(); }, timeoutMs || TIMEOUT_DIRECT);
    return fetch(url, Object.assign({}, options, { signal: controller.signal }))
        .finally(function () { clearTimeout(tid); });
}

// Живые прокси (corsproxy.io / thingproxy убраны — мёртвые / CORS-блок).
function getProxies(url) {
    var encoded = encodeURIComponent(url);
    return [
        { url: 'https://api.allorigins.win/raw?url=' + encoded, type: 'raw' },
        { url: 'https://api.codetabs.com/v1/proxy?quest=' + encoded, type: 'raw' },
        { url: 'https://api.allorigins.win/get?url=' + encoded, type: 'json' }
    ];
}

function isUsable(text) {
    return typeof text === 'string' && text.length > 0;
}

// useProxy оставлен для совместимости. Прямой запрос ВСЕГДА первый.
// Прокси — только если прямой не прошёл. НИКОГДА не отключаем прокси
// (это был баг, ломавший LRClib при useProxy=false).
async function fetchHTML(url, useProxy) {
    // ── 1. Прямой запрос (основной канал) ──
    try {
        var res = await fetchWithTimeout(url, { headers: HEADERS, redirect: 'follow' }, TIMEOUT_DIRECT);
        if (res && res.ok) {
            var html = await res.text();
            if (isUsable(html)) return html;
        }
    } catch (e) {
        // CORS / сеть / таймаут — пробуем прокси
    }

    // ── 2. Прокси (аварийный fallback, всегда доступен) ──
    var proxies = getProxies(url);
    var lastErr = null;
    for (var i = 0; i < proxies.length; i++) {
        var proxy = proxies[i];
        try {
            var res2 = await fetchWithTimeout(proxy.url, { headers: HEADERS }, TIMEOUT_PROXY);
            if (!res2 || !res2.ok) {
                lastErr = new Error('proxy HTTP ' + (res2 ? res2.status : '?'));
                continue;
            }
            var html2;
            if (proxy.type === 'json') {
                var data = await res2.json();
                html2 = (data && (data.contents != null ? data.contents : data.body)) || '';
            } else {
                html2 = await res2.text();
            }
            if (isUsable(html2)) return html2;
            lastErr = new Error('proxy empty body');
        } catch (e) {
            lastErr = e;
        }
    }

    throw lastErr || new Error('Все попытки запроса провалились: ' + url);
}

// ── Обработчик сообщений от parsers.js ──
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg && msg.type === 'CLP_FETCH_HTML') {
        fetchHTML(msg.url, msg.useProxy)
            .then(function (html) { sendResponse({ html: html }); })
            .catch(function (err) { sendResponse({ error: String((err && err.message) || err) }); });
        return true;
    }
});