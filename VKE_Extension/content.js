// Transcript content runtime compatibility shim.

(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  if (
    typeof modules.createLegacyContentRuntime !== "function" &&
    typeof modules.createContentRuntime === "function"
  ) {
    modules.createLegacyContentRuntime = function createLegacyContentRuntime(
      runtimeContext = {},
    ) {
      return modules.createContentRuntime(runtimeContext);
    };
  }
})(globalThis);
