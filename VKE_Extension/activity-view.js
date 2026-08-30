(function (global) {
  "use strict";

  function getLanguageLabel(language, t) {
    switch (String(language || "").trim().toLowerCase()) {
      case "en":
      case "english":
        return t("popupHistoryLanguageEn");
      case "ru":
      case "russian":
        return t("popupHistoryLanguageRu");
      default:
        return t("popupHistoryLanguageOrig");
    }
  }

  function getPlatformLabel(platform, t) {
    switch (String(platform || "").trim().toLowerCase()) {
      case "youtube":
        return t("popupHistoryPlatformYoutube");
      case "vkvideo":
        return t("popupHistoryPlatformVkvideo");
      default:
        return t("popupHistoryPlatformRutube");
    }
  }

  function getRelativeTimeLabel(timestamp, t, now = Date.now()) {
    const value = Date.parse(timestamp || "");
    if (!Number.isFinite(value)) return t("popupHistoryJustNow");

    const diffMs = Math.max(0, now - value);
    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);

    if (minutes < 1) return t("popupHistoryJustNow");
    if (minutes < 60) return t("popupHistoryMinutesAgo", [String(minutes)]);
    if (hours < 24) return t("popupHistoryHoursAgo", [String(hours)]);
    return t("popupHistoryDaysAgo", [String(Math.max(1, days))]);
  }

  function resolveVideoTitle(item, t) {
    const candidates = [
      item?.videoTitle,
      item?.video_title,
      item?.videoName,
      item?.video_name,
      item?.documentTitle,
      item?.document_title,
    ];
    const title = candidates
      .map((value) => String(value || "").trim())
      .find(Boolean);

    return title || t("popupHistoryUntitled");
  }

  function buildHistoryItems({ entries = [], historyType = "all", t, now }) {
    return (Array.isArray(entries) ? entries : [])
      .filter((item) => {
        const translatedSubtitles = Array.isArray(item?.translatedSubtitles)
          ? item.translatedSubtitles
          : Array.isArray(item?.translated_subtitles)
            ? item.translated_subtitles
            : [];
        const summaryType = String(
          item?.summaryType || item?.summary_type || "",
        )
          .trim()
          .toLowerCase();

        if (historyType === "translation") {
          return translatedSubtitles.length > 0;
        }

        if (historyType === "summary") {
          return summaryType === "full";
        }

        return true;
      })
      .map((item) => {
      const summaryText = String(item?.summaryText || item?.summary_text || "").trim();
      const translatedSubtitles = Array.isArray(item?.translatedSubtitles)
        ? item.translatedSubtitles
        : Array.isArray(item?.translated_subtitles)
          ? item.translated_subtitles
          : [];

      return {
        title: resolveVideoTitle(item, t),
        meta: [
          getPlatformLabel(item?.platform, t),
          getLanguageLabel(item?.language, t),
          getRelativeTimeLabel(item?.requestedAt, t, now),
        ].join(" • "),
        url: item?.videoUrl || "",
        rawItem: item,
        downloadType: translatedSubtitles.length > 0
          ? "translation"
          : summaryText
            ? "summary"
            : "",
      };
    });
  }

  function paginateHistoryItems(items = [], page = 0, pageSize = 3) {
    const normalizedItems = Array.isArray(items) ? items : [];
    const safePageSize = Math.max(1, Number(pageSize) || 3);
    const totalPages = Math.max(
      1,
      Math.ceil(normalizedItems.length / safePageSize) || 1,
    );
    const currentPage = Math.min(
      Math.max(0, Number(page) || 0),
      totalPages - 1,
    );
    const startIndex = currentPage * safePageSize;

    return {
      items: normalizedItems.slice(startIndex, startIndex + safePageSize),
      page: currentPage,
      totalPages,
      hasPrev: currentPage > 0,
      hasNext: currentPage < totalPages - 1,
    };
  }

  const api = {
    buildHistoryItems,
    paginateHistoryItems,
  };

  global.__rutubeTranscriptPopupActivity = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
