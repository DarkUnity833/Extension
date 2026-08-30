(function (global) {
  "use strict";

  const DEFAULT_SITE_BASE_URL = "https://implesol.com";

  function normalizeLifecycleLocale(locale) {
    return String(locale || "")
      .trim()
      .toLowerCase()
      .startsWith("en")
      ? "en"
      : "ru";
  }

  function buildTranscriptLifecyclePath(kind, locale) {
    const normalizedKind = kind === "uninstall" ? "uninstall" : "thank-you";
    const prefix = normalizeLifecycleLocale(locale) === "en" ? "/en" : "";
    return `${prefix}/extensions/transcript/${normalizedKind}`;
  }

  function buildTranscriptLifecycleUrl(kind, options = {}) {
    const locale = normalizeLifecycleLocale(options.locale);
    const url = new URL(
      buildTranscriptLifecyclePath(kind, locale),
      options.baseUrl || DEFAULT_SITE_BASE_URL,
    );

    url.searchParams.set("source", String(options.source || kind));
    url.searchParams.set("product", "transcript-pro");
    url.searchParams.set("locale", locale);

    if (options.version) {
      url.searchParams.set("version", String(options.version));
    }

    const bridgeParams = new URLSearchParams();

    if (options.deviceId) {
      bridgeParams.set("device_id", String(options.deviceId));
    }

    if (options.fingerprint) {
      bridgeParams.set("fingerprint", String(options.fingerprint));
    }

    if (bridgeParams.toString()) {
      url.hash = bridgeParams.toString();
    }

    return url.toString();
  }

  const api = {
    DEFAULT_SITE_BASE_URL,
    normalizeLifecycleLocale,
    buildTranscriptLifecyclePath,
    buildTranscriptLifecycleUrl,
  };

  global.__rutubeTranscriptLifecycleUrls = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
