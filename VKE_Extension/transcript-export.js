(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  modules.createTranscriptExport = function createTranscriptExport(deps = {}) {
    const formatTime = deps.formatTime || ((value) => String(value));
    const formatSRTTime = deps.formatSRTTime || ((value) => String(value));

    function buildPlainText(subtitles = []) {
      return Array.isArray(subtitles)
        ? subtitles.map((cue) => `${formatTime(cue.start)} ${cue.text}`).join("\n")
        : "";
    }

    return {
      buildPlainText,
      buildTxt({
        title = "Video",
        videoUrl = "",
        videoLabel = "Video",
        subtitles = [],
      } = {}) {
        const safeTitle = title || "Video";
        const headerDivider = "=".repeat(Math.min(safeTitle.length, 50));
        const body = buildPlainText(subtitles);

        return `${safeTitle}\n${headerDivider}\n\n${videoLabel}: ${videoUrl}\n\n${body}`;
      },
      buildSrt({ subtitles = [] } = {}) {
        if (!Array.isArray(subtitles) || subtitles.length === 0) return "";

        return subtitles
          .map(
            (cue, index) =>
              `${index + 1}\n${formatSRTTime(cue.start)} --> ${formatSRTTime(cue.end)}\n${cue.text}`,
          )
          .join("\n\n")
          .concat("\n\n");
      },
    };
  };
})(globalThis);
