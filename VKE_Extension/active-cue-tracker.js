(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  modules.createActiveCueTracker = function createActiveCueTracker() {
    let activeIndex = -1;

    function resolveActiveIndex(subtitles, currentTime) {
      if (!Array.isArray(subtitles) || subtitles.length === 0) return -1;
      if (typeof currentTime !== "number" || Number.isNaN(currentTime)) {
        return -1;
      }

      for (let index = 0; index < subtitles.length; index += 1) {
        const cue = subtitles[index];
        if (!cue) continue;
        if (currentTime >= cue.start && currentTime < cue.end) return index;
      }

      return -1;
    }

    return {
      reset() {
        activeIndex = -1;
      },
      getActiveIndex() {
        return activeIndex;
      },
      sync({ subtitles = [], currentTime } = {}) {
        const previousIndex = activeIndex;
        const nextIndex = resolveActiveIndex(subtitles, currentTime);
        activeIndex = nextIndex;

        return {
          previousIndex,
          nextIndex,
          changed: previousIndex !== nextIndex,
        };
      },
    };
  };
})(globalThis);
