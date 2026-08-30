(() => {
  'use strict';
  if (window.__vkeBlobBridgeV1) return;
  window.__vkeBlobBridgeV1 = true;

  const isBlob = u => typeof u === 'string' && /^blob:/i.test(u);
  const isFetchableMedia = u => typeof u === 'string' && (/^blob:/i.test(u) || /^https?:\/\//i.test(u));
  const postBlob = (type, requestId, blob, extra = {}) => {
    try {
      window.postMessage({ type, requestId, blob, ...extra }, '*');
    } catch (e) {
      window.postMessage({ type, requestId, error: e?.message || String(e), ...extra }, '*');
    }
  };

  async function fetchBlob(url) {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store', redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (!blob || blob.size < 1024) throw new Error('Пустой media blob');
    return blob;
  }

  async function captureStory(requestId) {
    const root = document.querySelector('[data-testid*="stories_viewer" i],.StoriesViewer,[class*="StoryViewer" i],[class*="StoriesViewer" i]') || document;
    const exact = document.querySelector('video.videoStoriesViewerPlayer');
    if (exact) {
      const src = exact.currentSrc || exact.src || '';
      if (isBlob(src)) { const blob = await fetchBlob(src); postBlob('CLP_CAPTURE_STORY_RESULT', requestId, blob); return; }
      if (/^https?:\/\//i.test(src)) { const blob = await fetchBlob(src); postBlob('CLP_CAPTURE_STORY_RESULT', requestId, blob, { url: src }); return; }
    }
    const videos = [...root.querySelectorAll('video')].filter(v => {
      const r = v.getBoundingClientRect?.();
      return r && r.width > 20 && r.height > 20;
    });
    videos.sort((a, b) => {
      const ap = (!a.paused && !a.ended) ? 1 : 0;
      const bp = (!b.paused && !b.ended) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    });

    const video = videos[0];
    if (!video) throw new Error('Видео истории не найдено');
    const src = video.currentSrc || video.src || '';

    if (isBlob(src)) {
      const blob = await fetchBlob(src);
      postBlob('CLP_CAPTURE_STORY_RESULT', requestId, blob);
      return;
    }

    if (/^https?:\/\//i.test(src)) {
      const blob = await fetchBlob(src);
      postBlob('CLP_CAPTURE_STORY_RESULT', requestId, blob, { url: src });
      return;
    }

    throw new Error('Источник истории не найден');
  }

  window.addEventListener('message', e => {
    if (e.source !== window) return;
    const d = e.data || {};
    if (d.type === 'CLP_FETCH_BLOB_REQUEST' && d.requestId && isFetchableMedia(d.url)) {
      fetchBlob(d.url)
        .then(blob => postBlob('CLP_FETCH_BLOB_RESULT', d.requestId, blob))
        .catch(err => postBlob('CLP_FETCH_BLOB_RESULT', d.requestId, null, { error: err?.message || String(err) }));
    }
    if (d.type === 'CLP_CAPTURE_STORY' && d.clientId) {
      captureStory(d.clientId)
        .catch(err => postBlob('CLP_CAPTURE_STORY_RESULT', d.clientId, null, { error: err?.message || String(err) }));
    }
  });
})();
