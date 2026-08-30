(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  modules.youtubeAdapter = {
    id: "youtube",
    observeShadowHost: false,
    match(targetLocation = location) {
      const hostname = String(targetLocation?.hostname || "").toLowerCase();
      return (
        hostname === "youtube.com" ||
        hostname === "www.youtube.com" ||
        hostname === "m.youtube.com"
      );
    },
    getVideoId(targetLocation = location) {
      const search = String(targetLocation?.search || "");
      const pathname = String(targetLocation?.pathname || "");
      const params = new URLSearchParams(search);
      const watchId = params.get("v");
      if (watchId) return watchId;
      const shortsMatch = pathname.match(/\/shorts\/([^/?]+)/);
      return shortsMatch ? shortsMatch[1] : null;
    },
    getPlayerRoot(targetDocument = document) {
      return targetDocument;
    },
    getNavigationEvents() {
      return ["yt-navigate-start", "yt-navigate-finish", "yt-page-data-updated"];
    },
    getDownloadPrefix() {
      return "youtube";
    },
  };
})(globalThis);
