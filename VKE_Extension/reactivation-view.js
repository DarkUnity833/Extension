(function (global) {
  "use strict";

  const REACTIVATION_REASONS = new Set(["expired", "cancelled", "past_due"]);

  function normalizeReason(reason) {
    return String(reason || "").trim().toLowerCase();
  }

  function isReactivationReason(reason) {
    return REACTIVATION_REASONS.has(normalizeReason(reason));
  }

  function getReactivationContent({ reason, price, t }) {
    const normalizedReason = normalizeReason(reason);
    const titleKey =
      normalizedReason === "past_due"
        ? "popupSubscriptionPastDueTitle"
        : normalizedReason === "cancelled"
          ? "popupSubscriptionCancelledTitle"
          : "popupSubscriptionExpiredTitle";

    return {
      reason: normalizedReason,
      title: t(titleKey),
      description: t("popupSubscriptionNeedsRenewalDesc"),
      buttonText: t("popupReactivateBtn", [String(price)]),
      buyTitle: t("popupReactivateViewTitle"),
      buySubtitle: t("popupReactivateViewSubtitle"),
      buySubmit: t("popupReactivateSubmit"),
      iconText: normalizedReason === "past_due" ? "!" : "\u21bb",
      tone: normalizedReason === "past_due" ? "warning" : "reactivation",
    };
  }

  const api = {
    getReactivationContent,
    isReactivationReason,
  };

  global.__rutubeTranscriptPopupHelpers = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
