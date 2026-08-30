(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});
  const PARTIAL_VIDEO_MIN_DURATION_SECONDS = 5 * 60;
  const PARTIAL_MISSING_TAIL_MIN_SECONDS = 90;
  const PARTIAL_COVERAGE_THRESHOLD = 0.8;
  const VK_PARTIAL_CUE_RETRY_TIMEOUT_MS = 8_000;
  const VK_PARTIAL_CUE_POLL_INTERVAL_MS = 500;

  modules.createTranscriptFetchController =
    function createTranscriptFetchController(deps = {}) {
      let subtitleFetchPromise = null;
      let vkNoTracksDetected = false;
      const fetchImpl =
        typeof deps.fetch === "function"
          ? deps.fetch.bind(global)
          : typeof global.fetch === "function"
            ? global.fetch.bind(global)
            : null;

      function getPendingPromise() {
        return subtitleFetchPromise;
      }

      function notifyStateUpdated() {
        deps.onStateUpdated?.();
      }

      function reset() {
        subtitleFetchPromise = null;
        vkNoTracksDetected = false;
      }

      function readSubtitleLanguage(...candidates) {
        for (const candidate of candidates) {
          if (typeof candidate !== "string") continue;
          const normalized = candidate.trim();
          if (normalized) return normalized;
        }
        return "";
      }

      function buildSubtitleCoverageMeta(parsed = []) {
        const durationSeconds = Number(deps.getVideoDuration?.());
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
          return null;
        }

        const transcriptEndSeconds = Math.max(
          0,
          ...parsed.map((cue) => Number(cue?.end || cue?.start || 0)),
        );
        if (!Number.isFinite(transcriptEndSeconds) || transcriptEndSeconds <= 0) {
          return null;
        }

        const coverageRatio = Math.max(
          0,
          Math.min(1, transcriptEndSeconds / durationSeconds),
        );
        const missingTailSeconds = Math.max(
          0,
          durationSeconds - transcriptEndSeconds,
        );
        const isLikelyPartial =
          durationSeconds >= PARTIAL_VIDEO_MIN_DURATION_SECONDS &&
          missingTailSeconds >= PARTIAL_MISSING_TAIL_MIN_SECONDS &&
          coverageRatio < PARTIAL_COVERAGE_THRESHOLD;

        return {
          durationSeconds,
          transcriptEndSeconds,
          coverageRatio,
          missingTailSeconds,
          isLikelyPartial,
        };
      }

      function sleep(ms) {
        return new Promise((resolve) => {
          global.setTimeout(resolve, ms);
        });
      }

      function deduplicateVKTrackCues(cues) {
        return deps.deduplicateVKCues?.(cues) || [];
      }

      function isBetterCoverage(candidateMeta, bestMeta, candidateParsed, bestParsed) {
        if (!candidateMeta) return false;
        if (!bestMeta) return true;
        const candidateEnd = Number(candidateMeta.transcriptEndSeconds || 0);
        const bestEnd = Number(bestMeta.transcriptEndSeconds || 0);
        if (candidateEnd > bestEnd + 1) return true;
        return (
          candidateEnd >= bestEnd &&
          Array.isArray(candidateParsed) &&
          Array.isArray(bestParsed) &&
          candidateParsed.length > bestParsed.length
        );
      }

      async function waitForMoreCompleteVKCues(
        track,
        initialParsed,
        initialSourceMeta,
        expectedVideoId,
      ) {
        if (initialSourceMeta?.isLikelyPartial !== true) {
          return { parsed: initialParsed, sourceMeta: initialSourceMeta };
        }

        const timeoutMs = Number(
          deps.vkPartialCueRetryTimeoutMs ?? VK_PARTIAL_CUE_RETRY_TIMEOUT_MS,
        );
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
          return { parsed: initialParsed, sourceMeta: initialSourceMeta };
        }

        const pollIntervalMs = Math.max(
          50,
          Number(
            deps.vkPartialCuePollIntervalMs ?? VK_PARTIAL_CUE_POLL_INTERVAL_MS,
          ) || VK_PARTIAL_CUE_POLL_INTERVAL_MS,
        );
        const deadline = Date.now() + timeoutMs;
        let bestParsed = initialParsed;
        let bestSourceMeta = initialSourceMeta;

        while (Date.now() < deadline) {
          if (!deps.isExpectedVideoActive?.(expectedVideoId)) break;
          await sleep(pollIntervalMs);

          const cues = track?.cues;
          if (!cues || cues.length === 0) continue;

          const parsed = deduplicateVKTrackCues(cues);
          if (!Array.isArray(parsed) || parsed.length === 0) continue;

          const sourceMeta = buildSubtitleCoverageMeta(parsed);
          if (
            isBetterCoverage(sourceMeta, bestSourceMeta, parsed, bestParsed)
          ) {
            bestParsed = parsed;
            bestSourceMeta = sourceMeta;
          }

          if (sourceMeta?.isLikelyPartial === false) {
            break;
          }
        }

        return { parsed: bestParsed, sourceMeta: bestSourceMeta };
      }

      async function waitForTrackCues(track, timeoutMs = 5000) {
        if (!track) return null;
        if (track.cues && track.cues.length > 0) return track.cues;

        return await new Promise((resolve) => {
          let settled = false;
          const finish = (value) => {
            if (settled) return;
            settled = true;
            global.clearInterval(intervalId);
            global.clearTimeout(timeoutId);
            track.removeEventListener("cuechange", onCueChange);
            resolve(value);
          };
          const onCueChange = () => {
            if (track.cues && track.cues.length > 0) finish(track.cues);
          };
          const intervalId = global.setInterval(() => {
            if (track.cues && track.cues.length > 0) finish(track.cues);
          }, 300);
          const timeoutId = global.setTimeout(
            () => finish(track.cues && track.cues.length > 0 ? track.cues : null),
            timeoutMs,
          );
          track.addEventListener("cuechange", onCueChange);
        });
      }

      async function fetchRuTubeSubtitles(videoId, expectedVideoId = videoId) {
        if (deps.hasLoadedSubtitles?.()) return;
        if (!deps.isExpectedVideoActive?.(expectedVideoId)) return;
        if (!fetchImpl) return;

        try {
          const resp = await fetchImpl(
            `https://rutube.ru/api/play/options/${videoId}/?no_404=true&referer=https://rutube.ru`,
          );
          const data = await resp.json();
          if (!data.captions || data.captions.length === 0) return;

          for (const caption of data.captions) {
            if (!caption.file) continue;
            const subResp = await fetchImpl(caption.file);
            const subText = await subResp.text();
            const subtitleLanguage = readSubtitleLanguage(
              caption.language,
              caption.lang,
              caption.language_code,
              caption.code,
              caption.label,
              caption.name,
            );
            deps.parseSubtitles?.(
              subText,
              caption.file,
              "rutube_api",
              expectedVideoId,
              { subtitleLanguage },
            );
            if (deps.hasLoadedSubtitles?.()) return;
          }
        } catch (error) {
          console.error("RuTube subtitle API error:", error);
        }
      }

      async function fetchVKVideoSubtitles(
        expectedVideoId = deps.getCurrentVideoId?.(),
      ) {
        if (deps.hasCompleteSubtitles?.()) return;
        if (!deps.isExpectedVideoActive?.(expectedVideoId)) return;

        const video = await waitForVKVideoTrackHost(expectedVideoId);
        if (!video || !video.textTracks) return;
        if (video.textTracks.length === 0) {
          vkNoTracksDetected = true;
          return;
        }

        vkNoTracksDetected = false;

        for (let index = 0; index < video.textTracks.length; index += 1) {
          const track = video.textTracks[index];
          if (track.kind !== "subtitles" && track.kind !== "captions") continue;
          const subtitleLanguage = readSubtitleLanguage(
            track.language,
            track.srclang,
            track.lang,
            track.label,
          );

          const previousMode = track.mode;
          if (track.mode === "disabled") track.mode = "hidden";

          try {
            const cues = await waitForTrackCues(
              track,
              deps.vkCueTimeoutMs || 20_000,
            );
            if (!cues || cues.length === 0) continue;

            let parsed = deduplicateVKTrackCues(cues);
            let sourceMeta = buildSubtitleCoverageMeta(parsed);
            if (sourceMeta?.isLikelyPartial === true) {
              const completed = await waitForMoreCompleteVKCues(
                track,
                parsed,
                sourceMeta,
                expectedVideoId,
              );
              parsed = completed.parsed;
              sourceMeta = completed.sourceMeta;
            }
            const isLikelyPartial = sourceMeta?.isLikelyPartial === true;
            const stored = deps.storeLoadedSubtitles?.(parsed, {
              expectedVideoId,
              sourceMode: isLikelyPartial
                ? "vk_text_tracks_partial"
                : "vk_text_tracks",
              subtitleLanguage,
              ...(sourceMeta ? { sourceMeta } : {}),
            });
            if (stored) return;
          } finally {
            if (previousMode === "disabled") {
              track.mode = previousMode;
            }
          }
        }

        vkNoTracksDetected = true;
      }

      async function waitForVKVideoTrackHost(expectedVideoId) {
        const timeoutMs = deps.vkTrackReadyTimeoutMs || 15_000;
        const noTrackGraceMs = deps.vkNoTracksGraceMs || 3_000;
        const pollIntervalMs = deps.vkTrackPollIntervalMs || 500;
        const deadline = Date.now() + timeoutMs;
        let videoReadyAt = 0;

        while (Date.now() < deadline) {
          if (!deps.isExpectedVideoActive?.(expectedVideoId)) return null;

          const root = deps.getPlayerRoot?.();
          const video = root?.querySelector?.("video");
          const tracks = video?.textTracks;
          const isVideoReady = Boolean(
            video && (video.currentSrc || Number(video.readyState || 0) >= 1),
          );

          if (isVideoReady && videoReadyAt === 0) {
            videoReadyAt = Date.now();
          }

          if (video && tracks && tracks.length > 0) {
            return video;
          }

          if (
            video &&
            isVideoReady &&
            videoReadyAt > 0 &&
            Date.now() - videoReadyAt >= noTrackGraceMs
          ) {
            return video;
          }

          await new Promise((resolve) => {
            global.setTimeout(resolve, pollIntervalMs);
          });
        }

        return null;
      }

      async function fetchSubtitlesNow(options = {}) {
        const { force = false } = options;
        const videoId = deps.getVideoId?.();
        if (!videoId) return false;
        if (
          deps.isYouTube || deps.isVKVideo
            ? deps.hasCompleteSubtitles?.()
            : deps.hasLoadedSubtitles?.()
        ) {
          return true;
        }
        if (subtitleFetchPromise) return subtitleFetchPromise;
        if (deps.isYouTube && !force && deps.isYouTubeFetchCoolingDown?.()) {
          return false;
        }
        if (deps.isYouTube && !force) {
          deps.registerYouTubeAutoFetchAttempt?.();
        }

        const requestVideoId = videoId;
        const activePromise = (async () => {
          try {
            if (deps.isRuTube) {
              await fetchRuTubeSubtitles(videoId, requestVideoId);
              return Boolean(deps.hasLoadedSubtitles?.());
            }

            if (deps.isVKVideo) {
              await fetchVKVideoSubtitles(requestVideoId);
              return Boolean(deps.hasLoadedSubtitles?.());
            }

            return await deps.fetchYouTubeSubtitles?.({
              force,
              expectedVideoId: requestVideoId,
            });
          } finally {
            if (subtitleFetchPromise === activePromise) {
              subtitleFetchPromise = null;
            }
            notifyStateUpdated();
          }
        })();

        subtitleFetchPromise = activePromise;
        notifyStateUpdated();
        return activePromise;
      }

      function tryFetchSubtitles() {
        if (!deps.getVideoId?.()) return;

        fetchSubtitlesNow();
        if (deps.isVKVideo) {
          global.setTimeout(() => {
            if (!deps.hasCompleteSubtitles?.() && !vkNoTracksDetected) {
              fetchSubtitlesNow();
            }
          }, 2000);
          global.setTimeout(() => {
            if (!deps.hasCompleteSubtitles?.() && !vkNoTracksDetected) {
              fetchSubtitlesNow();
            }
          }, 5000);
        } else if (deps.isYouTube) {
          deps.startYouTubeLiveCaptionCapture?.();
          deps.setupYouTubeSubtitleWatchers?.();
        }
      }

      return {
        fetchSubtitlesNow,
        getPendingPromise,
        reset,
        tryFetchSubtitles,
        waitForTrackCues,
      };
    };
})(globalThis);
