(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  modules.createTimeupdateController =
    function createTimeupdateController() {
      let boundVideo = null;
      let boundHandler = null;

      function clear() {
        if (boundVideo && boundHandler) {
          boundVideo.removeEventListener("timeupdate", boundHandler);
        }
        boundVideo = null;
        boundHandler = null;
      }

      return {
        bind(video, handler) {
          if (!video || typeof handler !== "function") {
            clear();
            return false;
          }

          if (boundVideo === video && boundHandler === handler) return false;

          clear();
          video.addEventListener("timeupdate", handler);
          boundVideo = video;
          boundHandler = handler;
          return true;
        },
        clear,
        getBoundVideo() {
          return boundVideo;
        },
      };
    };
})(globalThis);
