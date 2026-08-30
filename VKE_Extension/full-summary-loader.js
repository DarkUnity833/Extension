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

  modules.createFullSummaryLoader = function createFullSummaryLoader() {
    return {
      buildMarkup({ t, progress = 12 }) {
        const normalizedProgress = Math.max(0, Math.min(99, Math.round(progress)));
        return `
          <div class="summary-full-loader" style="--summary-loader-progress: ${normalizedProgress};">
            <div class="summary-full-loader-visual" aria-hidden="true">
              <div class="summary-full-loader-halo"></div>
              <div class="summary-full-loader-ring"></div>
              <div class="summary-full-loader-dot"></div>
            </div>
            <div class="summary-full-loader-copy">
              <div class="summary-full-loader-label">${escapeHtml(t("contentSummaryFullLoading"))}</div>
              <div class="summary-full-loader-stage" id="summary-full-loading-stage">${escapeHtml(t("contentSummaryFullLoadingStageAnalyze"))}</div>
            </div>
            <div class="summary-full-progress">
              <div class="summary-full-progress-head">
                <span>${escapeHtml(t("contentSummaryFullLoadingProgress"))}</span>
                <span class="summary-full-progress-value" id="summary-full-loading-percent">${normalizedProgress}%</span>
              </div>
              <div class="summary-full-progress-track" id="summary-full-loading-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${normalizedProgress}" aria-label="${escapeHtml(t("contentSummaryFullLoadingProgress"))}">
                <span class="summary-full-progress-fill" id="summary-full-loading-bar" style="width: ${normalizedProgress}%;"></span>
              </div>
            </div>
          </div>
        `;
      },
      sync(panel, { progress = 12, stageLabel = "" } = {}) {
        const fullView = panel?.querySelector("#summary-full-view");
        if (!fullView) return null;
        const loader = fullView.querySelector(".summary-full-loader");
        if (!loader) return null;

        const normalizedProgress = Math.max(0, Math.min(99, Math.round(progress)));
        loader.style.setProperty("--summary-loader-progress", String(normalizedProgress));

        const progressValue = `${normalizedProgress}%`;
        const percentNode = fullView.querySelector("#summary-full-loading-percent");
        const barNode = fullView.querySelector("#summary-full-loading-bar");
        const stageNode = fullView.querySelector("#summary-full-loading-stage");
        const trackNode = fullView.querySelector("#summary-full-loading-track");

        if (percentNode) percentNode.textContent = progressValue;
        if (barNode) barNode.style.width = progressValue;
        if (stageNode && stageLabel) stageNode.textContent = stageLabel;
        if (trackNode) trackNode.setAttribute("aria-valuenow", String(normalizedProgress));

        return {
          progress: normalizedProgress,
          stageLabel,
        };
      },
    };
  };
})(globalThis);
