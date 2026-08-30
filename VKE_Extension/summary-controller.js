(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});
  const PREVIEW_CACHE_LIMIT = 24;
  const PREVIEW_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
  const DEFAULT_PREVIEW_METER_LIMIT = 5;
  const DEFAULT_PREVIEW_METER_WINDOW_DAYS = 7;
  const FULL_CACHE_LIMIT = 12;
  const FULL_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
  const MOCK_SUMMARY_PREFIXES = [
    "test preview for",
    "\u0442\u0435\u0441\u0442\u043e\u0432\u044b\u0439 preview",
    "full test summary for",
    "\u043f\u043e\u043b\u043d\u044b\u0439 \u0442\u0435\u0441\u0442\u043e\u0432\u044b\u0439 \u043f\u0435\u0440\u0435\u0441\u043a\u0430\u0437",
  ];

  function createDefaultState(videoId = null) {
    return {
      videoId,
      previewStatus: "hidden",
      previewText: "",
      fullStatus: "idle",
      fullText: "",
      timeSavedLabel: "",
      previewRequestedForVideoId: null,
      previewMeter: null,
      fullRequestedForVideoId: null,
      visibleTrackedForVideoId: null,
    };
  }

  function normalizeErrorMessage(error) {
    return String(error?.message || error || "").slice(0, 200);
  }

  function normalizeHistoryList(items = []) {
    return Array.isArray(items) ? items.filter(Boolean).slice(0, 8) : [];
  }

  function buildTranscriptSignature(subtitles = []) {
    const source = Array.isArray(subtitles)
      ? subtitles
          .map((subtitle) => {
            const start = String(subtitle?.start ?? "").trim();
            const end = String(subtitle?.end ?? "").trim();
            const text = String(subtitle?.text || "").replace(/\s+/g, " ").trim();
            return `${start}|${end}|${text}`;
          })
          .join("\n")
      : "";

    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `sp_${(hash >>> 0).toString(36)}_${source.length}`;
  }

  function normalizePersistedCache(rawValue) {
    return rawValue && typeof rawValue === "object" ? { ...rawValue } : {};
  }

  function normalizeComparableLanguage(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) return "";
    if (normalized === "original") return "original";
    if (normalized.startsWith("ru")) return "ru";
    if (normalized.startsWith("en")) return "en";
    return "";
  }

  function isMockSummaryText(text = "") {
    const normalized = String(text || "").trim().toLowerCase();
    if (!normalized) return false;
    return MOCK_SUMMARY_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  }

  modules.createSummaryController = function createSummaryController(
    deps = {},
  ) {
    const shouldRequestPreview =
      deps.shouldRequestSummaryPreview || global.shouldRequestSummaryPreview;
    const readSummaryText = deps.extractSummaryText || global.extractSummaryText;
    const storage = deps.storage || null;
    const storageKeys = deps.storageKeys || {};

    let summaryState = createDefaultState();
    let previewToken = 0;
    let fullToken = 0;
    const previewSummaryCache = new Map();
    const fullSummaryCache = new Map();
    let persistedPreviewCacheLoaded = false;
    let persistedPreviewCache = {};
    let persistedFullCacheLoaded = false;
    let persistedFullCache = {};

    function getCurrentVideoId() {
      return deps.getCurrentVideoId?.() || deps.getVideoId?.() || null;
    }

    function getCurrentPlatform() {
      return deps.getCurrentPlatform?.() || "rutube";
    }

    function trackEvent(eventType, eventData) {
      deps.trackEvent?.(eventType, eventData);
    }

    function showToast(type, title, subtitle) {
      deps.showToast?.(type, title, subtitle);
    }

    function showPaywall(feature, options) {
      deps.showSubscriptionPaywall?.(feature, options);
    }

    function getState() {
      return {
        ...summaryState,
      };
    }

    function notify() {
      deps.onStateChange?.(getState());
    }

    function ensureStateForVideo(videoId = getCurrentVideoId()) {
      if (!videoId) {
        if (summaryState.videoId !== null) {
          summaryState = createDefaultState();
          notify();
        }
        return null;
      }

      if (summaryState.videoId === videoId) return videoId;
      summaryState = createDefaultState(videoId);
      notify();
      return videoId;
    }

    function isRequestStillForActiveVideo(videoId) {
      const activeVideoId = getCurrentVideoId();
      return Boolean(videoId && activeVideoId && activeVideoId === videoId);
    }

    function setState(patch = {}) {
      summaryState = {
        ...summaryState,
        ...patch,
      };
      notify();
      return getState();
    }

    function buildTranscriptText(subtitles = []) {
      if (
        deps.transcriptExport?.buildPlainText &&
        typeof deps.transcriptExport.buildPlainText === "function"
      ) {
        return deps.transcriptExport.buildPlainText(subtitles);
      }

      return subtitles
        .map((subtitle) => subtitle?.text || "")
        .join(" ")
        .trim();
    }

    function buildTimeSavedLabel() {
      const duration = Number(deps.getVideoDuration?.());
      if (!Number.isFinite(duration) || duration <= 0) return "";
      const minutes = Math.max(1, Math.round(duration / 60));
      return deps.t("contentSummaryTimeSaved", [String(minutes)]);
    }

    function resolveSourceSubtitles(subtitles = []) {
      const sourceSubtitles = deps.getSourceSubtitles?.();
      if (Array.isArray(sourceSubtitles) && sourceSubtitles.length > 0) {
        return sourceSubtitles;
      }

      return Array.isArray(subtitles) ? subtitles : [];
    }

    function getSourceSubtitleLanguage() {
      const subtitleLanguage =
        deps.getSourceSubtitleLanguage?.() || deps.getSubtitleLanguage?.();
      return typeof subtitleLanguage === "string"
        ? subtitleLanguage.trim()
        : "";
    }

    function isTranscriptSourcePartial() {
      const sourceMode = String(deps.getSubtitleSourceMode?.() || "");
      const sourceMeta = deps.getSubtitleSourceMeta?.() || {};
      return (
        sourceMeta?.isLikelyPartial === true ||
        sourceMode === "vk_text_tracks_partial"
      );
    }

    function formatCoverageTime(seconds) {
      const value = Number(seconds);
      if (!Number.isFinite(value) || value <= 0) return "?:??";
      if (typeof deps.formatTime === "function") {
        return deps.formatTime(value);
      }
      const minutes = Math.floor(value / 60);
      const secs = Math.floor(value % 60);
      return `${minutes}:${String(secs).padStart(2, "0")}`;
    }

    function getPartialSubtitleWarningText() {
      const sourceMeta = deps.getSubtitleSourceMeta?.() || {};
      return deps.t("contentPartialSubtitlesSummaryBlocked", [
        formatCoverageTime(sourceMeta.transcriptEndSeconds),
        formatCoverageTime(sourceMeta.durationSeconds),
      ]);
    }

    function getTargetLanguage() {
      const targetLanguage = normalizeComparableLanguage(
        deps.getTargetLanguage?.(),
      );
      const sourceSubtitleLanguage = normalizeComparableLanguage(
        deps.getSourceSubtitleLanguage?.() || deps.getSubtitleLanguage?.(),
      );

      if (!targetLanguage || targetLanguage === "original") {
        return "original";
      }

      return sourceSubtitleLanguage &&
        sourceSubtitleLanguage === targetLanguage
        ? "original"
        : targetLanguage;
    }

    function artifactLanguageMatches(artifactLanguage, requestedLanguage) {
      const artifact = normalizeComparableLanguage(artifactLanguage);
      const requested = normalizeComparableLanguage(requestedLanguage);
      if (!requested || requested === "original") return true;
      return artifact === requested || artifact === "original";
    }

    function getArtifactText(artifact) {
      return String(artifact?.content_text_optional || "").trim();
    }

    function isPreviewSummaryArtifact(artifact) {
      return (
        artifact?.type === "summary" &&
        String(artifact?.metadata_json?.summary_type || "").toLowerCase() ===
          "preview"
      );
    }

    function findArchiveSummaryArtifact(material, mode) {
      const artifacts = Array.isArray(material?.artifacts)
        ? material.artifacts
        : [];
      const requestedLanguage = getTargetLanguage();
      const summaryArtifacts = artifacts.filter((artifact) => {
        return (
          artifact?.type === "summary" &&
          getArtifactText(artifact) &&
          artifactLanguageMatches(artifact.language, requestedLanguage)
        );
      });
      if (mode === "preview") {
        return (
          summaryArtifacts.find((artifact) => !isPreviewSummaryArtifact(artifact)) ||
          summaryArtifacts.find((artifact) => isPreviewSummaryArtifact(artifact)) ||
          null
        );
      }
      return (
        summaryArtifacts.find((artifact) => !isPreviewSummaryArtifact(artifact)) ||
        null
      );
    }

    async function readArchiveSummaryText(mode) {
      if (typeof deps.lookupArchiveMaterial !== "function") return "";
      try {
        const material = await deps.lookupArchiveMaterial({
          artifactType: "summary",
          mode,
          targetLanguage: getTargetLanguage(),
        });
        const artifact = findArchiveSummaryArtifact(material, mode);
        return getArtifactText(artifact);
      } catch {
        return "";
      }
    }

    function getPreviewCacheStorageKey() {
      return storageKeys.SUMMARY_PREVIEW_CACHE || "";
    }

    function getPreviewMeterStorageKey() {
      return storageKeys.SUMMARY_PREVIEW_METER || "";
    }

    function getFullCacheStorageKey() {
      return storageKeys.SUMMARY_FULL_CACHE || "";
    }

    function normalizePositiveInteger(value, fallback) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
      return Math.max(1, Math.round(parsed));
    }

    function getPreviewMeterConfig() {
      const rawConfig = deps.getSummaryPreviewMeterConfig?.() || {};
      const copy = rawConfig.copy && typeof rawConfig.copy === "object"
        ? rawConfig.copy
        : {};
      return {
        enabled: rawConfig.enabled === true,
        limit: normalizePositiveInteger(
          rawConfig.limit ?? rawConfig.free_limit ?? rawConfig.freeLimit,
          DEFAULT_PREVIEW_METER_LIMIT,
        ),
        windowDays: normalizePositiveInteger(
          rawConfig.window_days ?? rawConfig.windowDays,
          DEFAULT_PREVIEW_METER_WINDOW_DAYS,
        ),
        variant: String(rawConfig.variant || "").trim(),
        copy,
      };
    }

    function isPreviewMeterBypassedForPro() {
      const proState = deps.entitlementService?.getProState?.() || {};
      return Boolean(proState.isPro);
    }

    function normalizePreviewMeterStore(rawValue, config) {
      const source = rawValue && typeof rawValue === "object" ? rawValue : {};
      const cutoff = Date.now() - config.windowDays * 24 * 60 * 60 * 1000;
      return Object.entries(source).reduce((result, [key, record]) => {
        const normalizedKey = String(key || "").trim();
        const usedAt = Number(record?.usedAt || 0);
        if (!normalizedKey || !usedAt || usedAt < cutoff) return result;
        result[normalizedKey] = {
          usedAt,
          videoId: String(record?.videoId || ""),
          platform: String(record?.platform || ""),
          targetLanguage: String(record?.targetLanguage || "original"),
        };
        return result;
      }, {});
    }

    async function readPreviewMeterStore(config) {
      const meterStorageKey = getPreviewMeterStorageKey();
      if (!storage?.get || !meterStorageKey) return {};
      const data = await storage.get([meterStorageKey]);
      return normalizePreviewMeterStore(data?.[meterStorageKey], config);
    }

    async function writePreviewMeterStore(store, config) {
      const meterStorageKey = getPreviewMeterStorageKey();
      if (!storage?.set || !meterStorageKey) return;
      await storage.set({
        [meterStorageKey]: normalizePreviewMeterStore(store, config),
      });
    }

    async function evaluatePreviewMeter(previewCacheKey, { videoId } = {}) {
      const config = getPreviewMeterConfig();
      if (!config.enabled || isPreviewMeterBypassedForPro()) {
        return { active: false, allowed: true, config };
      }

      const store = await readPreviewMeterStore(config);
      const existingRecord = store[previewCacheKey];
      const usedCount = Object.keys(store).length;
      const resetAt =
        usedCount > 0
          ? Math.min(...Object.values(store).map((record) => Number(record.usedAt || 0))) +
            config.windowDays * 24 * 60 * 60 * 1000
          : Date.now() + config.windowDays * 24 * 60 * 60 * 1000;

      if (existingRecord || usedCount < config.limit) {
        return {
          active: true,
          allowed: true,
          config,
          store,
          previewCacheKey,
          recordUsage: !existingRecord,
          usedCount,
          resetAt,
        };
      }

      return {
        active: true,
        allowed: false,
        config,
        store,
        previewCacheKey,
        videoId,
        usedCount,
        resetAt,
      };
    }

    function buildPreviewMeterEventData(meterState = {}, extra = {}) {
      const config = meterState.config || getPreviewMeterConfig();
      return {
        video_id: getCurrentVideoId(),
        platform: getCurrentPlatform(),
        free_previews_used: meterState.usedCount || 0,
        free_previews_limit: config.limit,
        window_days: config.windowDays,
        entry_source: "preview_meter",
        is_pro_user: isPreviewMeterBypassedForPro(),
        reset_at: meterState.resetAt
          ? new Date(meterState.resetAt).toISOString()
          : null,
        ...extra,
      };
    }

    async function recordPreviewMeterShown(meterState, { videoId, targetLanguage } = {}) {
      if (!meterState?.active || !meterState.allowed) return;
      let usedCount = meterState.usedCount || 0;
      if (meterState.recordUsage && meterState.previewCacheKey) {
        const store = meterState.store || {};
        store[meterState.previewCacheKey] = {
          usedAt: Date.now(),
          videoId: String(videoId || ""),
          platform: getCurrentPlatform(),
          targetLanguage: String(targetLanguage || "original"),
        };
        usedCount += 1;
        await writePreviewMeterStore(store, meterState.config);
      }
      trackEvent("summary_preview_free_shown", {
        ...buildPreviewMeterEventData(
          {
            ...meterState,
            usedCount,
          },
          { video_id: videoId || getCurrentVideoId() },
        ),
      });
    }

    function showPreviewMeterLimit(meterState) {
      const config = meterState.config || getPreviewMeterConfig();
      const copy = config.copy || {};
      const title =
        copy.title || deps.t("contentSummaryPreviewMeterTitle");
      const body =
        copy.body || deps.t("contentSummaryPreviewMeterBody", [
          String(config.limit),
          String(config.windowDays),
        ]);
      const cta = copy.cta || deps.t("contentSummaryPreviewMeterCta");
      const subcopy =
        copy.subcopy || deps.t("contentSummaryPreviewMeterSubcopy");

      setState({
        previewStatus: "meter_limit",
        previewText: "",
        timeSavedLabel: "",
        previewRequestedForVideoId: meterState.videoId || getCurrentVideoId(),
        previewMeter: {
          title,
          body,
          cta,
          subcopy,
          usedCount: meterState.usedCount || config.limit,
          limit: config.limit,
          windowDays: config.windowDays,
          resetAt: meterState.resetAt || null,
        },
      });
      const eventData = buildPreviewMeterEventData(meterState, {
        video_id: meterState.videoId || getCurrentVideoId(),
      });
      trackEvent("summary_preview_meter_limit_shown", eventData);
      trackEvent("summary_preview_blur_shown", eventData);
    }

    function isStructuredApiError(error, code) {
      const message = normalizeErrorMessage(error);
      return message.includes(code);
    }

    function trimPreviewMemoryCache() {
      while (previewSummaryCache.size > PREVIEW_CACHE_LIMIT) {
        const oldestKey = previewSummaryCache.keys().next().value;
        if (!oldestKey) break;
        previewSummaryCache.delete(oldestKey);
      }
    }

    function rememberPreview(cacheKey, previewText) {
      if (isMockSummaryText(previewText)) return;
      previewSummaryCache.delete(cacheKey);
      previewSummaryCache.set(cacheKey, String(previewText || ""));
      trimPreviewMemoryCache();
    }

    function trimFullMemoryCache() {
      while (fullSummaryCache.size > FULL_CACHE_LIMIT) {
        const oldestKey = fullSummaryCache.keys().next().value;
        if (!oldestKey) break;
        fullSummaryCache.delete(oldestKey);
      }
    }

    function rememberFull(cacheKey, fullText) {
      if (isMockSummaryText(fullText)) return;
      fullSummaryCache.delete(cacheKey);
      fullSummaryCache.set(cacheKey, String(fullText || ""));
      trimFullMemoryCache();
    }

    function getPreviewCacheKey(
      videoId = getCurrentVideoId(),
      subtitles = [],
      targetLanguage = getTargetLanguage(),
    ) {
      return `${videoId || "video"}::${String(targetLanguage || "original")}::${buildTranscriptSignature(subtitles)}`;
    }

    function prunePersistedPreviewCache(cache) {
      const now = Date.now();
      const entries = Object.entries(normalizePersistedCache(cache))
        .filter(([, record]) => {
          if (!record || typeof record !== "object") return false;
          const previewStatus = String(record.previewStatus || "").trim();
          const previewText = String(record.previewText || "").trim();
          if (previewStatus !== "paused") {
            if (!previewText || isMockSummaryText(previewText)) return false;
          }
          const savedAt = Number(record.savedAt || 0);
          return savedAt > 0 && now - savedAt <= PREVIEW_CACHE_TTL_MS;
        })
        .sort(
          (left, right) =>
            Number(right[1]?.savedAt || 0) - Number(left[1]?.savedAt || 0),
        )
        .slice(0, PREVIEW_CACHE_LIMIT);

      return entries.reduce((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {});
    }

    function prunePersistedFullCache(cache) {
      const now = Date.now();
      const entries = Object.entries(normalizePersistedCache(cache))
        .filter(([, record]) => {
          if (!record || typeof record !== "object") return false;
          const fullText = String(record.fullText || "").trim();
          if (!fullText || isMockSummaryText(fullText)) return false;
          const savedAt = Number(record.savedAt || 0);
          return savedAt > 0 && now - savedAt <= FULL_CACHE_TTL_MS;
        })
        .sort(
          (left, right) =>
            Number(right[1]?.savedAt || 0) - Number(left[1]?.savedAt || 0),
        )
        .slice(0, FULL_CACHE_LIMIT);

      return entries.reduce((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {});
    }

    async function ensurePersistedPreviewCacheLoaded() {
      const cacheStorageKey = getPreviewCacheStorageKey();
      if (persistedPreviewCacheLoaded || !storage?.get || !cacheStorageKey) {
        return persistedPreviewCache;
      }

      const data = await storage.get([cacheStorageKey]);
      persistedPreviewCache = prunePersistedPreviewCache(data?.[cacheStorageKey]);
      persistedPreviewCacheLoaded = true;
      return persistedPreviewCache;
    }

    async function persistPreviewCache() {
      const cacheStorageKey = getPreviewCacheStorageKey();
      if (!storage?.set || !cacheStorageKey) return;

      persistedPreviewCache = prunePersistedPreviewCache(persistedPreviewCache);
      await storage.set({
        [cacheStorageKey]: persistedPreviewCache,
      });
    }

    async function ensurePersistedFullCacheLoaded() {
      const cacheStorageKey = getFullCacheStorageKey();
      if (persistedFullCacheLoaded || !storage?.get || !cacheStorageKey) {
        return persistedFullCache;
      }

      const data = await storage.get([cacheStorageKey]);
      persistedFullCache = prunePersistedFullCache(data?.[cacheStorageKey]);
      persistedFullCacheLoaded = true;
      return persistedFullCache;
    }

    async function persistFullCache() {
      const cacheStorageKey = getFullCacheStorageKey();
      if (!storage?.set || !cacheStorageKey) return;

      persistedFullCache = prunePersistedFullCache(persistedFullCache);
      await storage.set({
        [cacheStorageKey]: persistedFullCache,
      });
    }

    async function readPersistedPreview(cacheKey) {
      const cacheStorageKey = getPreviewCacheStorageKey();
      if (!cacheStorageKey) return "";

      const cache = await ensurePersistedPreviewCacheLoaded();
      const record = cache?.[cacheKey];
      const previewText = String(record?.previewText || "").trim();
      if (!previewText) return "";
      if (isMockSummaryText(previewText)) {
        delete cache[cacheKey];
        await persistPreviewCache();
        return "";
      }

      const savedAt = Number(record.savedAt || 0);
      if (!savedAt || Date.now() - savedAt > PREVIEW_CACHE_TTL_MS) {
        delete cache[cacheKey];
        await persistPreviewCache();
        return "";
      }

      return previewText;
    }

    async function readPersistedPreviewStatus(cacheKey) {
      const cacheStorageKey = getPreviewCacheStorageKey();
      if (!cacheStorageKey) return "";

      const cache = await ensurePersistedPreviewCacheLoaded();
      const record = cache?.[cacheKey];
      const previewStatus = String(record?.previewStatus || "").trim();
      if (!previewStatus) return "";

      const savedAt = Number(record.savedAt || 0);
      if (!savedAt || Date.now() - savedAt > PREVIEW_CACHE_TTL_MS) {
        delete cache[cacheKey];
        await persistPreviewCache();
        return "";
      }

      return previewStatus;
    }

    async function writePersistedPreview(
      cacheKey,
      previewText,
      { videoId, targetLanguage, transcriptSignature } = {},
    ) {
      const cacheStorageKey = getPreviewCacheStorageKey();
      if (!cacheStorageKey) return;

      await ensurePersistedPreviewCacheLoaded();
      if (isMockSummaryText(previewText)) return;
      persistedPreviewCache[cacheKey] = {
        videoId: String(videoId || ""),
        targetLanguage: String(targetLanguage || "original"),
        transcriptSignature: String(transcriptSignature || ""),
        savedAt: Date.now(),
        previewText: String(previewText || ""),
      };
      await persistPreviewCache();
    }

    async function writePersistedPreviewStatus(
      cacheKey,
      previewStatus,
      { videoId, targetLanguage, transcriptSignature } = {},
    ) {
      const cacheStorageKey = getPreviewCacheStorageKey();
      if (!cacheStorageKey) return;

      await ensurePersistedPreviewCacheLoaded();
      persistedPreviewCache[cacheKey] = {
        videoId: String(videoId || ""),
        targetLanguage: String(targetLanguage || "original"),
        transcriptSignature: String(transcriptSignature || ""),
        savedAt: Date.now(),
        previewStatus: String(previewStatus || ""),
      };
      await persistPreviewCache();
    }

    function getFullCacheKey(
      videoId = getCurrentVideoId(),
      subtitles = [],
      targetLanguage = getTargetLanguage(),
    ) {
      return `${videoId || "video"}::${String(targetLanguage || "original")}::${buildTranscriptSignature(subtitles)}`;
    }

    async function readPersistedFull(cacheKey) {
      const cacheStorageKey = getFullCacheStorageKey();
      if (!cacheStorageKey) return "";

      const cache = await ensurePersistedFullCacheLoaded();
      const record = cache?.[cacheKey];
      const fullText = String(record?.fullText || "").trim();
      if (!fullText) return "";
      if (isMockSummaryText(fullText)) {
        delete cache[cacheKey];
        await persistFullCache();
        return "";
      }

      const savedAt = Number(record.savedAt || 0);
      if (!savedAt || Date.now() - savedAt > FULL_CACHE_TTL_MS) {
        delete cache[cacheKey];
        await persistFullCache();
        return "";
      }

      return fullText;
    }

    async function writePersistedFull(
      cacheKey,
      fullText,
      { videoId, targetLanguage, transcriptSignature } = {},
    ) {
      const cacheStorageKey = getFullCacheStorageKey();
      if (!cacheStorageKey) return;

      await ensurePersistedFullCacheLoaded();
      if (isMockSummaryText(fullText)) return;
      persistedFullCache[cacheKey] = {
        videoId: String(videoId || ""),
        targetLanguage: String(targetLanguage || "original"),
        transcriptSignature: String(transcriptSignature || ""),
        savedAt: Date.now(),
        fullText: String(fullText || ""),
      };
      await persistFullCache();
    }

    async function recordSummaryActivity({
      summaryText = "",
      summaryType = "full",
      incrementTotal = true,
    } = {}) {
      if (
        !storage?.get ||
        !storage?.set ||
        !storageKeys.SUMMARY_HISTORY ||
        !storageKeys.SUMMARY_ACTIVITY_STATS
      ) {
        return false;
      }

      const videoId = getCurrentVideoId();
      if (!videoId) return false;

      const requestedAt = new Date().toISOString();
      const normalizedSummaryText = String(summaryText || "").trim();
      const entry = {
        videoId,
        videoUrl: String(deps.getVideoUrl?.() || ""),
        videoTitle: String(deps.getVideoTitle?.() || ""),
        platform: getCurrentPlatform(),
        language: getTargetLanguage(),
        requestedAt,
      };
      const historyKey = storageKeys.SUMMARY_HISTORY;
      const statsKey = storageKeys.SUMMARY_ACTIVITY_STATS;
      const data = await storage.get([historyKey, statsKey]);
      const existingHistory = normalizeHistoryList(data?.[historyKey]);
      const previousEntry = existingHistory.find((item) => {
        return (
          String(item?.videoId || "") === entry.videoId &&
          String(item?.platform || "") === entry.platform &&
          String(item?.language || "") === entry.language
        );
      });
      if (normalizedSummaryText || String(previousEntry?.summaryText || "").trim()) {
        entry.summaryText =
          normalizedSummaryText || String(previousEntry?.summaryText || "").trim();
      }
      if (String(summaryType || "").trim()) {
        entry.summaryType = String(summaryType || "").trim().toLowerCase();
      }
      const nextHistory = [
        entry,
        ...existingHistory.filter((item) => {
          return !(
            String(item?.videoId || "") === entry.videoId &&
            String(item?.platform || "") === entry.platform &&
            String(item?.language || "") === entry.language
          );
        }),
      ].slice(0, 8);
      const existingStats =
        data?.[statsKey] && typeof data[statsKey] === "object"
          ? data[statsKey]
          : {};

      await storage.set({
        [historyKey]: nextHistory,
        [statsKey]: {
          ...existingStats,
          total: Number(existingStats.total || 0) + (incrementTotal ? 1 : 0),
          lastRequestedAt: requestedAt,
        },
      });
      return true;
    }

    async function syncArchiveSummary(summaryType = "full") {
      if (typeof deps.syncArchiveMaterial !== "function") return false;
      try {
        const result = await deps.syncArchiveMaterial({
          artifactType: "summary",
          summaryType,
          targetLanguage: getTargetLanguage(),
        });
        if (result?.synced) {
          trackEvent("archive_summary_synced", {
            video_id: getCurrentVideoId(),
            platform: getCurrentPlatform(),
            summary_type: summaryType,
          });
        }
        return Boolean(result?.synced);
      } catch (error) {
        trackEvent("archive_summary_sync_failed", {
          video_id: getCurrentVideoId(),
          platform: getCurrentPlatform(),
          summary_type: summaryType,
          error: normalizeErrorMessage(error),
        });
        return false;
      }
    }

    function trackSummaryError(stage, error) {
      const videoId = getCurrentVideoId();
      const platform = getCurrentPlatform();
      const message = normalizeErrorMessage(error);

      if (stage === "full") {
        trackEvent("ai_summary_error", {
          video_id: videoId,
          platform,
          error: message,
        });
      } else {
        trackEvent("summary_preview_error", {
          video_id: videoId,
          platform,
          error: message,
        });
      }

      trackEvent("summary_error", {
        video_id: videoId,
        platform,
        stage,
        error: message,
      });
    }

    function markPreviewVisible() {
      const videoId = summaryState.videoId;
      if (!videoId) return false;
      if (summaryState.previewStatus === "hidden") return false;
      if (summaryState.visibleTrackedForVideoId === videoId) return false;

      summaryState.visibleTrackedForVideoId = videoId;
      trackEvent("summary_preview_visible", {
        video_id: videoId,
        platform: getCurrentPlatform(),
      });
      return true;
    }

    function reset(options = {}) {
      const videoId = options.videoId || summaryState.videoId;
      if (videoId && options.clearCache !== false) {
        const videoKeyPrefix = `${videoId || "video"}::`;
        Array.from(fullSummaryCache.keys()).forEach((key) => {
          if (String(key).startsWith(videoKeyPrefix)) {
            fullSummaryCache.delete(key);
          }
        });
      }
      summaryState = createDefaultState();
      notify();
      return getState();
    }

    async function requestPreview({ subtitles = [], trigger = "auto" } = {}) {
      const videoId = ensureStateForVideo();
      if (!videoId) return false;
      const sourceSubtitles = resolveSourceSubtitles(subtitles);
      if (sourceSubtitles.length === 0) return false;
      const previewCacheKey = getPreviewCacheKey(videoId, sourceSubtitles);
      const transcriptSignature = buildTranscriptSignature(sourceSubtitles);

      const sourceMode = deps.getSubtitleSourceMode?.() || "none";
      const isEligible =
        typeof shouldRequestPreview === "function" &&
        shouldRequestPreview(sourceSubtitles, {
          isComplete: deps.hasCompleteSubtitles?.() !== false,
          isLiveCapture: sourceMode === "live_capture",
        });

      if (isTranscriptSourcePartial()) {
        if (
          trigger !== "retry" &&
          summaryState.previewStatus === "partial" &&
          summaryState.previewRequestedForVideoId === videoId
        ) {
          return false;
        }
        setState({
          previewStatus: "partial",
          previewText: getPartialSubtitleWarningText(),
          previewMeter: null,
          timeSavedLabel: "",
          previewRequestedForVideoId: videoId,
        });
        trackEvent("summary_preview_blocked_partial_subtitles", {
          video_id: videoId,
          platform: getCurrentPlatform(),
        });
        return false;
      }

      if (!isEligible) {
        if (summaryState.previewStatus === "loading") {
          setState({
            previewStatus: "hidden",
            previewText: "",
            timeSavedLabel: "",
          });
        }
        return false;
      }

      const previewMeterState = await evaluatePreviewMeter(previewCacheKey, {
        videoId,
      });
      if (!isRequestStillForActiveVideo(videoId)) return false;

      if (!previewMeterState.allowed) {
        if (
          trigger !== "retry" &&
          summaryState.previewStatus === "meter_limit" &&
          summaryState.previewRequestedForVideoId === videoId
        ) {
          return false;
        }
        showPreviewMeterLimit(previewMeterState);
        return false;
      }

      const cachedPreviewText = previewSummaryCache.get(previewCacheKey);
      if (cachedPreviewText && !isMockSummaryText(cachedPreviewText)) {
        setState({
          previewStatus: "success",
          previewText: cachedPreviewText,
          previewMeter: null,
          timeSavedLabel: buildTimeSavedLabel(),
          previewRequestedForVideoId: videoId,
        });
        await recordPreviewMeterShown(previewMeterState, {
          videoId,
          targetLanguage: getTargetLanguage(),
        });
        deps.onPreviewReady?.(getState());
        return true;
      }

      const persistedPreviewText = await readPersistedPreview(previewCacheKey);
      if (!isRequestStillForActiveVideo(videoId)) return false;

      if (persistedPreviewText) {
        rememberPreview(previewCacheKey, persistedPreviewText);
        setState({
          previewStatus: "success",
          previewText: persistedPreviewText,
          previewMeter: null,
          timeSavedLabel: buildTimeSavedLabel(),
          previewRequestedForVideoId: videoId,
        });
        await recordPreviewMeterShown(previewMeterState, {
          videoId,
          targetLanguage: getTargetLanguage(),
        });
        deps.onPreviewReady?.(getState());
        return true;
      }

      const persistedPreviewStatus = await readPersistedPreviewStatus(previewCacheKey);
      if (!isRequestStillForActiveVideo(videoId)) return false;

      if (persistedPreviewStatus === "paused" && trigger !== "retry") {
        setState({
          previewStatus: "paused",
          previewText: "",
          previewMeter: null,
          timeSavedLabel: "",
          previewRequestedForVideoId: videoId,
        });
        return false;
      }

      const archivePreviewText = await readArchiveSummaryText("preview");
      if (!isRequestStillForActiveVideo(videoId)) return false;

      if (archivePreviewText) {
        rememberPreview(previewCacheKey, archivePreviewText);
        await writePersistedPreview(previewCacheKey, archivePreviewText, {
          videoId,
          targetLanguage: getTargetLanguage(),
          transcriptSignature,
        });
        setState({
          previewStatus: "success",
          previewText: archivePreviewText,
          previewMeter: null,
          timeSavedLabel: buildTimeSavedLabel(),
          previewRequestedForVideoId: videoId,
        });
        trackEvent("summary_preview_loaded", {
          video_id: videoId,
          platform: getCurrentPlatform(),
          cache_source: "archive",
        });
        await recordPreviewMeterShown(previewMeterState, {
          videoId,
          targetLanguage: getTargetLanguage(),
        });
        deps.onPreviewReady?.(getState());
        return true;
      }

      if (
        trigger !== "retry" &&
        (summaryState.previewStatus === "loading" ||
          summaryState.previewStatus === "success")
      ) {
        return false;
      }

      if (!isRequestStillForActiveVideo(videoId)) return false;

      const token = ++previewToken;
      setState({
        previewStatus: "loading",
        previewText: "",
        previewMeter: null,
        timeSavedLabel: buildTimeSavedLabel(),
        previewRequestedForVideoId: videoId,
      });

      trackEvent("summary_preview_requested", {
        video_id: videoId,
        platform: getCurrentPlatform(),
        trigger,
      });

      try {
        const result = await deps.runtimeSendMessage?.({
          action: "requestAISummary",
          transcriptText: buildTranscriptText(sourceSubtitles),
          platform: getCurrentPlatform(),
          videoId,
          videoUrl: deps.getVideoUrl?.(),
          videoTitle: deps.getVideoTitle?.(),
          subtitleLanguage: getSourceSubtitleLanguage(),
          targetLanguage: getTargetLanguage(),
          mode: "preview",
          entryPoint: "panel_preview",
        });

        if (token !== previewToken || summaryState.videoId !== videoId) {
          return false;
        }

        if (!result) throw new Error(deps.t("contentNoResponse"));
        if (result?.error) throw new Error(result.error);

        const previewText =
          (typeof readSummaryText === "function"
            ? readSummaryText(result, "preview")
            : "") || "";

        if (!previewText) {
          throw new Error(deps.t("contentSummaryPreviewUnavailable"));
        }

        setState({
          previewStatus: "success",
          previewText,
          previewMeter: null,
          timeSavedLabel: buildTimeSavedLabel(),
        });
        rememberPreview(previewCacheKey, previewText);
        await writePersistedPreview(previewCacheKey, previewText, {
          videoId,
          targetLanguage: getTargetLanguage(),
          transcriptSignature,
        });
        trackEvent("summary_preview_loaded", {
          video_id: videoId,
          platform: getCurrentPlatform(),
        });
        await recordPreviewMeterShown(previewMeterState, {
          videoId,
          targetLanguage: getTargetLanguage(),
        });
        deps.onPreviewReady?.(getState());
        return true;
      } catch (error) {
        if (token !== previewToken || summaryState.videoId !== videoId) {
          return false;
        }

        if (isStructuredApiError(error, "SUMMARY_PREVIEW_METER_LIMIT_REACHED")) {
          showPreviewMeterLimit({
            ...previewMeterState,
            active: true,
            allowed: false,
            videoId,
          });
          return false;
        }

        if (isStructuredApiError(error, "SUMMARY_PREVIEW_PAUSED")) {
          setState({
            previewStatus: "paused",
            previewText: "",
            previewMeter: null,
            previewRequestedForVideoId: videoId,
          });
          await writePersistedPreviewStatus(previewCacheKey, "paused", {
            videoId,
            targetLanguage: getTargetLanguage(),
            transcriptSignature,
          });
          trackEvent("summary_preview_paused", {
            video_id: videoId,
            platform: getCurrentPlatform(),
          });
          return false;
        }

        setState({
          previewStatus: "error",
          previewText: "",
          previewMeter: null,
        });
        trackSummaryError("preview", error);
        return false;
      }
    }

    async function retryPreview({ subtitles = [] } = {}) {
      trackEvent("summary_preview_retry", {
        video_id: getCurrentVideoId(),
        platform: getCurrentPlatform(),
      });
      return await requestPreview({
        subtitles,
        trigger: "retry",
      });
    }

    async function openFullSummary({
      subtitles = [],
      source = "preview",
      revealView = true,
    } = {}) {
      const videoId = ensureStateForVideo();
      if (!videoId) return false;
      const effectiveSource =
        source === "preview" && summaryState.previewStatus === "meter_limit"
          ? "preview_meter"
          : source;
      const sourceSubtitles = resolveSourceSubtitles(subtitles);

      if (effectiveSource === "preview_meter") {
        trackEvent("summary_preview_unlock_clicked", {
          ...buildPreviewMeterEventData(
            {
              config: getPreviewMeterConfig(),
              usedCount:
                summaryState.previewMeter?.usedCount ||
                getPreviewMeterConfig().limit,
              resetAt: summaryState.previewMeter?.resetAt || null,
            },
            { video_id: videoId },
          ),
        });
        showPaywall("ai", {
          entryPoint: "preview_meter",
          copyVariant: "preview_meter",
        });
        return false;
      }

      if (effectiveSource === "preview") {
        trackEvent("summary_preview_cta_clicked", {
          video_id: videoId,
          platform: getCurrentPlatform(),
        });
        trackEvent("full_summary_requested_from_preview", {
          video_id: videoId,
          platform: getCurrentPlatform(),
        });
      }

      if (sourceSubtitles.length === 0) {
        showToast(
          "warning",
          deps.t("contentNoText"),
          deps.t("contentSubsNotLoaded"),
        );
        return false;
      }

      if (isTranscriptSourcePartial()) {
        showToast(
          "warning",
          deps.t("contentPartialSubtitlesTitle"),
          getPartialSubtitleWarningText(),
        );
        trackEvent("ai_summary_blocked_partial_subtitles", {
          video_id: videoId,
          platform: getCurrentPlatform(),
        });
        return false;
      }

      const fullCacheKey = getFullCacheKey(videoId, sourceSubtitles);
      const transcriptSignature = buildTranscriptSignature(sourceSubtitles);
      const cachedSummary = fullSummaryCache.get(fullCacheKey);
      if (cachedSummary && !isMockSummaryText(cachedSummary)) {
        setState({
          fullStatus: "success",
          fullText: cachedSummary,
          fullRequestedForVideoId: videoId,
        });
        if (revealView !== false) {
          deps.openFullSummaryView?.();
        }
        await recordSummaryActivity({
          summaryText: cachedSummary,
          summaryType: "full",
          incrementTotal: false,
        });
        await syncArchiveSummary("full");
        return true;
      }

      const persistedFullText = await readPersistedFull(fullCacheKey);
      if (persistedFullText) {
        rememberFull(fullCacheKey, persistedFullText);
        setState({
          fullStatus: "success",
          fullText: persistedFullText,
          fullRequestedForVideoId: videoId,
        });
        if (revealView !== false) {
          deps.openFullSummaryView?.();
        }
        await recordSummaryActivity({
          summaryText: persistedFullText,
          summaryType: "full",
          incrementTotal: false,
        });
        await syncArchiveSummary("full");
        return true;
      }

      const archiveFullText = await readArchiveSummaryText("full");
      if (archiveFullText) {
        rememberFull(fullCacheKey, archiveFullText);
        await writePersistedFull(fullCacheKey, archiveFullText, {
          videoId,
          targetLanguage: getTargetLanguage(),
          transcriptSignature,
        });
        setState({
          fullStatus: "success",
          fullText: archiveFullText,
          fullRequestedForVideoId: videoId,
        });
        if (revealView !== false) {
          deps.openFullSummaryView?.();
        }
        await recordSummaryActivity({
          summaryText: archiveFullText,
          summaryType: "full",
          incrementTotal: false,
        });
        trackEvent("ai_summary_success", {
          video_id: videoId,
          platform: getCurrentPlatform(),
          cache_source: "archive",
        });
        deps.refreshToolbarState?.();
        return true;
      }

      if (
        summaryState.fullStatus === "loading" &&
        summaryState.fullRequestedForVideoId === videoId
      ) {
        if (revealView !== false) {
          deps.openFullSummaryView?.();
        }
        return true;
      }

      await deps.entitlementService?.refresh?.();

      const proState = deps.entitlementService?.getProState?.() || {};

      if (proState.isPro && proState.aiUsed >= proState.aiLimit) {
        showToast(
          "warning",
          deps.t("contentLimitReached"),
          deps.t("contentLimitUsage", [
            String(proState.aiUsed),
            String(proState.aiLimit),
          ]),
        );
        trackEvent("ai_summary_limit_reached", {
          platform: getCurrentPlatform(),
        });
        return false;
      }

      if (!deps.entitlementService?.canAccessAI?.()) {
        showPaywall("ai", {
          entryPoint: "summary_preview",
          copyVariant: "summary_limit",
        });
        return false;
      }

      const token = ++fullToken;
      setState({
        fullStatus: "loading",
        fullText: "",
        fullRequestedForVideoId: videoId,
      });
      if (revealView !== false) {
        deps.openFullSummaryView?.();
      }

      trackEvent("ai_summary_requested", {
        video_id: videoId,
        platform: getCurrentPlatform(),
      });

      try {
        const result = await deps.runtimeSendMessage?.({
          action: "requestAISummary",
          transcriptText: buildTranscriptText(sourceSubtitles),
          platform: getCurrentPlatform(),
          videoId,
          videoUrl: deps.getVideoUrl?.(),
          videoTitle: deps.getVideoTitle?.(),
          subtitleLanguage: getSourceSubtitleLanguage(),
          targetLanguage: getTargetLanguage(),
          mode: "full",
          entryPoint: "panel_preview",
        });

        if (token !== fullToken || summaryState.videoId !== videoId) {
          return false;
        }

        if (!result) throw new Error(deps.t("contentNoResponse"));
        if (result?.error) throw new Error(result.error);

        const fullText =
          (typeof readSummaryText === "function"
            ? readSummaryText(result, "full")
            : "") || "";
        if (!fullText) {
          throw new Error(deps.t("contentSummaryFullUnavailable"));
        }

        rememberFull(fullCacheKey, fullText);
        await writePersistedFull(fullCacheKey, fullText, {
          videoId,
          targetLanguage: getTargetLanguage(),
          transcriptSignature,
        });
        setState({
          fullStatus: "success",
          fullText,
        });
        await deps.entitlementService?.incrementAiUsage?.();
        await recordSummaryActivity({
          summaryText: fullText,
          summaryType: "full",
          incrementTotal: true,
        });
        await syncArchiveSummary("full");
        trackEvent("ai_summary_success", {
          video_id: videoId,
          platform: getCurrentPlatform(),
        });
        deps.refreshToolbarState?.();
        return true;
      } catch (error) {
        if (token !== fullToken || summaryState.videoId !== videoId) {
          return false;
        }

        setState({
          fullStatus: "error",
          fullText: "",
        });
        trackSummaryError("full", error);

        const message = normalizeErrorMessage(error);
        if (
          message.includes("TRIAL_LIMIT_REACHED") ||
          message.includes("trial exhausted") ||
          message.includes("AI_LIMIT_REACHED") ||
          message.includes("Pro subscription required")
        ) {
          showPaywall("ai", {
            entryPoint: "summary_preview",
            copyVariant: "summary_limit",
          });
        } else if (
          message.includes("EMAIL_REQUIRED") ||
          message.includes("Email required")
        ) {
          showToast(
            "warning",
            deps.t("contentNeedEmail"),
            deps.t("contentRestoreInPopup"),
          );
        } else {
          showToast(
            "error",
            deps.t("contentError"),
            error.message || deps.t("contentAIFailed"),
          );
        }

        return false;
      }
    }

    function ensureFullSummaryReady() {
      const fullText = String(summaryState.fullText || "").trim();
      if (fullText) return fullText;

      showToast(
        "warning",
        deps.t("contentNoText"),
        deps.t("contentSummaryFullUnavailable"),
      );
      return "";
    }

    function copyFullSummary() {
      const fullText = ensureFullSummaryReady();
      if (!fullText) return Promise.resolve(false);

      return deps.copyText?.({
        text: fullText,
        successTitle: deps.t("contentCopied"),
        successSubtitle: deps.t("contentSummaryCopied"),
        errorTitle: deps.t("contentError"),
        errorSubtitle: deps.t("contentCopyError"),
      });
    }

    function downloadFullSummaryTxt() {
      const fullText = ensureFullSummaryReady();
      if (!fullText) return false;

      const videoId = getCurrentVideoId() || deps.getVideoId?.() || "video";
      const prefix = deps.getPlatformDownloadPrefix?.() || "transcript";
      return deps.downloadText?.({
        content: fullText,
        filename: `${prefix}_ai_summary_${videoId}.txt`,
        successTitle: deps.t("contentDownloaded"),
        successSubtitle: deps.t("contentTxtSaved"),
      });
    }

    return {
      getState,
      markPreviewVisible,
      maybeRequestPreview: requestPreview,
      retryPreview,
      openFullSummary,
      copyFullSummary,
      downloadFullSummaryTxt,
      reset,
    };
  };
})(globalThis);
