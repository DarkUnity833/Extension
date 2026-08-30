(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  modules.createRuntimeListenersController =
    function createRuntimeListenersController(deps = {}) {
      let attached = false;

      function handleRuntimeMessage(message, sender, sendResponse) {
        const hasSubtitles = Boolean(deps.getHasSubtitles?.());

        function respondWithPanelAvailability(openPanel = false) {
          const canOpen = Boolean(deps.canOpenPanel?.());
          if (canOpen) {
            if (openPanel) deps.onOpenPanelRequested?.();
            sendResponse({
              success: true,
              hasSubtitles,
              canOpen: true,
            });
            return true;
          }

          // VK Video can run content scripts in several same-tab frames. When
          // the popup sends a tab message, a non-player frame may answer before
          // the frame that owns the player. Delay negative answers so a real
          // player frame can win the response race.
          global.setTimeout(() => {
            sendResponse({
              success: true,
              hasSubtitles,
              canOpen: false,
            });
          }, 120);
          return true;
        }

        if (message.action === "setEnabled") {
          deps.onSetEnabled?.(message.enabled);
          sendResponse({ success: true });
          return true;
        }

        if (message.action === "refreshState") {
          deps.onRefreshState?.();
          sendResponse({ success: true });
          return true;
        }

        if (message.action === "openPanel") {
          return respondWithPanelAvailability(true);
        }

        if (message.action === "getPanelAvailability") {
          return respondWithPanelAvailability(false);
        }

        if (message.action === "getSubtitlesStatus") {
          sendResponse(deps.getSubtitlesStatus?.() || { hasSubtitles, count: 0 });
          return true;
        }

        if (
          message.action === "licenseActivated" ||
          message.action === "proActivated"
        ) {
          deps.onEntitlementUnlocked?.();
          sendResponse({ success: true });
          return true;
        }

        return true;
      }

      function handleStorageChanged(changes, namespace) {
        if (namespace !== "local") return;
        const storageKeys = deps.storageKeys || {};

        if (
          changes[storageKeys.IS_PRO] ||
          changes[storageKeys.SRT_UNLOCKED] ||
          changes[storageKeys.IS_UNLOCKED]
        ) {
          deps.onEntitlementsChanged?.();
        }
      }

      function attachPersistentListeners() {
        if (attached) return;
        attached = true;

        deps.runtime?.onMessage?.addListener?.(handleRuntimeMessage);
        deps.registerPersistentDisposer?.(() => {
          deps.runtime?.onMessage?.removeListener?.(handleRuntimeMessage);
          attached = false;
        });

        deps.storage?.onChanged?.addListener?.(handleStorageChanged);
        deps.registerPersistentDisposer?.(() => {
          deps.storage?.onChanged?.removeListener?.(handleStorageChanged);
        });
      }

      return {
        attachPersistentListeners,
        handleRuntimeMessage,
        handleStorageChanged,
      };
    };
})(globalThis);
