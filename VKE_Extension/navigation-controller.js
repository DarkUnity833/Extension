(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  modules.createNavigationController =
    function createNavigationController(deps = {}) {
      let pendingNavigationRefreshId = null;

      function clearPendingNavigation() {
        if (!pendingNavigationRefreshId) return;
        global.clearTimeout(pendingNavigationRefreshId);
        pendingNavigationRefreshId = null;
      }

      function observeVideoPlayer() {
        function checkForVideo() {
          if (!deps.isSessionActive?.()) return;

          const root = deps.getPlayerRoot?.();
          const video = root?.querySelector("video");
          const newVideoId = deps.getVideoId?.();
          const currentVideo = deps.getCurrentVideo?.();
          const currentVideoId = deps.getCurrentVideoId?.();

          if (
            video &&
            newVideoId &&
            (video !== currentVideo || newVideoId !== currentVideoId)
          ) {
            deps.onVideoDetected?.({
              video,
              videoId: newVideoId,
            });
          }
        }

        const observer = new global.MutationObserver(() => checkForVideo());
        observer.observe(deps.document.body, {
          childList: true,
          subtree: true,
        });
        deps.runtimeTeardown?.add?.(() => observer.disconnect());

        if (
          deps.platformAdapter?.observeShadowHost &&
          deps.platformAdapter?.getShadowHost
        ) {
          let shadowObserver = null;
          const waitForShadow = global.setInterval(() => {
            const host = deps.platformAdapter.getShadowHost(deps.document);
            if (host?.shadowRoot) {
              global.clearInterval(waitForShadow);
              if (shadowObserver) return;

              shadowObserver = new global.MutationObserver(() => checkForVideo());
              shadowObserver.observe(host.shadowRoot, {
                childList: true,
                subtree: true,
              });
              checkForVideo();
            }
          }, 500);

          deps.runtimeTeardown?.add?.(() => global.clearInterval(waitForShadow));
          deps.runtimeTeardown?.add?.(() => shadowObserver?.disconnect());
        }

        checkForVideo();
      }

      function setupSPANavigation() {
        let lastUrl = deps.location.href;

        const checkUrl = () => {
          if (!deps.isSessionActive?.()) return;
          if (deps.location.href === lastUrl) return;

          lastUrl = deps.location.href;
          deps.onUrlChanged?.();
          clearPendingNavigation();

          pendingNavigationRefreshId = global.setTimeout(() => {
            pendingNavigationRefreshId = null;
            if (!deps.isSessionActive?.()) return;

            const root = deps.getPlayerRoot?.();
            const video = root?.querySelector("video");
            const videoId = deps.getVideoId?.();
            if (!video || !videoId) return;

            deps.onNavigationSettled?.({
              video,
              videoId,
            });
          }, 500);
        };

        const navigationEvents = deps.platformAdapter?.getNavigationEvents?.() || [];

        global.window.addEventListener("popstate", checkUrl);
        deps.runtimeTeardown?.add?.(() =>
          global.window.removeEventListener("popstate", checkUrl),
        );

        navigationEvents.forEach((eventName) => {
          global.window.addEventListener(eventName, checkUrl);
          deps.runtimeTeardown?.add?.(() =>
            global.window.removeEventListener(eventName, checkUrl),
          );
        });

        const originalPushState = global.history.pushState;
        const patchedPushState = function () {
          originalPushState.apply(this, arguments);
          checkUrl();
        };
        global.history.pushState = patchedPushState;
        deps.runtimeTeardown?.add?.(() => {
          if (global.history.pushState === patchedPushState) {
            global.history.pushState = originalPushState;
          }
        });

        const originalReplaceState = global.history.replaceState;
        const patchedReplaceState = function () {
          originalReplaceState.apply(this, arguments);
          checkUrl();
        };
        global.history.replaceState = patchedReplaceState;
        deps.runtimeTeardown?.add?.(() => {
          if (global.history.replaceState === patchedReplaceState) {
            global.history.replaceState = originalReplaceState;
          }
        });

        const intervalId = global.setInterval(checkUrl, 1000);
        deps.runtimeTeardown?.add?.(() => global.clearInterval(intervalId));
        deps.runtimeTeardown?.add?.(() => clearPendingNavigation());
      }

      return {
        clearPendingNavigation,
        observeVideoPlayer,
        setupSPANavigation,
      };
    };
})(globalThis);
