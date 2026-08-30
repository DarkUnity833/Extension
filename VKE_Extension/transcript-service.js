(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  modules.createTranscriptService = function createTranscriptService(deps = {}) {
    const state = deps.state;
    if (!state) {
      throw new Error("Transcript service requires a transcript state");
    }

    function hasCompleteSubtitles() {
      const sourceMode = state.getSourceMode();
      const sourceMeta = state.getSourceMeta?.() || {};
      return (
        state.hasSubtitles() &&
        sourceMode !== "live_capture" &&
        sourceMode !== "vk_text_tracks_partial" &&
        sourceMeta.isLikelyPartial !== true
      );
    }

    function normalizeSubtitles(parsed) {
      if (!Array.isArray(parsed)) return [];

      return parsed
        .map((cue) => ({
          start: cue?.start,
          end: cue?.end,
          text: cue?.text,
        }))
        .filter(
          (cue) =>
            typeof cue.start === "number" &&
            typeof cue.end === "number" &&
            typeof cue.text === "string" &&
            cue.text.length > 0,
        );
    }

    function storeLoadedSubtitles(
      parsed,
      {
        expectedVideoId,
        sourceMode = "full",
        subtitleLanguage = state.getSubtitleLanguage?.() || "",
        sourceMeta = {},
      } = {},
    ) {
      if (!Array.isArray(parsed) || parsed.length === 0) return false;
      if (
        typeof deps.isExpectedVideoActive === "function" &&
        !deps.isExpectedVideoActive(expectedVideoId)
      ) {
        return false;
      }

      state.setSubtitles(
        normalizeSubtitles(parsed),
        sourceMode,
        subtitleLanguage,
        sourceMeta,
      );
      return state.hasSubtitles();
    }

    function parseSubtitleText(
      text,
      url = "",
      source = "rutube_api",
      expectedVideoId,
      options = {},
    ) {
      if (!text || hasCompleteSubtitles()) return false;
      if (
        typeof deps.isExpectedVideoActive === "function" &&
        !deps.isExpectedVideoActive(expectedVideoId)
      ) {
        return false;
      }

      const targetUrl = String(url || "");
      const trimmed = String(text).trim();
      let parsed = [];

      if (
        trimmed.includes("WEBVTT") ||
        targetUrl.includes(".vtt") ||
        targetUrl.includes("fmt=vtt")
      ) {
        parsed = deps.parseVTT ? deps.parseVTT(text) : [];
      } else if (/^\d+\s*\n/.test(trimmed) || targetUrl.includes(".srt")) {
        parsed = deps.parseSRT ? deps.parseSRT(text) : [];
      } else if (
        trimmed.startsWith("<transcript") ||
        trimmed.startsWith("<?xml") ||
        trimmed.startsWith("<text")
      ) {
        parsed = deps.parseYouTubeTimedTextXML
          ? deps.parseYouTubeTimedTextXML(text)
          : [];
      } else if (
        trimmed.startsWith("{") &&
        (trimmed.includes('"events"') || trimmed.includes('"wireMagic"'))
      ) {
        parsed = deps.parseYouTubeJson3 ? deps.parseYouTubeJson3(text) : [];
      } else if (
        trimmed.startsWith("{") &&
        (trimmed.includes('"transcriptSegmentRenderer"') ||
          targetUrl.includes("/youtubei/v1/get_transcript"))
      ) {
        parsed = deps.parseYouTubeTranscriptResponse
          ? deps.parseYouTubeTranscriptResponse(text)
          : [];
      }

      return storeLoadedSubtitles(parsed, {
        expectedVideoId,
        sourceMode:
          typeof source === "string" && source.trim() ? source.trim() : "full",
        subtitleLanguage:
          typeof options.subtitleLanguage === "string"
            ? options.subtitleLanguage
            : "",
        sourceMeta:
          options.sourceMeta &&
          typeof options.sourceMeta === "object" &&
          !Array.isArray(options.sourceMeta)
            ? options.sourceMeta
            : {},
      });
    }

    return {
      hasCompleteSubtitles,
      reset() {
        state.clear();
      },
      storeLoadedSubtitles,
      parseSubtitles: parseSubtitleText,
    };
  };
})(globalThis);
