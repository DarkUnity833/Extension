(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  modules.detectPlatform = function detectPlatform(targetLocation = location) {
    const hostname = String(targetLocation?.hostname || "").toLowerCase();
    const adapter = modules.getPlatformAdapter?.(targetLocation) || null;

    if (adapter) {
      return {
        id: adapter.id,
        supported: true,
        hostname,
        adapter,
      };
    }

    return {
      id: "unknown",
      supported: false,
      hostname,
    };
  };
})(globalThis);
