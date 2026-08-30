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

  function withLineBreaks(text) {
    return escapeHtml(text).replace(/\n/g, "<br>");
  }

  function buildPreviewSkeleton() {
    return `
      <div class="summary-preview-skeleton">
        <span class="summary-preview-line"></span>
        <span class="summary-preview-line"></span>
        <span class="summary-preview-line short"></span>
      </div>
    `;
  }

  function buildThemeIcon({ mode = "dark" } = {}) {
    if (mode === "light") {
      return `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="4"></circle>
          <path d="M12 2v3"></path><path d="M12 19v3"></path>
          <path d="M4.93 4.93l2.12 2.12"></path><path d="M16.95 16.95l2.12 2.12"></path>
          <path d="M2 12h3"></path><path d="M19 12h3"></path>
          <path d="M4.93 19.07l2.12-2.12"></path><path d="M16.95 7.05l2.12-2.12"></path>
        </svg>
      `;
    }

    return `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"></path>
      </svg>
    `;
  }

  function buildPreviewMarkup({ t, state = {}, copy = {} }) {
    const status = state.previewStatus || "hidden";
    if (status === "hidden") return "";

    const header = `
      <div class="summary-preview-header">
        <span class="summary-preview-title">${escapeHtml(copy.preview_title || t("contentSummaryPreviewTitle"))}</span>
      </div>
    `;

    if (status === "loading") {
      return `
        ${header}
        <div class="summary-preview-body">
          ${buildPreviewSkeleton()}
          <div class="summary-preview-meta">${escapeHtml(t("contentSummaryPreviewLoading"))}</div>
        </div>
      `;
    }

    if (status === "paused") {
      return `
        ${header}
        <div class="summary-preview-body">
          <div class="summary-preview-text muted">${escapeHtml(t("contentSummaryPreviewPaused"))}</div>
          <button class="summary-preview-cta retry" id="summary-preview-retry">${escapeHtml(t("contentSummaryRetry"))}</button>
        </div>
      `;
    }

    if (status === "partial") {
      return `
        ${header}
        <div class="summary-preview-body">
          <div class="summary-preview-text muted">${escapeHtml(state.previewText || t("contentSummaryPreviewError"))}</div>
          <button class="summary-preview-cta retry" id="summary-preview-retry">${escapeHtml(t("contentSummaryRetry"))}</button>
        </div>
      `;
    }

    if (status === "meter_limit") {
      const meter = state.previewMeter || {};
      return `
        ${header}
        <div class="summary-preview-body summary-preview-meter-body">
          <div class="summary-preview-locked-visual" aria-hidden="true">
            <span class="summary-preview-locked-line"></span>
            <span class="summary-preview-locked-line"></span>
            <span class="summary-preview-locked-line short"></span>
          </div>
          <div class="summary-preview-locked-copy">
            <div class="summary-preview-locked-title">${escapeHtml(meter.title || t("contentSummaryPreviewMeterTitle"))}</div>
            <div class="summary-preview-locked-body">${escapeHtml(meter.body || t("contentSummaryPreviewMeterBody"))}</div>
            <button class="summary-preview-cta" id="summary-preview-cta">${escapeHtml(meter.cta || t("contentSummaryPreviewMeterCta"))}</button>
          </div>
        </div>
      `;
    }

    if (status === "error") {
      return `
        ${header}
        <div class="summary-preview-body">
          <div class="summary-preview-text muted">${escapeHtml(t("contentSummaryPreviewError"))}</div>
          <button class="summary-preview-cta retry" id="summary-preview-retry">${escapeHtml(t("contentSummaryRetry"))}</button>
        </div>
      `;
    }

    const timeSaved = state.timeSavedLabel
      ? `<div class="summary-preview-meta">${escapeHtml(state.timeSavedLabel)}</div>`
      : "";

    return `
      ${header}
      <div class="summary-preview-body">
        <div class="summary-preview-text">${withLineBreaks(state.previewText || "")}</div>
        ${timeSaved}
        <button class="summary-preview-cta" id="summary-preview-cta">${escapeHtml(copy.preview_cta_label || t("contentSummaryOpenFull"))}</button>
      </div>
    `;
  }

  function buildFallbackFullSummaryLoaderMarkup({ t, progress = 12 }) {
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
  }

  function syncFallbackFullSummaryLoadingState(
    panel,
    { progress = 12, stageLabel = "" } = {},
  ) {
    const fullView = panel?.querySelector("#summary-full-view");
    if (!fullView) return null;
    const loader = fullView.querySelector(".summary-full-loader");
    if (!loader) return null;

    const normalizedProgress = Math.max(0, Math.min(99, Math.round(progress)));
    loader.style?.setProperty?.(
      "--summary-loader-progress",
      String(normalizedProgress),
    );

    const progressValue = `${normalizedProgress}%`;
    const percentNode = fullView.querySelector("#summary-full-loading-percent");
    const barNode = fullView.querySelector("#summary-full-loading-bar");
    const stageNode = fullView.querySelector("#summary-full-loading-stage");
    const trackNode = fullView.querySelector("#summary-full-loading-track");

    if (percentNode) percentNode.textContent = progressValue;
    if (barNode?.style) barNode.style.width = progressValue;
    if (stageNode && stageLabel) stageNode.textContent = stageLabel;
    if (trackNode?.setAttribute) {
      trackNode.setAttribute("aria-valuenow", String(normalizedProgress));
    }

    return {
      progress: normalizedProgress,
      stageLabel,
    };
  }

  function buildFullSummaryMarkup({ t, state = {} }) {
    const status = state.fullStatus || "idle";
    const canUseActions = status === "success" && Boolean(state.fullText);

    let contentMarkup = `
      <div class="summary-full-empty">${escapeHtml(t("contentSummaryFullLoading"))}</div>
    `;

    if (status === "loading") {
      const loaderBuilder =
        global.__rutubeTranscriptModules?.createFullSummaryLoader?.();
      const loaderMarkup =
        loaderBuilder?.buildMarkup?.({ t }) ||
        buildFallbackFullSummaryLoaderMarkup({ t });
      contentMarkup = `<div class="summary-full-loading">${loaderMarkup}</div>`;
    } else if (status === "error") {
      contentMarkup = `
        <div class="summary-full-empty">
          <div class="summary-full-empty-text">${escapeHtml(t("contentSummaryFullError"))}</div>
          <button class="summary-preview-cta retry" id="summary-full-retry">${escapeHtml(t("contentSummaryRetry"))}</button>
        </div>
      `;
    } else if (status === "success") {
      contentMarkup = `
        <div class="summary-full-text">${withLineBreaks(state.fullText || "")}</div>
      `;
    }

    return `
      <div class="summary-full-header">
        <button class="summary-back-btn" id="summary-back">
          <span aria-hidden="true">&#8592;</span>
          <span>${escapeHtml(t("contentSummaryBackToTranscript"))}</span>
        </button>
        <div class="summary-full-title">${escapeHtml(t("contentSummaryFullTitle"))}</div>
      </div>
      <div class="summary-full-actions ${canUseActions ? "" : "hidden"}">
        <button class="transcript-btn" id="summary-copy">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <span>${escapeHtml(t("contentCopy"))}</span>
        </button>
        <button class="transcript-btn" id="summary-download-txt">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <span>TXT</span>
        </button>
      </div>
      <div class="summary-full-content">
        ${contentMarkup}
      </div>
    `;
  }

  function buildPanelMarkup({ t }) {
    return `
      <div class="transcript-panel-header">
        <div class="transcript-panel-title">
          <span class="transcript-panel-title-text">${escapeHtml(t("contentTranscriptTitle"))}</span>
        </div>
        <div class="transcript-panel-header-controls">
          <div class="transcript-language-slot" id="transcript-language-slot"></div>
          <div class="transcript-panel-actions">
            <button class="transcript-action-btn" id="transcript-theme-toggle" title="${escapeHtml(t("contentThemeToggleDark"))}">
              ${buildThemeIcon({ mode: "dark" })}
            </button>
            <button class="transcript-action-btn" id="transcript-close" title="${escapeHtml(t("contentClose"))}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div class="transcript-summary-preview hidden" id="summary-preview"></div>
      <div class="transcript-actions" id="transcript-actions">
        <div class="transcript-buttons secondary transcript-actions-row">
          <button class="transcript-btn transcript-btn-icon" id="transcript-toggle-expand" title="${escapeHtml(t("contentTranscriptExpand"))}" aria-label="${escapeHtml(t("contentTranscriptExpand"))}" aria-pressed="false">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 3 21 3 21 9"></polyline>
              <polyline points="9 21 3 21 3 15"></polyline>
              <line x1="21" y1="3" x2="14" y2="10"></line>
              <line x1="3" y1="21" x2="10" y2="14"></line>
            </svg>
          </button>
          <button class="transcript-btn transcript-btn-primary" id="btn-copy">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            <span>${escapeHtml(t("contentCopy"))}</span>
          </button>
          <button class="transcript-btn transcript-btn-compact" id="btn-download-txt">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span>TXT</span>
          </button>
          <div class="transcript-btn-shell transcript-btn-shell-compact">
            <button class="transcript-btn transcript-btn-compact pro" id="btn-download-srt">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>SRT</span>
            </button>
            <span class="transcript-language-control-badge transcript-btn-pro-badge" id="btn-download-srt-badge" aria-hidden="true">Pro</span>
          </div>
        </div>
        <div class="transcript-buttons transcript-archive-row">
          <button class="transcript-btn transcript-btn-archive" id="btn-save-archive" title="${escapeHtml(t("contentArchiveSave"))}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"></path>
              <path d="M3 8l2-5h14l2 5"></path>
              <path d="M10 12h4"></path>
            </svg>
            <span>${escapeHtml(t("contentArchiveSave"))}</span>
          </button>
        </div>
      </div>
      <div class="transcript-main">
        <div class="transcript-content" id="transcript-content">
          <div class="transcript-loading">${escapeHtml(t("contentLoadingSubs"))}</div>
        </div>
        <div class="summary-full-view hidden" id="summary-full-view"></div>
      </div>
      <div class="transcript-footer" id="transcript-footer">${escapeHtml(t("contentClickTimecode"))}</div>
    `;
  }

  modules.createPanelRoot = function createPanelRoot(options = {}) {
    const languageSelector = options.languageSelector || null;
    const fullSummaryLoader = options.fullSummaryLoader || null;

    return {
      buildMarkup: buildPanelMarkup,
      buildPreviewMarkup,
      buildFullSummaryMarkup,
      mount({ document, t, handlers = {} }) {
        const panel = document.createElement("div");
        panel.className = "rutube-transcript-panel";
        panel.innerHTML = buildPanelMarkup({ t });

        panel
          .querySelector("#transcript-toggle-expand")
          .addEventListener(
            "click",
            handlers.onToggleExpandedTranscript || (() => {}),
          );
        panel
          .querySelector("#transcript-close")
          .addEventListener("click", handlers.onClose);
        panel.querySelector("#btn-copy").addEventListener("click", handlers.onCopy);
        panel
          .querySelector("#btn-download-txt")
          .addEventListener("click", handlers.onDownloadTxt);
        panel
          .querySelector("#btn-download-srt")
          .addEventListener("click", handlers.onDownloadSrt);
        panel
          .querySelector("#btn-save-archive")
          .addEventListener(
            "click",
            handlers.onSaveToArchive || (() => {}),
          );

        document.body.appendChild(panel);
        return panel;
      },
      getContentElement(panel) {
        return panel?.querySelector("#transcript-content") || null;
      },
      getPreviewElement(panel) {
        return panel?.querySelector("#summary-preview") || null;
      },
      getFullSummaryElement(panel) {
        return panel?.querySelector("#summary-full-view") || null;
      },
      renderPreview(panel, { t, state = {}, copy = {}, handlers = {} }) {
        const preview = panel?.querySelector("#summary-preview");
        if (!preview) return null;

        preview.innerHTML = buildPreviewMarkup({ t, state, copy });
        const isHidden = (state.previewStatus || "hidden") === "hidden";
        preview.classList.toggle("hidden", isHidden);

        preview
          .querySelector("#summary-preview-cta")
          ?.addEventListener("click", handlers.onOpenFullSummary);
        preview
          .querySelector("#summary-preview-retry")
          ?.addEventListener("click", handlers.onRetryPreview);

        return preview;
      },
      renderFullSummary(panel, { t, state = {}, handlers = {} }) {
        const fullView = panel?.querySelector("#summary-full-view");
        if (!fullView) return null;

        fullView.innerHTML = buildFullSummaryMarkup({ t, state });
        fullView
          .querySelector("#summary-back")
          ?.addEventListener("click", handlers.onBackToTranscript);
        fullView
          .querySelector("#summary-copy")
          ?.addEventListener("click", handlers.onCopyFullSummary);
        fullView
          .querySelector("#summary-download-txt")
          ?.addEventListener("click", handlers.onDownloadFullSummaryTxt);
        fullView
          .querySelector("#summary-full-retry")
          ?.addEventListener("click", handlers.onOpenFullSummary);

        return fullView;
      },
      syncFullSummaryLoadingState(panel, { progress = 12, stageLabel = "" } = {}) {
        return (
          fullSummaryLoader?.sync?.(panel, {
            progress,
            stageLabel,
          }) ||
          syncFallbackFullSummaryLoadingState(panel, {
            progress,
            stageLabel,
          })
        );
      },
      renderHeaderControls(
        panel,
        {
          t,
          languageState = {},
          themeState = {},
          handlers = {},
          showLanguageSelector = true,
        } = {},
      ) {
        if (!panel) return null;

        const languageSlot = panel.querySelector("#transcript-language-slot");
        if (languageSlot) {
          languageSlot.classList.toggle("hidden", !showLanguageSelector);
          if (showLanguageSelector) {
            languageSelector?.render?.(languageSlot, {
              t,
              selectedLanguage: languageState.selectedLanguage || "original",
              isLocked: Boolean(languageState.isLocked),
              isLoading: Boolean(languageState.isLoading),
              onChange: handlers.onLanguageChange,
              onLockedClick: handlers.onLockedLanguageClick,
            });
          } else {
            languageSlot.innerHTML = "";
          }
        }

        const themeToggle = panel.querySelector("#transcript-theme-toggle");
        if (themeToggle) {
          const themeMode = themeState.mode || "dark";
          themeToggle.innerHTML = buildThemeIcon({
            mode: themeMode,
          });
          themeToggle.title = escapeHtml(
            t(
              themeMode === "light"
                ? "contentThemeToggleLight"
                : "contentThemeToggleDark",
            ),
          );
          themeToggle.onclick = handlers.onThemeToggle || null;
          themeToggle.classList.toggle("active", themeMode === "light");
        }
        return panel;
      },
      setOpen(panel, isOpen) {
        if (!panel) return;
        panel.classList.toggle("open", Boolean(isOpen));
      },
      setPanelView(panel, view = "transcript", options = {}) {
        if (!panel) return;
        const isSummaryMode = view === "fullSummary";
        const isExpandedTranscript = view === "expandedTranscript";
        const showTranscriptActions = options.showTranscriptActions !== false;
        const showPreview = options.showPreview !== false;
        const showFooter = options.showFooter !== false;
        const toggleButton = panel.querySelector("#transcript-toggle-expand");

        panel.classList.toggle("summary-mode", isSummaryMode);
        panel.classList.toggle("expanded-transcript-mode", isExpandedTranscript);
        panel
          .querySelector("#summary-full-view")
          ?.classList.toggle("hidden", !isSummaryMode);
        panel
          .querySelector("#transcript-content")
          ?.classList.toggle("hidden", isSummaryMode);
        panel
          .querySelector("#transcript-actions")
          ?.classList.toggle("hidden", isSummaryMode || !showTranscriptActions);
        panel
          .querySelector("#transcript-footer")
          ?.classList.toggle(
            "hidden",
            isSummaryMode || isExpandedTranscript || !showFooter,
          );
        panel
          .querySelector("#summary-preview")
          ?.classList.toggle(
            "hidden",
            isSummaryMode || isExpandedTranscript || !showPreview,
          );

        if (toggleButton) {
          toggleButton.classList.toggle(
            "hidden",
            isSummaryMode || !showTranscriptActions,
          );
          toggleButton.classList.toggle("active", isExpandedTranscript);
          toggleButton.setAttribute(
            "aria-pressed",
            isExpandedTranscript ? "true" : "false",
          );
          if (typeof options.t === "function") {
            toggleButton.title = options.t(
              isExpandedTranscript
                ? "contentTranscriptCollapse"
                : "contentTranscriptExpand",
            );
          }
        }
      },
    };
  };
})(globalThis);
