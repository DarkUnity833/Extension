(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  function buildSrtMarkup({ unlocked = false }) {
    return `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <span>SRT</span>
    `;
  }

  function getButton(panel, selector) {
    return panel?.querySelector?.(selector) || null;
  }

  function setButtonState(button, { markup, isProLocked = false }) {
    if (!button) return null;
    button.classList.toggle("pro", Boolean(isProLocked));
    button.classList.toggle("unlocked", !isProLocked);
    button.innerHTML = markup;
    return button;
  }

  modules.createActionsToolbar = function createActionsToolbar() {
    return {
      buildSrtMarkup,
      syncProState({
        panel,
        canAccessSRT = false,
      }) {
        const srtButton = getButton(panel, "#btn-download-srt");

        setButtonState(srtButton, {
          markup: buildSrtMarkup({ unlocked: canAccessSRT }),
          isProLocked: !canAccessSRT,
        });

        return {
          srtButton,
        };
      },
    };
  };
})(globalThis);
