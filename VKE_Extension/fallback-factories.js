(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  modules.createFallbackTeardownRegistry =
    function createFallbackTeardownRegistry() {
      const disposers = [];

      return {
        add(disposer) {
          if (typeof disposer !== "function") return () => {};
          disposers.push(disposer);
          return disposer;
        },
        flush() {
          while (disposers.length > 0) {
            const disposer = disposers.pop();
            try {
              disposer();
            } catch (error) {
              console.error("Runtime teardown failed:", error);
            }
          }
        },
      };
    };

  modules.createFallbackActiveCueTracker =
    function createFallbackActiveCueTracker() {
      let activeIndex = -1;

      return {
        reset() {
          activeIndex = -1;
        },
        getActiveIndex() {
          return activeIndex;
        },
        sync({ subtitles = [], currentTime } = {}) {
          const previousIndex = activeIndex;
          let nextIndex = -1;

          if (Array.isArray(subtitles) && typeof currentTime === "number") {
            subtitles.some((cue, index) => {
              if (!cue) return false;
              if (currentTime >= cue.start && currentTime < cue.end) {
                nextIndex = index;
                return true;
              }
              return false;
            });
          }

          activeIndex = nextIndex;
          return {
            previousIndex,
            nextIndex,
            changed: previousIndex !== nextIndex,
          };
        },
      };
    };

  modules.createFallbackScrollManager = function createFallbackScrollManager() {
    let autoFollowEnabled = true;
    let programmaticScrollUntil = 0;

    return {
      reset() {
        autoFollowEnabled = true;
        programmaticScrollUntil = 0;
      },
      pauseAutoFollow() {
        autoFollowEnabled = false;
      },
      resumeAutoFollow() {
        autoFollowEnabled = true;
      },
      isAutoFollowEnabled() {
        return autoFollowEnabled;
      },
      isProgrammaticScrollActive() {
        return Date.now() < programmaticScrollUntil;
      },
      markProgrammaticScroll(durationMs = 900) {
        programmaticScrollUntil = Date.now() + durationMs;
      },
      handleUserScroll({ isPanelOpen = false } = {}) {
        if (!isPanelOpen || Date.now() < programmaticScrollUntil) return false;
        autoFollowEnabled = false;
        return true;
      },
      scrollItemIntoView(item, behavior = "smooth") {
        if (!item) return false;
        const durationMs = behavior === "smooth" ? 900 : 250;
        programmaticScrollUntil = Date.now() + durationMs;
        item.scrollIntoView({ behavior, block: "center" });
        return true;
      },
    };
  };

  modules.createFallbackTimeupdateController =
    function createFallbackTimeupdateController() {
      let boundVideo = null;
      let boundHandler = null;

      function clear() {
        if (boundVideo && boundHandler) {
          boundVideo.removeEventListener("timeupdate", boundHandler);
        }
        boundVideo = null;
        boundHandler = null;
      }

      return {
        bind(video, handler) {
          if (!video || typeof handler !== "function") {
            clear();
            return false;
          }
          if (boundVideo === video && boundHandler === handler) return false;
          clear();
          video.addEventListener("timeupdate", handler);
          boundVideo = video;
          boundHandler = handler;
          return true;
        },
        clear,
        getBoundVideo() {
          return boundVideo;
        },
      };
    };

  modules.createFallbackTranscriptState =
    function createFallbackTranscriptState(initialState = {}) {
      let subtitles = Array.isArray(initialState.subtitles)
        ? initialState.subtitles.slice()
        : [];
      let sourceMode =
        typeof initialState.sourceMode === "string"
          ? initialState.sourceMode
          : "none";

      return {
        clear() {
          subtitles = [];
          sourceMode = "none";
        },
        getSubtitles() {
          return subtitles;
        },
        setSubtitles(nextSubtitles = [], nextSourceMode = sourceMode) {
          subtitles = Array.isArray(nextSubtitles) ? nextSubtitles.slice() : [];
          sourceMode =
            typeof nextSourceMode === "string" ? nextSourceMode : sourceMode;
          return subtitles;
        },
        getSourceMode() {
          return sourceMode;
        },
        setSourceMode(nextSourceMode = "none") {
          sourceMode =
            typeof nextSourceMode === "string" ? nextSourceMode : "none";
          return sourceMode;
        },
        hasSubtitles() {
          return subtitles.length > 0;
        },
        count() {
          return subtitles.length;
        },
      };
    };

  modules.createFallbackTranscriptService =
    function createFallbackTranscriptService(deps = {}) {
      const state = deps.state;

      return {
        hasCompleteSubtitles() {
          return state.hasSubtitles() && state.getSourceMode() !== "live_capture";
        },
        reset() {
          state.clear();
        },
        storeLoadedSubtitles(
          parsed,
          { expectedVideoId, sourceMode = "full" } = {},
        ) {
          if (!Array.isArray(parsed) || parsed.length === 0) return false;
          if (
            typeof deps.isExpectedVideoActive === "function" &&
            !deps.isExpectedVideoActive(expectedVideoId)
          ) {
            return false;
          }

          state.setSubtitles(parsed, sourceMode);
          return state.hasSubtitles();
        },
        parseSubtitles(text, url = "", source = "rutube_api", expectedVideoId) {
          if (!text || this.hasCompleteSubtitles()) return false;
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

          return this.storeLoadedSubtitles(parsed, {
            expectedVideoId,
            sourceMode:
              typeof source === "string" && source.trim()
                ? source.trim()
                : "full",
          });
        },
      };
    };

  modules.createFallbackTranscriptExport =
    function createFallbackTranscriptExport(deps = {}) {
      const formatTime = deps.formatTime || ((value) => String(value));
      const formatSRTTime = deps.formatSRTTime || ((value) => String(value));

      function buildPlainText(subtitles = []) {
        return Array.isArray(subtitles)
          ? subtitles
              .map((cue) => `${formatTime(cue.start)} ${cue.text}`)
              .join("\n")
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
