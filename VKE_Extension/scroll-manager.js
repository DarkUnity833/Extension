(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  modules.createScrollManager = function createScrollManager(deps = {}) {
    const now = deps.now || (() => Date.now());

    let autoFollowEnabled = true;
    let programmaticScrollUntil = 0;

    function isProgrammaticScrollActive() {
      return now() < programmaticScrollUntil;
    }

    return {
      reset() {
        autoFollowEnabled = true;
        programmaticScrollUntil = 0;
      },
      pauseAutoFollow() {
        autoFollowEnabled = false;
      },
      resumeAutoFollow() {
        autoFollowEnabled = true;
      },
      isAutoFollowEnabled() {
        return autoFollowEnabled;
      },
      isProgrammaticScrollActive,
      markProgrammaticScroll(durationMs = 900) {
        programmaticScrollUntil = now() + durationMs;
        return programmaticScrollUntil;
      },
      handleUserScroll({ isPanelOpen = false } = {}) {
        if (!isPanelOpen || isProgrammaticScrollActive()) return false;
        autoFollowEnabled = false;
        return true;
      },
      scrollItemIntoView(item, behavior = "smooth") {
        if (!item) return false;
        const durationMs = behavior === "smooth" ? 900 : 250;
        programmaticScrollUntil = now() + durationMs;
        item.scrollIntoView({ behavior, block: "center" });
        return true;
      },
    };
  };
})(globalThis);
