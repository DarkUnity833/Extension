(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  modules.createTranscriptState = function createTranscriptState(
    initialState = {},
  ) {
    let subtitles = Array.isArray(initialState.subtitles)
      ? initialState.subtitles.slice()
      : [];
    let subtitleLanguage =
      typeof initialState.subtitleLanguage === "string"
        ? initialState.subtitleLanguage.trim()
        : "";
    let sourceMeta =
      initialState.sourceMeta &&
      typeof initialState.sourceMeta === "object" &&
      !Array.isArray(initialState.sourceMeta)
        ? { ...initialState.sourceMeta }
        : {};
    let sourceMode =
      typeof initialState.sourceMode === "string"
        ? initialState.sourceMode
        : "none";

    return {
      clear() {
        subtitles = [];
        subtitleLanguage = "";
        sourceMode = "none";
        sourceMeta = {};
      },
      getSubtitles() {
        return subtitles;
      },
      setSubtitles(
        nextSubtitles = [],
        nextSourceMode = sourceMode,
        nextSubtitleLanguage = subtitleLanguage,
        nextSourceMeta = sourceMeta,
      ) {
        subtitles = Array.isArray(nextSubtitles) ? nextSubtitles.slice() : [];
        subtitleLanguage =
          typeof nextSubtitleLanguage === "string"
            ? nextSubtitleLanguage.trim()
            : subtitleLanguage;
        sourceMode =
          typeof nextSourceMode === "string" ? nextSourceMode : sourceMode;
        sourceMeta =
          nextSourceMeta &&
          typeof nextSourceMeta === "object" &&
          !Array.isArray(nextSourceMeta)
            ? { ...nextSourceMeta }
            : {};
        return subtitles;
      },
      getSubtitleLanguage() {
        return subtitleLanguage;
      },
      setSubtitleLanguage(nextSubtitleLanguage = "") {
        subtitleLanguage =
          typeof nextSubtitleLanguage === "string"
            ? nextSubtitleLanguage.trim()
            : "";
        return subtitleLanguage;
      },
      getSourceMode() {
        return sourceMode;
      },
      setSourceMode(nextSourceMode = "none") {
        sourceMode =
          typeof nextSourceMode === "string" ? nextSourceMode : "none";
        return sourceMode;
      },
      getSourceMeta() {
        return { ...sourceMeta };
      },
      setSourceMeta(nextSourceMeta = {}) {
        sourceMeta =
          nextSourceMeta &&
          typeof nextSourceMeta === "object" &&
          !Array.isArray(nextSourceMeta)
            ? { ...nextSourceMeta }
            : {};
        return { ...sourceMeta };
      },
      hasSubtitles() {
        return subtitles.length > 0;
      },
      count() {
        return subtitles.length;
      },
    };
  };
})(globalThis);
