// clp/parsers.js — парсеры текстов песен (изолированный мир content-script)
// Загружается ДО content.js (см. manifest.json). Экспортирует window.CLP_PARSERS.
(function () {
'use strict';

// ─── Сетевой слой ────────────────────────────────────────────────────────────
function fetchHTML(url, useProxy) {
    useProxy = useProxy || false;
    return new Promise(function (resolve, reject) {
        chrome.runtime.sendMessage({ type: 'CLP_FETCH_HTML', url: url, useProxy: useProxy }, function (response) {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            if (!response) return reject(new Error('Нет ответа от background'));
            if (response.error) return reject(new Error(response.error));
            resolve(response.html);
        });
    });
}

function parseDoc(html) {
    // Удаляем <base>, чтобы не триггерить CSP "base-uri 'self'" в content script
    html = html.replace(/<base[^>]*>/gi, '');
    return new DOMParser().parseFromString(html, 'text/html');
}

// ─── Чистка текста ───────────────────────────────────────────────────────────
function cleanLyrics(text) {
    return text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\t/g, ' ')
        .replace(/[ ]{3,}/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{4,}/g, '\n\n\n')
        .trim();
}

function extractText(el) {
    var BLOCK = /^(div|p|li|tr|section|article|h[1-6]|header|footer|pre)$/;
    function walk(node, out) {
        if (node.nodeType === 3) { out.push(node.nodeValue); return; }
        if (node.nodeType !== 1) return;
        var tag = node.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'noscript') return;
        if (tag === 'br') { out.push('\n'); return; }
        var isBlock = BLOCK.test(tag);
        if (isBlock) out.push('\n');
        for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i], out);
        if (isBlock) out.push('\n');
    }
    var parts = [];
    walk(el, parts);
    return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

function plainLines(text) {
    return cleanLyrics(text).split('\n').map(function (t) {
        return { time: 0, text: t };
    });
}

// ─── Детект Cloudflare / блокировки ──────────────────────────────────────────
function isBlockedPage(html) {
    return /just a moment|challenge-platform|attention required|cf-challenge|access denied|403 forbidden|cloudflare|verify you are human/i.test(html);
}

