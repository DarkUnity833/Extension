(function (global) {
  "use strict";

  const DEFAULT_TTL_SECONDS = 3600;

  function isPlainObject(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
  }

  function cloneDeep(value) {
    if (Array.isArray(value)) {
      return value.map((item) => cloneDeep(item));
    }

    if (isPlainObject(value)) {
      return Object.entries(value).reduce((result, [key, nestedValue]) => {
        result[key] = cloneDeep(nestedValue);
        return result;
      }, {});
    }

    return value;
  }

  function deepMerge(baseValue, overrideValue) {
    if (!isPlainObject(baseValue)) {
      return cloneDeep(overrideValue);
    }

    if (!isPlainObject(overrideValue)) {
      return cloneDeep(overrideValue);
    }

    const result = cloneDeep(baseValue);
    Object.entries(overrideValue).forEach(([key, nestedValue]) => {
      if (isPlainObject(nestedValue) && isPlainObject(result[key])) {
        result[key] = deepMerge(result[key], nestedValue);
        return;
      }

      result[key] = cloneDeep(nestedValue);
    });
    return result;
  }

  function normalizeAssignments(rawValue) {
    if (!isPlainObject(rawValue)) return {};

    return Object.entries(rawValue).reduce((result, [key, value]) => {
      const normalizedKey = String(key || "").trim();
      const normalizedValue = String(value || "").trim();
      if (!normalizedKey || !normalizedValue) return result;
      result[normalizedKey] = normalizedValue;
      return result;
    }, {});
  }

  function normalizePayload(rawValue) {
    return isPlainObject(rawValue) ? cloneDeep(rawValue) : {};
  }

  function normalizeRuntimeUiConfig(rawValue = {}) {
    const source = isPlainObject(rawValue) ? rawValue : {};
    const ttlSeconds = Number(source.ttl_seconds ?? source.ttlSeconds);
    const expiresAt = Number(source.expires_at ?? source.expiresAt);

    return {
      version: String(source.version || "").trim(),
      ttl_seconds:
        Number.isFinite(ttlSeconds) && ttlSeconds > 0
          ? Math.round(ttlSeconds)
          : DEFAULT_TTL_SECONDS,
      ttlSeconds:
        Number.isFinite(ttlSeconds) && ttlSeconds > 0
          ? Math.round(ttlSeconds)
          : DEFAULT_TTL_SECONDS,
      assignments: normalizeAssignments(source.assignments),
      payload: normalizePayload(source.payload),
      expires_at:
        Number.isFinite(expiresAt) && expiresAt > 0 ? Math.round(expiresAt) : 0,
      expiresAt:
        Number.isFinite(expiresAt) && expiresAt > 0 ? Math.round(expiresAt) : 0,
    };
  }

  function createEmptyRuntimeUiConfig() {
    return normalizeRuntimeUiConfig({});
  }

  function getSurfaceCopy(config, surfaceName) {
    const normalized = normalizeRuntimeUiConfig(config);
    const surfaceKey = String(surfaceName || "").trim();
    if (!surfaceKey) return {};
    return normalizePayload(normalized.payload[surfaceKey]);
  }

  function getPopupUiCopy(config) {
    return getSurfaceCopy(config, "popup");
  }

  function getPanelUiCopy(config) {
    return getSurfaceCopy(config, "panel");
  }

  function getFeatureConfig(config, featureKey) {
    const features = getSurfaceCopy(config, "features");
    const normalizedKey = String(featureKey || "").trim();
    if (!normalizedKey) return {};
    return normalizePayload(features[normalizedKey]);
  }

  function getLimitConfig(config, limitKey) {
    const limits = getSurfaceCopy(config, "limits");
    const normalizedKey = String(limitKey || "").trim();
    if (!normalizedKey) return {};
    return normalizePayload(limits[normalizedKey]);
  }

  function getPaywallSourceConfig(config, sourceKey) {
    const paywallPayload = getSurfaceCopy(config, "paywall");
    const baseConfig = normalizePayload(paywallPayload.default);
    const normalizedSourceKey = String(sourceKey || "").trim();
    if (!normalizedSourceKey || normalizedSourceKey === "default") {
      return baseConfig;
    }

    const sourceConfig = normalizePayload(paywallPayload[normalizedSourceKey]);
    if (!Object.keys(sourceConfig).length) {
      return baseConfig;
    }
    return deepMerge(baseConfig, sourceConfig);
  }

  function resolvePaywallUiCopy(config, variantKey = "default") {
    const paywallPayload = getSurfaceCopy(config, "paywall");
    const baseCopy = normalizePayload(paywallPayload.default);
    const normalizedVariantKey = String(variantKey || "").trim();

    if (!normalizedVariantKey || normalizedVariantKey === "default") {
      return baseCopy;
    }

    const variantCopy = normalizePayload(paywallPayload[normalizedVariantKey]);
    if (!Object.keys(variantCopy).length) {
      return baseCopy;
    }

    return deepMerge(baseCopy, variantCopy);
  }

  function resolvePaywallExperimentVariant(config, paywallSource = "") {
    const normalized = normalizeRuntimeUiConfig(config);
    const source = String(paywallSource || "").trim();
    const candidateKeys = {
      translation: [
        "translation_paywall_framing_v1",
        "paywall_translation_framing_v1",
        "paywall_task_completion_translation_v1",
      ],
      srt: [
        "srt_paywall_framing_v1",
        "paywall_srt_framing_v1",
        "paywall_task_completion_srt_v1",
      ],
      ai_limit: ["summary_paywall_framing_v1", "paywall_summary_limit_v1"],
      preview_meter: [
        "summary_preview_meter_v1",
        "paywall_preview_meter_v1",
      ],
    }[source] || [];

    for (const key of candidateKeys) {
      const variant = String(normalized.assignments[key] || "").trim();
      if (variant) return variant;
    }

    return "current";
  }

  function getEventExperimentMetadata(config) {
    const normalized = normalizeRuntimeUiConfig(config);
    if (!Object.keys(normalized.assignments).length) {
      return {};
    }

    const metadata = {
      ui_experiments: normalized.assignments,
    };
    if (normalized.version) {
      metadata.ui_experiments_version = normalized.version;
    }
    return metadata;
  }

  global.__rutubeTranscriptRuntimeUi = {
    DEFAULT_TTL_SECONDS,
    cloneDeep,
    createEmptyRuntimeUiConfig,
    deepMerge,
    getEventExperimentMetadata,
    getFeatureConfig,
    getLimitConfig,
    getPanelUiCopy,
    getPaywallSourceConfig,
    getPopupUiCopy,
    getSurfaceCopy,
    isPlainObject,
    normalizeRuntimeUiConfig,
    resolvePaywallExperimentVariant,
    resolvePaywallUiCopy,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.__rutubeTranscriptRuntimeUi;
  }
})(globalThis);
