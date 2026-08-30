(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  modules.rutubeAdapter = {
    id: "rutube",
    observeShadowHost: false,
    match(targetLocation = location) {
      return String(targetLocation?.hostname || "")
        .toLowerCase()
        .includes("rutube.ru");
    },
    getVideoId(targetLocation = location) {
      const match = String(targetLocation?.pathname || "").match(
        /\/video\/([a-zA-Z0-9]+)/,
      );
      return match ? match[1] : null;
    },
    getPlayerRoot(targetDocument = document) {
      return targetDocument;
    },
    getNavigationEvents() {
      return [];
    },
    getDownloadPrefix() {
      return "rutube";
    },
  };
})(globalThis);
