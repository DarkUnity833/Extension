// RuTube, VK Video & YouTube Transcript Pro - Content Script

(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});
  const runtimeUiHelpers = global.__rutubeTranscriptRuntimeUi || {
    createEmptyRuntimeUiConfig: () => ({
      version: "",
      ttl_seconds: 3600,
      ttlSeconds: 3600,
      assignments: {},
      payload: {},
    }),
    getFeatureConfig: () => ({}),
    getLimitConfig: () => ({}),
    getPanelUiCopy: () => ({}),
    getSurfaceCopy: () => ({}),
    normalizeRuntimeUiConfig: (value) => value || {},
    resolvePaywallExperimentVariant: () => "current",
    resolvePaywallUiCopy: () => ({}),
  };

  modules.createContentRuntime = function createContentRuntime(
    runtimeContext = {},
  ) {
    const platform =
      runtimeContext.platform || modules.detectPlatform?.(location) || null;
    const runtimeTeardown =
      runtimeContext.teardownRegistry ||
      modules.createTeardownRegistry?.() ||
      modules.createFallbackTeardownRegistry?.();
    const persistentDisposers = [];

    function registerPersistentDisposer(disposer) {
      if (typeof disposer !== "function") return;
      persistentDisposers.push(disposer);
    }

    function flushPersistentDisposers() {
      while (persistentDisposers.length > 0) {
        const disposer = persistentDisposers.pop();
        try {
          disposer();
        } catch (error) {
          console.error("Persistent teardown failed:", error);
        }
      }
    }

  let currentVideo = null;
  let currentVideoId = null;
  let sessionActive = false;
  const platformAdapter =
    platform?.adapter || modules.getPlatformAdapter?.(location) || null;
  const transcriptState =
    modules.createTranscriptState?.() ||
    modules.createFallbackTranscriptState?.();
  const transcriptService =
    modules.createTranscriptService?.({
      state: transcriptState,
      isExpectedVideoActive,
      parseVTT,
      parseSRT,
      parseYouTubeTimedTextXML,
      parseYouTubeJson3,
      parseYouTubeTranscriptResponse,
    }) ||
    modules.createFallbackTranscriptService?.({
      state: transcriptState,
      isExpectedVideoActive,
      parseVTT,
      parseSRT,
      parseYouTubeTimedTextXML,
      parseYouTubeJson3,
      parseYouTubeTranscriptResponse,
    });
  const transcriptExport =
    modules.createTranscriptExport?.({
      formatTime,
      formatSRTTime,
    }) ||
    modules.createFallbackTranscriptExport?.({
      formatTime,
      formatSRTTime,
    });
  const languageSelector = modules.createLanguageSelector?.() || null;
  const fullSummaryLoader = modules.createFullSummaryLoader?.() || null;
  const transcriptPanelRoot =
    modules.createPanelRoot?.({
      languageSelector,
      fullSummaryLoader,
    }) || null;
  const transcriptListView = modules.createTranscriptListView?.();
  const transcriptActionsToolbar = modules.createActionsToolbar?.();
  const toastView = modules.createToastView?.();
  const paywallView = modules.createPaywallView?.();
  const activeCueTracker =
    modules.createActiveCueTracker?.() ||
    modules.createFallbackActiveCueTracker?.();
  const transcriptScrollManager =
    modules.createScrollManager?.() ||
    modules.createFallbackScrollManager?.();
  const transcriptTimeupdateController =
    modules.createTimeupdateController?.() ||
    modules.createFallbackTimeupdateController?.();

  const hostname = location.hostname.toLowerCase();
  const currentPlatform =
    platformAdapter?.id ||
    platform?.id ||
    (hostname.includes("vkvideo.ru")
      ? "vkvideo"
      : hostname === "youtube.com" ||
          hostname === "www.youtube.com" ||
          hostname === "m.youtube.com"
        ? "youtube"
        : "rutube");
  const isVKVideo = currentPlatform === "vkvideo";
  const isYouTube = currentPlatform === "youtube";
  const isRuTube = currentPlatform === "rutube";
  const t = chrome.i18n.getMessage;
  let extensionEnabled = true;
  let panelController = null;
  let navigationController = null;
  let sessionLifecycleController = null;
  let transcriptFetchController = null;
  let youtubeRuntimeController = null;
  let transcriptActionsController = null;
  let paywallController = null;
  let summaryController = null;
  let translationController = null;
  let themeController = null;
  let runtimeUiConfig = runtimeUiHelpers.createEmptyRuntimeUiConfig();
  const entitlementService = modules.createEntitlementService?.({
    storage: chrome.storage.local,
    runtimeSendMessage,
    storageKeys: STORAGE_KEYS,
    defaultTrialLimit: DEFAULT_TRIAL_LIMIT,
    defaultProductPrice: DEFAULT_PRODUCT_PRICE,
    defaultYearlyProductPrice: DEFAULT_YEARLY_PRODUCT_PRICE,
    onStateChange: () => {
      updateProButtonStates();
    },
  });
  translationController = modules.createTranslationController?.({
    storage: chrome.storage.local,
    storageKeys: STORAGE_KEYS,
    entitlementService,
    runtimeSendMessage,
    t,
    trackEvent,
    showToast,
    showSubscriptionPaywall,
    getCurrentVideoId: () => currentVideoId,
    getCurrentPlatform: () => currentPlatform,
    getVideoUrl: () => location.href,
    getVideoTitle: () => document.title,
    lookupArchiveMaterial: lookupCurrentArchiveMaterial,
    getSourceSubtitles: () => transcriptState.getSubtitles(),
    getSourceSubtitleLanguage: () =>
      transcriptState.getSubtitleLanguage?.() || "",
    onStateChange: (nextState, previousState) => {
      panelController?.handleTranslationStateUpdate?.(nextState, previousState);
      const languageChanged =
        nextState?.selectedLanguage !== previousState?.selectedLanguage;

      if (languageChanged) {
        const sourceSubtitles = getSourceSubtitles();
        summaryController?.reset?.({
          videoId: currentVideoId || getVideoId(),
          clearCache: false,
        });
        summaryController?.maybeRequestPreview?.({
          subtitles: sourceSubtitles,
        });
        if ((panelController?.getPanelView?.() || "transcript") === "fullSummary") {
          void summaryController?.openFullSummary?.({
            subtitles: sourceSubtitles,
            source: "language_change",
            revealView: true,
          });
        }
      }
    },
  });
  themeController = modules.createThemeController?.({
    storage: chrome.storage.local,
    storageKeys: STORAGE_KEYS,
    document,
    onStateChange: () => {
      if (panelController?.getPanel?.()) {
        panelController?.renderPanelState?.();
      }
    },
  });
  youtubeRuntimeController = modules.createYouTubeRuntimeController?.({
    isYouTube,
    controllerDeps: {
      getCurrentVideo: () => currentVideo,
      getCurrentVideoId: () => currentVideoId,
      getPlayerRoot,
      getSubtitles,
      getSubtitleLanguage,
      getSubtitleSourceMode,
      getVideoId,
      hasCompleteSubtitles,
      hasSubtitles: hasLoadedSubtitles,
      isExpectedVideoActive,
      parseSubtitles,
      renderTranscriptContent: () => {
        if (panelController?.getPanel?.()) renderTranscriptContent();
      },
      requestSubtitlesNow: (options) =>
        transcriptFetchController?.fetchSubtitlesNow?.(options),
      setHasSubtitles: () => {},
      setSubtitleSourceMode,
      storeLoadedSubtitles,
      updateButtonState,
      waitForTrackCues: (track, timeoutMs) =>
        transcriptFetchController?.waitForTrackCues?.(track, timeoutMs) || null,
    },
  }) || null;
  transcriptFetchController =
    modules.createTranscriptFetchController?.({
      fetch,
      deduplicateVKCues,
      getCurrentVideoId: () => currentVideoId,
      getVideoDuration: () => currentVideo?.duration,
      getPlayerRoot,
      getVideoId,
      hasCompleteSubtitles,
      hasLoadedSubtitles,
      isExpectedVideoActive,
      isRuTube,
      isVKVideo,
      isYouTube,
      onStateUpdated: () => {
        updateButtonState();
        if (panelController?.getPanel?.()) {
          panelController?.renderPanelState?.();
        }
        summaryController?.maybeRequestPreview?.({
          subtitles: getSourceSubtitles(),
        });
      },
      parseSubtitles,
      registerYouTubeAutoFetchAttempt: () =>
        youtubeRuntimeController?.registerAutoFetchAttempt?.(),
      setupYouTubeSubtitleWatchers: () =>
        youtubeRuntimeController?.setupSubtitleWatchers?.(),
      startYouTubeLiveCaptionCapture: () =>
        youtubeRuntimeController?.startLiveCaptionCapture?.(),
      storeLoadedSubtitles,
      fetchYouTubeSubtitles: (options) =>
        youtubeRuntimeController?.fetchSubtitles?.(options) || false,
      isYouTubeFetchCoolingDown: () =>
        youtubeRuntimeController?.isFetchCoolingDown?.() || false,
    }) || null;
  panelController = modules.createPanelController?.({
    document,
    panelRoot: transcriptPanelRoot,
    listView: transcriptListView,
    activeCueTracker,
    scrollManager: transcriptScrollManager,
    timeupdateController: transcriptTimeupdateController,
    t,
    formatTime,
    currentPlatform,
    isRuTube,
    isVKVideo,
    isYouTube,
    getPlayerRoot,
    getCurrentVideo: () => currentVideo,
    getCurrentVideoId: () => currentVideoId,
    getSubtitles,
    hasLoadedSubtitles,
    getSubtitleSourceMode,
    getSubtitleSourceMeta,
    hasCompleteSubtitles,
    isLoading: () =>
      Boolean(
        transcriptFetchController?.getPendingPromise?.() ||
          youtubeRuntimeController?.shouldShowLoadingState?.(),
      ),
    getSubtitleFetchPromise: () =>
      transcriptFetchController?.getPendingPromise?.() || null,
    shouldKeepButtonEnabled: shouldKeepTranscriptButtonEnabled,
    fetchSubtitlesNow: (options) =>
      transcriptFetchController?.fetchSubtitlesNow?.(options) || false,
    primeYouTubeCaptionsFromGesture: (expectedVideoId) =>
      youtubeRuntimeController?.primeCaptionsFromUserGesture?.(expectedVideoId) ||
      false,
    resetViewState: resetPanelViewState,
    clearSubtitleWatchers: () =>
      youtubeRuntimeController?.clearSubtitleWatchers?.(),
    concealNativeTranscriptPanel: () =>
      youtubeRuntimeController?.concealNativeTranscriptPanel?.(),
    closeNativeTranscriptPanel: () =>
      youtubeRuntimeController?.closeNativeTranscriptPanel?.(),
    resetYouTubePageSessionState: () =>
      youtubeRuntimeController?.resetPageSessionState?.(),
    injectStylesIntoShadow,
    storage: chrome.storage.local,
    storageKeys: STORAGE_KEYS,
    shouldShowSummaryPreviewNudge,
    alwaysShowSummaryReadyNudge: false,
    updateProButtonStates,
    syncProStatusFromBackend,
    getSummaryState: () => summaryController?.getState?.() || {},
    getTranslationState: () => translationController?.getState?.() || {},
    getProState: () => entitlementService?.getProState?.() || {},
    getThemeState: () => themeController?.getState?.() || {},
    applyThemeToPanel: (panel) => themeController?.applyToPanel?.(panel),
    getPanelRuntimeUiCopy: () => runtimeUiHelpers.getPanelUiCopy(runtimeUiConfig),
    markSummaryPreviewVisible: () =>
      summaryController?.markPreviewVisible?.() || false,
    onPanelOpened: () => {
      const sourceSubtitles = getSourceSubtitles();
      if (!Array.isArray(sourceSubtitles) || sourceSubtitles.length === 0) {
        return false;
      }
      void summaryController?.maybeRequestPreview?.({
        subtitles: sourceSubtitles,
      });
      return true;
    },
    onLanguageChange: handleLanguageChange,
    onLockedLanguageClick: handleLockedLanguageClick,
    onThemeToggle: handleThemeToggle,
    onCopy: copyTranscript,
    onDownloadTxt: downloadTXT,
    onDownloadSrt: downloadSRT,
    onSaveToArchive: handleSaveToArchive,
    onArchiveSaveError: (error) => {
      showToast(
        "error",
        t("contentArchiveFailed"),
        String(error?.message || ""),
      );
    },
    onOpenArchiveMaterial: handleOpenArchiveMaterial,
    onLookupArchiveMaterial: handleLookupArchiveMaterial,
    onArchiveOpenError: (error) => {
      showToast(
        "error",
        t("contentArchiveOpenFailed"),
        String(error?.message || ""),
      );
    },
    onOpenFullSummary: handleOpenFullSummary,
    onRetryPreview: handleRetryPreview,
    onCopyFullSummary: copyFullSummary,
    onDownloadFullSummaryTxt: downloadFullSummaryTxt,
    trackEvent,
  });
  paywallController = modules.createPaywallController?.({
    view: paywallView,
    entitlementService,
    document,
    t,
    currentPlatform,
    getRuntimeUiCopy: (variantKey) =>
      runtimeUiHelpers.resolvePaywallUiCopy(runtimeUiConfig, variantKey),
    getRuntimeUiVariant: (paywallSource) =>
      runtimeUiHelpers.resolvePaywallExperimentVariant(runtimeUiConfig, paywallSource),
    siteBaseUrl: "https://extension.implesol.com",
    getInterfaceLocale: () => chrome.i18n.getUILanguage?.() || "ru",
    runtimeSendMessage,
    trackEvent,
    showToast,
    openExternal: (url) => window.open(url, "_blank"),
  });
  transcriptActionsController =
    modules.createTranscriptActionsController?.({
      document,
      navigator,
      urlApi: URL,
      transcriptExport,
      entitlementService,
      t,
      showToast,
      showSubscriptionPaywall,
      trackEvent,
    }) || null;
  summaryController = modules.createSummaryController?.({
    entitlementService,
    transcriptExport,
    storage: chrome.storage.local,
    storageKeys: STORAGE_KEYS,
    t,
    shouldRequestSummaryPreview,
    extractSummaryText,
    getCurrentPlatform: () => currentPlatform,
    getCurrentVideoId: () => currentVideoId,
    getSourceSubtitles: () => getSourceSubtitles(),
    getSourceSubtitleLanguage: () =>
      transcriptState.getSubtitleLanguage?.() || "",
    getSubtitleLanguage,
    getTargetLanguage: () =>
      translationController?.getEffectiveTargetLanguage?.() || "original",
    getSummaryPreviewMeterConfig,
    getSubtitleSourceMode,
    getSubtitleSourceMeta,
    hasCompleteSubtitles,
    getVideoId,
    getVideoDuration: () => currentVideo?.duration,
    formatTime,
    getVideoUrl: () => location.href,
    getVideoTitle: () => document.title,
    getPlatformDownloadPrefix,
    openFullSummaryView: () => panelController?.setPanelView?.("fullSummary"),
    copyText: (...args) => transcriptActionsController?.copyText?.(...args),
    downloadText: (...args) => transcriptActionsController?.downloadText?.(...args),
    runtimeSendMessage,
    lookupArchiveMaterial: lookupCurrentArchiveMaterial,
    syncArchiveMaterial: syncCurrentArchiveMaterial,
    trackEvent,
    showToast,
    showSubscriptionPaywall,
    onStateChange: () => panelController?.handleSummaryStateUpdate?.(),
    refreshToolbarState: updateProButtonStates,
  });
  navigationController = modules.createNavigationController?.({
    document,
    location,
    platformAdapter,
    runtimeTeardown,
    getPlayerRoot,
    getVideoId,
    getCurrentVideo: () => currentVideo,
    getCurrentVideoId: () => currentVideoId,
    isSessionActive: () => sessionLifecycleController?.isSessionActive?.() || false,
    onVideoDetected: ({ video, videoId }) => {
      sessionLifecycleController?.activateVideoSession?.(video, videoId);
    },
    onUrlChanged: () => {
      sessionLifecycleController?.resetActiveVideoSession?.();
    },
    onNavigationSettled: ({ video, videoId }) => {
      sessionLifecycleController?.activateVideoSession?.(video, videoId);
    },
  });
  sessionLifecycleController =
    modules.createSessionLifecycleController?.({
      storage: chrome.storage.local,
      storageKeys: STORAGE_KEYS,
      entitlementService,
      getExtensionEnabled: () => extensionEnabled,
      setExtensionEnabled: (value) => {
        extensionEnabled = value;
      },
      getSessionActive: () => sessionActive,
      setSessionActive: (value) => {
        sessionActive = value;
      },
      getVideoId,
      setCurrentVideo: (video) => {
        currentVideo = video;
      },
      setCurrentVideoId: (videoId) => {
        currentVideoId = videoId;
      },
      navigationController,
      panelController,
      resetTranscriptData,
      resetTranscriptViewState,
      runtimeTeardown,
      transcriptFetchController,
      youtubeRuntimeController,
    }) || null;
  const runtimeListenersController =
    modules.createRuntimeListenersController?.({
      runtime: chrome.runtime,
      storage: chrome.storage,
      storageKeys: STORAGE_KEYS,
      registerPersistentDisposer,
      getHasSubtitles: hasLoadedSubtitles,
      getSubtitlesStatus: () => ({
        hasSubtitles: hasLoadedSubtitles(),
        count: getSubtitles().length,
      }),
      canOpenPanel: () =>
        (sessionLifecycleController?.isSessionActive?.() || false) &&
        Boolean(panelController?.getPanel?.()),
      onOpenPanelRequested: () => {
        if (!panelController?.isOpen?.()) panelController?.togglePanel?.();
      },
      onRefreshState: () => {
        entitlementService?.refresh?.();
      },
      onEntitlementUnlocked: () => {
        entitlementService?.markLocallyUnlocked?.();
        entitlementService?.loadProState?.();
      },
      onEntitlementsChanged: () => {
        entitlementService?.refresh?.();
      },
      onSetEnabled: (enabled) => {
        sessionLifecycleController?.handleEnabledChange?.(enabled);
      },
    }) || null;

  function getPlayerRoot() {
    return platformAdapter?.getPlayerRoot?.(document) || document;
  }

  function getPlatformDownloadPrefix() {
    return platformAdapter?.getDownloadPrefix?.() || currentPlatform;
  }

  function getSourceSubtitles() {
    return transcriptState.getSubtitles();
  }

  function getSubtitles() {
    return (
      translationController?.getDisplayedSubtitles?.(getSourceSubtitles()) ||
      getSourceSubtitles()
    );
  }

  function hasLoadedSubtitles() {
    return transcriptState.hasSubtitles();
  }

  function getSubtitleLanguage() {
    return (
      translationController?.getDisplayedSubtitleLanguage?.(
        transcriptState.getSubtitleLanguage?.() || "",
      ) ||
      transcriptState.getSubtitleLanguage?.() ||
      ""
    );
  }

  function getSubtitleSourceMode() {
    return transcriptState.getSourceMode();
  }

  function getSubtitleSourceMeta() {
    return transcriptState.getSourceMeta?.() || {};
  }

  function setSubtitleSourceMode(mode) {
    transcriptState.setSourceMode(mode);
  }

  function resetTranscriptData() {
    transcriptService.reset();
  }

  function hasCompleteSubtitles() {
    return transcriptService.hasCompleteSubtitles();
  }

  function isExpectedVideoActive(expectedVideoId = currentVideoId) {
    if (!expectedVideoId) return true;
    const activeVideoId = getVideoId();
    return (
      expectedVideoId === currentVideoId || expectedVideoId === activeVideoId
    );
  }

  function injectStylesIntoShadow(shadowRoot) {
    if (shadowRoot.querySelector("#rutube-transcript-styles")) return;
    const style = document.createElement("style");
    style.id = "rutube-transcript-styles";
    style.textContent = `
      .rutube-transcript-btn {
        display: flex; align-items: center; justify-content: center;
        width: 40px; height: 40px; background: transparent; border: none;
        border-radius: 8px; color: rgba(255,255,255,0.7); cursor: pointer;
        transition: all 0.15s ease; padding: 0; margin: 0 2px;
      }
      .rutube-transcript-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
      .rutube-transcript-btn:active { transform: scale(0.95); }
      .rutube-transcript-btn svg { width: 24px; height: 24px; }
      .rutube-transcript-btn.in-controls { opacity: 1; }
      .rutube-transcript-btn.active { color: #8b5cf6; }
      .rutube-transcript-btn.active:hover { color: #a78bfa; }
      .rutube-transcript-btn.disabled { color: rgba(255,255,255,0.3); cursor: not-allowed; }
      .rutube-transcript-btn.disabled:hover { background: transparent; color: rgba(255,255,255,0.3); }
      .rutube-transcript-btn.loading { color: rgba(255,255,255,0.85); }
      .rutube-transcript-btn.loading svg { animation: transcript-pulse 1s ease-in-out infinite; }
      .rutube-transcript-btn.floating {
        position: absolute; top: 12px; right: 12px; z-index: 9999;
        background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); opacity: 0;
      }
      .rutube-transcript-btn.floating.visible { opacity: 1; }
      @keyframes transcript-pulse {
        0%, 100% { opacity: 0.55; }
        50% { opacity: 1; }
      }
    `;
    shadowRoot.appendChild(style);
  }

  function runtimeSendMessage(message) {
    return chrome.runtime.sendMessage(message);
  }

  function getSummaryPreviewMeterConfig() {
    const featureConfig =
      runtimeUiHelpers.getFeatureConfig?.(
        runtimeUiConfig,
        "summary_preview_meter",
      ) || {};
    const limitConfig =
      runtimeUiHelpers.getLimitConfig?.(
        runtimeUiConfig,
        "summary_preview_meter",
      ) || {};
    const copySurface =
      runtimeUiHelpers.getSurfaceCopy?.(runtimeUiConfig, "copy") || {};
    const copy =
      copySurface.summary_preview_meter &&
      typeof copySurface.summary_preview_meter === "object"
        ? copySurface.summary_preview_meter
        : {};

    return {
      ...featureConfig,
      ...limitConfig,
      copy,
    };
  }

  async function init() {
    await loadRuntimeUiConfig();
    await translationController?.loadPreference?.();
    await themeController?.loadPreference?.();
    runtimeListenersController?.attachPersistentListeners?.();
    return await sessionLifecycleController?.start?.();
  }

  async function loadRuntimeUiConfig() {
    try {
      const response = await runtimeSendMessage({
        action: "getRuntimeUiConfig",
      });
      runtimeUiConfig = runtimeUiHelpers.normalizeRuntimeUiConfig(response);
    } catch (error) {
      runtimeUiConfig = runtimeUiHelpers.createEmptyRuntimeUiConfig();
    }
  }

  function trackEvent(eventType, eventData) {
    runtimeSendMessage({
      action: "trackEvent",
      eventType,
      eventData,
    });
  }

  function stopSession() {
    return sessionLifecycleController?.stopSession?.() || false;
  }

  function updateProButtonStates() {
    const transcriptPanel = panelController?.getPanel?.();
    if (!transcriptPanel) return;
    transcriptActionsToolbar?.syncProState?.({
      panel: transcriptPanel,
      canAccessSRT: entitlementService?.canAccessSRT?.() || false,
    });
  }

  function getVideoId() {
    return platformAdapter?.getVideoId?.(location) || null;
  }

  // в”Ђв”Ђв”Ђ Subtitle extraction в”Ђв”Ђв”Ђ

  function storeLoadedSubtitles(parsed, storeOptions = {}) {
    const {
      expectedVideoId = currentVideoId,
      source = "full",
      sourceMode = source,
      subtitleLanguage = "",
      sourceMeta = {},
    } = storeOptions || {};
    const stored = transcriptService.storeLoadedSubtitles(parsed, {
      expectedVideoId,
      sourceMode:
        typeof sourceMode === "string" && sourceMode.trim()
          ? sourceMode.trim()
          : "full",
      subtitleLanguage:
        typeof subtitleLanguage === "string" ? subtitleLanguage : "",
      sourceMeta:
        sourceMeta &&
        typeof sourceMeta === "object" &&
        !Array.isArray(sourceMeta)
          ? sourceMeta
          : {},
    });
    if (!stored) return false;

    const sourceSubtitles = getSourceSubtitles();
    const activeVideoId = getVideoId() || currentVideoId;
    const trackingSource =
      typeof sourceMode === "string" && sourceMode.trim()
        ? sourceMode.trim()
        : typeof source === "string" && source.trim()
          ? source.trim()
          : "full";
    const currentSourceMeta = getSubtitleSourceMeta();
    void translationController?.maybeTranslate?.(sourceSubtitles);
    updateButtonState();
    if (panelController?.getPanel?.()) renderTranscriptContent();
    youtubeRuntimeController?.notifySubtitlesUpdated?.(true);
    trackEvent("subtitles_loaded", {
      video_id: activeVideoId,
      platform: currentPlatform,
      count: sourceSubtitles.length,
      source: trackingSource,
      source_partial: currentSourceMeta.isLikelyPartial === true,
      source_coverage_ratio: currentSourceMeta.coverageRatio ?? null,
      source_transcript_end_seconds:
        currentSourceMeta.transcriptEndSeconds ?? null,
    });
    summaryController?.maybeRequestPreview?.({
      subtitles: sourceSubtitles,
    });
    return true;
  }

  function shouldKeepTranscriptButtonEnabled() {
    return true;
  }

  function resetPanelViewState() {
    activeCueTracker.reset();
    transcriptScrollManager.reset();
  }

  function resetTranscriptViewState() {
    resetPanelViewState();
    translationController?.reset?.();
    summaryController?.reset?.({
      videoId: currentVideoId || getVideoId(),
      clearCache: false,
    });
    panelController?.clearPreviewNudge?.();
  }

  function parseSubtitles(
    text,
    url,
    source = "rutube_api",
    expectedVideoId = currentVideoId,
    options = {},
  ) {
    const parsed = transcriptService.parseSubtitles(
      text,
      url,
      source,
      expectedVideoId,
      options,
    );
    if (!parsed) return false;

    const sourceSubtitles = getSourceSubtitles();
    const activeVideoId = getVideoId() || currentVideoId;
    const currentSourceMeta = getSubtitleSourceMeta();
    void translationController?.maybeTranslate?.(sourceSubtitles);
    updateButtonState();
    if (panelController?.getPanel?.()) renderTranscriptContent();
    youtubeRuntimeController?.notifySubtitlesUpdated?.(true);
    trackEvent("subtitles_loaded", {
      video_id: activeVideoId,
      platform: currentPlatform,
      count: sourceSubtitles.length,
      source,
      source_partial: currentSourceMeta.isLikelyPartial === true,
      source_coverage_ratio: currentSourceMeta.coverageRatio ?? null,
      source_transcript_end_seconds:
        currentSourceMeta.transcriptEndSeconds ?? null,
    });
    summaryController?.maybeRequestPreview?.({
      subtitles: sourceSubtitles,
    });
    return true;
  }

  // в”Ђв”Ђв”Ђ UI в”Ђв”Ђв”Ђ

  function updateButtonState() {
    panelController?.updateButtonState?.();
  }

  function renderTranscriptContent() {
    panelController?.renderTranscriptContent?.();
  }

  async function syncProStatusFromBackend() {
    try {
      await entitlementService?.syncProStatusFromBackend?.();
      if (panelController?.getPanel?.()) {
        panelController?.renderPanelState?.();
      }
    } catch (e) {
      // Silent fail вЂ” use cached state
    }
  }

  async function handleLanguageChange(nextLanguage) {
    await translationController?.setSelectedLanguage?.(
      nextLanguage,
      {
        trigger: "manual",
        sourceSubtitles: getSourceSubtitles(),
      },
    );
    if (panelController?.getPanel?.()) {
      panelController?.renderPanelState?.();
    }
  }

  function handleLockedLanguageClick() {
    trackEvent("transcript_language_selector_locked_clicked", {
      video_id: currentVideoId || getVideoId(),
      platform: currentPlatform,
    });
    showSubscriptionPaywall("translation", {
      entryPoint: "transcript_language_selector",
      copyVariant: "translation",
    });
  }

  async function handleThemeToggle() {
    await themeController?.cycleMode?.();
    if (panelController?.getPanel?.()) {
      panelController?.renderPanelState?.();
    }
  }

  function copyTranscript() {
    transcriptActionsController?.copyTranscript?.({
      subtitles: getSubtitles(),
      currentVideoId,
      currentPlatform,
    });
  }

  function downloadTXT() {
    transcriptActionsController?.downloadTXT?.({
      subtitles: getSubtitles(),
      videoId: getVideoId() || "video",
      title: document.title || "Video",
      videoUrl: location.href,
      videoLabel: t("contentVideo"),
      platformPrefix: getPlatformDownloadPrefix(),
      currentVideoId,
      currentPlatform,
    });
  }

  async function downloadSRT() {
    await transcriptActionsController?.downloadSRT?.({
      subtitles: getSourceSubtitles(),
      videoId: getVideoId() || "video",
      platformPrefix: getPlatformDownloadPrefix(),
      currentVideoId,
      currentPlatform,
    });
  }

  function normalizeArchiveLanguage(value, fallback = "original") {
    const normalized = String(value || "").trim().toLowerCase();
    return normalized || fallback;
  }

  function buildArchiveSubtitleText(subtitles = []) {
    const items = Array.isArray(subtitles) ? subtitles : [];
    if (items.length === 0) return "";

    try {
      const text = transcriptExport?.buildPlainText?.(items);
      if (typeof text === "string" && text.trim()) return text.trim();
    } catch (error) {
      console.warn("Failed to build archive transcript text:", error);
    }

    return items
      .map((item) => String(item?.text || "").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  function buildPanelArchiveArtifacts() {
    const artifacts = [];
    const sourceSubtitles = getSourceSubtitles();
    const displayedSubtitles = getSubtitles();
    const sourceLanguage = normalizeArchiveLanguage(
      transcriptState.getSubtitleLanguage?.(),
    );
    const displayedLanguage = normalizeArchiveLanguage(getSubtitleLanguage());
    const subtitleSourceMode = getSubtitleSourceMode();
    const subtitleSourceMeta = getSubtitleSourceMeta();

    const transcriptText = buildArchiveSubtitleText(sourceSubtitles);
    if (transcriptText) {
      artifacts.push({
        type: "transcript",
        language: sourceLanguage,
        content_text: transcriptText,
        metadata_json: {
          cue_count: sourceSubtitles.length,
          source_mode: subtitleSourceMode || null,
          source_coverage: subtitleSourceMeta,
        },
      });
    }

    const translationState = translationController?.getState?.() || {};
    const hasDisplayedTranslation =
      (translationState.status || "idle") === "success" &&
      displayedLanguage !== "original" &&
      displayedLanguage !== sourceLanguage;
    const translationText = hasDisplayedTranslation
      ? buildArchiveSubtitleText(displayedSubtitles)
      : "";
    if (translationText) {
      artifacts.push({
        type: "translation",
        language: displayedLanguage,
        content_text: translationText,
        metadata_json: {
          cue_count: displayedSubtitles.length,
          source_mode: "extension_translation",
          translation_scope: "full",
        },
      });
    }

    const summaryState = summaryController?.getState?.() || {};
    const fullSummary = String(summaryState.fullText || "").trim();
    const previewSummary = String(summaryState.previewText || "").trim();
    const summaryText = fullSummary || previewSummary;
    if (summaryText) {
      artifacts.push({
        type: "summary",
        language:
          displayedLanguage === "original" ? sourceLanguage : displayedLanguage,
        content_text: summaryText,
        metadata_json: {
          summary_type: fullSummary ? "full" : "preview",
          ...(fullSummary ? { source: "extension_ai_summary" } : {}),
        },
      });
    }

    return artifacts;
  }

  function buildPanelArchivePayload() {
    const activeVideoId = getVideoId() || currentVideoId || "";
    const sourceLanguage = normalizeArchiveLanguage(
      transcriptState.getSubtitleLanguage?.() || getSubtitleLanguage(),
    );
    const title =
      String(document.title || "").trim() ||
      t("contentVideo") ||
      t("contentVideoText") ||
      "Video";
    const duration = Number(currentVideo?.duration);
    const payload = {
      source_kind: "extension_video",
      title,
      source_url: location.href,
      platform: currentPlatform,
      language: sourceLanguage,
      status: "saved",
      metadata_json: {
        source: "content_panel",
        subtitle_source_mode: getSubtitleSourceMode() || null,
        subtitle_source_coverage: getSubtitleSourceMeta(),
        saved_at: new Date().toISOString(),
      },
      artifacts: buildPanelArchiveArtifacts(),
    };

    if (activeVideoId) payload.external_id = activeVideoId;
    if (Number.isFinite(duration) && duration > 0) {
      payload.duration_seconds = Math.max(1, Math.round(duration));
    }

    return payload;
  }

  function buildArchiveLookupPayload() {
    const activeVideoId = getVideoId() || currentVideoId || "";
    const sourceLanguage = normalizeArchiveLanguage(
      transcriptState.getSubtitleLanguage?.() || getSubtitleLanguage(),
    );
    const payload = {
      platform: currentPlatform,
      source_url: location.href,
      language: sourceLanguage,
    };
    if (activeVideoId) payload.external_id = activeVideoId;
    return payload;
  }

  async function lookupCurrentArchiveMaterial() {
    try {
      const response = await runtimeSendMessage({
        action: "lookupArchiveMaterial",
        payload: buildArchiveLookupPayload(),
      });
      if (response?.error) return null;
      return response?.material || null;
    } catch {
      return null;
    }
  }

  async function handleSaveToArchive() {
    const payload = buildPanelArchivePayload();
    try {
      const response = await runtimeSendMessage({
        action: "saveArchiveMaterial",
        payload,
      });
      if (response?.error) throw new Error(response.error);

      if (response?.pairing_required) {
        showToast(
          "warning",
          t("contentArchivePairingStarted"),
          t("contentArchivePairingSubtitle"),
        );
      } else {
        showToast(
          "success",
          t("contentArchiveSaved"),
          t("contentArchiveSavedSubtitle"),
        );
      }

      trackEvent("content_archive_save_clicked", {
        video_id: getVideoId() || currentVideoId,
        platform: currentPlatform,
        artifact_types: payload.artifacts.map((artifact) => artifact.type),
        pairing_required: Boolean(response?.pairing_required),
      });
      return {
        ok: true,
        saved: !response?.pairing_required,
        pairingRequired: Boolean(response?.pairing_required),
        material: response?.material || null,
      };
    } catch (error) {
      showToast(
        "error",
        t("contentArchiveFailed"),
        String(error?.message || ""),
      );
      trackEvent("content_archive_save_failed", {
        video_id: getVideoId() || currentVideoId,
        platform: currentPlatform,
        error: String(error?.message || error || "").slice(0, 180),
      });
      return { ok: false, saved: false, error: String(error?.message || error || "") };
    }
  }

  async function handleOpenArchiveMaterial(options = {}) {
    let material = options?.material || null;
    if (!material?.id) {
      material = await lookupCurrentArchiveMaterial();
    }

    const materialId = String(material?.id || "").trim();
    const response = await runtimeSendMessage({
      action: "openArchiveMaterial",
      materialId,
    });
    if (response?.error) throw new Error(response.error);

    trackEvent("content_archive_open_clicked", {
      video_id: getVideoId() || currentVideoId,
      platform: currentPlatform,
      material_id: materialId || null,
      fallback_to_archive: !materialId,
    });
    return {
      ok: true,
      material,
      url: response?.url || null,
    };
  }

  async function handleLookupArchiveMaterial() {
    return {
      ok: true,
      material: await lookupCurrentArchiveMaterial(),
    };
  }

  async function syncCurrentArchiveMaterial(options = {}) {
    const payload = buildPanelArchivePayload();
    const artifactType = String(options?.artifactType || "").trim();
    const summaryType = String(options?.summaryType || "").trim().toLowerCase();
    const hasExpectedArtifact = payload.artifacts.some((artifact) => {
      if (artifactType && artifact.type !== artifactType) return false;
      if (artifact.type === "summary" && summaryType) {
        return (
          String(artifact?.metadata_json?.summary_type || "")
            .trim()
            .toLowerCase() === summaryType
        );
      }
      return true;
    });

    if (!hasExpectedArtifact) {
      return { ok: true, synced: false, skipped: "artifact_missing" };
    }

    try {
      const response = await runtimeSendMessage({
        action: "syncArchiveMaterial",
        payload,
      });
      if (response?.error) throw new Error(response.error);
      trackEvent("content_archive_sync_finished", {
        video_id: getVideoId() || currentVideoId,
        platform: currentPlatform,
        artifact_types: payload.artifacts.map((artifact) => artifact.type),
        synced: Boolean(response?.synced),
        skipped: response?.skipped || null,
      });
      return response;
    } catch (error) {
      trackEvent("content_archive_sync_failed", {
        video_id: getVideoId() || currentVideoId,
        platform: currentPlatform,
        error: String(error?.message || error || "").slice(0, 180),
      });
      return { ok: false, synced: false, error: String(error?.message || error || "") };
    }
  }

  async function handleRetryPreview() {
    await summaryController?.retryPreview?.({
      subtitles: getSourceSubtitles(),
    });
  }

  async function handleOpenFullSummary() {
    await summaryController?.openFullSummary?.({
      subtitles: getSourceSubtitles(),
    });
  }

  function copyFullSummary() {
    return summaryController?.copyFullSummary?.() || Promise.resolve(false);
  }

  function downloadFullSummaryTxt() {
    return summaryController?.downloadFullSummaryTxt?.() || false;
  }

  // в”Ђв”Ђв”Ђ Toasts & Paywall в”Ђв”Ђв”Ђ

  function showToast(type, title, subtitle) {
    toastView?.show?.({
      document,
      type,
      title,
      subtitle,
    });
  }

  function showSubscriptionPaywall(feature, options) {
    paywallController?.showSubscriptionPaywall?.(feature, options);
  }

  function showRestoreModal() {
    paywallController?.showRestoreModal?.();
  }

    return {
      start: init,
      stop() {
        return stopSession();
      },
      destroy() {
        stopSession();
        flushPersistentDisposers();
        return true;
      },
      getPlatformId() {
        return currentPlatform;
      },
    };
  };
})(globalThis);

