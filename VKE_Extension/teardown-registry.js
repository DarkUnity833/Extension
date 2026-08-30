(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  modules.createTeardownRegistry = function createTeardownRegistry() {
    const disposers = [];

    function add(disposer) {
      if (typeof disposer !== "function") return () => {};
      disposers.push(disposer);
      return disposer;
    }

    function flush() {
      while (disposers.length > 0) {
        const disposer = disposers.pop();
        try {
          disposer();
        } catch (error) {
          console.error("Runtime teardown failed:", error);
        }
      }
    }

    return {
      add,
      flush,
      get size() {
        return disposers.length;
      },
    };
  };
})(globalThis);