// ─── DuckDuckGo: универсальный поиск ссылок ──────────────────────────────────
async function ddgSearchLinks(query, domainFilter) {
    var url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
    var raw = await fetchHTML(url, true);
    var doc = parseDoc(raw);
    var out = [];
    var anchors = Array.from(doc.querySelectorAll('a[href]'));
    for (var i = 0; i < anchors.length; i++) {
        var href = anchors[i].getAttribute('href') || '';
        var m = href.match(/uddg=([^&]+)/);
        if (m) href = decodeURIComponent(m[1]);
        if (!/^https?:\/\//i.test(href)) continue;
        if (domainFilter && href.indexOf(domainFilter) === -1) continue;
        if (out.indexOf(href) === -1) out.push(href);
    }
    return out;
}

// ─── Релевантность (чтобы Genius не отдавал чужой текст) ─────────────────────
function normalizeForCompare(s) {
    return (s || '').toLowerCase()
        .replace(/\(.*?\)|\[.*?\]/g, ' ')
        .replace(/\b(feat|ft|featuring|prod|by)\b.*/i, ' ')
        .replace(/[^a-zа-яё0-9]+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function relevanceScore(query, candidate) {
    var qWords = normalizeForCompare(query).split(' ').filter(function (w) { return w.length >= 2; });
    var cNorm = ' ' + normalizeForCompare(candidate) + ' ';
    if (!qWords.length) return 0;
    var matched = 0;
    for (var i = 0; i < qWords.length; i++) {
        if (cNorm.indexOf(qWords[i]) !== -1) matched++;
    }
    return matched / qWords.length;
}

// ─── Чистка текста Genius ────────────────────────────────────────────────────
// Убирает: "N Contributors", "X Lyrics", "[Текст песни «...»]", "[Songtext ...]",
// блок "Translations" + названия языков, "Embed", "You might also like".
// Секционные теги ([Hook], [Verse 1], [Припев]) остаются.
var GENIUS_LANGS = {
    'english': 1, 'español': 1, 'espanol': 1, 'deutsch': 1, 'german': 1,
    'français': 1, 'francais': 1, 'french': 1, 'italiano': 1, 'italian': 1,
    'português': 1, 'portugues': 1, 'portuguese': 1, 'русский': 1, 'russian': 1,
    '日本語': 1, 'japanese': 1, '한국어': 1, 'korean': 1, '中文': 1, 'chinese': 1,
    'türkçe': 1, 'turkce': 1, 'turkish': 1, 'polski': 1, 'polish': 1,
    'nederlands': 1, 'dutch': 1, 'svenska': 1, 'swedish': 1, 'norsk': 1,
    'norwegian': 1, 'dansk': 1, 'danish': 1, 'suomi': 1, 'finnish': 1,
    'ελληνικά': 1, 'greek': 1, 'čeština': 1, 'czech': 1, 'magyar': 1,
    'hungarian': 1, 'română': 1, 'romanian': 1, 'български': 1, 'bulgarian': 1,
    'українська': 1, 'ukrainian': 1, 'עברית': 1, 'hebrew': 1, 'العربية': 1,
    'arabic': 1, 'हिन्दी': 1, 'hindi': 1, 'ไทย': 1, 'thai': 1,
    'tiếng việt': 1, 'vietnamese': 1, 'bahasa indonesia': 1, 'indonesian': 1,
    'bahasa melayu': 1, 'malay': 1, 'filipino': 1, 'tagalog': 1
};

function cleanGeniusText(text, title) {
    var lines = text.split('\n');
    var normTitle = (title || '').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').trim();
    var titleWords = normTitle.split(' ').filter(function (w) { return w.length >= 3; });

    function isMetaTag(t) {
        if (!/^\[.*\]$/.test(t)) return false;
        if (/(текст песни|songtext|\blyrics\b|paroles|letra|testo|tekst|sözleri|lirik|перевод|translation)/i.test(t)) return true;
        if (titleWords.length) {
            var hit = 0;
            for (var i = 0; i < titleWords.length; i++) {
                if (t.toLowerCase().indexOf(titleWords[i]) !== -1) hit++;
            }
            if (hit >= Math.max(1, Math.ceil(titleWords.length / 2))) return true;
        }
        return false;
    }
    function isLangLine(s) {
        return GENIUS_LANGS.hasOwnProperty(s.toLowerCase().trim());
    }

    // 1) Обрезаем блок "Translations" (обычно в конце) — всё от этой строки до конца
    var cutIndex = -1;
    for (var i = 0; i < lines.length; i++) {
        if (/^\d*\s*Translations?\s*$/i.test(lines[i].trim())) { cutIndex = i; break; }
    }
    if (cutIndex !== -1) lines = lines.slice(0, cutIndex);

    // 2) Построчно удаляем мусор
    var out = [];
    for (var j = 0; j < lines.length; j++) {
        var s = lines[j].trim();
        if (!s) { out.push(lines[j]); continue; }
        if (/^\d+\s+Contributors?$/i.test(s)) continue;
        if (/^Embed$/i.test(s)) continue;
        if (/^\d+\s*Embed$/i.test(s)) continue;
        if (/^You might also like/i.test(s)) continue;
        if (/^More on Genius/i.test(s)) continue;
        if (/^\d*\s*Translations?\s*$/i.test(s)) continue;
        if (isLangLine(s)) continue;
        if (isMetaTag(s)) continue;
        // заголовок "X Lyrics" — только в первых 10 строках
        if (j < 10 && /\bLyrics\s*$/i.test(s) && s.length <= 120) continue;
        out.push(lines[j]);
    }
    while (out.length && !out[0].trim()) out.shift();
    while (out.length && !out[out.length - 1].trim()) out.pop();
    return out.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
//  ПАРСЕРЫ
// ═══════════════════════════════════════════════════════════════════════════
var PARSERS = {};

// ─── 1. LRClib (публичный API, без токена) ───────────────────────────────────
PARSERS.lrclib = async function (title, artist) {
    var url = 'https://lrclib.net/api/get?artist_name=' + encodeURIComponent(artist) +
              '&track_name=' + encodeURIComponent(title);
    var raw = await fetchHTML(url);
    var data;
    try { data = JSON.parse(raw); } catch (e) { throw new Error('LRCLIB: некорректный ответ'); }
    var text = data.syncedLyrics || data.plainLyrics;
    if (!text) throw new Error('LRCLIB: текст не найден');
    var hasTimestamps = /\[\d{2}:\d{2}\.\d{2,3}\]/.test(text);
    if (hasTimestamps && data.syncedLyrics) {
        var lines = [];
        var lrcRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/g;
        var match;
        while ((match = lrcRegex.exec(text)) !== null) {
            var minutes = parseInt(match[1], 10);
            var seconds = parseInt(match[2], 10);
            var centis  = parseInt(match[3].padEnd(3, '0'), 10);
            var time    = minutes * 60 + seconds + centis / 1000;
            var lineText = match[4].trim();
            if (lineText) lines.push({ time: time, text: lineText });
        }
        if (lines.length > 0) return { lines: lines, hasTimestamps: true };
    }
    return { lines: plainLines(text), hasTimestamps: false };
};

// ─── 2. Genius (сбор кандидатов + релевантность + робастное извлечение) ──────
PARSERS.genius = async function (title, artist) {
    var query = (artist + ' ' + title).trim();
    var candidates = [];

    function isLyricsHref(href) {
        if (!href) return false;
        try {
            var u = /^https?:\/\//i.test(href) ? new URL(href) : new URL(href, 'https://genius.com');
            if (u.hostname && !/genius\.com$/i.test(u.hostname)) return false;
            var p = u.pathname;
            return /-lyrics\/?$/.test(p) && p !== '/' && !/\/search\/?$/i.test(p);
        } catch (e) { return false; }
    }
    function absGenius(href) {
        if (!href) return null;
        if (/^https?:\/\//i.test(href)) return href;
        if (href.charAt(0) === '/') return 'https://genius.com' + href;
        return null;
    }
    function addCandidate(href) {
        var abs = absGenius(href);
        if (abs && isLyricsHref(abs) && candidates.indexOf(abs) === -1) candidates.push(abs);
    }
    function urlText(href) {
        try {
            var u = new URL(href);
            return u.pathname.replace(/^-+/, '').replace(/-lyrics\/?$/, '').replace(/-/g, ' ');
        } catch (e) { return ''; }
    }

    // Робастное извлечение текста со страницы песни
    async function extractFromSongPage(songUrl) {
        var page = await fetchHTML(songUrl, true);
        if (isBlockedPage(page) && !/data-lyrics-container|Lyrics__Container|lyrics/i.test(page)) {
            throw new Error('Genius: страница закрыта Cloudflare');
        }
        var doc = parseDoc(page);

        // Пробуем разные селекторы (Genius меняет вёрстку)
        var selectors = [
            '[data-lyrics-container="true"]',
            '.lyrics',
            '.song_body-lyrics',
            '[class*="Lyrics__Container"]',
            '[class*="lyrics__content"]',
            '#lyrics',
            '.Lyrics__Container-sc-1ynbvzw-1',
            '[class^="Lyrics__Container"]',
            '[class*="SongPage__Container"] [class*="Lyrics"]',
            'div[class*="Lyrics"]'
        ];
        var nodes = [];
        for (var i = 0; i < selectors.length; i++) {
            try {
                var found = doc.querySelectorAll(selectors[i]);
                if (found && found.length) { nodes = Array.from(found); break; }
            } catch (e) { /* невалидный селектор — пропускаем */ }
        }

        var text = '';
        if (nodes.length) {
            nodes.forEach(function (c) { text += extractText(c) + '\n'; });
        }

        // Эвристический fallback: ищем блок с большим количеством коротких строк
        // (текст песни = много коротких строк, а не один длинный абзац)
        if (!text || text.trim().length < 50) {
            var allEls = Array.from(doc.querySelectorAll('div, section, article'));
            var best = null, bestScore = 0;
            for (var d = 0; d < allEls.length; d++) {
                var el = allEls[d];
                var cls = (el.className || '').toString().toLowerCase();
                // Пропускаем явно не-текстовые блоки
                if (/comment|sidebar|header|footer|nav|menu|ad|promo|share|related|recommend/i.test(cls)) continue;
                var t = extractText(el);
                if (!t || t.length < 100) continue;
                var tLines = t.split('\n').filter(function (l) { return l.trim().length > 0; });
                if (tLines.length < 5) continue;
                // Средняя длина строки: у текста песни строки короткие (< 80 символов)
                var avgLen = tLines.reduce(function (s, l) { return s + l.trim().length; }, 0) / tLines.length;
                if (avgLen > 120) continue; // слишком длинные строки — не текст песни
                // Скоринг: количество строк × средняя длина (предпочитаем длинные тексты с короткими строками)
                var score = tLines.length * (1 / (avgLen + 1)) * t.length;
                if (score > bestScore) { bestScore = score; best = t; }
            }
            if (best) text = best;
        }

        text = cleanLyrics(cleanGeniusText(text, title));
        if (!text || text.trim().length < 20) throw new Error('Genius: пустой текст на странице');
        return { lines: plainLines(text), hasTimestamps: false };
    }

    // 1) HTML-поиск Genius
    try {
        var html = await fetchHTML('https://genius.com/search?q=' + encodeURIComponent(query), true);
        if (html && !isBlockedPage(html)) {
            var doc = parseDoc(html);
            Array.from(doc.querySelectorAll('a[href]')).forEach(function (a) {
                addCandidate(a.getAttribute('href'));
            });
        }
    } catch (e) { /* дальше */ }

    // 2) DuckDuckGo site:genius.com
    try {
        var links = await ddgSearchLinks(query + ' site:genius.com lyrics', 'genius.com');
        links.forEach(addCandidate);
    } catch (e) { /* дальше */ }

    // 3) API /search/multi
    try {
        var raw3 = await fetchHTML('https://genius.com/api/search/multi?q=' + encodeURIComponent(query), true);
        var data3 = JSON.parse(raw3);
        var sections = (data3 && data3.response && data3.response.sections) || [];
        sections.forEach(function (sec) {
            if ((sec.type === 'song' || sec.type === 'top_hit') && sec.hits) {
                sec.hits.forEach(function (h) {
                    if (h.result && h.result.url) addCandidate(h.result.url);
                });
            }
        });
        if (data3 && data3.response && data3.response.top_hit && data3.response.top_hit.result) {
            addCandidate(data3.response.top_hit.result.url);
        }
    } catch (e) { /* дальше */ }

    // 4) API /search/song
    try {
        var raw4 = await fetchHTML('https://genius.com/api/search/song?q=' + encodeURIComponent(query), true);
        var data4 = JSON.parse(raw4);
        var hits = (data4 && data4.response && data4.response.hits) || [];
        hits.forEach(function (h) {
            if (h.result && h.result.url) addCandidate(h.result.url);
        });
    } catch (e) { /* дальше */ }

    if (!candidates.length) throw new Error('Genius: трек не найден ни одним способом');

    // Сортируем кандидатов по релевантности (чтобы не брать чужой текст)
    var scored = candidates.map(function (c) {
        return { url: c, score: relevanceScore(query, urlText(c)) };
    });
    scored.sort(function (a, b) { return b.score - a.score; });

    // Пробуем извлечь текст из лучших кандидатов (по убыванию релевантности)
    var lastErr = null;
    for (var i = 0; i < scored.length && i < 5; i++) {
        if (scored[i].score < 0.2 && i > 0) break; // не пробуем совсем нерелевантные
        try {
            return await extractFromSongPage(scored[i].url);
        } catch (e) {
            lastErr = e;
            // Если страница заблокирована или текст пустой — пробуем следующего кандидата
        }
    }
    throw lastErr || new Error('Genius: не удалось извлечь текст');
};

// ─── 3. AZLyrics (прямой поиск → DuckDuckGo) ─────────────────────────────────
PARSERS.azlyrics = async function (title, artist) {
    var query = artist + ' ' + title;
    var songUrl = null;
    try {
        var raw = await fetchHTML('https://search.azlyrics.com/search.php?q=' + encodeURIComponent(query), true);
        if (raw && !isBlockedPage(raw)) {
            var doc = parseDoc(raw);
            var link = doc.querySelector('a[href*="/lyrics/"]');
            if (link) songUrl = link.href.startsWith('http') ? link.href : 'https://www.azlyrics.com' + link.href;
        }
    } catch (e) { /* дальше */ }
    if (!songUrl) {
        try {
            var links = await ddgSearchLinks(query + ' site:azlyrics.com lyrics', 'azlyrics.com');
            if (links.length) songUrl = links[0];
        } catch (e) { /* дальше */ }
    }
    if (!songUrl) throw new Error('AZLyrics: трек не найден');
    var page = await fetchHTML(songUrl, true);
    if (isBlockedPage(page)) throw new Error('AZLyrics: страница заблокирована');
    var doc2 = parseDoc(page);
    var wrap = doc2.querySelector('.col-xs-12.col-lg-8.text-center');
    var target = null;
    if (wrap) {
        var divs = wrap.querySelectorAll('div');
        for (var i = 0; i < divs.length; i++) {
            var d = divs[i];
            if (!d.className && !d.id && d.innerText.length > 50) { target = d; break; }
        }
    }
    if (!target) {
        var allDivs = Array.from(doc2.querySelectorAll('div'))
            .filter(function (d) { return d.innerText && d.innerText.length > 100; });
        allDivs.sort(function (a, b) { return b.innerText.length - a.innerText.length; });
        target = allDivs[0];
    }
    if (!target) throw new Error('AZLyrics: контейнер с текстом не найден');
    var text = extractText(target);
    if (!text.trim()) throw new Error('AZLyrics: пустой текст');
    return { lines: plainLines(text), hasTimestamps: false };
};

// ─── 4. Musixmatch (прямой slug → DuckDuckGo, перебор URL) ───────────────────
PARSERS.musixmatch = async function (title, artist) {
    function slug(s) {
        return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }
    function extractFromDoc(doc) {
        var nodes = doc.querySelectorAll('[class*="lyrics__content"], .mxm-lyrics__content, [class*="Lyrics__Cont"]');
        if (nodes.length) {
            var text = '';
            nodes.forEach(function (n) { text += extractText(n) + '\n\n'; });
            text = cleanLyrics(text);
            if (text) return { lines: plainLines(text), hasTimestamps: false };
        }
        var mainContent = doc.querySelector('main') || doc.body;
        if (mainContent) {
            var paragraphs = Array.from(mainContent.querySelectorAll('p, span, div'));
            var longTexts = paragraphs.filter(function (p) {
                return p.innerText.split('\n').length > 3 && p.innerText.length > 100;
            });
            if (longTexts.length > 0) {
                return { lines: plainLines(extractText(longTexts[0])), hasTimestamps: false };
            }
        }
        return null;
    }
    var urls = ['https://www.musixmatch.com/lyrics/' + slug(artist) + '/' + slug(title)];
    try {
        var links = await ddgSearchLinks(artist + ' ' + title + ' site:musixmatch.com lyrics', 'musixmatch.com');
        links.forEach(function (l) { if (urls.indexOf(l) === -1) urls.push(l); });
    } catch (e) { /* дальше */ }
    for (var i = 0; i < urls.length; i++) {
        try {
            var raw = await fetchHTML(urls[i], true);
            if (!raw || raw.length < 500) continue;
            if (isBlockedPage(raw) && !/lyrics__content|Lyrics__Cont/i.test(raw)) continue;
            var doc = parseDoc(raw);
            var result = extractFromDoc(doc);
            if (result) return result;
        } catch (e) { /* дальше */ }
    }
    throw new Error('Musixmatch: текст не найден');
};

// ─── 5. LyricsFreak (прямой поиск → DuckDuckGo) ──────────────────────────────
PARSERS.lyricsfreak = async function (title, artist) {
    var q = artist + ' ' + title;
    var songUrl = null;
    try {
        var raw = await fetchHTML('https://www.lyricsfreak.com/search.php?q=' + encodeURIComponent(q), true);
        if (raw && !isBlockedPage(raw)) {
            var doc = parseDoc(raw);
            var link = doc.querySelector('a.song') || doc.querySelector('a[href$=".html"]');
            if (link) {
                var href = link.getAttribute('href') || '';
                songUrl = href.startsWith('http') ? href : 'https://www.lyricsfreak.com' + href;
            }
        }
    } catch (e) { /* дальше */ }
    if (!songUrl) {
        try {
            var links = await ddgSearchLinks(q + ' site:lyricsfreak.com lyrics', 'lyricsfreak.com');
            if (links.length) songUrl = links[0];
        } catch (e) { /* дальше */ }
    }
    if (!songUrl) throw new Error('LyricsFreak: трек не найден');
    var page = await fetchHTML(songUrl, true);
    if (isBlockedPage(page)) throw new Error('LyricsFreak: страница заблокирована');
    var doc2 = parseDoc(page);
    var node = doc2.querySelector('#content .dn') ||
               doc2.querySelector('.lyrictxt') ||
               doc2.querySelector('#lyrictxt') ||
               doc2.querySelector('[id*="content"] .dn') ||
               doc2.querySelector('.song-content');
    if (!node) throw new Error('LyricsFreak: контейнер с текстом не найден');
    var text = extractText(node);
    if (!text.trim()) throw new Error('LyricsFreak: пустой текст');
    return { lines: plainLines(text), hasTimestamps: false };
};

// ─── 6. Muzexo (прямой поиск → DuckDuckGo) ───────────────────────────────────
PARSERS.muzexo = async function (title, artist) {
    var q = artist + ' ' + title;
    var songUrl = null;
    try {
        var raw = await fetchHTML('https://muzexo.com/search?q=' + encodeURIComponent(q), true);
        if (raw && !isBlockedPage(raw)) {
            var doc = parseDoc(raw);
            var link = doc.querySelector('a[href*="/text/"], a[href*="/lyrics/"], a[href*="/pesnya/"]');
            if (link) {
                var href = link.getAttribute('href') || '';
                songUrl = href.startsWith('http') ? href : 'https://muzexo.com' + href;
            }
        }
    } catch (e) { /* дальше */ }
    if (!songUrl) {
        try {
            var links = await ddgSearchLinks(q + ' site:muzexo.com текст', 'muzexo.com');
            if (links.length) songUrl = links[0];
        } catch (e) { /* дальше */ }
    }
    if (!songUrl) throw new Error('Muzexo: трек не найден');
    var page = await fetchHTML(songUrl, true);
    if (isBlockedPage(page)) throw new Error('Muzexo: страница заблокирована');
    var doc2 = parseDoc(page);
    var node = doc2.querySelector('.text-lyrics') ||
               doc2.querySelector('.lyrics-text') ||
               doc2.querySelector('.song-text') ||
               doc2.querySelector('[class*="text"]');
    if (!node) throw new Error('Muzexo: контейнер с текстом не найден');
    var text = extractText(node);
    if (!text.trim()) throw new Error('Muzexo: пустой текст');
    return { lines: plainLines(text), hasTimestamps: false };
};

// ─── Экспорт ─────────────────────────────────────────────────────────────────
window.CLP_PARSERS = PARSERS;
console.log('[CLP] parsers.js loaded, sources:', Object.keys(PARSERS).join(', '));

})();