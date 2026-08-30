(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  modules.createSessionManager = function createSessionManager(deps = {}) {
    const detectPlatform = deps.detectPlatform || modules.detectPlatform;
    const createContentRuntime =
      deps.createContentRuntime ||
      modules.createContentRuntime ||
      deps.createLegacyContentRuntime ||
      modules.createLegacyContentRuntime;

    if (typeof detectPlatform !== "function") {
      throw new Error("detectPlatform module is not available");
    }
    if (typeof createContentRuntime !== "function") {
      throw new Error("content runtime module is not available");
    }

    let runtime = null;
    let runtimePlatformId = null;
    let currentSessionId = 0;
    let isRunning = false;

    function getPlatform() {
      return detectPlatform(global.location);
    }

    function ensureRuntime(platform) {
      if (runtime && runtimePlatformId === platform.id) return runtime;

      if (runtime?.destroy) runtime.destroy({ reason: "platform_changed" });

      runtimePlatformId = platform.id;
      runtime = createContentRuntime({
        platform,
      });

      return runtime;
    }

    async function start(reason = "bootstrap") {
      const platform = getPlatform();
      if (!platform?.supported) return false;

      const activeRuntime = ensureRuntime(platform);
      currentSessionId += 1;
      isRunning = true;

      return await activeRuntime.start({
        sessionId: currentSessionId,
        reason,
        platform,
      });
    }

    function stop(reason = "manual") {
      if (!runtime) return false;
      isRunning = false;
      return runtime.stop({ reason });
    }

    async function restart(reason = "restart") {
      stop(reason);
      return await start(reason);
    }

    function destroy(reason = "destroy") {
      if (!runtime) return false;
      isRunning = false;
      const activeRuntime = runtime;
      runtime = null;
      runtimePlatformId = null;
      return activeRuntime.destroy({ reason });
    }

    return {
      start,
      stop,
      restart,
      destroy,
      getState() {
        return {
          isRunning,
          currentSessionId,
          platform: runtimePlatformId,
        };
      },
    };
  };
})(globalThis);
