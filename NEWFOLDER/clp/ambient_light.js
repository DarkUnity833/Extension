
(() => {
  'use strict';

  // Ambient Light is intentionally a VK Video-only feature.
  // Do not touch vk.ru / vk.com pages at all.
  const hostName = String(location.hostname || '').toLowerCase();
  if (hostName !== 'vkvideo.ru' && !hostName.endsWith('.vkvideo.ru')) return;

  if (window.__VKE_AMBIENT_LIGHT_V72R6__) return;
  window.__VKE_AMBIENT_LIGHT_V72R6__ = true;

  const STYLE_ID = 'vke-ambient-light-style-v7r6';
  const HOST_ID = 'vke-ambient-light-host-v7r6';
  const BUTTON_ID = 'vke-ambient-light-settings-button-v7r6';
  const STORAGE_KEY = 'vke_ambient_light_settings';

  const defaults = {
    enabled: true,
    blur: 100,
    spread: 0,
    opacity: 0.78,
    brightness: 1.05,
    saturation: 1.25,
    barOpacity: 0.42,
    barSaturation: 1.18,
    barTransparency: 58,
    fillVideo: false,
    frameRate: 24
  };

  let settings = {...defaults};
  let state = { video: null, host: null, barHost: null, bars: {}, glow: null, canvas: null, ctx: null, raf: 0, last: 0, open: false };

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) || {};
        settings = {...defaults, ...saved};
        // v71 baseline: start from the requested defaults so the old
        // pixel-based spread cannot carry over into the new percent control.
        if (saved.__vke_ambient_defaults_v71 !== true) {
          settings.blur = 100;
          settings.spread = 0;
          settings.__vke_ambient_defaults_v71 = true;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        }
        settings.blur = Math.max(0, Math.min(1500, Number(settings.blur) || 0));
        settings.spread = Math.max(0, Math.min(100, Number(settings.spread) || 0));
        settings.barOpacity = Math.max(0, Math.min(1, Number(settings.barOpacity) || 0));
        settings.barTransparency = Math.round((1-settings.barOpacity)*100);
        settings.fillVideo = !!settings.fillVideo;
        // Bar opacity uses normal opacity semantics: 0% = transparent, 100% = opaque.
        // Convert the immediately previous inverse build once.
        if (saved.__vke_bar_opacity_alpha_v2 !== true) {
          const old = Math.max(0, Math.min(1, Number(settings.barOpacity) || 0));
          if (saved.__vke_bar_opacity_transparency_v1 === true) settings.barOpacity = 1 - old;
          else settings.barOpacity = old;
          settings.__vke_bar_opacity_alpha_v2 = true;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        }
      }
    } catch {}
  }
  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}
  }

  const STYLE_MARKER = 'data-vke-ambient-style-v7r6';

  // Hide/remove VK Video's advertising container. Keep this scoped strictly
  // to vkvideo.ru so other VK surfaces are untouched.
  function removeVkVideoAds() {
    try {
      const roots=[document],seen=new Set();
      for(let i=0;i<roots.length;i++){
        const r=roots[i]; if(!r||seen.has(r)) continue; seen.add(r);
        r.querySelectorAll?.('*').forEach(e=>e.shadowRoot&&!seen.has(e.shadowRoot)&&roots.push(e.shadowRoot));
        r.querySelectorAll?.('.ads-container,[data-testid="ad-container"]').forEach(el=>{
          el.querySelectorAll?.('video,audio').forEach(m=>{try{m.pause();m.muted=true;m.volume=0;m.removeAttribute('src');m.load?.();}catch{}});
          if(el instanceof HTMLElement) el.remove();
        });
      }
    } catch {}
  }

  const AMBIENT_CSS = `
    /* VK Video advertising slot: remove the container itself, including
       the hidden ad <video> that otherwise gets caught by our media logic. */
    .ads-container,
    [data-testid=ad-container] {
      display:none!important;
      visibility:hidden!important;
      width:0!important;
      height:0!important;
      min-width:0!important;
      min-height:0!important;
      max-width:0!important;
      max-height:0!important;
      overflow:hidden!important;
      pointer-events:none!important;
    }

    /* Ambient layer sits above page surfaces but below the actual player.
       The configurable blur may extend well beyond the video viewport. */
    #${HOST_ID}{
      position:fixed!important;pointer-events:none!important;z-index:19!important;
      overflow:visible!important;display:none!important;opacity:0!important;
      border:0!important;border-radius:0!important;background:transparent!important;
      box-shadow:none!important;transform:translateZ(0)!important;
      will-change:left,top,width,height!important;
    }
    #${HOST_ID}.vke-ambient-visible{display:block!important;opacity:1!important}
    #${HOST_ID}.vke-ambient-clip-mode{
      position:fixed!important;
      z-index:4!important;
      pointer-events:none!important;
      overflow:visible!important;
      isolation:isolate!important;
    }
    [data-testid=clips-feed-item].vke-ambient-clip-root{
      position:relative!important;
      z-index:10!important;
      isolation:isolate!important;
      overflow:visible!important;
    }
    [data-testid=clips-feed-item].vke-ambient-clip-root > *{
      z-index:11!important;
    }
    [data-testid=clips-feed-item].vke-ambient-clip-root video,
    [data-testid=clips-feed-item].vke-ambient-clip-root [data-testid=clipcontainer-video]{
      position:relative!important;
      z-index:20!important;
    }
    #${HOST_ID} .vke-ambient-canvas{
      position:absolute!important;display:block!important;
      left:var(--vke-al-canvas-left,0px)!important;
      top:var(--vke-al-canvas-top,0px)!important;
      width:var(--vke-al-canvas-width,100%)!important;
      height:var(--vke-al-canvas-height,100%)!important;
      max-width:none!important;object-fit:fill!important;
      filter:blur(var(--vke-al-blur,100px)) saturate(var(--vke-al-sat,1.25))
        brightness(var(--vke-al-bright,1.05))!important;
      transform:none!important;
      opacity:var(--vke-al-opacity,.78)!important;
      will-change:filter,left,top,width,height!important;
    }
    #${HOST_ID} .vke-ambient-fade{
      position:absolute!important;inset:0!important;
      background:transparent!important;
      pointer-events:none!important;
    }
    vk-video-player{position:relative!important;z-index:20!important}
    vk-video-player video.player-media{position:relative!important;z-index:20!important}
    vk-video-player.vke-fill-video video.player-media,
    vk-video-player.vke-fill-video video{object-fit:cover!important;object-position:center center!important}

    /* Black-bar replacements are attached to the player itself, not to the viewport.
       They therefore move exactly with the player while scrolling. */
    #${HOST_ID}-bars{
      position:absolute!important;inset:0!important;pointer-events:none!important;
      z-index:21!important;display:none!important;overflow:hidden!important;
    }
    #${HOST_ID}-bars.vke-ambient-bars-visible{display:block!important}
    #${HOST_ID}-bars .vke-ambient-bar{
      position:absolute!important;display:none!important;overflow:hidden!important;pointer-events:none!important;
      background:transparent!important;border:0!important;
    }
    #${HOST_ID}-bars .vke-ambient-bar.vke-ambient-bar-visible{display:block!important}
    #${HOST_ID}-bars .vke-ambient-bar canvas{
      position:absolute!important;inset:0!important;width:100%!important;height:100%!important;
      max-width:none!important;object-fit:fill!important;
      filter:blur(var(--vke-al-bar-blur,180px)) saturate(var(--vke-al-bar-sat,1.18)) brightness(1.08)!important;
      opacity:var(--vke-al-bar-opacity,.42)!important;transform:scale(1.36)!important;
      will-change:filter,transform,opacity!important;
    }
    #${BUTTON_ID}-wrap{display:flex!important;align-items:center!important;height:100%!important;flex:0 0 auto!important}
    #${BUTTON_ID}{width:40px!important;height:40px!important;min-width:40px!important;min-height:40px!important;
      display:inline-flex!important;align-items:center!important;justify-content:center!important;
      padding:0!important;margin:0!important;border:0!important;border-radius:50%!important;
      background:rgba(255,255,255,.06)!important;color:#fff!important;cursor:pointer!important;transition:background .16s ease,box-shadow .16s ease,opacity .16s ease!important;opacity:.82!important;
    }
    #${BUTTON_ID}:hover,#${BUTTON_ID}.vke-btn-hover{background:rgba(255,255,255,.13)!important;opacity:1!important}
    #${BUTTON_ID}.vke-btn-active{background:rgba(81,129,184,.22)!important;box-shadow:0 0 0 1px rgba(81,129,184,.28),0 0 14px rgba(81,129,184,.18)!important;opacity:1!important}
    #${BUTTON_ID} svg{width:21px!important;height:21px!important;fill:currentColor!important}
    #${BUTTON_ID}-clip-floating{position:fixed!important;left:0!important;top:0!important;width:52px!important;height:52px!important;min-width:52px!important;min-height:52px!important;display:block!important;pointer-events:none!important;z-index:2147483646!important;margin:0!important;padding:0!important;transform:translateZ(0)!important;}
    #${BUTTON_ID}-clip-wrap{display:flex!important;align-items:center!important;justify-content:center!important;height:52px!important;width:52px!important;flex:0 0 52px!important;margin:0!important;padding:0!important;position:fixed!important;pointer-events:none!important;}
    .vke-ambient-clip-control-shell{width:52px!important;height:52px!important;display:flex!important;align-items:center!important;justify-content:center!important;pointer-events:auto!important}
    #${BUTTON_ID}-clip{width:52px!important;height:52px!important;min-width:52px!important;min-height:52px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;padding:0!important;margin:0!important;border:0!important;border-radius:50%!important;background:transparent!important;color:#fff!important;cursor:pointer!important;pointer-events:auto!important;opacity:.86!important;transition:background .16s ease,box-shadow .16s ease,opacity .16s ease!important}
    #${BUTTON_ID}-clip:hover,#${BUTTON_ID}-clip.vke-btn-hover{background:rgba(255,255,255,.10)!important;opacity:1!important}
    #${BUTTON_ID}-clip.vke-btn-active{background:rgba(81,129,184,.18)!important;box-shadow:0 0 0 1px rgba(81,129,184,.24),0 0 14px rgba(81,129,184,.16)!important;opacity:1!important}
    #${BUTTON_ID}-clip svg{width:28px!important;height:28px!important;fill:currentColor!important}
    #${BUTTON_ID}-clip-floating{position:fixed!important;z-index:2147483646!important;pointer-events:auto!important;width:52px!important;height:52px!important}
    #${BUTTON_ID}-clip-floating .vke-ambient-clip-control-shell{width:52px!important;height:52px!important;display:flex!important;align-items:center!important;justify-content:center!important;pointer-events:auto!important}
    #${BUTTON_ID}-clip-floating #${BUTTON_ID}-clip{width:52px!important;height:52px!important;min-width:52px!important;min-height:52px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;margin:0!important;padding:0!important;border:0!important;border-radius:50%!important;background:transparent!important;color:#fff!important;cursor:pointer!important}
    .vke-al-clip-page .vke-al-bars-setting,.vke-al-clip-page .vke-al-fill-setting{display:none!important}
    #${HOST_ID}-bars .vke-ambient-bar-left canvas{transform-origin:right center!important}
    #${HOST_ID}-bars .vke-ambient-bar-right canvas{transform-origin:left center!important}
    #${HOST_ID}-bars .vke-ambient-bar-top canvas{transform-origin:center bottom!important}
    #${HOST_ID}-bars .vke-ambient-bar-bottom canvas{transform-origin:center top!important}

    .vke-al-panel{
      position:fixed!important;z-index:2147483647!important;width:280px!important;
      padding:14px!important;border-radius:14px!important;background:#222!important;color:#fff!important;
      box-shadow:0 12px 40px rgba(0,0,0,.55)!important;
      font:13px/18px -apple-system,BlinkMacSystemFont,Roboto,sans-serif!important;
    }
    .vke-al-panel h3{margin:0 0 10px!important;font:600 15px/20px inherit!important}
    .vke-al-row{display:grid!important;grid-template-columns:1fr 90px!important;gap:8px!important;align-items:center!important;margin:8px 0!important}
    .vke-al-row input[type=range]{width:90px!important}
    .vke-al-actions{display:flex!important;gap:8px!important;margin-top:12px!important}
    .vke-al-actions button{flex:1!important;border:0!important;border-radius:8px!important;padding:7px 9px!important;background:#383838!important;color:#fff!important;cursor:pointer!important}
    .vke-al-actions button:hover{background:#4a4a4a!important}
    .vke-al-toggle{display:flex!important;align-items:center!important;justify-content:space-between!important;margin-bottom:10px!important}
    .vke-al-toggle input{accent-color:#5181b8!important}

    /* Video page surfaces: transparent, but keep recommendation cards readable. */
    section.vke-ambient-surface,
    section.vke-ambient-surface.vkuiGroup__modeCard,
    section[data-testid=video_page_playlist_videos],
    section#video_recommendations{
      background:rgba(34,34,34,.14)!important;
      background-color:rgba(34,34,34,.14)!important;
      border-color:rgba(255,255,255,.05)!important;
      -webkit-backdrop-filter:none!important;
      backdrop-filter:none!important;
      position:relative!important;
      z-index:11!important;
    }

    /* The information area under the player has several nested VKUI surfaces. */
    [data-testid=video-page-info],
    [data-testid=video-page-info] > *,
    [data-testid=video-page-info] [data-testid=headerlayout],
    [data-testid=video-page-info] [data-testid=headerlayout] > *,
    [data-testid=video-page-info] .vkuiHeader__main,
    [data-testid=video-page-info] .vkuiHeader__content,
    [data-testid=video-page-info] .vkuiHeader__contentIn{
      background:transparent!important;
      background-color:transparent!important;
      box-shadow:none!important;
      border-color:transparent!important;
      -webkit-backdrop-filter:none!important;
      backdrop-filter:none!important;
    }

    /* Playlist/recommendation contents: no hidden opaque inner card behind the list. */
    section[data-testid=video_page_playlist_videos] > *,
    section[data-testid=video_page_playlist_videos] .vkuiGroup__header,
    section[data-testid=video_page_playlist_videos] .PlaylistVideos__container--4uC86,
    section#video_recommendations > *,
    section#video_recommendations [class*="PlaylistVideos__"]{
      background:transparent!important;
      background-color:transparent!important;
      box-shadow:none!important;
      border-color:transparent!important;
      -webkit-backdrop-filter:none!important;
      backdrop-filter:none!important;
    }
    section[data-testid=video_page_playlist_videos] .vkuiGroup__separatorSibling,
    section#video_recommendations .vkuiGroup__separatorSibling{
      background:transparent!important;
    }

    /* VK Video header: transparent wrappers + a very light outer veil. */
    .vkuiSplitLayout__host:has([data-testid=video_spa_header]),
    .vkuiSplitLayout__innerCenter:has(> [data-testid=video_spa_header]),
    [data-testid=video_spa_header] > *,
    [data-testid=video_spa_header] > * > *,
    [data-testid=video_spa_header] > * > * > *,
    [data-testid=video_spa_header] > * > * > * > *{
      background:transparent!important;
      background-color:transparent!important;
      background-image:none!important;
      box-shadow:none!important;
      border-color:transparent!important;
      -webkit-backdrop-filter:none!important;
      backdrop-filter:none!important;
    }
    [data-testid=video_spa_header],
    .VideoHeaderLayout__container--6Emcb{
      background:rgba(17,17,17,.07)!important;
      background-color:rgba(17,17,17,.07)!important;
      background-image:none!important;
      box-shadow:none!important;
      border-color:transparent!important;
      -webkit-backdrop-filter:none!important;
      backdrop-filter:none!important;
      position:fixed!important;
      top:0!important;left:0!important;right:0!important;
      z-index:1000!important;
      width:100%!important;box-sizing:border-box!important;
    }
    .vkuiSplitLayout__host:has([data-testid=video_spa_header]),
    .vkuiSplitLayout__innerCenter:has(> [data-testid=video_spa_header]){
      background:transparent!important;
      background-color:transparent!important;
    }

    /* Restore the VK Video search field outline after the transparent-header reset. */
    [data-testid=video_spa_header] .vkuiSearch__field{
      background:rgba(255,255,255,.065)!important;
      border:1px solid rgba(255,255,255,.15)!important;
      box-shadow:0 0 0 1px rgba(0,0,0,.16)!important;
      border-radius:8px!important;
      background-clip:padding-box!important;
    }
    [data-testid=video_spa_header] .vkuiSearch__field:focus-within{
      border-color:rgba(255,255,255,.24)!important;
      box-shadow:0 0 0 1px rgba(255,255,255,.06)!important;
    }

    /* Collapsed left catalog: keep the fixed shells transparent. */
    [data-testid=video_left_menu],
    [data-testid=video_left_menu] > *,
    [data-testid=video_left_menu] .AsideMenuLayout__container--uN7o0,
    [data-testid=video_left_menu] .AsideMenuLayout__fixedTop--c4Ob1,
    [data-testid=video_left_menu] .vkuiFixedLayout__host,
    [data-testid=video_left_menu] .vkuiCustomScrollView__host,
    [data-testid=video_left_menu] .vkuiDiv__host{
      background:transparent!important;
      background-color:transparent!important;
      box-shadow:none!important;
      border-color:transparent!important;
      -webkit-backdrop-filter:none!important;
      backdrop-filter:none!important;
    }
  `;

  function ensureStyle(root) {
    if (!root?.querySelector || !root.appendChild) return;
    if (root.querySelector(`style[${STYLE_MARKER}]`)) return;
    const st=document.createElement('style');
    st.setAttribute(STYLE_MARKER,'1');
    st.textContent=AMBIENT_CSS;
    root.appendChild(st);
  }

  function style() {
    ensureStyle(document.head || document.documentElement);
  }

  function findRoots() {
    const roots = [document];
    const seen = new Set();
    for (let i=0; i<roots.length; i++) {
      const root = roots[i];
      if (!root || seen.has(root)) continue;
      seen.add(root);
      root.querySelectorAll?.('*').forEach(el => { if (el.shadowRoot) roots.push(el.shadowRoot); });
    }
    return roots;
  }

  function isClipVideo(v) {
    if (!v) return false;
    try {
      if (v.closest?.('[data-testid=\"clips-feed-item\"]')) return true;
      if (v.closest?.('[data-testid=\"clipcontainer-video\"]')) return true;
      if (v.closest?.('[data-testid=\"clips-carousel-vertical-item\"]')) return true;
    } catch {}
    return false;
  }

  function getVideos() {
    const out = [];
    for (const root of findRoots()) {
      for (const v of root.querySelectorAll?.('video.player-media, vk-video-player video, video') || []) {
        if (isClipVideo(v)) continue;
        const r = v.getBoundingClientRect?.();
        if (!r || r.width < 160 || r.height < 90 || r.bottom < 0 || r.right < 0 ||
            r.top > innerHeight || r.left > innerWidth) continue;
        out.push(v);
      }
    }
    return [...new Set(out)];
  }

  function pickVideo() {
    const vids = getVideos();
    // When a VK card/mini-player is hovered, prefer that exact media element
    // so Ambient follows the preview instead of a background/hidden player.
    const hovered=vids.find(v=>{try{return v.matches(':hover')}catch{return false}});
    if(hovered)return hovered;
    let best = null, score = -Infinity;
    for (const v of vids) {
      const r = v.getBoundingClientRect();
      const area = r.width*r.height;
      const s = area + (v.paused ? 0 : 1000000) + ((v.readyState >= 3) ? 120000 : 0);
      if (s > score) { score=s; best=v; }
    }
    return best;
  }

  function isClipPage() {
    const p=String(location.pathname||'').toLowerCase();
    return p === '/clip' || p.startsWith('/clip/') || p.startsWith('/clip-');
  }

  function getClipRoot(v) {
    if (!v) return null;
    const roots=findRoots();
    for (const root of roots) {
      const clip=root.querySelector?.('[data-testid=clips-feed-item]');
      if (clip && clip.contains?.(v)) return clip;
    }
    let n=v;
    for(let i=0;i<12 && n;i++){
      if(n.getAttribute?.('data-testid')==='clips-feed-item') return n;
      n=n.parentElement||n.host||null;
    }
    return null;
  }

  function makeHost() {
    if (state.host && state.barHost) return state.host;
    let h=state.host || document.createElement('div');
    h.id=HOST_ID;
    if (!h.querySelector('.vke-ambient-canvas')) h.innerHTML='<canvas class="vke-ambient-canvas"></canvas><div class="vke-ambient-fade"></div>';
    state.host=h;
    state.glow=h.querySelector('.vke-ambient-canvas');

    let bh=state.barHost || document.createElement('div');
    bh.id=HOST_ID+'-bars';
    if (!bh.querySelector('.vke-ambient-bar')) {
      bh.innerHTML=['left','right','top','bottom'].map(side=>`<div class="vke-ambient-bar vke-ambient-bar-${side}"><canvas></canvas></div>`).join('');
    }
    state.barHost=bh;
    state.bars={};
    for(const side of ['left','right','top','bottom']) state.bars[side]=bh.querySelector('.vke-ambient-bar-'+side);
    if (!state.canvas) {
      state.canvas=document.createElement('canvas');
      state.canvas.width=96; state.canvas.height=54;
      state.ctx=state.canvas.getContext('2d', {alpha:false, desynchronized:true});
    }
    if (state.glow && (!state.glow.width || !state.glow.height)) {
      state.glow.width=160; state.glow.height=90;
    }
    return h;
  }

  function buttonSvg() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.75a7.25 7.25 0 1 0 7.25 7.25A7.258 7.258 0 0 0 12 4.75Zm0 12.5A5.25 5.25 0 1 1 17.25 12 5.256 5.256 0 0 1 12 17.25ZM4.41 5.83 5.83 4.41 4.3 2.88 2.88 4.3Zm15.29 0 1.53-1.53-1.42-1.42-1.53 1.53ZM12 2h2V0h-2Zm0 22h2v-2h-2ZM22 11v2h2v-2Zm-22 0v2h2v-2Z"/></svg>`;
  }

  function findControlsRoot(video) {
    if (!video) return null;
    const root = video.getRootNode?.();
    const direct = root?.querySelector?.('.controls-right');
    if (direct) return direct;
    let n = video;
    for (let i = 0; i < 24 && n; i++) {
      const parent = n.parentNode || n.parentElement;
      const c = parent?.querySelector?.('.controls-right');
      if (c) return c;
      if (parent?.host) {
        const c2 = parent.host.shadowRoot?.querySelector?.('.controls-right');
        if (c2) return c2;
        n = parent.host;
      } else n = parent;
    }
    for (const r of findRoots()) {
      const c = r.querySelector?.('.controls-right');
      if (c) return c;
    }
    return null;
  }

  function ensureShadowStyle(root) {
    ensureStyle(root);
  }

  function findClipControlsGroup(){
    const roots=[document,...findRoots().filter(r=>r!==document)];
    for(const root of roots){
      const controls=root.querySelector?.('[data-testid="clips-feed-controls"]');
      if(!controls) continue;
      const groups=[...controls.querySelectorAll?.('[data-testid="roundedgroup"]')||[]];
      const group=groups.find(g=>g.querySelector?.('[data-testid="clips-controls-like-button"]'));
      if(group) return {group,controls};
    }
    return null;
  }

  function installClipButton(video){
    // Clips are intentionally excluded from Ambient Light for stability.
    // Remove any button left by an older build and never mutate the clips
    // controls/flex tree.
    try { document.getElementById(BUTTON_ID+'-clip-floating')?.remove(); } catch {}
    return false;

    /* legacy clip-button implementation intentionally disabled */
    const found=findClipControlsGroup();
    if(!found) return false;
    const {group}=found;
    let wrap=document.getElementById(BUTTON_ID+'-clip-floating');
    if(!wrap){
      wrap=document.createElement('div');
      wrap.id=BUTTON_ID+'-clip-floating';
      wrap.setAttribute('data-vke-ambient-clip-control','1');
      const shell=document.createElement('div'); shell.className='vke-ambient-clip-control-shell';
      const b=document.createElement('button');
      b.id=BUTTON_ID+'-clip'; b.type='button';
      b.className='vkit-jhwfrm vkit-U2BHxX vkuiInternalTappable vkuiIconButton__host vkuiIconButton__densityCompact vkuiTappable__host';
      b.setAttribute('aria-label','Настройки Ambient Light'); b.setAttribute('title','Настройки Ambient Light'); b.tabIndex=0; b.innerHTML=buttonSvg();
      const stop=(e)=>{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();};
      b.addEventListener('pointerdown',stop,true); b.addEventListener('mousedown',stop,true);
      b.addEventListener('click',(e)=>{stop(e); state.video=wrap.__vkeVideo||video||pickVideo(); makeHost(); openPanel(b);},true);
      b.addEventListener('mouseenter',()=>b.classList.add('vke-btn-hover'),true);
      b.addEventListener('mouseleave',()=>b.classList.remove('vke-btn-hover'),true);
      shell.appendChild(b); wrap.appendChild(shell); document.body.appendChild(wrap);
    }
    wrap.__vkeVideo=video||pickVideo();
    const b=wrap.querySelector('#'+BUTTON_ID+'-clip');
    b?.classList.toggle('vke-btn-active',!!settings.enabled);
    positionClipButton(wrap,group);
    return true;
  }

  function positionClipButton(wrap,group){
    const r=group?.getBoundingClientRect?.();
    if(!r||!r.width||!r.height||!wrap)return;
    // Do not insert anything into VK's flex tree: the carousel must keep its original geometry.
    const left=Math.min(innerWidth-60,Math.max(8,r.right+14));
    const top=Math.max(8,Math.min(innerHeight-60,r.top));
    wrap.style.position='fixed';
    wrap.style.left=`${Math.round(left)}px`;
    wrap.style.top=`${Math.round(top)}px`;
    wrap.style.width='52px';
    wrap.style.height='52px';
    wrap.style.pointerEvents='none';
    wrap.style.zIndex='2147483646';
  }

  function installButton(video) {
    if(isClipPage()) return installClipButton(video);
    const root=findControlsRoot(video);
    if(!root) return;
    const shadowRoot=root.getRootNode?.() || root;
    ensureShadowStyle(shadowRoot);
    if(root.querySelector?.('#'+BUTTON_ID+'-wrap')) return;
    const wrap=document.createElement('div'); wrap.id=BUTTON_ID+'-wrap'; wrap.className='btn-container vke-extension-btn-container';
    const tooltip=document.createElement('div'); tooltip.className='tooltip-wrapper s-23 full-width';
    const b=document.createElement('button'); b.id=BUTTON_ID; b.type='button'; b.className='btn s-26';
    b.setAttribute('aria-label','Настройки Ambient Light'); b.setAttribute('title','Настройки Ambient Light'); b.innerHTML=buttonSvg();
    b.style.cssText='width:40px;height:40px;min-width:40px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:50%;background:rgba(255,255,255,.06);color:#fff;cursor:pointer;transition:background .16s ease,box-shadow .16s ease,opacity .16s ease;opacity:.82;';
    const stop=(e)=>{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();};
    b.addEventListener('pointerdown',stop,true);
    b.addEventListener('mousedown',stop,true);
    b.addEventListener('click',e=>{stop(e);openPanel(b);},true);
    b.addEventListener('mouseenter',()=>b.classList.add('vke-btn-hover'),true);
    b.addEventListener('mouseleave',()=>b.classList.remove('vke-btn-hover'),true);
    tooltip.appendChild(b); wrap.appendChild(tooltip);
    const more=root.querySelector?.('[data-testid="btn-context-menu"]');
    const target=more?.closest?.('.btn-container') || more?.parentElement;
    if(target && target.parentNode===root) root.insertBefore(wrap,target); else root.appendChild(wrap);
  }

  function openPanel(anchor) {
    closePanel();
    const p=document.createElement('div');
    p.className='vke-al-panel'+(isClipPage()?' vke-al-clip-page':'');
    p.innerHTML=`
      <h3>Ambient Light</h3>
      <label class="vke-al-toggle"><span>Эффект включён</span><input type="checkbox" data-k="enabled"></label>
      <div class="vke-al-row"><span>Размытие</span><input type="range" data-k="blur" min="0" max="1500"></div>
      <div class="vke-al-row"><span>Распространение</span><input type="range" data-k="spread" min="0" max="100"></div>
      <div class="vke-al-row"><span>Яркость</span><input type="range" data-k="brightness" min="70" max="150"></div>
      <div class="vke-al-row"><span>Насыщенность</span><input type="range" data-k="saturation" min="70" max="180"></div>
      <div class="vke-al-row"><span>Прозрачность эффекта</span><input type="range" data-k="opacity" min="20" max="100"></div>
      <div class="vke-al-row vke-al-bars-setting"><span>Прозрачность полос</span><input type="range" data-k="barTransparency" min="0" max="100"></div>
      <div class="vke-al-row vke-al-bars-setting"><span>Красочность полос</span><input type="range" data-k="barSaturation" min="0" max="250"></div>
      <label class="vke-al-toggle vke-al-fill-setting"><span>Заполнить плеер без чёрных полос <small style="opacity:.65">(с обрезкой краёв)</small></span><input type="checkbox" data-k="fillVideo"></label>
      <div class="vke-al-actions"><button data-a="reset">Сбросить</button><button data-a="close">Закрыть</button></div>`;
    for (const el of p.querySelectorAll('[data-k]')) {
      const k=el.dataset.k;
      if(el.type==='checkbox') el.checked=!!settings[k];
      else if(k==='barTransparency') el.value=String(Math.round((1-Math.max(0,Math.min(1,Number(settings.barOpacity)||0)))*100));
      else el.value=String(k==='opacity'||k==='saturation'||k==='brightness'||k==='barSaturation'?settings[k]*100:settings[k]);
      el.addEventListener('input',()=>{
        let v=el.type==='checkbox'?el.checked:Number(el.value);
        if(k==='brightness'||k==='saturation') v=v/100;
        if(k==='opacity'||k==='barSaturation') v=v/100;
        if(k==='barTransparency') { settings.barOpacity = 1 - Math.max(0,Math.min(100,v))/100; saveSettings(); apply(); position(); return; }
        settings[k]=v; saveSettings(); apply(); position(); if(k==='fillVideo') syncBarControls(p);
      });
    }
    p.querySelector('[data-a="reset"]').onclick=()=>{settings={...defaults};saveSettings();closePanel();openPanel(anchor);apply();};
    syncBarControls(p);
    p.querySelector('[data-a="close"]').onclick=closePanel;
    document.body.appendChild(p);
    state.open=true;
    const r=anchor.getBoundingClientRect();
    let x=Math.min(innerWidth-p.offsetWidth-12, Math.max(12,r.right-p.offsetWidth));
    let y=Math.max(12,r.top-p.offsetHeight-10);
    if(y<12) y=Math.min(innerHeight-p.offsetHeight-12,r.bottom+10);
    p.style.left=x+'px'; p.style.top=y+'px';
    requestAnimationFrame(()=>document.addEventListener('pointerdown', outsidePanel, true));
  }
  function outsidePanel(e){
    const p=document.querySelector('.vke-al-panel');
    const b=document.getElementById(BUTTON_ID);
    if (p && !p.contains(e.target) && e.target!==b) closePanel();
  }
  function closePanel(){
    document.querySelectorAll('.vke-al-panel').forEach(x=>x.remove());
    document.removeEventListener('pointerdown',outsidePanel,true);
    state.open=false;
  }

  function syncFillVideo() {
    const v=state.video;
    if(!v) return;
    if(settings.fillVideo){
      // Force the actual media element, including players rendered inside Shadow DOM,
      // to cover its box. CSS from the host/player can otherwise keep `contain`.
      v.style.setProperty('object-fit','cover','important');
      v.style.setProperty('object-position','center center','important');
      v.classList.add('vke-force-fill-video');
    }else{
      v.style.removeProperty('object-fit');
      v.style.removeProperty('object-position');
      v.classList.remove('vke-force-fill-video');
    }
    const player=v.closest?.('vk-video-player');
    if(player) player.classList.toggle('vke-fill-video', !!settings.fillVideo);
  }

  function syncBarControls(panel){
    if(!panel) return;
    const disabled=!!settings.fillVideo;
    for(const k of ['barTransparency','barSaturation']){
      const el=panel.querySelector(`[data-k="${k}"]`);
      const row=el?.closest('.vke-al-row');
      if(el) el.disabled=disabled;
      if(row){
        row.style.opacity=disabled?'0.45':'1';
        row.style.pointerEvents=disabled?'none':'auto';
      }
    }
  }

  function apply() {
    const h=state.host;
    if (!h) return;
    const blurPx = Math.max(0, Math.min(1000, Number(settings.blur) || 0));
    // The same blur control drives four directional edge layers.
    // Ease the range so the first part stays smooth and the upper end still
    // gives enough reach for very wide letterbox areas.
    const barBlurPx = Math.max(0, Math.min(1500, Math.pow(blurPx / 1500, 1.35) * 1500));
    const barOpacity = Math.max(0, Math.min(1, Number(settings.barOpacity) || 0));
    const barSat = Math.max(0, Math.min(2.5, Number(settings.barSaturation) || 0));
    h.style.setProperty('--vke-al-blur', `${blurPx}px`);
    h.style.setProperty('--vke-al-bar-blur', `${barBlurPx}px`);
    h.style.setProperty('--vke-al-bar-opacity', `${barOpacity}`);
    h.style.setProperty('--vke-al-bar-sat', `${barSat}`);
    syncFillVideo();
    // Bar layer is mounted inside the player separately from the main ambient
    // host, so its CSS variables must be applied to barHost itself. Previously
    // these were set only on h, making the two bar controls visually inert.
    const bh = state.barHost;
    if (bh) {
      bh.style.setProperty('--vke-al-bar-blur', `${barBlurPx}px`);
      bh.style.setProperty('--vke-al-bar-opacity', `${barOpacity}`);
      bh.style.setProperty('--vke-al-bar-sat', `${barSat}`);
    }
    h.style.setProperty('--vke-al-opacity', `${settings.opacity}`);
    h.style.setProperty('--vke-al-sat', `${settings.saturation}`);
    h.style.setProperty('--vke-al-bright', `${settings.brightness}`);
    if (settings.enabled) { h.classList.add('vke-ambient-visible'); if (!settings.fillVideo) state.barHost?.classList.add('vke-ambient-bars-visible'); else state.barHost?.classList.remove('vke-ambient-bars-visible'); } else { h.classList.remove('vke-ambient-visible'); state.barHost?.classList.remove('vke-ambient-bars-visible'); }
    const b=document.getElementById(BUTTON_ID); if(b) b.classList.toggle('vke-btn-active', !!settings.enabled);
  }

  function setBarRect(el, r) {
    if (!el) return;
    el.style.left = `${Math.max(0,r.left)}px`;
    el.style.top = `${Math.max(0,r.top)}px`;
    el.style.width = `${Math.max(0,r.width)}px`;
    el.style.height = `${Math.max(0,r.height)}px`;
    el.classList.toggle('vke-ambient-bar-visible', r.width > 2 && r.height > 2);
  }

  function getMediaContentRect(v) {
    const r=v.getBoundingClientRect();
    const vw=Number(v.videoWidth)||0, vh=Number(v.videoHeight)||0;
    if(!vw || !vh || r.width<2 || r.height<2) return {box:r,left: r.left,top:r.top,width:r.width,height:r.height};
    const videoRatio=vw/vh, boxRatio=r.width/r.height;
    let w=r.width, h=r.height, x=r.left, y=r.top;
    if(videoRatio > boxRatio){
      h=r.width/videoRatio; y=r.top+(r.height-h)/2;
    } else if(videoRatio < boxRatio){
      w=r.height*videoRatio; x=r.left+(r.width-w)/2;
    }
    return {box:r,left:x,top:y,width:w,height:h};
  }

  function positionBars() {
    const bh=state.barHost, v=state.video;
    if(!bh || !v) return;
    const r=v.getBoundingClientRect();
    const c=getMediaContentRect(v);
    const player=v.closest?.('vk-video-player') || v.parentElement;
    const pr=player?.getBoundingClientRect?.() || r;
    const px=c.left-pr.left, py=c.top-pr.top;
    const left=Math.max(0,c.left-r.left), right=Math.max(0,(r.left+r.width)-(c.left+c.width));
    const top=Math.max(0,c.top-r.top), bottom=Math.max(0,(r.top+r.height)-(c.top+c.height));
    setBarRect(state.bars.left, {left:Math.max(0, r.left-pr.left),top:py,width:left,height:c.height});
    setBarRect(state.bars.right, {left:Math.max(0, r.left-pr.left+(c.left-r.left)+c.width),top:py,width:right,height:c.height});
    setBarRect(state.bars.top, {left:Math.max(0, r.left-pr.left),top:Math.max(0,r.top-pr.top),width:r.width,height:top});
    setBarRect(state.bars.bottom, {left:Math.max(0, r.left-pr.left),top:Math.max(0,r.top-pr.top+(c.top-r.top)+c.height),width:r.width,height:bottom});
    const any=left>2 || right>2 || top>2 || bottom>2;
    bh.classList.toggle('vke-ambient-bars-visible', any && settings.enabled && !settings.fillVideo);
  }

  function drawBars() {
    const c=state.canvas, v=state.video;
    if(!c || !v || !state.bars || settings.fillVideo) return;
    const cw=c.width, ch=c.height;
    // Four independent directional samples. Each bar gets pixels from the
    // matching physical edge of the actual video instead of the centre.
    const edgeX=Math.max(4,Math.round(cw*.065));
    const edgeY=Math.max(4,Math.round(ch*.065));
    const crops={
      left:[0,0,edgeX,ch],
      right:[Math.max(0,cw-edgeX),0,edgeX,ch],
      top:[0,0,cw,edgeY],
      bottom:[0,Math.max(0,ch-edgeY),cw,edgeY]
    };
    for(const [side,el] of Object.entries(state.bars)){
      const b=el?.querySelector('canvas');
      if(!b || !el.classList.contains('vke-ambient-bar-visible')) continue;
      if(side==='left'||side==='right'){ b.width=96; b.height=192; }
      else { b.width=192; b.height=96; }
      const ctx=b.getContext('2d'); if(!ctx) continue;
      ctx.clearRect(0,0,b.width,b.height);
      ctx.imageSmoothingEnabled=true;
      ctx.imageSmoothingQuality='high';
      const [sx,sy,sw,sh]=crops[side];
      ctx.drawImage(c,sx,sy,sw,sh,0,0,b.width,b.height);
    }
  }

  function softenPageSurfaces() {
    try {
      const player = state.video?.closest?.('vk-video-player');
      if (player) {
        let node = player.parentElement;
        for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
          if (node.tagName === 'SECTION' && node.querySelector?.('vk-video-player')) {
            node.classList.add('vke-ambient-surface');
            break;
          }
        }
      }
      document.querySelectorAll('section[data-testid="video_page_playlist_videos"], section#video_recommendations').forEach(el => {
        el.classList.add('vke-ambient-surface');
      });
    document.querySelectorAll(
      '.vkuiSplitLayout__host, .vkuiSplitLayout__inner, [data-testid="video_spa_header"]'
    ).forEach(el => {
      if (el.querySelector?.('[data-testid="video_spa_header"]') || el.matches?.('[data-testid="video_spa_header"]')) {
        el.style.setProperty('background','transparent','important');
        el.style.setProperty('background-color','transparent','important');
      }
    });

    } catch {}
  }

  function getPlayerRoot(v){
    if(!v) return null;
    let n=v;
    for(let i=0;i<40 && n;i++){
      const p=n.parentElement;
      if(p?.classList?.contains('root-container')) return p;
      n=p || n.parentNode || null;
      if(n?.host) {
        const host=n.host;
        if(host?.classList?.contains('root-container')) return host;
        n=host;
      }
    }
    const host=v.closest?.('vk-video-player');
    const roots=[host?.shadowRoot, host, document].filter(Boolean);
    for(const r of roots){
      const q=r.querySelector?.('.root-container');
      if(q) return q;
    }
    return v.parentElement || null;
  }

  function mountAmbientHosts(v){
    makeHost();
    const clipMode=isClipPage();
    const clipRoot=clipMode ? getClipRoot(v) : null;
    const globalTarget=document.body || document.documentElement;

    if (clipRoot) {
      clipRoot.classList.add('vke-ambient-clip-root');
      // Clip ambient is mounted on BODY, not inside the clip card. This prevents
      // carousel/card overflow from clipping the glow and keeps the glow around
      // the player instead of painting over its pixels.
      if (state.host.parentNode !== globalTarget) {
        try { globalTarget.appendChild(state.host); } catch {}
      }
      state.host.classList.add('vke-ambient-clip-mode');
      state.host.classList.remove('vke-ambient-visible');
    } else {
      if(state.host.parentNode !== globalTarget) globalTarget.appendChild(state.host);
      state.host.classList.remove('vke-ambient-clip-mode');
    }

    // Bars are still tied to the media player for normal VK Video pages.
    // Clips have no letterbox bars, so never mount/use the bar layer there.
    if (!clipMode) {
      const player=v?.closest?.('vk-video-player') || v?.parentElement || globalTarget;
      if (player && state.barHost.parentNode !== player) {
        try { player.appendChild(state.barHost); } catch { if(state.barHost.parentNode !== globalTarget) globalTarget.appendChild(state.barHost); }
      }
    } else if (state.barHost?.parentNode) {
      state.barHost.classList.remove('vke-ambient-bars-visible');
      state.barHost.remove();
    }
    ensureStyle(document.head || document.documentElement);
    return clipRoot || globalTarget;
  }

  function position() {
    const v=state.video;
    const h=state.host;
    if(!v||!h) return;
    mountAmbientHosts(v);
    document.querySelectorAll?.('[data-testid=clips-feed-item].vke-ambient-clip-root').forEach(el=>{
      if(el !== getClipRoot(v)) el.classList.remove('vke-ambient-clip-root');
    });
    const r=v.getBoundingClientRect();
    if(!r.width||!r.height) return;
    const clipMode=isClipPage() && !!getClipRoot(v);

    // Spread is a true outward coverage control: 0% keeps the ambient source
    // exactly on the player, 100% reaches every visible viewport edge around it.
    const sp=Math.max(0,Math.min(100,Number(settings.spread)||0))/100;
    let reach=0;
    if (clipMode) {
      // For clips, spread is measured from the actual video edges and the ambient
      // layer stays behind the video itself. Never enlarge using the 800px feed card.
      const maxOut=Math.max(r.left, innerWidth-r.right, r.top, innerHeight-r.bottom, 0);
      reach=Math.min(Math.max(innerWidth,innerHeight), maxOut)*sp;
    } else {
      const maxOut=Math.max(r.left, innerWidth-r.right, r.top, innerHeight-r.bottom, 0);
      reach=Math.min(Math.max(innerWidth,innerHeight), maxOut)*sp;
    }

    if (clipMode) {
      h.style.left=`${r.left-reach}px`;
      h.style.top=`${r.top-reach}px`;
      h.style.zIndex='1';
    } else {
      h.style.left=`${r.left-reach}px`;
      h.style.top=`${r.top-reach}px`;
      h.style.zIndex='19';
    }
    h.style.width=`${r.width+reach*2}px`;
    h.style.height=`${r.height+reach*2}px`;
    h.style.borderRadius='0';

    // Keep the real video-sized source centered inside the expanded ambient host.
    h.style.setProperty('--vke-al-canvas-left', `${reach}px`);
    h.style.setProperty('--vke-al-canvas-top', `${reach}px`);
    h.style.setProperty('--vke-al-canvas-width', `${r.width}px`);
    h.style.setProperty('--vke-al-canvas-height', `${r.height}px`);

    positionBars();
  }

  function renderFrame(v) {
    if(!settings.enabled || !v || v.readyState<2 || v.paused || v.ended) return;
    try{
      const glowCtx=state.glow.getContext('2d');
      if(!glowCtx) return;
      glowCtx.clearRect(0,0,state.glow.width,state.glow.height);
      state.ctx.clearRect(0,0,state.canvas.width,state.canvas.height);
      state.ctx.drawImage(v,0,0,state.canvas.width,state.canvas.height);
      glowCtx.drawImage(state.canvas,0,0,state.glow.width,state.glow.height);
      drawBars();
    }catch{}
  }

  function bindVideoHover(v){
    if(!v || v.__vkeAmbientHoverBound)return;
    v.__vkeAmbientHoverBound=true;
    const enter=()=>{
      if(state.video!==v){ state.video=v; state.last=0; makeHost(); installButton(v); position(); apply(); }
      if(typeof v.requestVideoFrameCallback==='function'){ try{ v.requestVideoFrameCallback(()=>renderFrame(v)); }catch{} }
    };
    v.addEventListener('pointerenter',enter,{passive:true});
    v.addEventListener('mouseenter',enter,{passive:true});
  }

  function draw(ts) {
    state.raf=requestAnimationFrame(draw);
    for(const candidate of getVideos()) bindVideoHover(candidate);
    const v=pickVideo();
    if(v!==state.video){
      state.video=v;
      state.last=0;
    }
    if(!v){
      state.host?.classList.remove('vke-ambient-visible');
      state.barHost?.classList.remove('vke-ambient-bars-visible');
      return;
    }
    makeHost(); installButton(v); if(isClipPage()){ const found=findClipControlsGroup(); if(found) installClipButton(v); } softenPageSurfaces(); position(); apply();

    // Keep geometry/UI in the rAF loop, but render the actual image on every
    // decoded video frame. This removes the visible sampling delay that the
    // old 24 FPS timer introduced.
    if (v !== state._rvfVideo) {
      state._rvfVideo = v;
      if (typeof v.requestVideoFrameCallback === 'function') {
        const tick = (_now, meta) => {
          if (state._rvfVideo !== v) return;
          renderFrame(v);
          try { v.requestVideoFrameCallback(tick); } catch {}
        };
        try { v.requestVideoFrameCallback(tick); } catch {}
      }
    }
    if (typeof v.requestVideoFrameCallback !== 'function') {
      const minDt=1000/Math.max(24,Math.min(60,Number(settings.frameRate)||60));
      if(ts-state.last>=minDt){ state.last=ts; renderFrame(v); }
    }
  }

  loadSettings(); removeVkVideoAds(); style(); makeHost();
  // Hard reset of legacy clip Ambient state: no glow, no bars, no clip button.
  try { document.getElementById(BUTTON_ID+'-clip-floating')?.remove(); } catch {}
  document.querySelectorAll?.('[data-testid=clips-feed-item].vke-ambient-clip-root').forEach(el=>el.classList.remove('vke-ambient-clip-root'));
  state.host?.classList.remove('vke-ambient-clip-mode','vke-ambient-visible');
  state.barHost?.classList.remove('vke-ambient-bars-visible');
  apply();
  const mo=new MutationObserver(()=>{
    removeVkVideoAds();
    try { document.getElementById(BUTTON_ID+'-clip-floating')?.remove(); } catch {}
    const v=pickVideo();
    if(v){ installButton(v); softenPageSurfaces(); }
  });
  mo.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('resize',()=>position(),{passive:true});
  document.addEventListener('fullscreenchange',()=>setTimeout(()=>{const v=pickVideo();if(v)installButton(v);position();},50),{passive:true});
  requestAnimationFrame(draw);
})();
