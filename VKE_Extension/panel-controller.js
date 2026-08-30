(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});
  const SUMMARY_READY_NUDGE_DURATION_MS = 6000;
  const FIRST_USE_BUTTON_HINT_DURATION_MS = 6400;
  const YOUTUBE_MANUAL_FETCH_RETRY_DELAY_MS = 450;

  modules.createPanelController = function createPanelController(deps = {}) {
    const shouldShowPreviewNudge =
      deps.shouldShowSummaryPreviewNudge ||
      global.shouldShowSummaryPreviewNudge;

    let transcriptPanel = null;
    let transcriptButton = null;
    let playerContainer = null;
    let isPanelOpen = false;
    let hoverCleanup = null;
    let panelView = "transcript";
    let previewNudge = null;
    let previewNudgeTimer = null;
    let previewNudgeCleanup = null;
    let fullSummaryLoadingTimer = null;
    let fullSummaryLoadingStartedAt = 0;
    let fullSummaryLoadingProgress = 0;
    let pendingReadyNudgeKind = null;
    let previewNudgeShownForVideoId = null;
    let fullNudgeShownForVideoId = null;
    let firstUseButtonHighlightTimer = null;
    let vkButtonMountRepairTimeoutIds = [];
    let archiveSaveInFlight = false;
    let archiveButtonStatus = "idle";
    let archiveButtonStatusVideoId = null;
    const archiveSavedVideoIds = new Set();
    const archiveSavedMaterials = new Map();
    const archiveLookupCheckedVideoIds = new Set();
    let archiveLookupInFlightVideoId = null;

    function clearHoverCleanup() {
      if (typeof hoverCleanup === "function") hoverCleanup();
      hoverCleanup = null;
    }

    function clearPreviewNudgeListeners() {
      if (typeof previewNudgeCleanup === "function") previewNudgeCleanup();
      previewNudgeCleanup = null;
    }

    function clearPreviewNudge() {
      if (previewNudgeTimer) {
        global.clearTimeout(previewNudgeTimer);
        previewNudgeTimer = null;
      }
      clearPreviewNudgeListeners();
      if (previewNudge) {
        previewNudge.remove();
        previewNudge = null;
      }
    }

    function clearFirstUseButtonHighlight() {
      if (firstUseButtonHighlightTimer) {
        global.clearTimeout(firstUseButtonHighlightTimer);
        firstUseButtonHighlightTimer = null;
      }
      transcriptButton?.classList.remove("first-use-highlight");
    }

    function clearFullSummaryLoadingTimer(resetProgress = true) {
      if (fullSummaryLoadingTimer) {
        global.clearTimeout(fullSummaryLoadingTimer);
        fullSummaryLoadingTimer = null;
      }

      if (resetProgress) {
        fullSummaryLoadingStartedAt = 0;
        fullSummaryLoadingProgress = 0;
      }
    }

    function clearVKButtonMountRepair() {
      if (!Array.isArray(vkButtonMountRepairTimeoutIds)) {
        vkButtonMountRepairTimeoutIds = [];
        return;
      }
      vkButtonMountRepairTimeoutIds.forEach((timeoutId) => {
        global.clearTimeout?.(timeoutId);
      });
      vkButtonMountRepairTimeoutIds = [];
    }

    function wait(ms) {
      return new Promise((resolve) => {
        global.setTimeout(resolve, ms);
      });
    }

    function scrollTranscriptContentToTop(behavior = "smooth") {
      const content = getTranscriptContentElement();
      if (!content) return false;

      if (typeof content.scrollTo === "function") {
        content.scrollTo({
          top: 0,
          behavior,
        });
      } else {
        content.scrollTop = 0;
      }

      return true;
    }

    function getTranscriptContentElement() {
      return deps.panelRoot?.getContentElement?.(transcriptPanel) || null;
    }

    function getSummaryState() {
      return deps.getSummaryState?.() || {};
    }

    function getTranscriptUiState() {
      const subtitles = deps.getSubtitles?.() || [];
      const hasSubtitles = Boolean(deps.hasLoadedSubtitles?.());
      const isLoading = !hasSubtitles && Boolean(deps.isLoading?.());
      const isUnavailable = !isLoading && (!hasSubtitles || subtitles.length === 0);

      return {
        subtitles,
        hasSubtitles,
        isLoading,
        isUnavailable,
      };
    }

    function getPanelTitle() {
      return deps.t("contentTranscriptTitle") || deps.t("contentVideoText");
    }

    function getCurrentVideoId() {
      return deps.getCurrentVideoId?.() || null;
    }

    function getArchiveVideoKey() {
      return String(getCurrentVideoId() || "").trim();
    }

    function getArchiveButtonStatus() {
      const videoKey = getArchiveVideoKey();
      if (videoKey && archiveSavedVideoIds.has(videoKey)) return "saved";
      if (archiveButtonStatusVideoId && archiveButtonStatusVideoId !== videoKey) {
        return "idle";
      }
      return archiveButtonStatus;
    }

    function setArchiveButtonStatus(status = "idle") {
      archiveButtonStatus = status;
      archiveButtonStatusVideoId = getArchiveVideoKey();
      updateArchiveButtonState();
    }

    function rememberArchiveMaterial(material) {
      const videoKey = getArchiveVideoKey();
      const materialId = String(material?.id || "").trim();
      if (!videoKey || !materialId) return;
      archiveSavedMaterials.set(videoKey, material);
    }

    function getRememberedArchiveMaterial() {
      const videoKey = getArchiveVideoKey();
      if (!videoKey) return null;
      return archiveSavedMaterials.get(videoKey) || null;
    }

    function shouldRefreshArchiveMaterialState(videoKey = getArchiveVideoKey()) {
      if (!videoKey || typeof deps.onLookupArchiveMaterial !== "function") {
        return false;
      }
      if (archiveSavedVideoIds.has(videoKey)) return false;
      if (archiveLookupCheckedVideoIds.has(videoKey)) return false;
      if (archiveLookupInFlightVideoId === videoKey) return false;
      return getArchiveButtonStatus() === "idle";
    }

    async function refreshArchiveMaterialState() {
      const videoKey = getArchiveVideoKey();
      if (!shouldRefreshArchiveMaterialState(videoKey)) return false;

      archiveLookupInFlightVideoId = videoKey;
      try {
        const result = await deps.onLookupArchiveMaterial?.({
          videoId: videoKey,
        });
        const material = result?.material || null;
        archiveLookupCheckedVideoIds.add(videoKey);
        if (!material?.id || getArchiveVideoKey() !== videoKey) {
          updateArchiveButtonState();
          return false;
        }

        archiveSavedVideoIds.add(videoKey);
        rememberArchiveMaterial(material);
        setArchiveButtonStatus("saved");
        return true;
      } catch {
        archiveLookupCheckedVideoIds.add(videoKey);
        updateArchiveButtonState();
        return false;
      } finally {
        if (archiveLookupInFlightVideoId === videoKey) {
          archiveLookupInFlightVideoId = null;
        }
      }
    }

    function resolveArchiveButtonLabel(status) {
      if (status === "saving") {
        return deps.t("contentArchiveSaving") || deps.t("contentArchiveSave");
      }
      if (status === "saved") {
        return (
          deps.t("contentArchiveOpenButton") ||
          deps.t("contentArchiveSavedButton") ||
          deps.t("contentArchiveSaved") ||
          deps.t("contentArchiveSave")
        );
      }
      if (status === "pairing") {
        return (
          deps.t("contentArchivePairingButton") ||
          deps.t("contentArchivePairingStarted") ||
          deps.t("contentArchiveSave")
        );
      }
      return deps.t("contentArchiveSave");
    }

    function isTranscriptView() {
      return panelView === "transcript" || panelView === "expandedTranscript";
    }

    function removeUI() {
      deps.clearSubtitleWatchers?.();
      deps.timeupdateController?.clear?.();
      deps.resetYouTubePageSessionState?.();
      clearHoverCleanup();
      clearPreviewNudge();
      clearFirstUseButtonHighlight();
      clearFullSummaryLoadingTimer();
      clearVKButtonMountRepair();

      if (transcriptButton) {
        transcriptButton.remove();
        transcriptButton = null;
      }
      if (transcriptPanel) {
        transcriptPanel.remove();
        transcriptPanel = null;
      }

      playerContainer = null;
      panelView = "transcript";
      isPanelOpen = false;
      pendingReadyNudgeKind = null;
      previewNudgeShownForVideoId = null;
      fullNudgeShownForVideoId = null;
      archiveSaveInFlight = false;
      archiveButtonStatus = "idle";
      archiveButtonStatusVideoId = null;
    }

    function updateButtonState() {
      if (!transcriptButton) return;

      const isLoading = Boolean(deps.isLoading?.());
      const hasSubtitles = Boolean(deps.hasLoadedSubtitles?.());

      transcriptButton.classList.toggle("loading", isLoading);
      transcriptButton.setAttribute("aria-busy", isLoading ? "true" : "false");

      if (hasSubtitles) {
        transcriptButton.classList.remove("disabled");
        transcriptButton.title = getPanelTitle();
        return;
      }

      if (deps.shouldKeepButtonEnabled?.()) {
        transcriptButton.classList.remove("disabled");
        transcriptButton.title = isLoading
          ? deps.t("contentLoadingSubs")
          : getPanelTitle();
        return;
      }

      transcriptButton.classList.add("disabled");
      transcriptButton.title = isLoading
        ? deps.t("contentLoadingSubs")
        : deps.t("contentSubsUnavailable");
    }

    function bindTranscriptContentInteractions() {
      const content = transcriptPanel?.querySelector("#transcript-content");
      if (!content || content.dataset.transcriptScrollBound === "true") return;

      content.dataset.transcriptScrollBound = "true";
      content.addEventListener(
        "scroll",
        () => {
          deps.scrollManager?.handleUserScroll?.({ isPanelOpen });
        },
        { passive: true },
      );
    }

    function highlightCurrentSubtitle(options = {}) {
      const currentVideo = deps.getCurrentVideo?.();
      if (!currentVideo || !transcriptPanel || !isTranscriptView()) return;

      const { forceScroll = false } = options;
      const content = getTranscriptContentElement();
      if (!content) return;

      const subtitles = deps.getSubtitles?.() || [];
      const currentTime = currentVideo.currentTime;
      const { previousIndex, nextIndex } = deps.activeCueTracker?.sync?.({
        subtitles,
        currentTime,
      }) || {
        previousIndex: -1,
        nextIndex: -1,
      };

      const activeItem = deps.listView?.highlightActiveItem?.({
        contentEl: content,
        activeIndex: nextIndex,
      });

      const shouldScrollToActiveItem =
        nextIndex >= 0 &&
        isPanelOpen &&
        deps.scrollManager?.isAutoFollowEnabled?.() &&
        (forceScroll || nextIndex !== previousIndex);

      if (!shouldScrollToActiveItem) return;
      deps.scrollManager?.scrollItemIntoView?.(
        activeItem,
        forceScroll ? "auto" : "smooth",
      );
    }

    function bindTranscriptTimeupdate() {
      const currentVideo = deps.getCurrentVideo?.();
      if (!currentVideo || !isTranscriptView()) {
        deps.timeupdateController?.clear?.();
        return;
      }

      deps.timeupdateController?.bind?.(currentVideo, highlightCurrentSubtitle);
    }

    function renderTranscriptContent() {
      if (!isTranscriptView()) return;

      const content = getTranscriptContentElement();
      if (!content) return;

      const subtitles = deps.getSubtitles?.() || [];
      const hasSubtitles = Boolean(deps.hasLoadedSubtitles?.());
      const subtitleSourceMode = deps.getSubtitleSourceMode?.() || "none";
      const subtitleSourceMeta = deps.getSubtitleSourceMeta?.() || {};
      const translationState = deps.getTranslationState?.() || {};

      if (deps.isYouTube) {
        deps.concealNativeTranscriptPanel?.();
      }

      deps.listView?.render?.({
        contentEl: content,
        t: deps.t,
        isLoading: !hasSubtitles && Boolean(deps.isLoading?.()),
        hasSubtitles,
        subtitles,
        isYouTube: Boolean(deps.isYouTube),
        subtitleSourceMode,
        subtitleSourceMeta,
        translationState,
        formatTime: deps.formatTime,
        onSeek: (time) => {
          const currentVideo = deps.getCurrentVideo?.();
          if (!currentVideo || Number.isNaN(time)) return;
          deps.scrollManager?.resumeAutoFollow?.();
          currentVideo.currentTime = time;
          highlightCurrentSubtitle({ forceScroll: true });
        },
      });

      if (!hasSubtitles || subtitles.length === 0) return;

      bindTranscriptTimeupdate();
      highlightCurrentSubtitle({
        forceScroll:
          isPanelOpen && deps.scrollManager?.isAutoFollowEnabled?.(),
      });
    }

    function getFullSummaryLoadingProgress(elapsedMs) {
      if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 12;
      if (elapsedMs < 1200) {
        return 12 + (elapsedMs / 1200) * 20;
      }
      if (elapsedMs < 3200) {
        return 32 + ((elapsedMs - 1200) / 2000) * 20;
      }
      if (elapsedMs < 6500) {
        return 52 + ((elapsedMs - 3200) / 3300) * 18;
      }
      if (elapsedMs < 11000) {
        return 70 + ((elapsedMs - 6500) / 4500) * 14;
      }
      return Math.min(94, 84 + ((elapsedMs - 11000) / 12000) * 10);
    }

    function getFullSummaryLoadingStage(progress) {
      if (progress < 38) {
        return deps.t("contentSummaryFullLoadingStageAnalyze");
      }
      if (progress < 76) {
        return deps.t("contentSummaryFullLoadingStageCompose");
      }
      return deps.t("contentSummaryFullLoadingStagePolish");
    }

    function syncFullSummaryLoadingUi(progress = fullSummaryLoadingProgress) {
      if (!transcriptPanel) return;
      deps.panelRoot?.syncFullSummaryLoadingState?.(transcriptPanel, {
        progress,
        stageLabel: getFullSummaryLoadingStage(progress),
      });
    }

    function scheduleFullSummaryLoadingTick() {
      fullSummaryLoadingTimer = global.setTimeout(() => {
        fullSummaryLoadingTimer = null;

        if (!transcriptPanel || panelView !== "fullSummary") {
          clearFullSummaryLoadingTimer();
          return;
        }

        const summaryState = getSummaryState();
        if ((summaryState.fullStatus || "idle") !== "loading") {
          clearFullSummaryLoadingTimer();
          return;
        }

        if (!fullSummaryLoadingStartedAt) {
          fullSummaryLoadingStartedAt = Date.now();
        }

        fullSummaryLoadingProgress = getFullSummaryLoadingProgress(
          Date.now() - fullSummaryLoadingStartedAt,
        );
        syncFullSummaryLoadingUi(fullSummaryLoadingProgress);
        scheduleFullSummaryLoadingTick();
      }, 180);
    }

    function ensureFullSummaryLoadingAnimation(summaryState = getSummaryState()) {
      const isFullSummaryLoading =
        panelView === "fullSummary" &&
        (summaryState.fullStatus || "idle") === "loading";

      if (!isFullSummaryLoading) {
        clearFullSummaryLoadingTimer();
        return;
      }

      if (!fullSummaryLoadingStartedAt) {
        fullSummaryLoadingStartedAt = Date.now();
      }
      if (!Number.isFinite(fullSummaryLoadingProgress) || fullSummaryLoadingProgress < 12) {
        fullSummaryLoadingProgress = 12;
      }

      syncFullSummaryLoadingUi(fullSummaryLoadingProgress);

      if (!fullSummaryLoadingTimer) {
        scheduleFullSummaryLoadingTick();
      }
    }

    function renderPanelState() {
      if (!transcriptPanel) return;

      const summaryState = getSummaryState();
      const translationState = deps.getTranslationState?.() || {};
      const proState = deps.getProState?.() || {};
      const themeState = deps.getThemeState?.() || {};
      const transcriptUiState = getTranscriptUiState();
      const showTranscriptChrome = !transcriptUiState.isUnavailable;
      const showPreview =
        showTranscriptChrome &&
        (summaryState.previewStatus || "hidden") !== "hidden";

      deps.panelRoot?.renderHeaderControls?.(transcriptPanel, {
        t: deps.t,
        languageState: {
          selectedLanguage: translationState.selectedLanguage || "original",
          isLocked: !Boolean(proState.isPro),
          isLoading: Boolean(translationState.status === "loading"),
        },
        themeState,
        showLanguageSelector: showTranscriptChrome,
        handlers: {
          onLanguageChange: deps.onLanguageChange,
          onLockedLanguageClick: deps.onLockedLanguageClick,
          onThemeToggle: deps.onThemeToggle,
        },
      });
      deps.applyThemeToPanel?.(transcriptPanel);
      deps.panelRoot?.renderPreview?.(transcriptPanel, {
        t: deps.t,
        state: summaryState,
        copy: deps.getPanelRuntimeUiCopy?.() || {},
        handlers: {
          onOpenFullSummary: deps.onOpenFullSummary,
          onRetryPreview: deps.onRetryPreview,
        },
      });
      deps.panelRoot?.renderFullSummary?.(transcriptPanel, {
        t: deps.t,
        state: summaryState,
        handlers: {
          onBackToTranscript: () => setPanelView("transcript"),
          onCopyFullSummary: deps.onCopyFullSummary,
          onDownloadFullSummaryTxt: deps.onDownloadFullSummaryTxt,
          onOpenFullSummary: deps.onOpenFullSummary,
        },
      });
      deps.panelRoot?.setPanelView?.(transcriptPanel, panelView, {
        t: deps.t,
        showTranscriptActions: showTranscriptChrome,
        showPreview,
        showFooter: showTranscriptChrome,
      });

      if (isTranscriptView()) {
        renderTranscriptContent();
        if (isPanelOpen && panelView === "transcript" && showPreview) {
          deps.markSummaryPreviewVisible?.();
        }
      } else {
        deps.timeupdateController?.clear?.();
      }

      ensureFullSummaryLoadingAnimation(summaryState);
      updateArchiveButtonState();
      void refreshArchiveMaterialState();
      deps.updateProButtonStates?.();
    }

    function updateArchiveButtonState() {
      const button = transcriptPanel?.querySelector("#btn-save-archive");
      if (!button) return;

      const status = getArchiveButtonStatus();
      const loading = status === "saving";
      const locked = status === "pairing";
      const label = button.querySelector?.("span");
      if (label && !button.dataset.defaultLabel) {
        button.dataset.defaultLabel = label.textContent || deps.t("contentArchiveSave");
      }

      button.disabled = loading || locked;
      button.classList.toggle("loading", loading);
      button.classList.toggle("saved", status === "saved");
      button.classList.toggle("pairing", status === "pairing");
      button.setAttribute?.("aria-busy", loading ? "true" : "false");
      button.setAttribute?.("aria-disabled", loading || locked ? "true" : "false");
      button.title = resolveArchiveButtonLabel(status);
      if (label) {
        label.textContent = resolveArchiveButtonLabel(status);
      }
    }

    async function handleOpenArchiveMaterial() {
      try {
        const result = await deps.onOpenArchiveMaterial?.({
          material: getRememberedArchiveMaterial(),
          videoId: getArchiveVideoKey(),
        });
        if (result?.material) rememberArchiveMaterial(result.material);
        return result === true || Boolean(result?.ok);
      } catch (error) {
        deps.onArchiveOpenError?.(error);
        return false;
      }
    }

    async function handleSaveToArchive() {
      const currentStatus = getArchiveButtonStatus();
      if (archiveSaveInFlight || currentStatus === "pairing") {
        updateArchiveButtonState();
        return currentStatus === "saved";
      }
      if (currentStatus === "saved") {
        return handleOpenArchiveMaterial();
      }
      archiveSaveInFlight = true;
      setArchiveButtonStatus("saving");
      try {
        const result = await deps.onSaveToArchive?.();
        const success = result === true || Boolean(result?.ok || result?.saved || result?.pairingRequired);
        if (success) {
          const videoKey = getArchiveVideoKey();
          if (result?.pairingRequired) {
            setArchiveButtonStatus("pairing");
          } else {
            if (videoKey) archiveSavedVideoIds.add(videoKey);
            rememberArchiveMaterial(result?.material);
            setArchiveButtonStatus("saved");
          }
          return true;
        }
        setArchiveButtonStatus("idle");
        return false;
      } catch (error) {
        deps.onArchiveSaveError?.(error);
        setArchiveButtonStatus("idle");
        return false;
      } finally {
        archiveSaveInFlight = false;
        updateArchiveButtonState();
      }
    }

    function createTranscriptPanel() {
      transcriptPanel = deps.panelRoot?.mount?.({
        document: deps.document,
        t: deps.t,
        handlers: {
          onClose: closePanel,
          onToggleExpandedTranscript: () =>
            setPanelView(
              panelView === "expandedTranscript"
                ? "transcript"
                : "expandedTranscript",
            ),
          onCopy: deps.onCopy,
          onDownloadTxt: deps.onDownloadTxt,
          onDownloadSrt: deps.onDownloadSrt,
          onSaveToArchive: handleSaveToArchive,
        },
      });

      bindTranscriptContentInteractions();
      updateArchiveButtonState();
      void refreshArchiveMaterialState();
      renderPanelState();
      return transcriptPanel;
    }

    async function maybeHighlightTranscriptButtonOnFirstVideo() {
      if (
        !transcriptButton ||
        !deps.storage?.get ||
        !deps.storage?.set ||
        !deps.storageKeys?.HIGHLIGHT_TRANSCRIPT_BUTTON_ON_FIRST_VIDEO
      ) {
        return false;
      }

      const key = deps.storageKeys.HIGHLIGHT_TRANSCRIPT_BUTTON_ON_FIRST_VIDEO;
      const data = await deps.storage.get([key]);
      if (data?.[key] !== true) return false;

      await deps.storage.set({ [key]: false });
      transcriptButton.classList.add("first-use-highlight");
      firstUseButtonHighlightTimer = global.setTimeout(() => {
        firstUseButtonHighlightTimer = null;
        transcriptButton?.classList.remove("first-use-highlight");
      }, FIRST_USE_BUTTON_HINT_DURATION_MS);
      return true;
    }

    async function recordPanelOpened() {
      if (!deps.storage?.set || !deps.storageKeys?.LAST_PANEL_OPENED_AT) return;
      await deps.storage.set({
        [deps.storageKeys.LAST_PANEL_OPENED_AT]: Date.now(),
      });
    }

    function setPanelView(nextView = "transcript") {
      if (nextView === "fullSummary") {
        panelView = "fullSummary";
      } else if (nextView === "expandedTranscript") {
        panelView = "expandedTranscript";
      } else {
        panelView = "transcript";
      }
      renderPanelState();
    }

    async function togglePanel() {
      if (isPanelOpen) {
        closePanel();
        return;
      }

      const needsSubtitles = deps.isYouTube
        ? !deps.hasCompleteSubtitles?.()
        : !deps.hasLoadedSubtitles?.();
      if (deps.isYouTube && needsSubtitles) {
        deps.primeYouTubeCaptionsFromGesture?.(deps.getCurrentVideoId?.());
      }
      const loadAttempt = needsSubtitles
        ? deps.getSubtitleFetchPromise?.() ||
          deps.fetchSubtitlesNow?.({ force: deps.isYouTube })
        : null;

      openPanel();

      if (!loadAttempt) return;

      let loaded = await loadAttempt;

      if (
        deps.isYouTube &&
        !loaded &&
        !deps.hasCompleteSubtitles?.() &&
        (deps.getSubtitles?.() || []).length === 0
      ) {
        await wait(YOUTUBE_MANUAL_FETCH_RETRY_DELAY_MS);
        const retryAttempt =
          deps.getSubtitleFetchPromise?.() ||
          deps.fetchSubtitlesNow?.({ force: true });
        if (retryAttempt) {
          loaded = await retryAttempt;
        }
      }

      if (!loaded && (deps.getSubtitles?.() || []).length === 0) {
        deps.trackEvent?.("subtitles_not_found", {
          video_id: deps.getCurrentVideoId?.(),
          platform: deps.currentPlatform,
        });
        renderPanelState();
      }
    }

    function openPanel() {
      isPanelOpen = true;
      panelView = "transcript";
      clearPreviewNudge();
      clearFirstUseButtonHighlight();
      deps.resetViewState?.();
      void recordPanelOpened();

      if (deps.isYouTube) {
        deps.concealNativeTranscriptPanel?.();
      }

      renderPanelState();
      deps.panelRoot?.setOpen?.(transcriptPanel, true);
      transcriptButton?.classList.add("active");
      highlightCurrentSubtitle({ forceScroll: true });
      deps.syncProStatusFromBackend?.();
      deps.trackEvent?.("transcript_opened", {
        video_id: deps.getCurrentVideoId?.(),
        platform: deps.currentPlatform,
      });
      void deps.onPanelOpened?.({
        videoId: deps.getCurrentVideoId?.(),
        platform: deps.currentPlatform,
      });
    }

    function closePanel() {
      isPanelOpen = false;
      deps.panelRoot?.setOpen?.(transcriptPanel, false);
      transcriptButton?.classList.remove("active");
      clearFullSummaryLoadingTimer();
      if (deps.isYouTube) {
        deps.closeNativeTranscriptPanel?.();
      }

      if (pendingReadyNudgeKind) {
        const kind = pendingReadyNudgeKind;
        pendingReadyNudgeKind = null;
        void maybeShowSummaryReadyNudge(kind, getSummaryState());
      }
    }

    function getSummaryReadyNudgeLabel(kind = "preview") {
      return kind === "full"
        ? deps.t("contentSummaryFullReadyNudge")
        : deps.t("contentSummaryPreviewReadyNudge");
    }

    function trackSummaryReadyNudgeEvent(kind, action) {
      const eventData = {
        video_id: getCurrentVideoId(),
        platform: deps.currentPlatform,
      };
      if (kind === "full" && action === "clicked") {
        deps.trackEvent?.("summary_full_ready_nudge_clicked", eventData);
        return;
      }
      if (kind === "full") {
        deps.trackEvent?.("summary_full_ready_nudge_shown", eventData);
        return;
      }
      if (action === "clicked") {
        deps.trackEvent?.("summary_preview_nudge_clicked", eventData);
        return;
      }
      deps.trackEvent?.("summary_preview_nudge_shown", eventData);
    }

    function showSummaryReadyNudge(kind = "preview") {
      if (!transcriptButton || !deps.document?.body || isPanelOpen) return false;

      clearPreviewNudge();

      const rect = transcriptButton.getBoundingClientRect?.();
      if (!rect || !Number.isFinite(rect.top) || !Number.isFinite(rect.left)) {
        return false;
      }

      const nudge = deps.document.createElement("button");
      nudge.className = "summary-preview-nudge";
      nudge.type = "button";
      nudge.textContent = getSummaryReadyNudgeLabel(kind);

      const maxLeft = Math.max(
        12,
        (global.innerWidth || 0) - 180,
      );
      const left = Math.min(maxLeft, Math.max(12, rect.left + rect.width / 2 - 72));
      const top = Math.max(12, rect.top - 46);
      nudge.style.left = `${left}px`;
      nudge.style.top = `${top}px`;

      const dismiss = () => clearPreviewNudge();
      const handleClick = () => {
        trackSummaryReadyNudgeEvent(kind, "clicked");
        dismiss();
        if (!isPanelOpen) togglePanel();
      };

      nudge.addEventListener("click", handleClick);
      deps.document.body.appendChild(nudge);

      const hideOnViewportChange = () => dismiss();
      global.addEventListener?.("scroll", hideOnViewportChange, true);
      global.addEventListener?.("resize", hideOnViewportChange, true);
      previewNudgeCleanup = () => {
        nudge.removeEventListener("click", handleClick);
        global.removeEventListener?.("scroll", hideOnViewportChange, true);
        global.removeEventListener?.("resize", hideOnViewportChange, true);
      };

      previewNudge = nudge;
      previewNudgeTimer = global.setTimeout(() => {
        dismiss();
      }, SUMMARY_READY_NUDGE_DURATION_MS);

      trackSummaryReadyNudgeEvent(kind, "shown");
      return true;
    }

    async function maybeShowPreviewNudge(state = getSummaryState()) {
      return await maybeShowSummaryReadyNudge("preview", state);
    }

    async function maybeShowSummaryReadyNudge(
      kind = "preview",
      state = getSummaryState(),
    ) {
      if (isPanelOpen || !transcriptButton || previewNudge) return false;
      const videoId = state.videoId || getCurrentVideoId();
      if (!videoId) return false;

      if (kind === "full") {
        if ((state.fullStatus || "idle") !== "success") return false;
        if (fullNudgeShownForVideoId === videoId) return false;
      } else {
        if ((state.previewStatus || "hidden") !== "success") return false;
        if (previewNudgeShownForVideoId === videoId) return false;
      }

      let canShow = true;
      const bypassGating = Boolean(deps.alwaysShowSummaryReadyNudge);

      if (kind !== "full" && !bypassGating) {
        if (
          !deps.storage?.get ||
          !deps.storage?.set ||
          !deps.storageKeys?.LAST_PANEL_OPENED_AT ||
          !deps.storageKeys?.LAST_PREVIEW_NUDGE_SHOWN_AT
        ) {
          return false;
        }

        const data = await deps.storage.get([
          deps.storageKeys.LAST_PANEL_OPENED_AT,
          deps.storageKeys.LAST_PREVIEW_NUDGE_SHOWN_AT,
        ]);

        if (isPanelOpen || !transcriptButton) return false;
        if (typeof shouldShowPreviewNudge !== "function") return false;

        canShow = shouldShowPreviewNudge(
          data?.[deps.storageKeys.LAST_PANEL_OPENED_AT],
          data?.[deps.storageKeys.LAST_PREVIEW_NUDGE_SHOWN_AT],
        );
      }

      if (!canShow) return false;

      const shown = showSummaryReadyNudge(kind);
      if (!shown) return false;

      if (kind === "full") {
        fullNudgeShownForVideoId = videoId;
      } else {
        previewNudgeShownForVideoId = videoId;
      }

      if (
        kind !== "full" &&
        deps.storage?.set &&
        deps.storageKeys?.LAST_PREVIEW_NUDGE_SHOWN_AT
      ) {
        await deps.storage.set({
          [deps.storageKeys.LAST_PREVIEW_NUDGE_SHOWN_AT]: Date.now(),
        });
      }
      return true;
    }

    function handleSummaryStateUpdate(state = getSummaryState()) {
      if (transcriptPanel) {
        renderPanelState();
      }

      const videoId = state.videoId || getCurrentVideoId();
      if (!videoId) return;

      if (state.previewStatus === "success" && previewNudgeShownForVideoId !== videoId) {
        if (isPanelOpen) {
          pendingReadyNudgeKind = pendingReadyNudgeKind || "preview";
        } else {
          void maybeShowSummaryReadyNudge("preview", state);
        }
      }

      if (state.fullStatus === "success" && fullNudgeShownForVideoId !== videoId) {
        if (isPanelOpen) {
          pendingReadyNudgeKind = "full";
        } else {
          void maybeShowSummaryReadyNudge("full", state);
        }
      }
    }

    function shouldRevealTranslationStatus(
      nextState = {},
      previousState = {},
    ) {
      if (!isPanelOpen || !isTranscriptView()) return false;
      if ((nextState?.selectedLanguage || "original") === "original") return false;
      if ((nextState?.status || "idle") !== "loading") return false;

      const previousLanguage = previousState?.selectedLanguage || "original";
      const previousStatus = previousState?.status || "idle";
      return (
        previousLanguage !== nextState.selectedLanguage ||
        previousStatus !== "loading"
      );
    }

    function resolveVKControlsMount(root) {
      if (!root || typeof root.querySelector !== "function") {
        return { container: null, beforeNode: null };
      }

      const directContainerSelectors = [
        ".controls-right",
        '[class*="controls-right"]',
        '[class*="control-right"]',
        '[class*="right-controls"]',
        '[class*="controlsRight"]',
        '[class*="buttons-right"]',
      ];

      for (const selector of directContainerSelectors) {
        const container = root.querySelector(selector);
        if (container) {
          return {
            container,
            beforeNode: container.firstChild || null,
          };
        }
      }

      const anchorSelectors = [
        '[data-testid="settings-btn"]',
        '[data-testid="pip-btn"]',
        '[data-testid="fullscreen-btn"]',
        '[data-testid="mini-player-btn"]',
        '[data-testid="theater-btn"]',
        'button[aria-label*="настр"]',
        'button[aria-label*="полноэк"]',
      ];

      for (const selector of anchorSelectors) {
        const anchor = root.querySelector(selector);
        if (!anchor?.parentElement) continue;

        return {
          container: anchor.parentElement,
          beforeNode: anchor,
        };
      }

      return { container: null, beforeNode: null };
    }

    function repairVKButtonMount(root = deps.getPlayerRoot?.()) {
      if (!deps.isVKVideo || !transcriptButton || !root) return false;
      if (root !== deps.document) {
        deps.injectStylesIntoShadow?.(root);
      }

      const vkMount = resolveVKControlsMount(root);
      if (!vkMount.container || typeof vkMount.container.insertBefore !== "function") {
        return false;
      }

      clearHoverCleanup();
      transcriptButton.classList.remove("floating", "visible");
      transcriptButton.classList.add("in-controls");
      vkMount.container.insertBefore(
        transcriptButton,
        vkMount.beforeNode || vkMount.container.firstChild || null,
      );
      return true;
    }

    function scheduleVKButtonMountRepair() {
      clearVKButtonMountRepair();
      if (!deps.isVKVideo || !transcriptButton) return;

      [120, 320, 700, 1400, 2600, 4200].forEach((delayMs) => {
        const timeoutId = global.setTimeout?.(() => {
          if (!transcriptButton) return;
          if (repairVKButtonMount()) {
            clearVKButtonMountRepair();
          }
        }, delayMs);
        if (timeoutId !== undefined) {
          vkButtonMountRepairTimeoutIds.push(timeoutId);
        }
      });
    }

    function injectUI(video) {
      removeUI();

      playerContainer =
        video.closest('.video-player, .player-container, [class*="player"]') ||
        video.parentElement;
      if (!playerContainer) return;

      if (global.getComputedStyle(playerContainer).position === "static") {
        playerContainer.style.position = "relative";
      }

      let controlsContainer = null;
      const root = deps.getPlayerRoot?.();
      if (deps.isVKVideo && root && root !== deps.document) {
        deps.injectStylesIntoShadow?.(root);
      }
      if (deps.isRuTube) {
        controlsContainer = deps.document.querySelector(
          '[class*="desktopButtonsBlockRight"]',
        );
        if (!controlsContainer) {
          const fallback = deps.document.querySelector(
            '[data-testid="ui-fullscreen"]',
          );
          if (fallback) {
            controlsContainer = fallback.parentElement?.parentElement;
          }
        }
      } else if (deps.isYouTube) {
        controlsContainer =
          root?.querySelector(".ytp-right-controls") ||
          root?.querySelector(".ytp-left-controls");
      } else {
        const vkMount = resolveVKControlsMount(root);
        controlsContainer = vkMount.container;
      }

      transcriptButton = deps.document.createElement("button");
      transcriptButton.className = "rutube-transcript-btn";
      transcriptButton.setAttribute("data-testid", "ui-transcript");
      transcriptButton.setAttribute("aria-label", getPanelTitle());
      transcriptButton.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`;
      transcriptButton.addEventListener("click", togglePanel);

      let vkMountedInControls = false;
      if (controlsContainer) {
        if (deps.isVKVideo) {
          vkMountedInControls = repairVKButtonMount(root);
        } else {
          controlsContainer.insertBefore(
            transcriptButton,
            controlsContainer.firstChild,
          );
        }
        if (!deps.isVKVideo || vkMountedInControls) {
          transcriptButton.classList.add("in-controls");
        }
      } else if (!deps.isVKVideo) {
        transcriptButton.classList.add("floating");
        playerContainer.appendChild(transcriptButton);

        const onMouseEnter = () => {
          if (!isPanelOpen) transcriptButton?.classList.add("visible");
        };
        const onMouseLeave = () => {
          if (!isPanelOpen) transcriptButton?.classList.remove("visible");
        };

        playerContainer.addEventListener("mouseenter", onMouseEnter);
        playerContainer.addEventListener("mouseleave", onMouseLeave);
        hoverCleanup = () => {
          playerContainer?.removeEventListener("mouseenter", onMouseEnter);
          playerContainer?.removeEventListener("mouseleave", onMouseLeave);
        };
      }

      if (deps.isVKVideo && !vkMountedInControls) {
        scheduleVKButtonMountRepair();
      }
      updateButtonState();
      createTranscriptPanel();
      void maybeHighlightTranscriptButtonOnFirstVideo();
    }

    return {
      clearPreviewNudge,
      closePanel,
      getButton() {
        return transcriptButton;
      },
      getPanel() {
        return transcriptPanel;
      },
      getPanelView() {
        return panelView;
      },
      handleSummaryStateUpdate,
      handleTranslationStateUpdate(nextState = {}, previousState = {}) {
        if (shouldRevealTranslationStatus(nextState, previousState)) {
          scrollTranscriptContentToTop("smooth");
        }
        renderPanelState();
      },
      injectUI,
      isOpen() {
        return isPanelOpen;
      },
      maybeShowPreviewNudge,
      maybeShowSummaryReadyNudge,
      removeUI,
      renderPanelState,
      renderTranscriptContent,
      setPanelView,
      togglePanel,
      updateButtonState,
    };
  };
})(globalThis);
