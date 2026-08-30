(function (global) {
  "use strict";

  if (global.__rutubeTranscriptEntryStarted) return;
  global.__rutubeTranscriptEntryStarted = true;

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  try {
    const bootstrap = modules.createContentBootstrap?.();
    if (!bootstrap) {
      throw new Error("content bootstrap is not available");
    }

    global.__rutubeTranscriptBootstrap = bootstrap;
    Promise.resolve(bootstrap.start()).catch((error) => {
      console.error("Content bootstrap failed:", error);
    });
  } catch (error) {
    console.error("Content entry failed:", error);
  }
})(globalThis);
