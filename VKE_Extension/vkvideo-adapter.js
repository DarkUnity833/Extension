(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});
  const VK_PLAYER_CONTAINER_SELECTORS = [
    ".shadow-root-container",
    '[data-testid="video-player"]',
    '[data-testid="video_player"]',
    '[class*="video-player"]',
    '[class*="player-container"]',
    '[class*="video_player"]',
  ];

  function findVKPlayerContainer(targetDocument = document) {
    if (!targetDocument || typeof targetDocument.querySelector !== "function") {
      return null;
    }

    for (const selector of VK_PLAYER_CONTAINER_SELECTORS) {
      const candidate = targetDocument.querySelector(selector);
      if (candidate) return candidate;
    }

    return null;
  }

  function rootHasVideo(root) {
    return Boolean(
      root &&
        typeof root.querySelector === "function" &&
        root.querySelector("video"),
    );
  }

  modules.vkvideoAdapter = {
    id: "vkvideo",
    observeShadowHost: true,
    match(targetLocation = location) {
      return String(targetLocation?.hostname || "")
        .toLowerCase()
        .includes("vkvideo.ru");
    },
    getVideoId(targetLocation = location) {
      const match = String(targetLocation?.pathname || "").match(
        /\/video(-?\d+_\d+)/,
      );
      return match ? match[1] : null;
    },
    getShadowHost(targetDocument = document) {
      const container = findVKPlayerContainer(targetDocument);
      return container?.shadowRoot ? container : null;
    },
    getPlayerRoot(targetDocument = document) {
      const container = findVKPlayerContainer(targetDocument);

      if (rootHasVideo(container?.shadowRoot)) {
        return container.shadowRoot;
      }

      if (rootHasVideo(container)) {
        return container;
      }

      const directVideo =
        typeof targetDocument?.querySelector === "function"
          ? targetDocument.querySelector("video")
          : null;
      const nearestVideoContainer =
        directVideo && typeof directVideo.closest === "function"
          ? directVideo.closest(VK_PLAYER_CONTAINER_SELECTORS.join(", "))
          : null;

      if (nearestVideoContainer) {
        return nearestVideoContainer;
      }

      return container?.shadowRoot || container || targetDocument;
    },
    getNavigationEvents() {
      return [];
    },
    getDownloadPrefix() {
      return "vkvideo";
    },
  };
})(globalThis);
