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

  function buildToastIcon(type) {
    if (type === "success") {
      return `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 6 9 17l-5-5"/>
        </svg>
      `;
    }

    if (type === "warning") {
      return `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m10.29 3.86-7.5 13A2 2 0 0 0 4.53 20h14.94a2 2 0 0 0 1.74-3.14l-7.5-13a2 2 0 0 0-3.42 0Z"/>
          <path d="M12 9v4"/>
          <path d="M12 17h.01"/>
        </svg>
      `;
    }

    return `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="m15 9-6 6"/>
        <path d="m9 9 6 6"/>
      </svg>
    `;
  }

  function buildMarkup({ type, title, subtitle }) {
    return `
      <span class="toast-icon">${buildToastIcon(type)}</span>
      <div class="toast-content">
        <div class="toast-title">${escapeHtml(title)}</div>
        <div class="toast-subtitle">${escapeHtml(subtitle)}</div>
      </div>
    `;
  }

  modules.createToastView = function createToastView() {
    return {
      escapeHtml,
      buildMarkup,
      show({ document, type, title, subtitle, durationMs = 3000 }) {
        const existing = document.querySelector(".rutube-transcript-toast");
        if (existing) existing.remove();

        const toast = document.createElement("div");
        toast.className = `rutube-transcript-toast ${type}`;
        toast.innerHTML = buildMarkup({ type, title, subtitle });
        document.body.appendChild(toast);

        const hideTimer = setTimeout(() => {
          toast.style.animation = "slideOut 0.3s ease forwards";
          setTimeout(() => toast.remove(), 300);
        }, durationMs);

        return {
          element: toast,
          remove() {
            clearTimeout(hideTimer);
            toast.remove();
          },
        };
      },
    };
  };
})(globalThis);
