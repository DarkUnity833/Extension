(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  modules.createSessionLifecycleController =
    function createSessionLifecycleController(deps = {}) {
      let startPromise = null;

      function resetSessionState() {
        deps.navigationController?.clearPendingNavigation?.();
        deps.setCurrentVideo?.(null);
        deps.setCurrentVideoId?.(null);
        deps.resetTranscriptData?.();
        deps.transcriptFetchController?.reset?.();
        deps.resetTranscriptViewState?.();
      }

      function resetActiveVideoSession() {
        deps.panelController?.removeUI?.();
        resetSessionState();
      }

      function stopSession() {
        if (!deps.getSessionActive?.()) {
          resetActiveVideoSession();
          return false;
        }

        deps.setSessionActive?.(false);
        deps.runtimeTeardown?.flush?.();
        resetActiveVideoSession();
        return true;
      }

      function activateVideoSession(video, videoId = deps.getVideoId?.()) {
        deps.setCurrentVideo?.(video);
        deps.setCurrentVideoId?.(videoId);
        deps.resetTranscriptData?.();
        deps.transcriptFetchController?.reset?.();
        deps.resetTranscriptViewState?.();
        deps.panelController?.injectUI?.(video);
        deps.youtubeRuntimeController?.startLiveCaptionCapture?.();
        deps.transcriptFetchController?.tryFetchSubtitles?.();
        return true;
      }

      async function start(options = {}) {
        const { skipStorageRead = false } = options;

        if (!skipStorageRead) {
          if (startPromise) return await startPromise;

          startPromise = (async () => {
            const data = await deps.storage?.get?.([
              deps.storageKeys?.EXTENSION_ENABLED,
            ]);
            deps.setExtensionEnabled?.(
              data?.[deps.storageKeys?.EXTENSION_ENABLED] !== false,
            );
            return await start({ skipStorageRead: true });
          })();

          try {
            return await startPromise;
          } finally {
            startPromise = null;
          }
        }

        if (!deps.getExtensionEnabled?.()) {
          stopSession();
          return false;
        }
        if (deps.getSessionActive?.()) return true;

        deps.setSessionActive?.(true);
        deps.youtubeRuntimeController?.setupBridge?.();
        await deps.entitlementService?.refresh?.();
        deps.navigationController?.observeVideoPlayer?.();
        deps.navigationController?.setupSPANavigation?.();
        return true;
      }

      async function handleEnabledChange(enabled) {
        deps.setExtensionEnabled?.(enabled);
        if (!enabled) return stopSession();
        return await start({ skipStorageRead: true });
      }

      return {
        activateVideoSession,
        handleEnabledChange,
        isSessionActive() {
          return Boolean(deps.getSessionActive?.());
        },
        resetActiveVideoSession,
        resetSessionState,
        start,
        stopSession,
      };
    };
})(globalThis);
