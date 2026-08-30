(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  modules.createYouTubeController = function createYouTubeController(deps) {
    const TRANSCRIPT_RU = "\u0442\u0440\u0430\u043d\u0441\u043a\u0440\u0438\u043f\u0442";
    const DECIPHER_RU = "\u0440\u0430\u0441\u0448\u0438\u0444\u0440\u043e\u0432";
    const CLOSE_RU = "\u0437\u0430\u043a\u0440\u044b";
    const SHOW_VIDEO_TEXT_RU = "\u043f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u0442\u0435\u043a\u0441\u0442 \u0432\u0438\u0434\u0435\u043e";
    const VIDEO_TEXT_RU = "\u0442\u0435\u043a\u0441\u0442 \u0432\u0438\u0434\u0435\u043e";

    let youtubeSubtitleObserver = null;
    let youtubeSubtitleFetchTimer = null;
    let youtubeSubtitlePollInterval = null;
    let youtubeLiveCaptionObserver = null;
    let youtubeLiveCaptionPollInterval = null;
    let youtubeLiveCaptionLastSignature = "";
    let youtubeAutoFetchAttempts = 0;
    let youtubeEnsureCaptionsEnabled = false;
    let youtubeEnsureCaptionsInFlight = null;
    let youtubeEnsureCaptionsLastAttemptAt = 0;
    let youtubeGestureCaptionsEnabled = false;
    let youtubeGestureCaptionsVideoId = "";
    let youtubeGestureCaptionsLastAttemptAt = 0;
    let youtubeLoadingStateUntil = 0;
    let youtubeLoadingStateTimer = null;
    let youtubeFetchCooldownUntil = 0;
    let youtubeBridgeListenerAttached = false;
    let youtubeBridgeRequestSeq = 0;
    const youtubeBridgePending = new Map();
    const youtubeBridgeCommandPending = new Map();
    const youtubeBridgeWaiters = new Set();
    const youtubeBridgeSeenEntries = new Set();

    function readSubtitleLanguage(...candidates) {
      for (const candidate of candidates) {
        if (typeof candidate !== "string") continue;
        const normalized = candidate.trim();
        if (normalized) return normalized;
      }
      return "";
    }

    function readSubtitleLanguageFromUrl(url = "") {
      try {
        const parsed = new URL(url, window.location?.href || location.href);
        return readSubtitleLanguage(
          parsed.searchParams.get("lang"),
          parsed.searchParams.get("tlang"),
        );
      } catch (_) {
        return "";
      }
    }

    function readCurrentTrackSubtitleLanguage(video = null) {
      const targetVideo =
        video ||
        deps.getPlayerRoot?.()?.querySelector?.("video") ||
        deps.getCurrentVideo?.() ||
        null;
      const tracks = Array.from(targetVideo?.textTracks || []).filter(
        (track) => track?.kind === "subtitles" || track?.kind === "captions",
      );
      if (tracks.length === 0) return "";

      const preferredTrack =
        tracks.find(
          (track) => track?.mode === "showing" || track?.mode === "hidden",
        ) || tracks[0];

      return readSubtitleLanguage(
        preferredTrack?.language,
        preferredTrack?.srclang,
        preferredTrack?.lang,
        preferredTrack?.label,
      );
    }

    function notifyBridgeWaiters(value = deps.hasSubtitles()) {
      if (youtubeBridgeWaiters.size === 0) return;
      for (const waiter of Array.from(youtubeBridgeWaiters)) {
        clearTimeout(waiter.timeoutId);
        waiter.resolve(value);
        youtubeBridgeWaiters.delete(waiter);
      }
    }

    function waitForBridgeSubtitles(timeoutMs = 4000) {
      if (deps.hasSubtitles()) return Promise.resolve(true);

      return new Promise((resolve) => {
        const waiter = {
          resolve,
          timeoutId: setTimeout(() => {
            youtubeBridgeWaiters.delete(waiter);
            resolve(deps.hasSubtitles());
          }, timeoutMs),
        };
        youtubeBridgeWaiters.add(waiter);
      });
    }

    function allocateBridgeRequestId() {
      return ++youtubeBridgeRequestSeq;
    }

    function sendBridgeMessage(type, requestId, extra = {}) {
      window.postMessage(
        {
          source: "rutube-transcript-content",
          type,
          requestId,
          ...extra,
        },
        "*",
      );
      return requestId;
    }

    function requestBridgeState(timeoutMs = 1000) {
      return new Promise((resolve) => {
        const requestId = allocateBridgeRequestId();
        const timeoutId = setTimeout(() => {
          youtubeBridgePending.delete(requestId);
          resolve(null);
        }, timeoutMs);

        youtubeBridgePending.set(requestId, (state) => {
          clearTimeout(timeoutId);
          resolve(state || null);
        });
        sendBridgeMessage("youtube:get-cache", requestId);
      });
    }

    function sendBridgeCommandResult(type, timeoutMs = 1000) {
      return new Promise((resolve) => {
        const requestId = allocateBridgeRequestId();
        const timeoutId = setTimeout(() => {
          youtubeBridgeCommandPending.delete(requestId);
          resolve({ applied: false });
        }, timeoutMs);

        youtubeBridgeCommandPending.set(requestId, (payload) => {
          clearTimeout(timeoutId);
          resolve(payload || { applied: false });
        });
        sendBridgeMessage(type, requestId);
      });
    }

    async function sendBridgeCommand(type, timeoutMs = 1000) {
      const payload = await sendBridgeCommandResult(type, timeoutMs);
      return Boolean(payload?.applied);
    }

    function consumeBridgeEntries(
      entries,
      source = "youtube_page_session",
      expectedVideoId = deps.getCurrentVideoId(),
    ) {
      if (!Array.isArray(entries) || entries.length === 0) return false;
      if (!deps.isExpectedVideoActive(expectedVideoId)) return false;

      for (const entry of entries) {
        if (!entry?.body || !entry?.url) continue;
        if (
          expectedVideoId &&
          entry.videoId &&
          String(entry.videoId) !== String(expectedVideoId)
        ) {
          continue;
        }

        const entryKey = `${entry.url}::${entry.body.length}`;
        if (youtubeBridgeSeenEntries.has(entryKey)) continue;
        youtubeBridgeSeenEntries.add(entryKey);

        if (
          deps.parseSubtitles(
            entry.body,
            entry.url,
            source,
            expectedVideoId || entry.videoId || deps.getCurrentVideoId(),
            {
              subtitleLanguage: readSubtitleLanguage(
                entry.languageCode,
                entry.language,
                readSubtitleLanguageFromUrl(entry.url),
              ),
            },
          )
        ) {
          notifyBridgeWaiters(true);
          return true;
        }
      }

      return false;
    }

    function handleBridgeMessage(event) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== "rutube-transcript-page-bridge") return;

      if (data.type === "youtube-rate-limit") {
        setFetchCooldown();
        notifyBridgeWaiters(false);
        return;
      }

      if (data.type === "youtube-cache") {
        const requestId = data.payload?.requestId;
        const resolver = youtubeBridgePending.get(requestId);
        if (resolver) {
          youtubeBridgePending.delete(requestId);
          resolver(data.payload?.state || null);
        }
        return;
      }

      if (data.type === "youtube-caption-response") {
        consumeBridgeEntries(
          [data.payload],
          "youtube_page_session",
          deps.getCurrentVideoId() || deps.getVideoId(),
        );
        return;
      }

      if (data.type === "youtube-transcript-response") {
        if (
          consumeBridgeEntries(
            [data.payload],
            "youtube_page_transcript_api",
            deps.getCurrentVideoId() || deps.getVideoId(),
          )
        ) {
          return;
        }
        notifyBridgeWaiters(deps.hasSubtitles());
        return;
      }

      if (data.type === "youtube-command-result") {
        const requestId = data.payload?.requestId;
        const resolver = youtubeBridgeCommandPending.get(requestId);
        if (resolver) {
          youtubeBridgeCommandPending.delete(requestId);
          resolver(data.payload || null);
        }
      }
    }

    function setupBridge() {
      if (youtubeBridgeListenerAttached) return;
      youtubeBridgeListenerAttached = true;
      window.addEventListener("message", handleBridgeMessage);
    }

    function clearSubtitleWatchers() {
      if (youtubeSubtitleFetchTimer) {
        clearTimeout(youtubeSubtitleFetchTimer);
        youtubeSubtitleFetchTimer = null;
      }
      if (youtubeSubtitlePollInterval) {
        clearInterval(youtubeSubtitlePollInterval);
        youtubeSubtitlePollInterval = null;
      }
      if (youtubeSubtitleObserver) {
        youtubeSubtitleObserver.disconnect();
        youtubeSubtitleObserver = null;
      }
      if (youtubeLiveCaptionObserver) {
        youtubeLiveCaptionObserver.disconnect();
        youtubeLiveCaptionObserver = null;
      }
      if (youtubeLiveCaptionPollInterval) {
        clearInterval(youtubeLiveCaptionPollInterval);
        youtubeLiveCaptionPollInterval = null;
      }
    }

    function resetFetchState() {
      if (youtubeLoadingStateTimer) {
        clearTimeout(youtubeLoadingStateTimer);
        youtubeLoadingStateTimer = null;
      }
      youtubeAutoFetchAttempts = 0;
      youtubeEnsureCaptionsEnabled = false;
      youtubeEnsureCaptionsInFlight = null;
      youtubeEnsureCaptionsLastAttemptAt = 0;
      youtubeLoadingStateUntil = 0;
      youtubeFetchCooldownUntil = 0;
      youtubeBridgeSeenEntries.clear();
      youtubeLiveCaptionLastSignature = "";
      notifyBridgeWaiters(false);
    }

    function resetLoadingStateWindow(durationMs = 35_000) {
      youtubeLoadingStateUntil = Date.now() + durationMs;
      if (youtubeLoadingStateTimer) {
        clearTimeout(youtubeLoadingStateTimer);
      }
      youtubeLoadingStateTimer = setTimeout(() => {
        youtubeLoadingStateTimer = null;
        deps.updateButtonState?.();
        deps.renderTranscriptContent?.();
      }, durationMs + 50);
    }

    function beginLoadingStateWindow(durationMs = 35_000) {
      if (youtubeLoadingStateUntil > 0) return;
      resetLoadingStateWindow(durationMs);
    }

    function getCaptionsToggleButton() {
      return (
        document.querySelector(".ytp-subtitles-button") ||
        document.querySelector('button[aria-keyshortcuts="c"]') ||
        null
      );
    }

    function areCaptionsEnabled(button = getCaptionsToggleButton()) {
      return button?.getAttribute("aria-pressed") === "true";
    }

    function activateControl(button) {
      if (!button || typeof button.dispatchEvent !== "function") return false;
      const MouseEventCtor =
        typeof MouseEvent === "function" ? MouseEvent : null;

      try {
        if (MouseEventCtor) {
          button.dispatchEvent(
            new MouseEventCtor("mousedown", {
              bubbles: true,
              cancelable: true,
              view: window,
            }),
          );
          button.dispatchEvent(
            new MouseEventCtor("mouseup", {
              bubbles: true,
              cancelable: true,
              view: window,
            }),
          );
        }
        if (typeof button.click === "function") {
          button.click();
        } else if (MouseEventCtor) {
          button.dispatchEvent(
            new MouseEventCtor("click", {
              bubbles: true,
              cancelable: true,
              view: window,
            }),
          );
        } else {
          return false;
        }
        return true;
      } catch (_) {
        return false;
      }
    }

    function primeCaptionsFromUserGesture(
      expectedVideoId = deps.getCurrentVideoId(),
    ) {
      if (!deps.isExpectedVideoActive(expectedVideoId)) return false;
      if (deps.hasCompleteSubtitles()) return false;
      resetLoadingStateWindow();

      let primed = false;
      const transcriptTrigger = getTranscriptTrigger();
      if (transcriptTrigger) {
        primed = activateControl(transcriptTrigger);
      }

      const button = getCaptionsToggleButton();
      youtubeGestureCaptionsLastAttemptAt = Date.now();
      if (!button) {
        return primed;
      }
      if (areCaptionsEnabled(button)) {
        return true;
      }

      const activated = activateControl(button);
      if (activated && areCaptionsEnabled(button)) {
        youtubeGestureCaptionsEnabled = true;
        youtubeGestureCaptionsVideoId = String(
          expectedVideoId || deps.getCurrentVideoId() || "",
        );
        youtubeEnsureCaptionsEnabled = true;
        youtubeEnsureCaptionsLastAttemptAt = youtubeGestureCaptionsLastAttemptAt;
        return true;
      }

      return Boolean(activated || primed);
    }

    function registerAutoFetchAttempt() {
      youtubeAutoFetchAttempts += 1;
    }

    function isFetchCoolingDown() {
      return Date.now() < youtubeFetchCooldownUntil;
    }

    function setFetchCooldown(cooldownMs = 45_000) {
      youtubeFetchCooldownUntil = Date.now() + cooldownMs;
    }

    async function ensureCaptionsEnabledNow(options = {}) {
      const { minRetryMs = 1200 } = options;

      if (youtubeEnsureCaptionsEnabled || areCaptionsEnabled()) return true;
      if (youtubeEnsureCaptionsInFlight) {
        return await youtubeEnsureCaptionsInFlight;
      }

      const now = Date.now();
      if (
        youtubeEnsureCaptionsLastAttemptAt > 0 &&
        now - youtubeEnsureCaptionsLastAttemptAt < minRetryMs
      ) {
        return false;
      }

      youtubeEnsureCaptionsLastAttemptAt = now;
      beginLoadingStateWindow();
      youtubeEnsureCaptionsInFlight = sendBridgeCommandResult(
        "youtube:ensure-captions",
        6000,
      )
        .then((result) => {
          if (result?.applied) {
            youtubeEnsureCaptionsEnabled = true;
          }
          return Boolean(result?.applied);
        })
        .finally(() => {
          youtubeEnsureCaptionsInFlight = null;
        });

      return await youtubeEnsureCaptionsInFlight;
    }

    async function ensureCaptionsWithRetry(options = {}) {
      const { attempts = 2, retryDelayMs = 900, minRetryMs = 1200 } = options;

      for (let attemptIndex = 0; attemptIndex < attempts; attemptIndex += 1) {
        const applied = await ensureCaptionsEnabledNow({
          minRetryMs: attemptIndex === 0 ? minRetryMs : 0,
        });
        if (applied || youtubeEnsureCaptionsEnabled || deps.hasSubtitles()) {
          return true;
        }

        if (attemptIndex < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }

      return false;
    }

    async function restoreAutoEnabledCaptions(options = {}) {
      const { force = false } = options;
      if (!force && deps.getSubtitleSourceMode?.() === "live_capture") {
        return false;
      }

      const bridgeResult = await sendBridgeCommandResult(
        "youtube:restore-captions",
        3500,
      );
      if (bridgeResult?.restored || bridgeResult?.enabled === false) {
        youtubeEnsureCaptionsEnabled = false;
        youtubeEnsureCaptionsInFlight = null;
        youtubeEnsureCaptionsLastAttemptAt = 0;
      }

      const currentVideoId = String(deps.getCurrentVideoId?.() || "");
      const canRestoreGestureCaptions =
        youtubeGestureCaptionsEnabled &&
        youtubeGestureCaptionsVideoId &&
        youtubeGestureCaptionsVideoId === currentVideoId;

      let gestureRestored = false;
      if (canRestoreGestureCaptions) {
        const deadline = Date.now() + 2500;
        while (Date.now() < deadline) {
          const button = getCaptionsToggleButton();
          if (!button || !areCaptionsEnabled(button)) {
            gestureRestored = true;
            break;
          }

          activateControl(button);
          if (!areCaptionsEnabled(button)) {
            gestureRestored = true;
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }

      if (gestureRestored || canRestoreGestureCaptions) {
        youtubeGestureCaptionsEnabled = false;
        youtubeGestureCaptionsVideoId = "";
        youtubeGestureCaptionsLastAttemptAt = 0;
      }

      return Boolean(bridgeResult?.restored || gestureRestored);
    }

    async function finalizeCaptionProbe(fetchResult, options = {}) {
      const {
        forceRestore = false,
        keepCaptionsForLiveCapture = true,
      } = options;
      const sourceMode = deps.getSubtitleSourceMode?.() || "none";
      const isLiveCapture = sourceMode === "live_capture";

      if (keepCaptionsForLiveCapture && isLiveCapture && !forceRestore) {
        return fetchResult;
      }

      if (deps.hasCompleteSubtitles() || forceRestore) {
        await restoreAutoEnabledCaptions({ force: forceRestore || !isLiveCapture });
      }

      return fetchResult;
    }

    function shouldShowLoadingState() {
      if (deps.hasCompleteSubtitles()) {
        youtubeLoadingStateUntil = 0;
        if (youtubeLoadingStateTimer) {
          clearTimeout(youtubeLoadingStateTimer);
          youtubeLoadingStateTimer = null;
        }
        return false;
      }
      return Date.now() < youtubeLoadingStateUntil;
    }

    function scheduleSubtitlesFetch(delayMs = 400) {
      if (isFetchCoolingDown()) return;
      if (youtubeAutoFetchAttempts >= 2) return;
      if (youtubeSubtitleFetchTimer) clearTimeout(youtubeSubtitleFetchTimer);

      youtubeSubtitleFetchTimer = setTimeout(() => {
        youtubeSubtitleFetchTimer = null;
        if (
          !deps.hasCompleteSubtitles() &&
          deps.getCurrentVideoId() === deps.getVideoId()
        ) {
          deps.requestSubtitlesNow();
        }
      }, delayMs);
    }

    function setupSubtitleWatchers() {
      clearSubtitleWatchers();

      const root = deps.getPlayerRoot();
      const observerRoot = root === document ? document.body : root;
      if (!observerRoot) return;

      youtubeSubtitleObserver = new MutationObserver((mutations) => {
        if (deps.hasCompleteSubtitles()) return;
        for (const mutation of mutations) {
          const target = mutation.target;
          const className = String(target?.className || "");
          if (
            className.includes("caption") ||
            className.includes("ytp-subtitles-button") ||
            Array.from(mutation.addedNodes || []).some((node) =>
              String(node?.className || "").includes("caption"),
            )
          ) {
            scheduleSubtitlesFetch(250);
            break;
          }
        }
      });

      youtubeSubtitleObserver.observe(observerRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "aria-label", "aria-hidden"],
      });

      let pollsRemaining = 2;
      youtubeSubtitlePollInterval = setInterval(() => {
        if (
          deps.hasCompleteSubtitles() ||
          pollsRemaining <= 0 ||
          isFetchCoolingDown()
        ) {
          clearInterval(youtubeSubtitlePollInterval);
          youtubeSubtitlePollInterval = null;
          return;
        }
        pollsRemaining -= 1;
        deps.requestSubtitlesNow();
      }, 8000);
    }

    function readLiveCaptionText() {
      const selectors = [
        ".ytp-caption-window-container .ytp-caption-segment",
        ".ytp-caption-window-container .captions-text",
        ".caption-window .captions-text",
        ".ytp-caption-window-container [class*='caption']",
      ];

      for (const selector of selectors) {
        const texts = Array.from(document.querySelectorAll(selector))
          .map((node) => cleanSubtitleText(node.textContent || ""))
          .filter(Boolean);
        if (texts.length > 0) {
          return texts.join(" ").replace(/\s+/g, " ").trim();
        }
      }

      return "";
    }

    function appendLiveCaption(text) {
      const cleanedText = cleanSubtitleText(text).replace(/\s+/g, " ").trim();
      const currentTime = Number(deps.getCurrentVideo()?.currentTime);
      if (!cleanedText || Number.isNaN(currentTime)) return false;

      const signature = `${Math.floor(currentTime * 2)}:${cleanedText}`;
      if (signature === youtubeLiveCaptionLastSignature) return false;
      youtubeLiveCaptionLastSignature = signature;

      const subtitles = deps.getSubtitles();
      const lastSubtitle = subtitles[subtitles.length - 1];

      if (lastSubtitle && lastSubtitle.text === cleanedText) {
        lastSubtitle.end = Math.max(
          lastSubtitle.end || lastSubtitle.start,
          currentTime,
        );
      } else {
        if (lastSubtitle && deps.getSubtitleSourceMode() === "live_capture") {
          lastSubtitle.end = Math.max(
            lastSubtitle.end || lastSubtitle.start,
            currentTime,
          );
        }
        subtitles.push({
          start: currentTime,
          end: currentTime + 2,
          text: cleanedText,
        });
      }

      deps.setHasSubtitles(subtitles.length > 0);
      deps.setSubtitleSourceMode("live_capture");
      deps.updateButtonState();
      deps.renderTranscriptContent();
      notifyBridgeWaiters(true);
      return true;
    }

    function captureLiveCaption() {
      if (deps.hasCompleteSubtitles()) return false;
      const text = readLiveCaptionText();
      if (!text) return false;
      return appendLiveCaption(text);
    }

    function startLiveCaptionCapture() {
      if (youtubeLiveCaptionObserver || !deps.getCurrentVideo()) return;
      const observerRoot = document.body || document.documentElement;
      if (!observerRoot) return;

      youtubeLiveCaptionObserver = new MutationObserver(() => {
        captureLiveCaption();
      });
      youtubeLiveCaptionObserver.observe(observerRoot, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      youtubeLiveCaptionPollInterval = setInterval(() => {
        if (deps.hasCompleteSubtitles()) return;
        captureLiveCaption();
      }, 700);

      captureLiveCaption();
    }

    async function fetchTextTrackSubtitles(
      expectedVideoId = deps.getCurrentVideoId(),
    ) {
      if (!deps.isExpectedVideoActive(expectedVideoId)) return false;
      const root = deps.getPlayerRoot();
      const video = root.querySelector("video");
      if (!video || !video.textTracks) return false;

      for (let i = 0; i < video.textTracks.length; i++) {
        const track = video.textTracks[i];
        if (track.kind !== "subtitles" && track.kind !== "captions") continue;
        const subtitleLanguage = readSubtitleLanguage(
          track.language,
          track.srclang,
          track.lang,
          track.label,
        );

        const prevMode = track.mode;
        if (track.mode === "disabled") track.mode = "hidden";

        try {
          const cues = await deps.waitForTrackCues(track, 6000);
          if (!cues || cues.length === 0) continue;

          const parsed = Array.from(cues)
            .map((cue) => ({
              start: cue.startTime,
              end: cue.endTime,
              text: cleanSubtitleText(cue.text || ""),
            }))
            .filter((cue) => cue.text);

          if (
            deps.storeLoadedSubtitles(parsed, {
              expectedVideoId,
              sourceMode: "youtube_text_tracks",
              subtitleLanguage,
            })
          ) {
            notifyBridgeWaiters(true);
            return true;
          }
        } finally {
          if (prevMode === "disabled") track.mode = prevMode;
        }
      }

      return false;
    }

    async function fetchBridgeCaptions(
      expectedVideoId = deps.getCurrentVideoId(),
    ) {
      if (!deps.isExpectedVideoActive(expectedVideoId)) return false;

      const fetched = await sendBridgeCommand("youtube:fetch-captions", 8000);
      if (!fetched) return false;

      await waitForBridgeSubtitles(4500);
      if (deps.hasCompleteSubtitles()) return true;
      if (await fetchTextTrackSubtitles(expectedVideoId)) return true;
      return deps.hasCompleteSubtitles();
    }

    function readTranscriptSegments() {
      const panel = getTranscriptPanel();
      const scope = panel || document;
      const legacySegments = Array.from(
        scope.querySelectorAll("ytd-transcript-segment-renderer"),
      )
        .map((segment) => {
          const timestampEl = segment.querySelector(
            '[class*="segment-timestamp"], #start-offset',
          );
          const textEl = segment.querySelector(
            '[class*="segment-text"], yt-formatted-string',
          );
          const lines = (segment.innerText || segment.textContent || "")
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
          const timestampText = (
            timestampEl?.textContent ||
            lines[0] ||
            ""
          ).trim();
          const rawText = textEl?.textContent || lines.slice(1).join(" ");
          const start = parseTimestamp(timestampText);
          const text = cleanSubtitleText(rawText);

          if (!text || Number.isNaN(start)) return null;
          return { start, end: start, text };
        })
        .filter(Boolean);

      if (legacySegments.length > 0) {
        return legacySegments;
      }

      return Array.from(
        document.querySelectorAll("transcript-segment-view-model"),
      )
        .map((segment) => {
          const timestampText = (
            segment.querySelector(".ytwTranscriptSegmentViewModelTimestamp")
              ?.textContent || ""
          ).trim();
          const text = Array.from(segment.children || [])
            .filter(
              (child) =>
                !String(child.className || "").includes("Timestamp"),
            )
            .map((child) => cleanSubtitleText(child.textContent || ""))
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          const start = parseTimestamp(timestampText);

          if (!text || Number.isNaN(start)) return null;
          return { start, end: start, text };
        })
        .filter(Boolean);
    }

    function getTranscriptSegmentsSignature(segments = []) {
      if (!Array.isArray(segments) || segments.length === 0) return "";

      return segments
        .slice(0, 20)
        .map((segment) => `${segment.start}:${segment.text}`)
        .join("|");
    }

    function getTranscriptPanel() {
      const exactPanel = document.querySelector(
        'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
      );
      if (exactPanel) return exactPanel;

      return (
        Array.from(
          document.querySelectorAll("ytd-engagement-panel-section-list-renderer"),
        ).find((panel) => {
          const targetId = String(panel.getAttribute("target-id") || "")
            .trim()
            .toLowerCase();
          return (
            targetId.includes("transcript") ||
            panel.querySelector("ytd-transcript-renderer")
          );
        }) || null
      );
    }

    function isTranscriptPanelOpen(panel = getTranscriptPanel()) {
      if (!panel) return false;

      const visibility = String(panel.getAttribute("visibility") || "");
      if (visibility.includes("EXPANDED")) return true;
      if (panel.hasAttribute("hidden")) return false;
      if (panel.getAttribute("aria-hidden") === "true") return false;

      const style = window.getComputedStyle(panel);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }

      const rect = panel.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function findTranscriptCloseControl(panel = getTranscriptPanel()) {
      if (!panel) return null;

      const directButton = panel.querySelector("#visibility-button button");
      if (directButton) return directButton;

      return (
        Array.from(panel.querySelectorAll("button, [role='button']")).find(
          (button) => {
            const label = [
              button.getAttribute("aria-label") || "",
              button.getAttribute("title") || "",
              button.textContent || "",
            ]
              .join(" ")
              .trim()
              .toLowerCase();

            return label.includes("close") || label.includes(CLOSE_RU);
          },
        ) || null
      );
    }

    function concealTranscriptPanel(
      panel = getTranscriptPanel(),
      options = {},
    ) {
      const { preserveLayout = false } = options;
      if (!panel) return false;

      panel.removeAttribute("hidden");
      panel.setAttribute("visibility", "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN");
      panel.setAttribute("aria-hidden", "true");
      panel.style.setProperty("opacity", "0", "important");
      panel.style.setProperty("pointer-events", "none", "important");
      panel.style.setProperty("z-index", "-1", "important");

      if (preserveLayout) {
        panel.style.removeProperty("position");
        panel.style.removeProperty("top");
        panel.style.removeProperty("left");
        panel.style.removeProperty("width");
        panel.style.removeProperty("max-height");
      } else {
        panel.style.setProperty("position", "fixed", "important");
        panel.style.setProperty("top", "0", "important");
        panel.style.setProperty("left", "-20000px", "important");
        panel.style.setProperty("width", "420px", "important");
        panel.style.setProperty("max-height", "80vh", "important");
      }

      return true;
    }

    function closeTranscriptPanel() {
      const panel = getTranscriptPanel();
      if (!panel) return false;
      if (!isTranscriptPanelOpen(panel)) {
        return concealTranscriptPanel(panel);
      }

      const closeButton = findTranscriptCloseControl(panel);
      if (!closeButton) {
        return concealTranscriptPanel(panel);
      }

      concealTranscriptPanel(panel);
      closeButton.click();
      setTimeout(() => {
        if (isTranscriptPanelOpen(panel)) {
          concealTranscriptPanel(panel);
        }
      }, 200);
      return true;
    }

    function scheduleTranscriptPanelClose() {
      closeTranscriptPanel();
      [200, 800, 1500].forEach((delayMs) => {
        setTimeout(() => {
          closeTranscriptPanel();
        }, delayMs);
      });
    }

    function clearTranscriptPanelContents(panel = getTranscriptPanel()) {
      if (!panel) return false;

      let cleared = false;
      Array.from(
        panel.querySelectorAll("ytd-transcript-segment-renderer"),
      ).forEach((segment) => {
        segment.remove();
        cleared = true;
      });

      const segmentsContainer = panel.querySelector("#segments-container");
      if (segmentsContainer) {
        segmentsContainer.replaceChildren();
        cleared = true;
      }

      return cleared;
    }

    function resetNativeTranscriptState() {
      const panel = getTranscriptPanel();
      clearTranscriptPanelContents(panel);
      closeTranscriptPanel();
    }

    function resetPageSessionState() {
      restoreAutoEnabledCaptions({ force: true })
        .catch(() => {})
        .finally(() => {
          youtubeGestureCaptionsEnabled = false;
          youtubeGestureCaptionsVideoId = "";
          youtubeGestureCaptionsLastAttemptAt = 0;
        });
      resetFetchState();
      resetNativeTranscriptState();
      sendBridgeCommand("youtube:clear-cache", 400).catch(() => {});
    }

    function getTranscriptTrigger() {
      const selectors = [
        "ytd-video-description-transcript-section-renderer button",
        'button[aria-label*="transcript" i]',
        '[class="ytChipShapeButtonReset"]',
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
              text.includes(TRANSCRIPT_RU) ||
              text.includes(DECIPHER_RU) ||
              text.includes(SHOW_VIDEO_TEXT_RU) ||
              text.includes(VIDEO_TEXT_RU)
            );
          },
        );

        const visible =
          candidates.find((element) => element.offsetParent !== null) ||
          candidates[0];
        if (visible) return visible;
      }

      return null;
    }

    async function fetchTranscriptPanelSubtitles(options = {}) {
      const {
        forceOpen = false,
        keepNativePanelOpen = false,
        expectedVideoId = deps.getCurrentVideoId(),
      } = options;
      let openedByExtension = false;

      try {
        const nativePanel = getTranscriptPanel();
        const panelWasOpen = isTranscriptPanelOpen(nativePanel);
        const existing = readTranscriptSegments();
        const existingSignature = getTranscriptSegmentsSignature(existing);

        const subtitleLanguage = readCurrentTrackSubtitleLanguage();

        if (
          deps.storeLoadedSubtitles(existing, {
            expectedVideoId,
            sourceMode: "youtube_transcript_panel",
            subtitleLanguage,
          })
        ) {
          notifyBridgeWaiters(true);
          return true;
        }

        if (!forceOpen) return false;

        const trigger = getTranscriptTrigger();
        if (!trigger) return false;

        if (!panelWasOpen) {
          clearTranscriptPanelContents(nativePanel);
        }

        if (!panelWasOpen) {
          trigger.click();
          openedByExtension = true;
          setTimeout(() => {
            concealTranscriptPanel(undefined, { preserveLayout: true });
          }, 250);
        }

        const parsed = await new Promise((resolve) => {
          let settled = false;
          const finish = (value) => {
            if (settled) return;
            settled = true;
            observer.disconnect();
            clearInterval(intervalId);
            clearTimeout(timeoutId);
            resolve(value);
          };

          const collect = () => {
            if (!deps.isExpectedVideoActive(expectedVideoId)) {
              finish([]);
              return;
            }
            const segments = readTranscriptSegments();
            const signature = getTranscriptSegmentsSignature(segments);
            if (
              segments.length > 0 &&
              (!existingSignature || signature !== existingSignature)
            ) {
              finish(segments);
            }
          };

          const observer = new MutationObserver(() => collect());
          observer.observe(document.body, { childList: true, subtree: true });
          const intervalId = setInterval(collect, 300);
          const timeoutId = setTimeout(() => finish([]), 45_000);

          collect();
        });

        if (
          deps.storeLoadedSubtitles(parsed, {
            expectedVideoId,
            sourceMode: "youtube_transcript_panel",
            subtitleLanguage:
              readCurrentTrackSubtitleLanguage() || subtitleLanguage,
          })
        ) {
          notifyBridgeWaiters(true);
          return true;
        }

        return false;
      } catch (e) {
        console.error("YouTube transcript panel error:", e);
        return false;
      } finally {
        if (openedByExtension && !keepNativePanelOpen) {
          setTimeout(() => {
            scheduleTranscriptPanelClose();
          }, 0);
        }
      }
    }

    async function fetchCaptionTrackApi() {
      try {
        const pageResp = await fetch(location.href, {
          credentials: "same-origin",
        });
        if (!pageResp.ok) throw new Error("YouTube page fetch failed");

        const pageHtml = await pageResp.text();
        const captionTracks = extractYouTubeCaptionTracks(pageHtml);
        const preferredTrack = pickPreferredYouTubeCaptionTrack(captionTracks, [
          navigator.language,
          ...(navigator.languages || []),
        ]);

        if (!preferredTrack?.baseUrl) return false;

        const captionUrls = [
          buildYouTubeCaptionUrl(preferredTrack.baseUrl, null),
          buildYouTubeCaptionUrl(preferredTrack.baseUrl, "vtt"),
          buildYouTubeCaptionUrl(preferredTrack.baseUrl, "srv3"),
          buildYouTubeCaptionUrl(preferredTrack.baseUrl, "json3"),
        ];

        for (const captionUrl of captionUrls) {
          const captionResp = await fetch(captionUrl, {
            credentials: "same-origin",
          });
          if (captionResp.status === 429) {
            setFetchCooldown();
            return false;
          }
          if (!captionResp.ok) continue;

          const captionText = await captionResp.text();
          if (
          deps.parseSubtitles(
              captionText,
              captionUrl,
              "youtube_caption_track_api",
              undefined,
              {
                subtitleLanguage: readSubtitleLanguage(
                  preferredTrack.languageCode,
                  preferredTrack?.name?.simpleText,
                  readSubtitleLanguageFromUrl(captionUrl),
                ),
              },
            )
          ) {
            notifyBridgeWaiters(true);
            return true;
          }
        }

        return false;
      } catch (e) {
        console.error("YouTube caption API error:", e);
        return false;
      }
    }

    async function fetchSessionSubtitles(
      expectedVideoId = deps.getCurrentVideoId(),
    ) {
      if (!deps.isExpectedVideoActive(expectedVideoId)) return false;
      setupBridge();

      const snapshot = await requestBridgeState();
      if (
        consumeBridgeEntries(
          snapshot?.captionResponses,
          "youtube_page_session",
          expectedVideoId,
        )
      ) {
        return true;
      }

      if (
        consumeBridgeEntries(
          snapshot?.transcriptResponses,
          "youtube_page_transcript_api",
          expectedVideoId,
        )
      ) {
        return true;
      }

      if (await fetchBridgeCaptions(expectedVideoId)) return true;
      if (await fetchTextTrackSubtitles(expectedVideoId)) return true;
      const captionsEnabled = await ensureCaptionsWithRetry();
      if (captionsEnabled) {
        await waitForBridgeSubtitles(2500);
        if (await fetchTextTrackSubtitles(expectedVideoId)) return true;
      }
      if (captureLiveCaption()) return true;
      return false;
    }

    async function fetchSubtitles(options = {}) {
      const { force = false, expectedVideoId = deps.getCurrentVideoId() } =
        options;

      if (!deps.isExpectedVideoActive(expectedVideoId)) return false;
      if (deps.hasCompleteSubtitles()) return true;
      if (force) resetLoadingStateWindow();

      let result = false;

      try {
        const sessionLoaded = await fetchSessionSubtitles(expectedVideoId);
        if (deps.hasCompleteSubtitles()) {
          result = true;
          return result;
        }
        if (sessionLoaded && !force) {
          result = true;
          return result;
        }
        if (!force) {
          result = false;
          return result;
        }

        const pageTranscriptFetched = await sendBridgeCommand(
          "youtube:fetch-transcript",
          2500,
        );
        if (pageTranscriptFetched) {
          await waitForBridgeSubtitles(3500);
          if (deps.hasCompleteSubtitles()) {
            result = true;
            return result;
          }
        }

        if (await fetchBridgeCaptions(expectedVideoId)) {
          result = true;
          return result;
        }

        if (
          await ensureCaptionsWithRetry({
            attempts: 4,
            retryDelayMs: 1200,
            minRetryMs: 0,
          })
        ) {
          await waitForBridgeSubtitles(4500);
          if (await fetchSessionSubtitles(expectedVideoId)) {
            result = true;
            return result;
          }
          if (deps.hasCompleteSubtitles()) {
            result = true;
            return result;
          }
        }

        if (await fetchSessionSubtitles(expectedVideoId)) {
          result = true;
          return result;
        }
        if (deps.hasCompleteSubtitles()) {
          result = true;
          return result;
        }
        if (captureLiveCaption() || deps.getSubtitles().length > 0) {
          result = true;
          return result;
        }
        if (await fetchCaptionTrackApi()) {
          result = true;
          return result;
        }

        result = false;
        return result;
      } finally {
        await finalizeCaptionProbe(result);
      }
    }

    return {
      setupBridge,
      clearSubtitleWatchers,
      concealNativeTranscriptPanel: concealTranscriptPanel,
      closeNativeTranscriptPanel: scheduleTranscriptPanelClose,
      resetPageSessionState,
      startLiveCaptionCapture,
      setupSubtitleWatchers,
      registerAutoFetchAttempt,
      isFetchCoolingDown,
      primeCaptionsFromUserGesture,
      shouldShowLoadingState,
      fetchSubtitles,
      notifySubtitlesUpdated: notifyBridgeWaiters,
    };
  };
})(globalThis);
