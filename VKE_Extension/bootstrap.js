(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  modules.createContentBootstrap = function createContentBootstrap() {
    let sessionManager = null;

    function getSessionManager() {
      if (!sessionManager) {
        sessionManager = modules.createSessionManager();
      }
      return sessionManager;
    }

    return {
      async start() {
        return await getSessionManager().start("bootstrap");
      },
      stop(reason = "manual") {
        return getSessionManager().stop(reason);
      },
      restart(reason = "restart") {
        return getSessionManager().restart(reason);
      },
      destroy(reason = "destroy") {
        return getSessionManager().destroy(reason);
      },
      getSessionManager,
    };
  };
})(globalThis);
