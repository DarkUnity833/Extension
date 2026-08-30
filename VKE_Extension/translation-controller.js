(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  const SUPPORTED_LANGUAGES = new Set(["original", "en", "ru"]);
  const TRANSLATION_CACHE_LIMIT = 6;
  const TRANSLATION_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
  const TRANSLATION_BATCH_LIMIT = 12;
  const TRANSLATION_BATCH_CHAR_LIMIT = 900;

  function normalizeLanguage(value) {
    const normalized = String(value || "original").trim().toLowerCase();
    return SUPPORTED_LANGUAGES.has(normalized) ? normalized : "original";
  }

  function normalizeComparableLanguage(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) return "";
    if (normalized === "original") return "original";
    if (normalized.startsWith("ru")) return "ru";
    if (normalized.startsWith("en")) return "en";
    return "";
  }

  function buildSignature(subtitles = []) {
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
    return `tx_${(hash >>> 0).toString(36)}_${source.length}`;
  }

  function cloneItems(items = []) {
    return Array.isArray(items)
      ? items.map((item) => ({
          start: item?.start ?? 0,
          end: item?.end ?? item?.start ?? 0,
          text: typeof item?.text === "string" ? item.text : "",
        }))
      : [];
  }

  function normalizePersistedCache(rawValue) {
    return rawValue && typeof rawValue === "object" ? { ...rawValue } : {};
  }

  function createDefaultState(selectedLanguage = "original") {
    return {
      selectedLanguage: normalizeLanguage(selectedLanguage),
      status: "idle",
      error: "",
      videoId: null,
      transcriptSignature: "",
      translatedSubtitles: [],
      progress: 0,
      completedBatches: 0,
      totalBatches: 0,
    };
  }

  function normalizeHistoryList(items = []) {
    return Array.isArray(items) ? items.filter(Boolean).slice(0, 8) : [];
  }

  function splitIntoBatches(subtitles = []) {
    const sourceItems = cloneItems(subtitles);
    if (!sourceItems.length) return [];

    const batches = [];
    let currentItems = [];
    let currentChars = 0;
    let batchStartIndex = 0;

    sourceItems.forEach((item, index) => {
      const textLength = String(item?.text || "").length;
      const exceedsItemLimit = currentItems.length >= TRANSLATION_BATCH_LIMIT;
      const exceedsCharLimit =
        currentItems.length > 0 &&
        currentChars + textLength > TRANSLATION_BATCH_CHAR_LIMIT;

      if (exceedsItemLimit || exceedsCharLimit) {
        batches.push({
          startIndex: batchStartIndex,
          items: cloneItems(currentItems),
        });
        currentItems = [];
        currentChars = 0;
        batchStartIndex = index;
      }

      if (currentItems.length === 0) {
        batchStartIndex = index;
      }

      currentItems.push(item);
      currentChars += textLength;
    });

    if (currentItems.length > 0) {
      batches.push({
        startIndex: batchStartIndex,
        items: cloneItems(currentItems),
      });
    }

    return batches;
  }

  modules.createTranslationController = function createTranslationController(
    deps = {},
  ) {
    const storage = deps.storage || global.chrome?.storage?.local;
    const storageKeys = deps.storageKeys || {};
    let state = createDefaultState();
    let requestToken = 0;
    const translationCache = new Map();
    let persistedCacheLoaded = false;
    let persistedCache = {};

    function notify(previousState = null) {
      deps.onStateChange?.(getState(), previousState ? { ...previousState } : null);
    }

    function getState() {
      return {
        ...state,
        translatedSubtitles: cloneItems(state.translatedSubtitles),
      };
    }

    function getSelectedLanguage() {
      return state.selectedLanguage;
    }

    function getSourceSubtitleLanguage() {
      return normalizeComparableLanguage(
        deps.getSourceSubtitleLanguage?.() || deps.getSubtitleLanguage?.() || "",
      );
    }

    function getEffectiveTargetLanguage(
      selectedLanguage = state.selectedLanguage,
    ) {
      const normalizedSelected = normalizeLanguage(selectedLanguage);
      if (normalizedSelected === "original") return "original";

      const sourceLanguage = getSourceSubtitleLanguage();
      return sourceLanguage && sourceLanguage === normalizedSelected
        ? "original"
        : normalizedSelected;
    }

    function isOriginalLanguage() {
      return getEffectiveTargetLanguage() === "original";
    }

    function getCurrentVideoId() {
      return deps.getCurrentVideoId?.() || null;
    }

    function getCurrentPlatform() {
      return deps.getCurrentPlatform?.() || "rutube";
    }

    function getPersistentCacheKey() {
      return storageKeys.TRANSLATION_RESULT_CACHE || "";
    }

    function trimInMemoryCache() {
      while (translationCache.size > TRANSLATION_CACHE_LIMIT) {
        const oldestKey = translationCache.keys().next().value;
        if (!oldestKey) break;
        translationCache.delete(oldestKey);
      }
    }

    function rememberInMemory(cacheKey, items) {
      translationCache.delete(cacheKey);
      translationCache.set(cacheKey, cloneItems(items));
      trimInMemoryCache();
    }

    function prunePersistedCache(cache) {
      const now = Date.now();
      const entries = Object.entries(normalizePersistedCache(cache))
        .filter(([, record]) => {
          if (!record || typeof record !== "object") return false;
          if (!Array.isArray(record.items) || record.items.length === 0) return false;
          const savedAt = Number(record.savedAt || 0);
          return savedAt > 0 && now - savedAt <= TRANSLATION_CACHE_TTL_MS;
        })
        .sort(
          (left, right) =>
            Number(right[1]?.savedAt || 0) - Number(left[1]?.savedAt || 0),
        )
        .slice(0, TRANSLATION_CACHE_LIMIT);

      return entries.reduce((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {});
    }

    async function ensurePersistedCacheLoaded() {
      const cacheStorageKey = getPersistentCacheKey();
      if (persistedCacheLoaded || !storage?.get || !cacheStorageKey) {
        return persistedCache;
      }

      const data = await storage.get([cacheStorageKey]);
      persistedCache = prunePersistedCache(data?.[cacheStorageKey]);
      persistedCacheLoaded = true;
      return persistedCache;
    }

    async function persistCache() {
      const cacheStorageKey = getPersistentCacheKey();
      if (!storage?.set || !cacheStorageKey) return;

      persistedCache = prunePersistedCache(persistedCache);
      await storage.set({
        [cacheStorageKey]: persistedCache,
      });
    }

    async function readPersistedTranslation(cacheKey) {
      const cacheStorageKey = getPersistentCacheKey();
      if (!cacheStorageKey) return null;

      const cache = await ensurePersistedCacheLoaded();
      const record = cache?.[cacheKey];
      if (!record || !Array.isArray(record.items) || record.items.length === 0) {
        return null;
      }

      const savedAt = Number(record.savedAt || 0);
      if (!savedAt || Date.now() - savedAt > TRANSLATION_CACHE_TTL_MS) {
        delete cache[cacheKey];
        await persistCache();
        return null;
      }

      return cloneItems(record.items);
    }

    async function writePersistedTranslation(
      cacheKey,
      translatedItems,
      { videoId, language, transcriptSignature } = {},
    ) {
      const cacheStorageKey = getPersistentCacheKey();
      if (!cacheStorageKey) return;

      await ensurePersistedCacheLoaded();
      persistedCache[cacheKey] = {
        videoId: String(videoId || ""),
        language: normalizeLanguage(language),
        transcriptSignature: String(transcriptSignature || ""),
        savedAt: Date.now(),
        items: cloneItems(translatedItems),
      };
      await persistCache();
    }

    async function persistSelectedLanguage(nextLanguage) {
      if (!storage?.set || !storageKeys.SELECTED_LANGUAGE) return;
      await storage.set({
        [storageKeys.SELECTED_LANGUAGE]: nextLanguage,
      });
    }

    async function loadPreference() {
      const previousState = getState();
      state = createDefaultState("original");
      notify(previousState);
      if (storage?.set && storageKeys.SELECTED_LANGUAGE) {
        await storage.set({
          [storageKeys.SELECTED_LANGUAGE]: "original",
        });
      }
      return getState();
    }

    function getDisplayedSubtitles(sourceSubtitles = []) {
      if (
        !isOriginalLanguage() &&
        state.videoId === getCurrentVideoId() &&
        state.translatedSubtitles.length > 0
      ) {
        return cloneItems(state.translatedSubtitles);
      }
      return cloneItems(sourceSubtitles);
    }

    function getDisplayedSubtitleLanguage(sourceLanguage = "") {
      return isOriginalLanguage() ? sourceLanguage || "" : state.selectedLanguage;
    }

    function isLoading() {
      return state.status === "loading";
    }

    function isStructuredApiError(error, code) {
      return String(error?.message || error || "").includes(code);
    }

    async function ensureProAccess(trigger = "manual") {
      if (isOriginalLanguage()) return true;
      await deps.entitlementService?.refresh?.();
      const proState = deps.entitlementService?.getProState?.() || {};
      if (proState.isPro) return true;
      if (trigger === "manual") {
        deps.trackEvent?.("transcript_translation_paywall_requested", {
          platform: getCurrentPlatform(),
          video_id: getCurrentVideoId(),
          target_language: state.selectedLanguage,
        });
        deps.showSubscriptionPaywall?.("translation", {
          entryPoint: "transcript_language_selector",
          copyVariant: "translation",
        });
      }
      return false;
    }

    async function recordTranslationActivity(translatedItems = []) {
      if (!storage?.get || !storage?.set || !storageKeys.TRANSLATION_HISTORY) {
        return false;
      }

      const videoId = getCurrentVideoId();
      if (!videoId || isOriginalLanguage()) return false;

      const requestedAt = new Date().toISOString();
      const entry = {
        videoId,
        videoUrl: String(deps.getVideoUrl?.() || ""),
        videoTitle: String(deps.getVideoTitle?.() || ""),
        platform: getCurrentPlatform(),
        language: state.selectedLanguage,
        requestedAt,
      };
      const normalizedTranslatedItems = cloneItems(translatedItems);
      const historyKey = storageKeys.TRANSLATION_HISTORY;
      const data = await storage.get([historyKey]);
      const existingHistory = normalizeHistoryList(data?.[historyKey]);
      const previousEntry = existingHistory.find((item) => {
        return (
          String(item?.videoId || "") === entry.videoId &&
          String(item?.platform || "") === entry.platform &&
          String(item?.language || "") === entry.language
        );
      });
      if (
        normalizedTranslatedItems.length > 0 ||
        Array.isArray(previousEntry?.translatedSubtitles)
      ) {
        entry.translatedSubtitles =
          normalizedTranslatedItems.length > 0
            ? normalizedTranslatedItems
            : cloneItems(previousEntry?.translatedSubtitles);
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

      await storage.set({
        [historyKey]: nextHistory,
      });
      return true;
    }

    function artifactLanguageMatches(artifactLanguage, requestedLanguage) {
      return normalizeLanguage(artifactLanguage) === normalizeLanguage(requestedLanguage);
    }

    function getArtifactText(artifact) {
      return String(artifact?.content_text_optional || "").trim();
    }

    function findArchiveTranslationArtifact(material, requestedLanguage) {
      const artifacts = Array.isArray(material?.artifacts)
        ? material.artifacts
        : [];
      return (
        artifacts.find((artifact) => {
          return (
            artifact?.type === "translation" &&
            artifactLanguageMatches(artifact.language, requestedLanguage) &&
            getArtifactText(artifact)
          );
        }) || null
      );
    }

    function stripArchiveLinePrefix(line) {
      let cleaned = String(line || "").trim();
      for (let index = 0; index < 4; index += 1) {
        const next = cleaned
          .replace(/^\[[^\]]+\]\s*/, "")
          .replace(/^\d{1,2}:\d{2}(?::\d{2})?\s+/, "")
          .trim();
        if (next === cleaned) break;
        cleaned = next;
      }
      return cleaned;
    }

    function parseArchiveTranslationItems(text, sourceSubtitles = []) {
      const lines = String(text || "")
        .split(/\r?\n/)
        .map(stripArchiveLinePrefix)
        .filter(Boolean);
      if (lines.length === 0) return [];

      const sourceItems = cloneItems(sourceSubtitles);
      if (sourceItems.length === 0) {
        return lines.map((line, index) => ({
          start: index,
          end: index + 1,
          text: line,
        }));
      }

      return sourceItems.map((item, index) => ({
        ...item,
        text: lines[index] || item.text,
      }));
    }

    async function loadArchiveTranslation({
      subtitles = [],
      cacheKey,
      transcriptSignature,
      totalBatches,
      videoId,
    } = {}) {
      if (typeof deps.lookupArchiveMaterial !== "function") return false;
      try {
        const material = await deps.lookupArchiveMaterial({
          artifactType: "translation",
          targetLanguage: state.selectedLanguage,
        });
        const artifact = findArchiveTranslationArtifact(
          material,
          state.selectedLanguage,
        );
        const archiveItems = parseArchiveTranslationItems(
          getArtifactText(artifact),
          subtitles,
        );
        if (archiveItems.length === 0) return false;

        rememberInMemory(cacheKey, archiveItems);
        await writePersistedTranslation(cacheKey, archiveItems, {
          videoId,
          language: state.selectedLanguage,
          transcriptSignature,
        });
        const previousState = getState();
        state = {
          ...state,
          status: "success",
          error: "",
          videoId,
          transcriptSignature,
          translatedSubtitles: cloneItems(archiveItems),
          progress: 100,
          completedBatches: totalBatches,
          totalBatches,
        };
        notify(previousState);
        deps.trackEvent?.("transcript_translation_loaded", {
          platform: getCurrentPlatform(),
          video_id: videoId,
          target_language: state.selectedLanguage,
          cache_hit: true,
          cache_source: "archive",
        });
        await recordTranslationActivity(archiveItems);
        return true;
      } catch {
        return false;
      }
    }

    async function requestTranslation(sourceSubtitles = [], trigger = "auto") {
      const subtitles = cloneItems(sourceSubtitles);
      if (isOriginalLanguage() || subtitles.length === 0) return false;

      const videoId = getCurrentVideoId();
      const transcriptSignature = buildSignature(subtitles);
      const cacheKey = `${videoId || "video"}::${state.selectedLanguage}::${transcriptSignature}`;
      const batches = splitIntoBatches(subtitles);
      const totalBatches = batches.length;

      if (
        state.status === "loading" &&
        state.videoId === videoId &&
        state.transcriptSignature === transcriptSignature
      ) {
        return true;
      }

      const cachedItems = translationCache.get(cacheKey);
      if (cachedItems) {
        const previousState = getState();
        state = {
          ...state,
          status: "success",
          error: "",
          videoId,
          transcriptSignature,
          translatedSubtitles: cloneItems(cachedItems),
          progress: 100,
          completedBatches: totalBatches,
          totalBatches,
        };
        notify(previousState);
        await recordTranslationActivity(cachedItems);
        return true;
      }

      const persistedItems = await readPersistedTranslation(cacheKey);
      if (persistedItems) {
        rememberInMemory(cacheKey, persistedItems);
        const previousState = getState();
        state = {
          ...state,
          status: "success",
          error: "",
          videoId,
          transcriptSignature,
          translatedSubtitles: cloneItems(persistedItems),
          progress: 100,
          completedBatches: totalBatches,
          totalBatches,
        };
        notify(previousState);
        deps.trackEvent?.("transcript_translation_loaded", {
          platform: getCurrentPlatform(),
          video_id: videoId,
          target_language: state.selectedLanguage,
          cache_hit: true,
          cache_source: "local",
        });
        await recordTranslationActivity(persistedItems);
        return true;
      }

      const archiveLoaded = await loadArchiveTranslation({
        subtitles,
        cacheKey,
        transcriptSignature,
        totalBatches,
        videoId,
      });
      if (archiveLoaded) return true;

      if (!(await ensureProAccess(trigger))) return false;
      await recordTranslationActivity();

      const previousState = getState();
      state = {
        ...state,
        status: "loading",
        error: "",
        videoId,
        transcriptSignature,
        translatedSubtitles: cloneItems(subtitles),
        progress: 0,
        completedBatches: 0,
        totalBatches,
      };
      notify(previousState);
      deps.trackEvent?.("transcript_translation_requested", {
        platform: getCurrentPlatform(),
        video_id: videoId,
        target_language: state.selectedLanguage,
        trigger,
      });

      const token = ++requestToken;
      try {
        let workingItems = cloneItems(subtitles);
        let finalCacheHit = false;

        for (let index = 0; index < batches.length; index += 1) {
          const batch = batches[index];
          const result = await deps.runtimeSendMessage?.({
            action: "requestTranscriptTranslation",
            transcriptItems: batch.items,
            platform: getCurrentPlatform(),
            videoId,
            videoUrl: deps.getVideoUrl?.(),
            videoTitle: deps.getVideoTitle?.(),
            targetLanguage: state.selectedLanguage,
          });

          if (token !== requestToken) return false;
          if (!result) throw new Error(deps.t("contentNoResponse"));
          if (result.error) throw new Error(result.error);

          const translatedItems = Array.isArray(result.items)
            ? cloneItems(result.items)
            : [];
          if (translatedItems.length !== batch.items.length) {
            throw new Error(deps.t("contentTranslationUnavailable"));
          }

          workingItems.splice(
            batch.startIndex,
            translatedItems.length,
            ...translatedItems,
          );
          finalCacheHit = finalCacheHit || Boolean(result.cache_hit);

          const completedBatches = index + 1;
          if (completedBatches < totalBatches) {
            const nextPreviousState = getState();
            state = {
              ...state,
              status: "loading",
              error: "",
              videoId,
              transcriptSignature,
              translatedSubtitles: cloneItems(workingItems),
              progress: Math.max(
                8,
                Math.min(
                  96,
                  Math.round((completedBatches / totalBatches) * 100),
                ),
              ),
              completedBatches,
              totalBatches,
            };
            notify(nextPreviousState);
            await recordTranslationActivity(workingItems);
          }
        }

        rememberInMemory(cacheKey, workingItems);
        await writePersistedTranslation(cacheKey, workingItems, {
          videoId,
          language: state.selectedLanguage,
          transcriptSignature,
        });
        const nextPreviousState = getState();
        state = {
          ...state,
          status: "success",
          error: "",
          videoId,
          transcriptSignature,
          translatedSubtitles: cloneItems(workingItems),
          progress: 100,
          completedBatches: totalBatches,
          totalBatches,
        };
        notify(nextPreviousState);
        deps.trackEvent?.("transcript_translation_loaded", {
          platform: getCurrentPlatform(),
          video_id: videoId,
          target_language: state.selectedLanguage,
          cache_hit: finalCacheHit,
          batch_count: totalBatches,
        });
        await recordTranslationActivity(workingItems);
        return true;
      } catch (error) {
        if (token !== requestToken) return false;
        const limitReached = isStructuredApiError(error, "TRANSLATION_LIMIT_REACHED");
        const proRequired = isStructuredApiError(error, "PRO_REQUIRED");
        const nextPreviousState = getState();
        state = {
          ...state,
          status: "error",
          error: limitReached
            ? deps.t("contentTranslationLimitReached")
            : proRequired
              ? deps.t("contentLanguageProOnly")
              : String(error?.message || error || ""),
          videoId,
          transcriptSignature,
          translatedSubtitles: [],
          progress: 0,
          completedBatches: 0,
          totalBatches: 0,
        };
        notify(nextPreviousState);
        deps.trackEvent?.("transcript_translation_error", {
          platform: getCurrentPlatform(),
          video_id: videoId,
          target_language: state.selectedLanguage,
          error: state.error.slice(0, 200),
        });
        if (limitReached) {
          deps.trackEvent?.("transcript_translation_limit_reached", {
            platform: getCurrentPlatform(),
            video_id: videoId,
            target_language: state.selectedLanguage,
          });
        }
        if (proRequired && trigger === "manual") {
          deps.showSubscriptionPaywall?.("translation", {
            entryPoint: "transcript_language_selector",
            copyVariant: "translation",
          });
        }
        if (trigger === "manual") {
          deps.showToast?.(
            limitReached ? "warning" : "error",
            limitReached
              ? deps.t("contentTranslationLimitTitle")
              : deps.t("contentTranslationErrorTitle"),
            limitReached
              ? deps.t("contentTranslationLimitReached")
              : deps.t("contentTranslationErrorSubtitle"),
          );
        }
        return false;
      }
    }

    async function setSelectedLanguage(nextLanguage, options = {}) {
      const normalizedLanguage = normalizeLanguage(nextLanguage);
      const previousState = getState();
      if (normalizedLanguage === state.selectedLanguage) {
        if (!isOriginalLanguage() && options.sourceSubtitles?.length) {
          await requestTranslation(options.sourceSubtitles, options.trigger || "manual");
        }
        return true;
      }

      requestToken += 1;
      state = createDefaultState(normalizedLanguage);
      notify(previousState);

      const canPrimeTranslationHistory =
        normalizedLanguage !== "original" &&
        getEffectiveTargetLanguage(normalizedLanguage) !== "original" &&
        Boolean(deps.entitlementService?.getProState?.()?.isPro);

      if (canPrimeTranslationHistory) {
        await recordTranslationActivity();
      }

      await persistSelectedLanguage(normalizedLanguage);

      if (normalizedLanguage === "original") {
        return true;
      }

      if (getEffectiveTargetLanguage(normalizedLanguage) === "original") {
        return true;
      }

      const translated = await requestTranslation(
        options.sourceSubtitles || deps.getSourceSubtitles?.() || [],
        options.trigger || "manual",
      );
      if (!translated && state.status !== "success") {
        const blockedPreviousState = getState();
        state = createDefaultState("original");
        notify(blockedPreviousState);
        await persistSelectedLanguage("original");
        return false;
      }
      return translated;
    }

    async function maybeTranslate(sourceSubtitles = []) {
      return await requestTranslation(sourceSubtitles, "auto");
    }

    function reset() {
      const previousState = getState();
      state = createDefaultState("original");
      requestToken += 1;
      notify(previousState);
      return getState();
    }

    return {
      getState,
      getSelectedLanguage,
      getDisplayedSubtitles,
      getDisplayedSubtitleLanguage,
      isLoading,
      isOriginalLanguage,
      loadPreference,
      maybeTranslate,
      requestTranslation,
      reset,
      setSelectedLanguage,
      getEffectiveTargetLanguage,
    };
  };
})(globalThis);
