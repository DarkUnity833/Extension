'use strict';
(() => {
  if (window.__VKE_VKDL_ALBUM_V7__) return;
  window.__VKE_VKDL_ALBUM_V7__ = true;

  const d = document;
  const w = window;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const safe = s => String(s || 'VK Music').replace(/[\\/:*?"<>|~]+/g, '').replace(/\s+/g, ' ').trim() || 'VK Music';

  // ВАЖНО: не матчим внутренний [data-testid="MusicTrackRow"].
  // В VK для плейлиста внешний контейнер имеет data-testid="MusicPlaylistTracks_MusicTrackRow"
  // и именно он содержит стабильный data-audio-id.
  const OUTER_ROW_SELECTOR = '[data-testid="MusicPlaylistTracks_MusicTrackRow"],[data-testid^="PodcastEpisodeRow"],.audio_row';
  const ITEMS_SELECTOR = '[data-testid="MusicPlaylistTracks_Items"]';
  const TRACKS_SELECTOR = '[data-testid="MusicPlaylistModal_Tracks"]';

  function getModalRoot(header) {
    return header.closest?.('[role="dialog"], [data-testid="audio-lyrics-modal"], .vkuiModalPage') || header.parentElement || d.body;
  }

  function parseAudioId(value) {
    const m = String(value || '').match(/^(-?\d+)_(-?\d+)$/);
    return m ? { owner_id: m[1], id: m[2] } : null;
  }

  function extractAccessKey(row) {
    const href = row.querySelector('[data-testid="MusicTrackRow_Title"]')?.getAttribute('href') || '';
    const m = href.match(/(?:audio|audio-)(-?\d+)_(-?\d+)_([^/?#]+)$/i);
    return m ? m[3] : '';
  }

  function extractDomSnapshot(row) {
    if (!row || !row.matches(OUTER_ROW_SELECTOR)) return null;

    const pair = parseAudioId(row.getAttribute('data-audio-id'));
    const titleEl = row.querySelector('[data-testid="MusicTrackRow_Title"]');
    const authorEls = row.querySelectorAll('[data-testid="MusicTrackRow_Authors"]');
    const durationEl = row.querySelector('[data-testid="MusicTrackRow_Duration"]');
    const title = (titleEl?.textContent || '').replace(/\s+/g, ' ').trim();
    const artist = Array.from(authorEls).map(x => x.textContent.trim()).filter(Boolean).join(', ');
    const durationText = (durationEl?.textContent || '').trim();
    const dm = durationText.match(/^(\d+):(\d{2})$/);
    const duration = dm ? Number(dm[1]) * 60 + Number(dm[2]) : 0;
    const access_key = extractAccessKey(row);

    let fallback = null;
    try { fallback = w.VKE_VKDL?.getInfo?.(row.querySelector('[data-testid="MusicTrackRow"]') || row) || null; } catch (_) {}

    const owner_id = pair?.owner_id || fallback?.owner_id || '';
    const id = pair?.id || fallback?.id || '';
    if (!owner_id || !id || !title) return null;

    const info = {
      owner_id: String(owner_id),
      id: String(id),
      access_key: access_key || fallback?.access_key || '',
      duration: duration || Number(fallback?.duration || 0),
      artist: artist || fallback?.artist || '',
      title,
      ids: [owner_id, id, access_key || fallback?.access_key].filter(Boolean).join('_'),
      url: fallback?.url || '',
      name: safe(`${artist || fallback?.artist || ''} - ${title}`) + '.mp3'
    };

    // Замораживаем row-specific данные. Никакого чтения window.ap и current track здесь.
    return Object.freeze(info);
  }

  function getExactItems(root) {
    return root.querySelector(ITEMS_SELECTOR) || d.querySelector(ITEMS_SELECTOR) || null;
  }

  function findScrollParent(node, stopAt) {
    let n = node;
    while (n && n !== stopAt && n !== d.body) {
      const st = getComputedStyle(n);
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 4) return n;
      n = n.parentElement;
    }
    return null;
  }

  function getTracksScroller(root, items) {
    // В приоритете сам контейнер треков / items. Не скроллим фон модалки.
    const tracks = root.querySelector(TRACKS_SELECTOR) || d.querySelector(TRACKS_SELECTOR);
    const direct = [items, tracks, findScrollParent(items, root), findScrollParent(tracks, root)].filter(Boolean);
    for (const el of direct) {
      const st = getComputedStyle(el);
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) return el;
      if (el.scrollHeight > el.clientHeight + 40) return el;
    }
    return null;
  }

  function capture(root, map) {
    const items = root.querySelector(ITEMS_SELECTOR) || d.querySelector(ITEMS_SELECTOR);
    const scope = items || root;
    scope.querySelectorAll(OUTER_ROW_SELECTOR).forEach(row => {
      const snap = extractDomSnapshot(row);
      if (!snap) return;
      const key = `${snap.owner_id}_${snap.id}_${snap.access_key}`;
      map.set(key, snap);
    });
    return items;
  }

  function getFiber(node) {
    if (!node) return null;
    for (const k of Object.keys(node)) if (k.startsWith('__reactFiber')) return node[k];
    return null;
  }

  function audioFromObject(o) {
    if (!o || typeof o !== 'object') return null;
    const candidates = [o, o.apiAudio, o.entity?.apiAudio, o.track?.entity?.apiAudio, o.track?.data?.apiAudio, o.audio?.entity?.apiAudio, o.audio, o.episode?.entity?.apiAudio, o.episode?.data?.apiAudio];
    for (const x of candidates) {
      if (!x || typeof x !== 'object') continue;
      const owner = x.owner_id ?? x.ownerId;
      const id = x.id ?? x.audio_id;
      const title = x.title ?? x.name;
      if (owner != null && id != null && title) return x;
    }
    return null;
  }

  function collectFiberAudios(root, map) {
    const seen = new Set();
    const stack = [];
    let f = getFiber(root);
    for (let i=0; f && i<12; i++, f=f.return) stack.push(f);
    while (stack.length) {
      const fiber = stack.pop();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      const inspect = [fiber.memoizedProps, fiber.memoizedState];
      for (const obj of inspect) {
        const walk = (v, depth=0) => {
          if (!v || depth>8 || seen.has(v)) return;
          if (typeof v !== 'object') return;
          seen.add(v);
          const a = audioFromObject(v);
          if (a) {
            const owner_id=String(a.owner_id ?? a.ownerId ?? '');
            const id=String(a.id ?? a.audio_id ?? '');
            if (owner_id && id) {
              const duration=Number(a.duration||0);
              const artist=String(a.artist||a.author||'');
              const title=String(a.title||a.name||'');
              const access_key=String(a.access_key||a.accessKey||'');
              const url=String(a.url||a.src||a.audio_url||'');
              map.set(`${owner_id}_${id}_${access_key}`, Object.freeze({owner_id,id,access_key,duration,artist,title,url,ids:[owner_id,id,access_key].filter(Boolean).join('_'),name:safe(`${artist} - ${title}`)+'.mp3'}));
            }
          }
          if (Array.isArray(v)) for (const x of v) walk(x,depth+1);
          else for (const [k,x] of Object.entries(v)) {
            if (k === 'stateNode' || k === 'return' || k === 'child' || k === 'sibling' || k === '_owner' || k === '_store') continue;
            walk(x,depth+1);
          }
        };
        walk(obj);
      }
      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
    }
  }

  async function clickShowAll(root, onStatus) {
    const labels = Array.from(root.querySelectorAll('span')).filter(el =>
      el.children.length === 0 && el.textContent.trim() === 'Показать все'
    );
    if (!labels.length) return false;

    const label = labels[0];
    const clickable = label.closest('button,[role="button"],.vkuiTappable__host,.vkuiClickable__realClickable') || label;
    try {
      onStatus?.('Открываю весь плейлист…');
      clickable.scrollIntoView({ block: 'center', inline: 'nearest' });
      await sleep(50);
      clickable.click();
    } catch (_) {
      try { label.click(); } catch (_) { return false; }
    }

    // VK дорисовывает содержимое асинхронно после этого клика.
    await sleep(500);
    return true;
  }

  function getTrackRows(root) {
    const items = root.querySelector(ITEMS_SELECTOR) || d.querySelector(ITEMS_SELECTOR);
    const scope = items || root;
    return Array.from(scope.querySelectorAll(OUTER_ROW_SELECTOR));
  }

  async function waitForTargetRows(root, target, onStatus) {
    let stable = 0;
    let last = -1;
    for (let i = 0; i < 80; i++) {
      const count = getTrackRows(root).length;
      onStatus?.(`Загружаю треки… ${target ? `${count} / ${target}` : count}`);
      if (target > 0 && count >= target) return;
      if (count === last) stable++; else stable = 0;
      last = count;
      if (stable >= 5) break;
      await sleep(250);
    }
  }

  async function collectSnapshots(header, onStatus) {
    const root = getModalRoot(header);
    const map = new Map();
    const stat = root.querySelector('[data-testid="musicplayliststatistics-count"]') || d.querySelector('[data-testid="musicplayliststatistics-count"]');
    const target = Number((stat?.textContent || '').replace(/\D/g,'')) || 0;

    // 1. Сначала обязательно раскрываем "Показать все".
    await clickShowAll(root, onStatus);
    await waitForTargetRows(root, target, onStatus);

    // 2. Собираем уже раскрытые DOM-строки. Никакого window.ap/current track.
    const captureNow = () => {
      for (const row of getTrackRows(root)) {
        const snap = extractDomSnapshot(row);
        if (!snap) continue;
        const key = `${snap.owner_id}_${snap.id}_${snap.access_key}`;
        map.set(key, snap);
      }
    };
    captureNow();

    // 3. Если VK всё ещё виртуализирует список, скроллим именно ближайший
    //    scroll-контейнер вокруг MusicPlaylistModal_Tracks.
    const items = getExactItems(root);
    const tracks = root.querySelector(TRACKS_SELECTOR) || d.querySelector(TRACKS_SELECTOR);
    const candidates = [
      findScrollParent(tracks, root),
      findScrollParent(items, root),
      tracks,
      items
    ].filter(Boolean);

    let scroller = null;
    for (const el of candidates) {
      const st = getComputedStyle(el);
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) {
        scroller = el;
        break;
      }
    }

    // Если прямой overflow не нашли, ищем первый реально прокручиваемый предок.
    if (!scroller) {
      let n = tracks || items || null;
      while (n && n !== d.body) {
        const st = getComputedStyle(n);
        if (n.scrollHeight > n.clientHeight + 20 && (st.overflowY === 'auto' || st.overflowY === 'scroll')) {
          scroller = n;
          break;
        }
        n = n.parentElement;
      }
    }

    if (scroller) {
      let lastCount = map.size;
      let stable = 0;
      let lastTop = -1;

      for (let i = 0; i < 160; i++) {
        captureNow();
        const count = map.size;
        const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const top = scroller.scrollTop;
        onStatus?.(`Собрано ${count}${target ? ` / ${target}` : ''} треков`);
        if (target > 0 && count >= target) break;

        // Сначала прыгаем почти в низ списка, затем делаем несколько меньших
        // шагов — это надёжнее для VK virtual scrolling.
        const step = Math.max(260, Math.floor(scroller.clientHeight * 0.82));
        const nextTop = Math.min(max, top + step);
        if (nextTop === top || top === lastTop) stable++; else stable = 0;
        lastTop = top;

        scroller.scrollTop = nextTop;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        await sleep(260);

        captureNow();
        if (map.size === lastCount) stable++; else stable = 0;
        lastCount = map.size;

        if (top >= max - 2) {
          // В самом низу несколько импульсов заставляют VK завершить lazy load.
          for (let j = 0; j < 3; j++) {
            scroller.dispatchEvent(new WheelEvent('wheel', {
              deltaY: Math.max(500, scroller.clientHeight * 0.9),
              bubbles: true,
              cancelable: true
            }));
            scroller.scrollTop = max;
            await sleep(220);
            captureNow();
            if (target > 0 && map.size >= target) break;
          }
          if (target > 0 && map.size >= target) break;
          if (stable >= 8) break;
        }
      }
    }

    // 4. Финальный снимок после прокрутки.
    captureNow();
    const result = Array.from(map.values());
    if (target > 0 && result.length > target) result.length = target;
    onStatus?.(`Найдено ${result.length}${target ? ` / ${target}` : ''} треков`);
    return result;
  }

  async function resolveAndDownload(info) {
    const url = await w.VKE_VKDL?.resolveInfo?.(info);
    if (!url) throw new Error('URL не получен');
    const blob = await w.VKE_VKDL?.downloadBlob?.(info, url);
    if (!blob || blob.size < 500) throw new Error('пустой файл');
    return blob;
  }

  function zip(files) {
    if (!w.JSZip) throw new Error('JSZip не загружен');
    const z = new w.JSZip();
    for (const f of files) z.file(f.name, f.data);
    return z.generateAsync({type:'blob',compression:'STORE'});
  }

  function save(blob,name) {
    const u=URL.createObjectURL(blob), a=d.createElement('a');
    a.href=u; a.download=name; a.style.display='none';
    (d.body||d.documentElement).appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(u),15000);
  }

  function fmtBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const u=['B','KB','MB','GB']; const i=Math.min(3,Math.floor(Math.log(bytes)/Math.log(1024)));
    return `${(bytes/Math.pow(1024,i)).toFixed(i ? 1 : 0)} ${u[i]}`;
  }

  let weightPopup = null;
  function getWeightPopup() {
    if (weightPopup && d.body.contains(weightPopup)) return weightPopup;
    weightPopup=d.createElement('div'); weightPopup.className='vke-album-weight'; weightPopup.style.display='none';
    (d.body||d.documentElement).appendChild(weightPopup); return weightPopup;
  }
  function placeWeightPopup(btn) {
    const p=getWeightPopup(), r=btn.getBoundingClientRect();
    p.style.left=`${r.left+r.width/2}px`; p.style.top=`${r.bottom+8}px`; p.style.transform='translateX(-50%)';
  }
  async function ensurePlaylistPrepared(header, onStatus) {
    if (!header) return [];
    if (header._vkePrepPromise) return header._vkePrepPromise;
    if (header._vkeRows?.length) return header._vkeRows;
    header._vkePrepPromise = collectSnapshots(header, onStatus).then(rows => {
      header._vkeRows = rows;
      header._vkePrepared = true;
      return rows;
    }).catch(err => {
      header._vkePrepared = false;
      throw err;
    }).finally(() => {
      header._vkePrepPromise = null;
    });
    return header._vkePrepPromise;
  }

  async function calculatePlaylistWeight(header) {
    const rows = await ensurePlaylistPrepared(header);
    if (!rows.length) throw new Error('Нет треков');
    let total=0, exact=0, approx=0, failed=0, idx=0;
    const worker=async()=>{ while(true){ const i=idx++; if(i>=rows.length)return; const info=rows[i]; try {
      const meta=await w.VKE_VKDL?.audioMeta?.(info);
      if(meta?.size>0){ total+=meta.size; meta.approx?approx++:exact++; } else failed++;
    } catch(_){ failed++; } } };
    await Promise.all(Array.from({length:Math.min(4,rows.length)},worker));
    return {total,exact,approx,failed,count:rows.length};
  }
  function showWeight(btn,header) {
    if (btn._busy) return;
    const p=getWeightPopup(); placeWeightPopup(btn); p.style.display='block';
    if (header._vkeActualBytes > 0) {
      btn._weightResult = { total: header._vkeActualBytes, exact: header._vkeRows?.length || 0, approx: 0, failed: 0, count: header._vkeRows?.length || 0 };
    }
    if(btn._weightResult){
      const r=btn._weightResult;
      p.innerHTML=`<div class="vke-album-weight-total">${r.approx?'≈ ':''}${fmtBytes(r.total)}</div><div>${r.count} треков</div>${r.approx?`<div class="vke-album-weight-sub">${r.approx} приблизительно</div>`:'<div class="vke-album-weight-sub">точный размер загруженных файлов</div>'}`;
      return;
    }
    if(btn._weightLoading) return;
    btn._weightLoading=true; p.innerHTML='<div>Считаю размер…</div>';
    (async()=>{ try {
      const r=await calculatePlaylistWeight(header); btn._weightResult=r;
      if(p.style.display!=='none'){
        p.innerHTML=`<div class="vke-album-weight-total">${r.approx?'≈ ':''}${fmtBytes(r.total)}</div><div>${r.count} треков</div>${r.approx?`<div class="vke-album-weight-sub">${r.approx} приблизительно</div>`:'<div class="vke-album-weight-sub">точный размер загруженных файлов</div>'}`;
      }
    } catch(_){ p.innerHTML='<div>Не удалось посчитать</div>'; } finally { btn._weightLoading=false; } })();
  }
  function hideWeight(){ if(weightPopup) weightPopup.style.display='none'; }

  function setIcon(btn, progress=null, activeCount=0) {
    if (progress==null) {
      btn.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 3a1 1 0 0 1 1 1v9.586l2.293-2.293a1 1 0 1 1 1.414 1.414l-4 4a1 1 0 0 1-1.414 0l-4-4a1 1 0 1 1 1.414-1.414L11 13.586V4a1 1 0 0 1 1-1m-7 16a1 1 0 1 1 1-1h12a1 1 0 0 1 1 1H6a1 1 0 0 1-1-1z"/></svg>';
      return;
    }
    const p=Math.max(0,Math.min(1,progress)), c=2*Math.PI*12;
    btn.innerHTML=`<span class="vke-album-ring"><svg viewBox="0 0 32 32" width="28" height="28"><circle class="bg" cx="16" cy="16" r="12"/><circle class="fg" cx="16" cy="16" r="12" stroke-dasharray="${c}" stroke-dashoffset="${c*(1-p)}"/></svg><span>${Math.round(p*100)}%</span></span>`;
    btn.title = activeCount ? `${Math.round(p*100)}% • ${activeCount} потока` : btn.title;
  }

  function style() {
    if (d.getElementById('vke-album-style')) return;
    const s = d.createElement('style');
    s.id = 'vke-album-style';
    s.textContent = `
      .vke-album-download .vkuiButton__in,.vke-album-download .vkuiButton__before{display:inline-flex!important;align-items:center!important;justify-content:center!important;height:100%!important;line-height:1!important;margin:0!important;padding:0!important}
      .vke-album-download .vkuiButton__before{transform:translateX(-3px)!important}
      .vke-album-download svg{display:block!important}
      .vke-album-weight{position:fixed;z-index:2147483647;min-width:110px;padding:7px 11px;border-radius:9px;background:rgba(30,30,32,.96);border:1px solid rgba(255,255,255,.12);color:#fff;font:12px/17px system-ui,sans-serif;text-align:center;white-space:nowrap;box-shadow:0 8px 28px rgba(0,0,0,.32);pointer-events:none;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
      .vke-album-weight-total{font-weight:700;font-size:14px}.vke-album-weight-sub{opacity:.65;font-size:11px}
      .vke-album-ring{position:relative;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;font-size:8px;font-weight:700;line-height:1}
      .vke-album-ring svg{transform:rotate(-90deg)}
      .vke-album-ring circle{fill:none;stroke-width:2.5}
      .vke-album-ring .bg{stroke:rgba(255,255,255,.18)}
      .vke-album-ring .fg{stroke:currentColor;stroke-linecap:round}
      .vke-album-ring>span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
    `;
    d.head.appendChild(s);
  }

  function inject() {
    for (const header of d.querySelectorAll('[data-testid="audiolistboxheader-actions"]')) {
      if (header.querySelector('.vke-album-download')) continue;
      const group = header.querySelector('[role="group"]');
      if (!group) continue;
      const template = group.querySelector('button');
      if (!template) continue;

      // Полностью раскрываем плейлист сразу после открытия модалки, а не при hover по кнопке скачивания.
      if (!header._vkePrepStarted) {
        header._vkePrepStarted = true;
        ensurePlaylistPrepared(header, status => {
          // Не спамим title до появления нашей кнопки.
          const current = header.querySelector('.vke-album-download');
          if (current && !current._busy) current.title = status || 'Плейлист подготовлен';
        }).catch(err => console.warn('[VKDL Playlist] prepare:', err));
      }

      const btn = template.cloneNode(true);
      btn.classList.add('vke-album-download');
      btn.removeAttribute('data-testid');
      btn.removeAttribute('aria-busy');
      btn.title = 'Скачать плейлист';
      btn.addEventListener('mouseenter', () => showWeight(btn, header));
      btn.addEventListener('mouseleave', hideWeight);

      const before = btn.querySelector('.vkuiButton__before') || btn.querySelector('.vkuiButton__in') || btn;
      before.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 3a1 1 0 0 1 1 1v9.586l2.293-2.293a1 1 0 1 1 1.414 1.414l-4 4a1 1 0 0 1-1.414 0l-4-4a1 1 0 1 1 1.414-1.414L11 13.586V4a1 1 0 0 1 1-1m-7 16a1 1 0 1 1 1-1h12a1 1 0 1 1 1 1H6a1 1 0 0 1-1-1z"/></svg>';

      btn.onclick = async e => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (btn._busy) return;
        btn._busy = true;
        const original = btn.innerHTML;
        try {
          btn.title = 'Собираю треки…';
          const rows = await ensurePlaylistPrepared(header, status => { btn.title = status; });
          if (!rows.length) throw new Error('Не удалось найти треки плейлиста');

          const files = new Array(rows.length);
          let ok = 0, done = 0, next = 0, active = 0;
          const worker = async () => {
            while (true) {
              const i = next++;
              if (i >= rows.length) return;
              const info = rows[i];
              active++;
              btn.title = `Скачиваю ${done}/${rows.length}: ${info.title}`;
              try {
                const blob = await resolveAndDownload(info);
                files[i] = { name: info.name, data: blob };
                ok++;
              } catch (err) {
                console.warn('[VKDL Playlist] skip', i + 1, info.title, err?.message || err);
              } finally {
                active--; done++;
                setIcon(btn, done / rows.length, active);
                btn.title = `Скачано ${done}/${rows.length} • одновременно: ${active}`;
              }
            }
          };
          await Promise.all(Array.from({ length: Math.min(3, rows.length) }, worker));
          const packedFiles = files.filter(Boolean);
          files.length = 0;
          files.push(...packedFiles);

          // После фактической загрузки у нас есть точный размер каждого blob.
          // Сохраняем его для следующего наведения на кнопку, чтобы вес больше
          // не зависел от приблизительной оценки HLS.
          const actualBytes = files.reduce((sum, f) => sum + (f?.data?.size || 0), 0);
          header._vkeActualBytes = actualBytes;
          header._vkeWeightResult = { total: actualBytes, exact: files.length, approx: 0, failed: rows.length - files.length, count: rows.length };

          if (!files.length) throw new Error('Не удалось скачать ни одного трека');
          btn.title = `Упаковка ${ok} треков…`;
          setIcon(btn, 1);
          const title = safe(d.querySelector('[data-testid="MusicPlaylistModal_Title"]')?.textContent || 'VK Playlist');
          const zipBlob = await zip(files);
          save(zipBlob, `${title}.zip`);
          btn.title = `Готово: ${ok}/${rows.length}`;
        } catch (err) {
          console.warn('[VKDL Playlist]', err);
          btn.title = err?.message || 'Ошибка';
        } finally {
          btn._busy = false;
          setTimeout(() => { btn.innerHTML = original; }, 900);
        }
      };

      group.appendChild(btn);
    }
  }

  style();
  new MutationObserver(inject).observe(d.documentElement, { subtree: true, childList: true });
  inject();
  console.log('[VKDL] ✅ album downloader v7 ready');
})();
