(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildLoadingMarkup({ t }) {
    return `
      <div class="transcript-loading">${t("contentLoadingSubs")}</div>
    `;
  }

  function buildEmptyMarkup({ t, isYouTube }) {
    const emptyTitle = isYouTube
      ? t("contentYoutubeEmptyTitle")
      : t("contentEmptyTitle");
    const emptyDesc = isYouTube
      ? t("contentYoutubeEmptyDesc")
      : t("contentEmptyDesc");

    return `
      <div class="transcript-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" opacity="0.3">
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
          <path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>
        </svg>
        <div class="transcript-empty-title">${emptyTitle}</div>
        <div class="transcript-empty-desc">${emptyDesc}</div>
      </div>
    `;
  }

  function buildTranslationStatusMarkup({ t, translationState = {} }) {
    const isLoading = translationState?.status === "loading";
    const selectedLanguage = String(
      translationState?.selectedLanguage || "original",
    ).toUpperCase();
    if (!isLoading || selectedLanguage === "ORIGINAL") {
      return "";
    }

    const progress = Math.max(
      0,
      Math.min(99, Math.round(Number(translationState?.progress || 0))),
    );

    return `
      <div class="transcript-translation-status" role="status" aria-live="polite">
        <div class="transcript-translation-status-copy">
          <div class="transcript-translation-status-title">${escapeHtml(t("contentTranslationLoadingTitle"))}</div>
          <div class="transcript-translation-status-hint">${escapeHtml(t("contentTranslationLoadingHint"))}</div>
        </div>
        <div class="transcript-translation-status-meta">
          <span class="transcript-translation-status-lang">${escapeHtml(selectedLanguage)}</span>
          <span class="transcript-translation-status-progress">${progress}%</span>
        </div>
        <div class="transcript-translation-status-track" aria-hidden="true">
          <span class="transcript-translation-status-fill" style="width: ${Math.max(progress, 8)}%;"></span>
        </div>
      </div>
    `;
  }

  function isPartialSubtitleSource(subtitleSourceMode, subtitleSourceMeta = {}) {
    return (
      subtitleSourceMeta?.isLikelyPartial === true ||
      subtitleSourceMode === "vk_text_tracks_partial"
    );
  }

  function buildPartialSubtitleNotice({
    t,
    formatTime,
    subtitleSourceMeta = {},
  }) {
    const endSeconds = Number(subtitleSourceMeta?.transcriptEndSeconds || 0);
    const durationSeconds = Number(subtitleSourceMeta?.durationSeconds || 0);
    const ratio = Number(subtitleSourceMeta?.coverageRatio || 0);
    const endLabel =
      Number.isFinite(endSeconds) && endSeconds > 0
        ? formatTime(endSeconds)
        : "?:??";
    const durationLabel =
      Number.isFinite(durationSeconds) && durationSeconds > 0
        ? formatTime(durationSeconds)
        : "?:??";
    const percentLabel =
      Number.isFinite(ratio) && ratio > 0
        ? String(Math.max(1, Math.round(ratio * 100)))
        : "0";

    return `
      <div class="transcript-partial-note" role="status">
        ${escapeHtml(
          t("contentPartialSubtitlesNotice", [
            endLabel,
            durationLabel,
            percentLabel,
          ]),
        )}
      </div>
    `;
  }

  function buildListMarkup({
    t,
    subtitles = [],
    isYouTube = false,
    subtitleSourceMode = "none",
    subtitleSourceMeta = {},
    translationState = {},
    formatTime,
  }) {
    const translationStatus = buildTranslationStatusMarkup({
      t,
      translationState,
    });
    const liveCaptureNotice =
      isYouTube && subtitleSourceMode === "live_capture"
        ? `<div class="transcript-live-note">${escapeHtml(t("contentYoutubeLiveNotice"))}</div>`
        : "";
    const partialSubtitleNotice = isPartialSubtitleSource(
      subtitleSourceMode,
      subtitleSourceMeta,
    )
      ? buildPartialSubtitleNotice({
          t,
          formatTime,
          subtitleSourceMeta,
        })
      : "";

    const itemsMarkup = subtitles
      .map(
        (subtitle, index) => `
          <div class="transcript-item" data-index="${index}" data-time="${subtitle.start}">
            <div class="transcript-time">${formatTime(subtitle.start)}</div>
            <div class="transcript-text">${escapeHtml(subtitle.text)}</div>
          </div>`,
      )
      .join("");

    return translationStatus + liveCaptureNotice + partialSubtitleNotice + itemsMarkup;
  }

  modules.createTranscriptListView = function createTranscriptListView() {
    return {
      escapeHtml,
      buildLoadingMarkup,
      buildEmptyMarkup,
      buildListMarkup,
      render({
        contentEl,
        t,
        isLoading = false,
        hasSubtitles = false,
        subtitles = [],
        isYouTube = false,
        subtitleSourceMode = "none",
        subtitleSourceMeta = {},
        translationState = {},
        formatTime,
        onSeek,
      }) {
        if (!contentEl) return;

        if (isLoading) {
          contentEl.innerHTML = buildLoadingMarkup({ t });
          return;
        }

        if (!hasSubtitles || subtitles.length === 0) {
          contentEl.innerHTML = buildEmptyMarkup({ t, isYouTube });
          return;
        }

        contentEl.innerHTML = buildListMarkup({
          t,
          subtitles,
          isYouTube,
          subtitleSourceMode,
          subtitleSourceMeta,
          translationState,
          formatTime,
        });

        contentEl.querySelectorAll(".transcript-item").forEach((item) => {
          item.addEventListener("click", () => {
            const time = parseFloat(item.dataset.time);
            if (!Number.isNaN(time)) onSeek?.(time);
          });
        });
      },
      highlightActiveItem({ contentEl, activeIndex }) {
        if (!contentEl) return null;

        let activeItem = null;
        contentEl.querySelectorAll(".transcript-item").forEach((item) => {
          const isActive = parseInt(item.dataset.index, 10) === activeIndex;
          item.classList.toggle("active", isActive);
          if (isActive) activeItem = item;
        });

        return activeItem;
      },
    };
  };
})(globalThis);
