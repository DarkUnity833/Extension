(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  const THEME_MODES = ["dark", "light"];

  function normalizeThemeMode(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return THEME_MODES.includes(normalized) ? normalized : "";
  }

  function isDarkColor(color) {
    const match = String(color || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!match) return false;
    const [, red, green, blue] = match.map(Number);
    const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
    return luminance < 0.55;
  }

  modules.createThemeController = function createThemeController(deps = {}) {
    const storage = deps.storage || global.chrome?.storage?.local;
    const storageKeys = deps.storageKeys || {};
    let mode = "dark";

    function notify() {
      deps.onStateChange?.(getState());
    }

    async function persist(nextMode) {
      if (!storage?.set || !storageKeys.PANEL_THEME_MODE) return;
      await storage.set({
        [storageKeys.PANEL_THEME_MODE]: nextMode,
      });
    }

    function detectHostTheme() {
      const documentRef = deps.document || global.document;
      const root = documentRef?.documentElement;
      const body = documentRef?.body;
      const candidates = [
        root?.getAttribute?.("data-theme"),
        root?.getAttribute?.("data-mode"),
        body?.getAttribute?.("data-theme"),
      ]
        .map((value) => String(value || "").toLowerCase())
        .filter(Boolean);

      if (candidates.some((value) => value.includes("dark"))) return "dark";
      if (candidates.some((value) => value.includes("light"))) return "light";

      const classNames = [
        root?.className || "",
        body?.className || "",
      ]
        .join(" ")
        .toLowerCase();
      if (/\bdark\b|\btheme-dark\b|\bcolor-mode-dark\b/.test(classNames)) {
        return "dark";
      }
      if (/\blight\b|\btheme-light\b|\bcolor-mode-light\b/.test(classNames)) {
        return "light";
      }

      const backgroundColor = global.getComputedStyle?.(body || root || null)
        ?.backgroundColor;
      return isDarkColor(backgroundColor) ? "dark" : "light";
    }

    function getEffectiveTheme() {
      return mode || detectHostTheme();
    }

    function getState() {
      return {
        mode,
        effectiveTheme: getEffectiveTheme(),
      };
    }

    async function loadPreference() {
      if (!storage?.get || !storageKeys.PANEL_THEME_MODE) return getState();
      const data = await storage.get([storageKeys.PANEL_THEME_MODE]);
      mode =
        normalizeThemeMode(data?.[storageKeys.PANEL_THEME_MODE]) ||
        detectHostTheme();
      notify();
      return getState();
    }

    function applyToPanel(panel) {
      if (!panel) return getState();
      const { effectiveTheme } = getState();
      panel.classList.toggle("theme-dark", effectiveTheme === "dark");
      panel.classList.toggle("theme-light", effectiveTheme === "light");
      panel.dataset.themeMode = mode;
      panel.dataset.themeEffective = effectiveTheme;
      return getState();
    }

    async function setMode(nextMode) {
      mode = normalizeThemeMode(nextMode) || detectHostTheme();
      await persist(mode);
      notify();
      return getState();
    }

    async function cycleMode() {
      const currentIndex = THEME_MODES.indexOf(mode);
      const nextMode =
        THEME_MODES[(currentIndex + 1 + THEME_MODES.length) % THEME_MODES.length];
      return await setMode(nextMode);
    }

    return {
      applyToPanel,
      cycleMode,
      detectAutoTheme: detectHostTheme,
      detectHostTheme,
      getEffectiveTheme,
      getState,
      loadPreference,
      setMode,
    };
  };
})(globalThis);
