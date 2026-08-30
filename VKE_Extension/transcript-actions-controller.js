(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  modules.createTranscriptActionsController =
    function createTranscriptActionsController(deps = {}) {
      function downloadFile(content, filename, type) {
        const blob = new Blob([content], { type: `${type};charset=utf-8` });
        const urlApi = deps.urlApi || global.URL;
        const url = urlApi.createObjectURL(blob);
        const anchor = deps.document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        deps.document.body.appendChild(anchor);
        anchor.click();
        deps.document.body.removeChild(anchor);
        urlApi.revokeObjectURL(url);
      }

      function trackEvent(eventType, eventData) {
        deps.trackEvent?.(eventType, eventData);
      }

      function showToast(type, title, subtitle) {
        deps.showToast?.(type, title, subtitle);
      }

      function hasSubtitles(subtitles) {
        return Array.isArray(subtitles) && subtitles.length > 0;
      }

      function ensureSubtitles(subtitles) {
        if (hasSubtitles(subtitles)) return true;
        showToast(
          "warning",
          deps.t("contentNoText"),
          deps.t("contentSubsNotLoaded"),
        );
        return false;
      }

      function copyText({
        text = "",
        successTitle,
        successSubtitle,
        errorTitle,
        errorSubtitle,
        eventType,
        eventData,
      } = {}) {
        const safeText = String(text || "").trim();
        if (!safeText) {
          showToast(
            "warning",
            deps.t("contentNoText"),
            deps.t("contentSubsNotLoaded"),
          );
          return Promise.resolve(false);
        }

        return deps.navigator.clipboard
          .writeText(safeText)
          .then(() => {
            showToast(
              "success",
              successTitle || deps.t("contentCopied"),
              successSubtitle || deps.t("contentFileSaved"),
            );
            if (eventType) {
              trackEvent(eventType, eventData);
            }
            return true;
          })
          .catch(() => {
            showToast(
              "error",
              errorTitle || deps.t("contentError"),
              errorSubtitle || deps.t("contentCopyError"),
            );
            return false;
          });
      }

      function downloadText({
        content = "",
        filename = "transcript.txt",
        successTitle,
        successSubtitle,
        eventType,
        eventData,
      } = {}) {
        const safeContent = String(content || "");
        if (!safeContent.trim()) {
          showToast(
            "warning",
            deps.t("contentNoText"),
            deps.t("contentSubsNotLoaded"),
          );
          return false;
        }

        downloadFile(safeContent, filename, "text/plain");
        showToast(
          "success",
          successTitle || deps.t("contentDownloaded"),
          successSubtitle || deps.t("contentTxtSaved"),
        );
        if (eventType) {
          trackEvent(eventType, eventData);
        }
        return true;
      }

      function copyTranscript({
        subtitles = [],
        currentVideoId,
        currentPlatform,
      } = {}) {
        if (!ensureSubtitles(subtitles)) return Promise.resolve(false);

        const text = deps.transcriptExport.buildPlainText(subtitles);
        return copyText({
          text,
          successTitle: deps.t("contentCopied"),
          successSubtitle: deps.t("contentLinesCount", [String(subtitles.length)]),
          errorTitle: deps.t("contentError"),
          errorSubtitle: deps.t("contentCopyError"),
          eventType: "transcript_copy",
          eventData: {
            video_id: currentVideoId,
            platform: currentPlatform,
            lines: subtitles.length,
          },
        });
      }

      function downloadTXT({
        subtitles = [],
        videoId = "video",
        title = "Video",
        videoUrl = "",
        videoLabel,
        platformPrefix,
        currentVideoId,
        currentPlatform,
      } = {}) {
        if (!ensureSubtitles(subtitles)) return false;

        const content = deps.transcriptExport.buildTxt({
          title,
          videoUrl,
          videoLabel,
          subtitles,
        });
        return downloadText({
          content,
          filename: `${platformPrefix}_transcript_${videoId}.txt`,
          successTitle: deps.t("contentDownloaded"),
          successSubtitle: deps.t("contentTxtSaved"),
          eventType: "transcript_txt_download",
          eventData: {
            video_id: currentVideoId,
            platform: currentPlatform,
          },
        });
      }

      async function downloadSRT({
        subtitles = [],
        videoId = "video",
        platformPrefix,
        currentVideoId,
        currentPlatform,
      } = {}) {
        if (!ensureSubtitles(subtitles)) return false;

        trackEvent("transcript_srt_download_clicked", {
          video_id: currentVideoId,
          platform: currentPlatform,
        });

        await deps.entitlementService?.refresh?.();
        if (!deps.entitlementService?.canAccessSRT?.()) {
          deps.showSubscriptionPaywall?.("srt", {
            entryPoint: "transcript_srt_download",
            copyVariant: "srt_download",
          });
          return false;
        }

        const content = deps.transcriptExport.buildSrt({ subtitles });
        downloadFile(
          content,
          `${platformPrefix}_transcript_${videoId}.srt`,
          "text/plain",
        );
        showToast(
          "success",
          deps.t("contentDownloaded"),
          deps.t("contentSrtSaved"),
        );
        trackEvent("transcript_srt_download", {
          video_id: currentVideoId,
          platform: currentPlatform,
        });
        return true;
      }

      return {
        downloadFile,
        copyText,
        downloadText,
        copyTranscript,
        downloadTXT,
        downloadSRT,
      };
    };
})(globalThis);
