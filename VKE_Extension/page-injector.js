(function () {
  "use strict";

  const hostname = location.hostname.toLowerCase();
  const isYouTube =
    hostname === "youtube.com" ||
    hostname === "www.youtube.com" ||
    hostname === "m.youtube.com";

  if (!isYouTube || window.__rutubeTranscriptPageInjector) return;
  window.__rutubeTranscriptPageInjector = true;

  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("youtube-page-bridge.js");
  script.async = false;
  (document.head || document.documentElement).appendChild(script);
  script.onload = () => script.remove();
})();
