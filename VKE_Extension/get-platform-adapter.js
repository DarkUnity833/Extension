(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  modules.getPlatformAdapters = function getPlatformAdapters() {
    return [
      modules.youtubeAdapter,
      modules.vkvideoAdapter,
      modules.rutubeAdapter,
    ].filter(Boolean);
  };

  modules.getPlatformAdapter = function getPlatformAdapter(
    targetLocation = location,
  ) {
    return (
      modules
        .getPlatformAdapters()
        .find((adapter) => adapter.match?.(targetLocation)) || null
    );
  };
})(globalThis);
