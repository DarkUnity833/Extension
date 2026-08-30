(function () {
  "use strict";

  if (window.__rutubeTranscriptYouTubeBridge) return;
  window.__rutubeTranscriptYouTubeBridge = true;

  const BRIDGE_SOURCE = "rutube-transcript-page-bridge";
  const CONTENT_SOURCE = "rutube-transcript-content";
  const MAX_CACHE_ITEMS = 6;
  const state = {
    captionResponses: [],
    transcriptResponses: [],
    lastRateLimitAt: 0,
    captionsAutoEnabled: false,
    captionsAutoEnabledForVideoId: "",
  };

  function getCurrentVideoId(url = "") {
    try {
      const resolvedUrl = new URL(url || location.href, location.href);
      const watchId = resolvedUrl.searchParams.get("v");
      if (watchId) return watchId;
      const shortsMatch = resolvedUrl.pathname.match(/\/shorts\/([^/?]+)/);
      return shortsMatch ? shortsMatch[1] : "";
    } catch (_) {
      return "";
    }
  }

  function post(type, payload = {}) {
    window.postMessage({ source: BRIDGE_SOURCE, type, payload }, "*");
  }

  function trimStore(listName) {
    if (state[listName].length > MAX_CACHE_ITEMS) {
      state[listName] = state[listName].slice(0, MAX_CACHE_ITEMS);
    }
  }

  function pushEntry(listName, entry, eventType) {
    if (!entry?.url || !entry?.body) return;
    const key = `${entry.url}::${entry.body.length}`;
    state[listName] = state[listName].filter(
      (item) => `${item.url}::${item.body.length}` !== key,
    );
    state[listName].unshift(entry);
    trimStore(listName);
    post(eventType, entry);
  }

  function captureResponse(url, status, body, contentType = "") {
    if (!url) return;

    if (url.includes("/api/timedtext")) {
      if (status === 429) {
        state.lastRateLimitAt = Date.now();
        post("youtube-rate-limit", { url, status });
        return;
      }
      if (status >= 200 && status < 300 && body) {
        pushEntry(
          "captionResponses",
          {
            url,
            status,
            body,
            contentType,
            videoId: getCurrentVideoId(url),
            capturedAt: Date.now(),
          },
          "youtube-caption-response",
        );
      }
      return;
    }

    if (url.includes("/youtubei/v1/get_transcript")) {
      if (status >= 200 && status < 300 && body) {
        pushEntry(
          "transcriptResponses",
          {
            url,
            status,
            body,
            contentType,
            videoId: getCurrentVideoId(),
            capturedAt: Date.now(),
          },
          "youtube-transcript-response",
        );
      }
    }
  }

  function wrapFetch() {
    if (typeof window.fetch !== "function") return;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function () {
      const response = await originalFetch(...arguments);
      try {
        const clone = response.clone();
        const url =
          clone.url ||
          (typeof arguments[0] === "string" ? arguments[0] : arguments[0]?.url) ||
          "";
        if (
          url.includes("/api/timedtext") ||
          url.includes("/youtubei/v1/get_transcript")
        ) {
          const body = await clone.text();
          captureResponse(
            url,
            clone.status,
            body,
            clone.headers.get("content-type") || "",
          );
        }
      } catch (_) {
        // Ignore bridge capture issues and return the original response.
      }
      return response;
    };
  }

  function wrapXHR() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      this.__rutubeTranscriptUrl = typeof url === "string" ? url : "";
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      this.addEventListener("load", function () {
        try {
          const url = this.__rutubeTranscriptUrl || this.responseURL || "";
          if (
            !url.includes("/api/timedtext") &&
            !url.includes("/youtubei/v1/get_transcript")
          ) {
            return;
          }

          const body =
            typeof this.responseText === "string" ? this.responseText : "";
          captureResponse(
            url,
            this.status,
            body,
            this.getResponseHeader("content-type") || "",
          );
        } catch (_) {
          // Ignore XHR bridge issues.
        }
      });

      return originalSend.apply(this, arguments);
    };
  }

  function openTranscriptPanel() {
    const selectors = [
      "ytd-video-description-transcript-section-renderer button",
      'button[aria-label*="transcript" i]',
      ".ytChipShapeButtonReset",
    ];

    for (const selector of selectors) {
      const candidates = Array.from(document.querySelectorAll(selector)).filter(
        (element) => {
          const text = (element.innerText || element.textContent || "")
            .trim()
            .toLowerCase();
          return (
            text.includes("transcript") ||
            text.includes("show transcript") ||
            text.includes("video transcript") ||
            text.includes("show video text") ||
            text.includes("показать текст видео") ||
            text.includes("текст видео") ||
            text.includes("транскрипт") ||
            text.includes("расшифров")
          );
        },
      );

      const visible =
        candidates.find((element) => element.offsetParent !== null) ||
        candidates[0];
      if (visible) {
        visible.click();
        return true;
      }
    }

    return false;
  }

  function findTranscriptParams() {
    const visited = new Set();
    const stack = [window.ytInitialData];

    while (stack.length > 0) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (visited.has(node)) continue;
      visited.add(node);

      const directParams = node?.getTranscriptEndpoint?.params;
      if (typeof directParams === "string" && directParams) return directParams;

      const continuationParams =
        node?.continuationEndpoint?.getTranscriptEndpoint?.params;
      if (typeof continuationParams === "string" && continuationParams) {
        return continuationParams;
      }

      if (Array.isArray(node)) {
        for (const item of node) stack.push(item);
        continue;
      }

      for (const value of Object.values(node)) stack.push(value);
    }

    return "";
  }

  function getInnertubeContext() {
    const context =
      window.ytcfg?.get?.("INNERTUBE_CONTEXT") ||
      window.ytcfg?.data_?.INNERTUBE_CONTEXT ||
      null;
    if (!context) return null;

    try {
      return JSON.parse(JSON.stringify(context));
    } catch (_) {
      return context;
    }
  }

  function getInnertubeHeaders() {
    const data = window.ytcfg?.data_ || {};
    const headers = {
      "content-type": "application/json",
    };

    if (data.INNERTUBE_CLIENT_NAME) {
      headers["x-youtube-client-name"] = String(data.INNERTUBE_CLIENT_NAME);
    }
    if (data.INNERTUBE_CLIENT_VERSION) {
      headers["x-youtube-client-version"] = String(data.INNERTUBE_CLIENT_VERSION);
    }
    if (data.VISITOR_DATA) {
      headers["x-goog-visitor-id"] = String(data.VISITOR_DATA);
    }
    if (data.SESSION_INDEX !== undefined && data.SESSION_INDEX !== null) {
      headers["x-goog-authuser"] = String(data.SESSION_INDEX);
    }
    if (data.DELEGATED_SESSION_ID) {
      headers["x-goog-pageid"] = String(data.DELEGATED_SESSION_ID);
    }
    if (data.ID_TOKEN) {
      headers["x-youtube-identity-token"] = String(data.ID_TOKEN);
    }

    return headers;
  }

  function getPlayerResponse() {
    const direct = window.ytInitialPlayerResponse;
    if (direct && typeof direct === "object") return direct;

    const raw = window.ytplayer?.config?.args?.player_response;
    if (!raw) return null;

    try {
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (_) {
      return null;
    }
  }

  function getCaptionTracks() {
    const playerResponse = getPlayerResponse();
    const tracks =
      playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    return Array.isArray(tracks) ? tracks.filter(Boolean) : [];
  }

  function pickPreferredCaptionTrack() {
    const tracks = getCaptionTracks().filter((track) => track.baseUrl);
    if (tracks.length === 0) return null;

    const nonAsrTracks = tracks.filter((track) => track.kind !== "asr");
    const prioritized = nonAsrTracks.length > 0 ? nonAsrTracks : tracks;
    const languagePrefs = [navigator.language, ...(navigator.languages || [])]
      .flatMap((lang) => {
        const exact = String(lang || "").trim().toLowerCase();
        if (!exact) return [];
        const base = exact.split("-")[0];
        return base && base !== exact ? [exact, base] : [exact];
      })
      .filter(Boolean);

    for (const pref of languagePrefs) {
      const exactMatch = prioritized.find(
        (track) => String(track.languageCode || "").toLowerCase() === pref,
      );
      if (exactMatch) return exactMatch;
    }

    for (const pref of languagePrefs) {
      const baseMatch = prioritized.find(
        (track) =>
          String(track.languageCode || "")
            .toLowerCase()
            .split("-")[0] === pref,
      );
      if (baseMatch) return baseMatch;
    }

    return prioritized[0];
  }

  function buildCaptionUrl(baseUrl, format) {
    if (!baseUrl) return "";
    try {
      const url = new URL(baseUrl, location.href);
      if (format) {
        url.searchParams.set("fmt", format);
      } else {
        url.searchParams.delete("fmt");
      }
      return url.toString();
    } catch (_) {
      return baseUrl;
    }
  }

  async function fetchPreferredCaptions() {
    const track = pickPreferredCaptionTrack();
    if (!track?.baseUrl) {
      return {
        applied: false,
        trackFound: false,
      };
    }

    const captionUrls = [
      buildCaptionUrl(track.baseUrl, null),
      buildCaptionUrl(track.baseUrl, "vtt"),
      buildCaptionUrl(track.baseUrl, "srv3"),
      buildCaptionUrl(track.baseUrl, "json3"),
    ];

    for (const captionUrl of captionUrls) {
      try {
        const response = await window.fetch(captionUrl, {
          credentials: "same-origin",
        });
        if (response.status === 429) {
          state.lastRateLimitAt = Date.now();
          post("youtube-rate-limit", { url: captionUrl, status: 429 });
          return {
            applied: false,
            trackFound: true,
            rateLimited: true,
          };
        }
        if (!response.ok) continue;

        const body = await response.text();
        captureResponse(
          response.url || captionUrl,
          response.status,
          body,
          response.headers.get("content-type") || "",
        );

        return {
          applied: Boolean(body),
          trackFound: true,
          url: response.url || captionUrl,
        };
      } catch (_) {
        // Try the next caption format.
      }
    }

    return {
      applied: false,
      trackFound: true,
    };
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function getMoviePlayer() {
    return document.getElementById("movie_player");
  }

  function getSubtitlesButton() {
    return document.querySelector(".ytp-subtitles-button");
  }

  function isCaptionsEnabled() {
    const player = getMoviePlayer();
    try {
      if (typeof player?.isSubtitlesOn === "function") {
        return player.isSubtitlesOn() === true;
      }
    } catch (_) {
      // Fall back to DOM state below.
    }

    return getSubtitlesButton()?.getAttribute("aria-pressed") === "true";
  }

  function activateButton(button) {
    if (!button) return false;

    try {
      button.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
      button.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
      button.click();
      return true;
    } catch (_) {
      return false;
    }
  }

  function tryEnableCaptions() {
    const player = getMoviePlayer();
    const button = getSubtitlesButton();

    if (isCaptionsEnabled()) {
      return { attempted: true, enabled: true, changed: false };
    }

    try {
      if (typeof player?.toggleSubtitlesOn === "function") {
        player.toggleSubtitlesOn();
        return {
          attempted: true,
          enabled: isCaptionsEnabled(),
          changed: isCaptionsEnabled(),
        };
      }
      if (
        typeof player?.isSubtitlesOn === "function" &&
        typeof player?.toggleSubtitles === "function" &&
        !player.isSubtitlesOn()
      ) {
        player.toggleSubtitles();
        return {
          attempted: true,
          enabled: isCaptionsEnabled(),
          changed: isCaptionsEnabled(),
        };
      }
    } catch (_) {
      // Fall back to button activation below.
    }

    if (button && button.getAttribute("aria-pressed") !== "true") {
      activateButton(button);
      return {
        attempted: true,
        enabled: isCaptionsEnabled(),
        changed: isCaptionsEnabled(),
      };
    }

    return { attempted: false, enabled: isCaptionsEnabled(), changed: false };
  }

  function tryDisableCaptions() {
    const player = getMoviePlayer();
    const button = getSubtitlesButton();

    if (!isCaptionsEnabled()) {
      return { attempted: true, enabled: false, changed: false };
    }

    try {
      if (typeof player?.toggleSubtitles === "function") {
        player.toggleSubtitles();
        return {
          attempted: true,
          enabled: isCaptionsEnabled(),
          changed: !isCaptionsEnabled(),
        };
      }
    } catch (_) {
      // Fall back to button activation below.
    }

    if (button && button.getAttribute("aria-pressed") === "true") {
      activateButton(button);
      return {
        attempted: true,
        enabled: isCaptionsEnabled(),
        changed: !isCaptionsEnabled(),
      };
    }

    return { attempted: false, enabled: isCaptionsEnabled(), changed: false };
  }

  async function ensureCaptions(options = {}) {
    const timeoutMs = Number(options.timeoutMs || 4500);
    const retryIntervalMs = Number(options.retryIntervalMs || 350);
    const currentVideoId = getCurrentVideoId();

    if (isCaptionsEnabled()) {
      state.captionsAutoEnabled = false;
      state.captionsAutoEnabledForVideoId = "";
      return {
        applied: true,
        enabled: true,
        changed: false,
        autoEnabled: false,
      };
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = tryEnableCaptions();
      if (result.enabled || isCaptionsEnabled()) {
        state.captionsAutoEnabled = true;
        state.captionsAutoEnabledForVideoId = currentVideoId;
        return {
          applied: true,
          enabled: true,
          changed: true,
          autoEnabled: true,
        };
      }

      await wait(retryIntervalMs);
    }

    return {
      applied: false,
      enabled: isCaptionsEnabled(),
      changed: false,
      autoEnabled: false,
    };
  }

  async function restoreCaptions(options = {}) {
    const timeoutMs = Number(options.timeoutMs || 2200);
    const retryIntervalMs = Number(options.retryIntervalMs || 250);
    const currentVideoId = getCurrentVideoId();

    if (
      !state.captionsAutoEnabled ||
      !state.captionsAutoEnabledForVideoId ||
      state.captionsAutoEnabledForVideoId !== currentVideoId
    ) {
      return {
        applied: false,
        restored: false,
        enabled: isCaptionsEnabled(),
      };
    }

    if (!isCaptionsEnabled()) {
      state.captionsAutoEnabled = false;
      state.captionsAutoEnabledForVideoId = "";
      return {
        applied: true,
        restored: true,
        enabled: false,
      };
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = tryDisableCaptions();
      if (!result.enabled && !isCaptionsEnabled()) {
        state.captionsAutoEnabled = false;
        state.captionsAutoEnabledForVideoId = "";
        return {
          applied: true,
          restored: true,
          enabled: false,
        };
      }

      await wait(retryIntervalMs);
    }

    return {
      applied: false,
      restored: false,
      enabled: isCaptionsEnabled(),
    };
  }

  async function fetchTranscript(params) {
    const resolvedParams =
      typeof params === "string" && params ? params : findTranscriptParams();
    const context = getInnertubeContext();
    if (!resolvedParams || !context) {
      return {
        applied: false,
        status: 0,
        paramsFound: Boolean(resolvedParams),
        contextFound: Boolean(context),
      };
    }

    try {
      const response = await window.fetch(
        "/youtubei/v1/get_transcript?prettyPrint=false",
        {
          method: "POST",
          credentials: "same-origin",
          headers: getInnertubeHeaders(),
          body: JSON.stringify({
            context,
            params: resolvedParams,
          }),
        },
      );

      return {
        applied: response.ok,
        status: response.status,
        paramsFound: true,
        contextFound: true,
      };
    } catch (_) {
      return {
        applied: false,
        status: 0,
        paramsFound: true,
        contextFound: true,
      };
    }
  }

  function getSnapshot() {
    return {
      captionResponses: state.captionResponses.slice(),
      transcriptResponses: state.transcriptResponses.slice(),
      lastRateLimitAt: state.lastRateLimitAt,
    };
  }

  function clearCache() {
    state.captionResponses = [];
    state.transcriptResponses = [];
    state.lastRateLimitAt = 0;
    state.captionsAutoEnabled = false;
    state.captionsAutoEnabledForVideoId = "";
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== CONTENT_SOURCE) return;

    if (data.type === "youtube:get-cache") {
      post("youtube-cache", {
        requestId: data.requestId,
        state: getSnapshot(),
      });
      return;
    }

    if (data.type === "youtube:open-transcript") {
      post("youtube-command-result", {
        requestId: data.requestId,
        command: "open-transcript",
        applied: openTranscriptPanel(),
      });
      return;
    }

    if (data.type === "youtube:ensure-captions") {
      ensureCaptions().then((result) => {
        post("youtube-command-result", {
          requestId: data.requestId,
          command: "ensure-captions",
          ...result,
        });
      });
      return;
    }

    if (data.type === "youtube:restore-captions") {
      restoreCaptions().then((result) => {
        post("youtube-command-result", {
          requestId: data.requestId,
          command: "restore-captions",
          ...result,
        });
      });
      return;
    }

    if (data.type === "youtube:clear-cache") {
      clearCache();
      post("youtube-command-result", {
        requestId: data.requestId,
        command: "clear-cache",
        applied: true,
      });
      return;
    }

    if (data.type === "youtube:fetch-transcript") {
      fetchTranscript(data.params).then((result) => {
        post("youtube-command-result", {
          requestId: data.requestId,
          command: "fetch-transcript",
          ...result,
        });
      });
      return;
    }

    if (data.type === "youtube:fetch-captions") {
      fetchPreferredCaptions().then((result) => {
        post("youtube-command-result", {
          requestId: data.requestId,
          command: "fetch-captions",
          ...result,
        });
      });
    }
  });

  wrapFetch();
  wrapXHR();
  post("youtube-ready", { state: getSnapshot() });
})();
