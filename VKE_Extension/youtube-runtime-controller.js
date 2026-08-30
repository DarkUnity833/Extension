(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  modules.createYouTubeRuntimeController =
    function createYouTubeRuntimeController(deps = {}) {
      const controllerDeps = deps.controllerDeps || deps;
      const controller =
        deps.isYouTube && modules.createYouTubeController
          ? modules.createYouTubeController(controllerDeps)
          : null;

      function canUse(methodName) {
        return Boolean(
          deps.isYouTube &&
            controller &&
            typeof controller[methodName] === "function",
        );
      }

      return {
        clearSubtitleWatchers() {
          if (!canUse("clearSubtitleWatchers")) return;
          controller.clearSubtitleWatchers();
        },
        concealNativeTranscriptPanel() {
          if (!canUse("concealNativeTranscriptPanel")) return false;
          return controller.concealNativeTranscriptPanel();
        },
        closeNativeTranscriptPanel() {
          if (!canUse("closeNativeTranscriptPanel")) return false;
          return controller.closeNativeTranscriptPanel();
        },
        async fetchSubtitles(options = {}) {
          if (!canUse("fetchSubtitles")) return false;
          return await controller.fetchSubtitles(options);
        },
        isFetchCoolingDown() {
          if (!canUse("isFetchCoolingDown")) return false;
          return controller.isFetchCoolingDown();
        },
        primeCaptionsFromUserGesture(expectedVideoId) {
          if (!canUse("primeCaptionsFromUserGesture")) return false;
          return controller.primeCaptionsFromUserGesture(expectedVideoId);
        },
        shouldShowLoadingState() {
          if (!canUse("shouldShowLoadingState")) return false;
          return controller.shouldShowLoadingState();
        },
        notifySubtitlesUpdated(value = controllerDeps.hasSubtitles?.()) {
          if (!canUse("notifySubtitlesUpdated")) return;
          controller.notifySubtitlesUpdated(value);
        },
        registerAutoFetchAttempt() {
          if (!canUse("registerAutoFetchAttempt")) return;
          controller.registerAutoFetchAttempt();
        },
        resetPageSessionState() {
          if (!canUse("resetPageSessionState")) return;
          controller.resetPageSessionState();
        },
        setupBridge() {
          if (!canUse("setupBridge")) return;
          controller.setupBridge();
        },
        setupSubtitleWatchers() {
          if (!canUse("setupSubtitleWatchers")) return;
          controller.setupSubtitleWatchers();
        },
        startLiveCaptionCapture() {
          if (!canUse("startLiveCaptionCapture")) return;
          controller.startLiveCaptionCapture();
        },
      };
    };
})(globalThis);
