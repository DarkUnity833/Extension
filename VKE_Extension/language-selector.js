(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  const LANGUAGE_OPTIONS = [
    {
      value: "original",
      messageKey: "contentLanguageOriginal",
      shortMessageKey: "contentLanguageShortOriginal",
    },
    {
      value: "en",
      messageKey: "contentLanguageEnglish",
      shortMessageKey: "contentLanguageShortEnglish",
    },
    {
      value: "ru",
      messageKey: "contentLanguageRussian",
      shortMessageKey: "contentLanguageShortRussian",
    },
  ];

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  modules.createLanguageSelector = function createLanguageSelector() {
    return {
      render(
        container,
        {
          t,
          selectedLanguage = "original",
          isLocked = false,
          isLoading = false,
          onChange,
          onLockedClick,
        } = {},
      ) {
        if (!container) return null;

        const optionsMarkup = LANGUAGE_OPTIONS.map((option) => {
          const isSelected = option.value === selectedLanguage;
          const isPremiumOnly = isLocked && option.value !== "original";
          const isLoadingOption =
            isLoading && isSelected && option.value !== "original";
          const title = isPremiumOnly
            ? `${t(option.messageKey)} · ${t("contentLanguageProOnly")}`
            : t(option.messageKey);

          return `
            <button
              type="button"
              class="transcript-language-chip ${isSelected ? "active" : ""} ${isPremiumOnly ? "locked" : ""} ${isLoadingOption ? "loading" : ""}"
              data-language="${option.value}"
              title="${escapeHtml(title)}"
              aria-pressed="${isSelected ? "true" : "false"}"
            >
              ${escapeHtml(t(option.shortMessageKey))}
            </button>
          `;
        }).join("");
        const lockedBadgeMarkup = isLocked
          ? `
            <div class="transcript-language-control-badge" aria-hidden="true">
              Pro
            </div>
          `
          : "";

        container.innerHTML = `
          <div class="transcript-language-control ${isLocked ? "locked" : ""} ${isLoading ? "loading" : ""}" aria-label="${escapeHtml(t("contentLanguageLabel"))}">
            <div class="transcript-language-switch" role="group" aria-label="${escapeHtml(t("contentLanguageLabel"))}">
              ${optionsMarkup}
            </div>
            ${lockedBadgeMarkup}
          </div>
        `;

        const buttons = Array.from(
          container.querySelectorAll?.("[data-language]") || [],
        );
        buttons.forEach((button) => {
          button.addEventListener("click", (event) => {
            event.preventDefault();
            const nextLanguage =
              event?.currentTarget?.dataset?.language || "original";
            if (isLocked && nextLanguage !== "original") {
              onLockedClick?.();
              return;
            }
            onChange?.(nextLanguage);
          });
        });

        return container.firstElementChild;
      },
    };
  };
})(globalThis);
