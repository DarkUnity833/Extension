const t = chrome.i18n.getMessage;
const popupHelpers = globalThis.__rutubeTranscriptPopupHelpers || {
  isReactivationReason: () => false,
  getReactivationContent: () => null,
};
const popupActivityHelpers = globalThis.__rutubeTranscriptPopupActivity || {
  buildHistoryItems: () => [],
  paginateHistoryItems: () => ({
    items: [],
    page: 0,
    totalPages: 1,
    hasPrev: false,
    hasNext: false,
  }),
};
const runtimeUiHelpers = globalThis.__rutubeTranscriptRuntimeUi || {
  createEmptyRuntimeUiConfig: () => ({
    version: "",
    ttl_seconds: 3600,
    ttlSeconds: 3600,
    assignments: {},
    payload: {},
  }),
  getPopupUiCopy: () => ({}),
  normalizeRuntimeUiConfig: (value) => value || {},
};
const POPUP_HISTORY_PAGE_SIZE = 3;
let runtimeUiConfig = runtimeUiHelpers.createEmptyRuntimeUiConfig();
let popupViewTracked = false;

let state = {
  isUnlocked: false,
  isPro: false,
  proReason: null,
  periodEnd: null,
  aiLimit: 30,
  aiUsed: 0,
  srtUnlocked: false,
  email: null,
  price: DEFAULT_PRODUCT_PRICE,
  subscriptionPlans: [],
  subscriptionPlanKey: null,
  canUpgradeToYearly: false,
  pendingSubscriptionId: null,
  pendingSubscriptionOrigin: null,
  trialUsed: 0,
  trialLimit: DEFAULT_TRIAL_LIMIT,
  selectedLanguage: "original",
  panelThemeMode: "dark",
  summaryHistory: [],
  translationHistory: [],
  summaryActivityStats: {},
};
let historyPagination = {
  summary: 0,
  translation: 0,
};
let selectedCheckoutPlanKey = null;
let onboardingTabState = {
  status: "unknown",
};
let onboardingTabCheckInFlight = false;
let onboardingTabRetryTimer = null;
let onboardingTabRetryCount = 0;
const ONBOARDING_TAB_RETRY_LIMIT = 8;
const ONBOARDING_TAB_RETRY_DELAY_MS = 750;

function msg(key, substitutions) {
  return t(key, substitutions) || "";
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getInterfaceLocale() {
  try {
    return chrome.i18n?.getUILanguage?.() || navigator.language || "ru";
  } catch {
    return navigator.language || "ru";
  }
}

function resolveSiteBaseUrl() {
  return "https://extension.implesol.com";
}

function resolvePopupLegalLinks() {
  const locale = String(getInterfaceLocale() || "ru").toLowerCase();
  const localePrefix = locale.startsWith("en") ? "/en" : "";
  const siteBaseUrl = resolveSiteBaseUrl().replace(/\/+$/, "");

  return {
    offerUrl: `${siteBaseUrl}${localePrefix}/offer`,
    privacyUrl: `${siteBaseUrl}${localePrefix}/policy`,
    agreementUrl: `${siteBaseUrl}${localePrefix}/agreement`,
  };
}

function renderBuyConsents() {
  const container = document.getElementById("buy-consents");
  if (!container) return;

  const { offerUrl, privacyUrl, agreementUrl } = resolvePopupLegalLinks();
  container.innerHTML = `
    <div class="popup-consents">
      <label class="popup-consent is-required" data-consent="popup-legal">
        <input type="checkbox" id="buy-legal-consent" checked>
        <span class="popup-consent-text">
          ${escapeHtml(msg("contentPaywallConsentPrefix"))}
          <a class="popup-consent-link" href="${escapeHtml(offerUrl)}" target="_blank" rel="noreferrer noopener">${escapeHtml(msg("contentPaywallConsentOffer"))}</a>,
          <a class="popup-consent-link" href="${escapeHtml(privacyUrl)}" target="_blank" rel="noreferrer noopener">${escapeHtml(msg("contentPaywallConsentPrivacy"))}</a>
          ${escapeHtml(msg("contentPaywallConsentAnd"))}
          <a class="popup-consent-link" href="${escapeHtml(agreementUrl)}" target="_blank" rel="noreferrer noopener">${escapeHtml(msg("contentPaywallConsentAgreement"))}</a>
        </span>
      </label>
      <label class="popup-consent" data-consent="popup-marketing">
        <input type="checkbox" id="buy-marketing-opt-in" checked>
        <span class="popup-consent-text">
          ${escapeHtml(msg("contentPaywallMarketingOptIn"))}
        </span>
      </label>
    </div>
  `;
}

function applyProStatusToState(targetState, result = {}) {
  targetState.isPro = result.is_pro;
  targetState.proReason = result.reason;
  targetState.periodEnd = result.current_period_end;
  targetState.aiLimit =
    result.ai_summary_limit_monthly ?? targetState.aiLimit;
  targetState.aiUsed =
    result.ai_summary_used_this_period ?? targetState.aiUsed;
  targetState.srtUnlocked = result.srt_unlocked;
  targetState.price = result.subscription_price_rub ?? targetState.price;
  targetState.subscriptionPlans = Array.isArray(result.subscription_plans)
    ? result.subscription_plans
    : targetState.subscriptionPlans;
  targetState.subscriptionPlanKey = result.subscription_plan_key || null;
  targetState.canUpgradeToYearly = result.can_upgrade_to_yearly === true;
  return targetState;
}

function normalizeSubscriptionPlans(plans, fallbackPrice = DEFAULT_PRODUCT_PRICE) {
  if (!Array.isArray(plans) || plans.length === 0) {
    return [
      {
        key: "monthly",
        price_rub: Number(fallbackPrice) || DEFAULT_PRODUCT_PRICE,
        billing_period: "month",
        is_default: false,
        is_recommended: false,
      },
      {
        key: "yearly",
        price_rub: DEFAULT_YEARLY_PRODUCT_PRICE,
        billing_period: "year",
        is_default: true,
        is_recommended: true,
      },
    ];
  }

  return plans.map((plan) => ({
    key: plan?.key === "yearly" ? "yearly" : "monthly",
    price_rub:
      Number(plan?.price_rub) ||
      (plan?.key === "yearly"
        ? DEFAULT_YEARLY_PRODUCT_PRICE
        : Number(fallbackPrice) || DEFAULT_PRODUCT_PRICE),
    billing_period: plan?.billing_period === "year" ? "year" : "month",
    is_default: Boolean(plan?.is_default),
    is_recommended: Boolean(plan?.is_recommended),
  }));
}

function getYearlyMonthlyEquivalentPrice(plan = null) {
  const price = Number(plan?.price_rub) || DEFAULT_YEARLY_PRODUCT_PRICE;
  return Math.ceil(price / 12) || DEFAULT_YEARLY_MONTHLY_PRICE;
}

function getPrimaryCtaMonthlyPrice() {
  const plans = normalizeSubscriptionPlans(state.subscriptionPlans, state.price);
  const yearlyPlan =
    plans.find((plan) => plan.key === "yearly" && plan.is_recommended) ||
    plans.find((plan) => plan.key === "yearly");
  if (!yearlyPlan) return DEFAULT_YEARLY_MONTHLY_PRICE;
  return getYearlyMonthlyEquivalentPrice(yearlyPlan);
}

function isYearlyUpgradeFlow() {
  return (
    state.isPro === true &&
    state.subscriptionPlanKey === "monthly" &&
    state.canUpgradeToYearly === true
  );
}

function getBuyableSubscriptionPlans() {
  const plans = normalizeSubscriptionPlans(state.subscriptionPlans, state.price);
  if (isYearlyUpgradeFlow()) {
    return plans.filter((plan) => plan.key === "yearly");
  }
  return plans;
}

function resolveDefaultCheckoutPlanKey() {
  const plans = getBuyableSubscriptionPlans();
  if (plans.length === 0) return "monthly";
  const explicitDefault = plans.find((plan) => plan.is_default);
  if (explicitDefault) return explicitDefault.key;
  const recommended = plans.find((plan) => plan.is_recommended);
  if (recommended) return recommended.key;
  return plans[0].key;
}

function ensureSelectedCheckoutPlanKey() {
  const plans = getBuyableSubscriptionPlans();
  if (!plans.some((plan) => plan.key === selectedCheckoutPlanKey)) {
    selectedCheckoutPlanKey = resolveDefaultCheckoutPlanKey();
  }
  return selectedCheckoutPlanKey;
}

function getSelectedCheckoutPlan() {
  const selectedKey = ensureSelectedCheckoutPlanKey();
  return (
    getBuyableSubscriptionPlans().find((plan) => plan.key === selectedKey) ||
    null
  );
}

function formatPlanPriceLabel(plan) {
  if (!plan) return "";
  const amount = Number(plan.price_rub) || 0;
  if (plan.billing_period === "year") {
    const suffix = msg("popupPlanPerMonth");
    return `${getYearlyMonthlyEquivalentPrice(plan)} \u20BD${suffix ? ` ${suffix}` : ""}`.trim();
  }
  const suffix =
    plan.billing_period === "year"
      ? msg("popupPlanPerYear")
      : msg("popupPlanPerMonth");
  return `${amount} \u20BD${suffix ? ` ${suffix}` : ""}`.trim();
}

function formatPlanSecondaryPriceLabel(plan) {
  if (!plan || plan.billing_period !== "year") return "";
  const amount = Number(plan.price_rub) || DEFAULT_YEARLY_PRODUCT_PRICE;
  const suffix = msg("popupPlanPerYear");
  return `${amount} \u20BD${suffix ? ` ${suffix}` : ""}`.trim();
}

function renderBuyPlanSelector() {
  const container = document.getElementById("buy-plan-selector");
  if (!container) return;

  const plans = getBuyableSubscriptionPlans();
  if (plans.length === 0) {
    container.innerHTML = "";
    container.classList.add("hidden");
    return;
  }

  const selectedKey = ensureSelectedCheckoutPlanKey();
  container.classList.remove("hidden");
  container.innerHTML = plans
    .map((plan) => {
      const isSelected = plan.key === selectedKey;
      const badge = plan.is_recommended
        ? `<div class="popup-plan-badge">${escapeHtml(msg("popupPlanRecommended"))}</div>`
        : "";
      const secondaryPrice = formatPlanSecondaryPriceLabel(plan);
      return `
        <button
          type="button"
          class="popup-plan-card${isSelected ? " active" : ""}"
          data-plan-key="${escapeHtml(plan.key)}"
        >
          ${badge}
          <div class="popup-plan-copy">
            <div class="popup-plan-label">${escapeHtml(
              plan.key === "yearly"
                ? msg("popupPlanYearly")
                : msg("popupPlanMonthly"),
            )}</div>
            <div class="popup-plan-price-block">
              <div class="popup-plan-price">${escapeHtml(formatPlanPriceLabel(plan))}</div>
              ${
                secondaryPrice
                  ? `<div class="popup-plan-secondary-price">${escapeHtml(secondaryPrice)}</div>`
                  : ""
              }
            </div>
          </div>
          <span class="popup-plan-radio" aria-hidden="true"></span>
        </button>
      `;
    })
    .join("");

  container.querySelectorAll("[data-plan-key]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedCheckoutPlanKey = button.dataset.planKey || resolveDefaultCheckoutPlanKey();
      renderBuyPlanSelector();
      syncBuyViewCopy();
    });
  });
}

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const value = msg(element.dataset.i18n);
    if (value) element.textContent = value;
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    const value = msg(element.dataset.i18nPlaceholder);
    if (value) element.placeholder = value;
  });
}

function getPopupRuntimeCopy() {
  return runtimeUiHelpers.getPopupUiCopy(runtimeUiConfig);
}

function setElementText(id, value) {
  const element = document.getElementById(id);
  if (!element || !String(value || "").trim()) return;
  element.textContent = String(value).trim();
}

function setSelectorText(selector, value) {
  const element = document.querySelector(selector);
  if (!element || !String(value || "").trim()) return;
  element.textContent = String(value).trim();
}

function applyPopupRuntimeCopy() {
  const popupCopy = getPopupRuntimeCopy();

  setElementText("popup-status-title", popupCopy.status_title);
  setElementText("popup-status-desc", popupCopy.status_desc);
  setElementText("btn-open-panel", popupCopy.onboarding_button);
  setElementText("buy-view-title", popupCopy.buy_title);
  setElementText("buy-view-subtitle", popupCopy.buy_subtitle);
  setElementText("btn-pay", popupCopy.buy_submit);

  setSelectorText(
    '[data-i18n="popupOnboardingLabel"]',
    popupCopy.onboarding_label || msg("popupOnboardingLabel"),
  );
  setSelectorText(
    '[data-i18n="popupOnboardingTitle"]',
    popupCopy.onboarding_title || msg("popupOnboardingTitle"),
  );
  setSelectorText(
    '[data-i18n="popupOnboardingDesc"]',
    popupCopy.onboarding_desc || msg("popupOnboardingDesc"),
  );
  setSelectorText(
    '[data-i18n="popupOnboardingHint"]',
    popupCopy.onboarding_hint || msg("popupOnboardingHint"),
  );
}

function isReactivationFlow(reason = state.proReason) {
  return popupHelpers.isReactivationReason(reason);
}

function getReactivationContent() {
  if (!isReactivationFlow()) return null;
  return popupHelpers.getReactivationContent({
    reason: state.proReason,
    price: getPrimaryCtaMonthlyPrice(),
    t: msg,
  });
}

function getBuyViewContent() {
  const reactivationContent = getReactivationContent();
  if (reactivationContent) {
    return {
      title: reactivationContent.buyTitle,
      subtitle: reactivationContent.buySubtitle,
      submit: reactivationContent.buySubmit,
    };
  }

  if (isYearlyUpgradeFlow()) {
    return {
      title: msg("popupUpgradeViewTitle"),
      subtitle: msg("popupUpgradeViewSubtitle"),
      submit: msg("popupUpgradeSubmit"),
    };
  }

  const popupCopy = getPopupRuntimeCopy();
  return {
    title: popupCopy.buy_title || msg("popupBuyViewTitle"),
    subtitle: popupCopy.buy_subtitle || msg("popupBuyViewSubtitle"),
    submit: popupCopy.buy_submit || msg("popupBuySubmit"),
  };
}

function syncBuyViewCopy() {
  const content = getBuyViewContent();
  const buyTitle = document.getElementById("buy-view-title");
  const buySubtitle = document.getElementById("buy-view-subtitle");
  const payButton = document.getElementById("btn-pay");

  if (buyTitle) buyTitle.textContent = content.title;
  if (buySubtitle) buySubtitle.textContent = content.subtitle;
  if (payButton && !payButton.disabled) {
    payButton.textContent = content.submit;
  }
}

function setStatusCard({ title, description, tone = "" }) {
  const card = document.getElementById("popup-status-card");
  const titleElement = document.getElementById("popup-status-title");
  const descElement = document.getElementById("popup-status-desc");
  if (!card || !titleElement || !descElement) return;

  card.classList.remove("tone-success", "tone-warning", "tone-reactivation");
  if (tone) card.classList.add(`tone-${tone}`);
  titleElement.textContent = title;
  descElement.textContent = description;
}

function toggleCancelSubscriptionLink(show) {
  const cancelBtn = document.getElementById("btn-cancel-sub");
  const cancelSep = document.getElementById("cancel-sep");
  if (cancelBtn) cancelBtn.classList.toggle("hidden", !show);
  if (cancelSep) cancelSep.classList.toggle("hidden", !show);
}

function hasCancelableSubscription() {
  if (!state.isPro || !state.email) return false;

  const reason = String(state.proReason || "")
    .trim()
    .toLowerCase();

  if (
    reason.includes("promo") ||
    reason.includes("gift") ||
    reason.includes("license") ||
    reason.includes("trial") ||
    reason.includes("srt") ||
    reason.includes("cancel")
  ) {
    return false;
  }

  if (
    reason === "subscription" ||
    reason === "pro" ||
    reason.includes("subscription") ||
    reason.includes("active") ||
    reason.includes("paid")
  ) {
    return true;
  }

  return Boolean(state.periodEnd);
}

function setMainActions({
  visible,
  primaryText = "",
  showSecondary = true,
}) {
  const actions = document.getElementById("free-actions");
  const subscribeBtn = document.getElementById("btn-subscribe");
  const restoreBtn = document.getElementById("btn-restore");

  if (actions) actions.classList.toggle("hidden", !visible);
  if (subscribeBtn && primaryText) subscribeBtn.textContent = primaryText;
  if (restoreBtn) restoreBtn.classList.toggle("hidden", !showSecondary);
}

function getSubscriptionEntryPoint() {
  if (isYearlyUpgradeFlow()) return "popup_upgrade_yearly";
  return isReactivationFlow() ? "popup_reactivation" : "legacy";
}

function getPopupViewState() {
  const isPartialUnlock = !state.isPro && (state.srtUnlocked || state.isUnlocked);
  if (state.isPro) return "pro";
  if (isReactivationFlow()) return "reactivation";
  if (isPartialUnlock) return "partial_unlock";
  return "free";
}

function trackPopupViewed() {
  try {
    chrome.runtime.sendMessage({
      action: "trackEvent",
      eventType: "popup_viewed",
      eventData: {
        popup_state: getPopupViewState(),
        is_pro: Boolean(state.isPro),
      },
    });
  } catch (error) {
    console.error("Popup viewed track error:", error);
  }
}

function trackPopupViewedOnce() {
  if (popupViewTracked) return;
  popupViewTracked = true;
  trackPopupViewed();
}

function buildFreeStatusDescription() {
  const popupCopy = getPopupRuntimeCopy();
  if (popupCopy.free_status_desc || popupCopy.status_desc) {
    return String(popupCopy.free_status_desc || popupCopy.status_desc).trim();
  }

  const remaining = Math.max(0, Number(state.trialLimit || 0) - Number(state.trialUsed || 0));
  const trialText =
    remaining > 0
      ? msg("popupStatsTrialHint", [String(remaining)])
      : msg("popupStatsTrialExhausted");

  return `${msg("popupStatusFreeDesc")} ${trialText}`.trim();
}

function shouldShowOnboarding() {
  return !Boolean(state.isPro);
}

function isLikelyVideoPageUrl(rawUrl = "") {
  try {
    const url = new URL(String(rawUrl || ""));
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname || "";

    if (
      hostname === "youtube.com" ||
      hostname === "www.youtube.com" ||
      hostname === "m.youtube.com"
    ) {
      return (
        (pathname === "/watch" && Boolean(url.searchParams.get("v"))) ||
        /^\/shorts\/[^/?#]+/.test(pathname)
      );
    }

    if (hostname === "rutube.ru" || hostname.endsWith(".rutube.ru")) {
      return /^\/video\/[a-zA-Z0-9]+/.test(pathname);
    }

    if (hostname === "vkvideo.ru" || hostname.endsWith(".vkvideo.ru")) {
      return /^\/video-?\d+_\d+/.test(pathname);
    }
  } catch {
    return false;
  }

  return false;
}

function setOnboardingFeedback(message = "", tone = "") {
  const feedback = document.getElementById("popup-onboarding-feedback");
  if (!feedback) return;

  feedback.classList.remove("tone-error", "tone-warning");
  feedback.textContent = String(message || "").trim();
  feedback.classList.toggle("hidden", !feedback.textContent);
  if (tone) feedback.classList.add(`tone-${tone}`);
}

function renderOnboardingTabState() {
  const status = onboardingTabState.status || "unknown";
  const button = document.getElementById("btn-open-panel");
  const links = document.getElementById("popup-onboarding-links");
  const isReady = status === "ready";
  const isChecking = status === "unknown" || status === "checking";

  setSelectorText(
    '[data-i18n="popupOnboardingTitle"]',
    isReady
      ? msg("popupOnboardingVideoReadyTitle")
      : isChecking
        ? msg("popupOnboardingTitle")
        : msg("popupOnboardingNoVideoTitle"),
  );
  setSelectorText(
    '[data-i18n="popupOnboardingDesc"]',
    isReady
      ? msg("popupOnboardingVideoReadyDesc")
      : isChecking
        ? msg("popupOnboardingDesc")
        : msg("popupOnboardingNoVideoDesc"),
  );
  setSelectorText(
    '[data-i18n="popupOnboardingHint"]',
    isReady
      ? msg("popupOnboardingVideoReadyHint")
      : isChecking
        ? msg("popupOnboardingHint")
        : msg("popupOnboardingNoVideoHint"),
  );

  if (button) {
    button.disabled = !isReady;
    button.textContent = isReady
      ? msg("popupOnboardingOpenButton")
      : isChecking
        ? msg("popupOnboardingChecking")
        : msg("popupOnboardingNoVideoButton");
  }
  links?.classList.toggle("hidden", isReady || isChecking);
}

function clearOnboardingTabRetry() {
  if (!onboardingTabRetryTimer) return;
  clearTimeout(onboardingTabRetryTimer);
  onboardingTabRetryTimer = null;
}

function scheduleOnboardingTabRetry(tabUrl = "") {
  if (!shouldShowOnboarding()) return;
  if (tabUrl && !isLikelyVideoPageUrl(tabUrl)) return;
  if (onboardingTabRetryCount >= ONBOARDING_TAB_RETRY_LIMIT) return;
  clearOnboardingTabRetry();
  onboardingTabRetryCount += 1;
  onboardingTabRetryTimer = setTimeout(() => {
    onboardingTabRetryTimer = null;
    void refreshOnboardingTabState({ force: true, silent: true });
  }, ONBOARDING_TAB_RETRY_DELAY_MS);
}

async function refreshOnboardingTabState(options = {}) {
  if (!shouldShowOnboarding() || onboardingTabCheckInFlight) return;
  const currentStatus = onboardingTabState.status || "unknown";
  if (!options.force && currentStatus !== "unknown") return;

  onboardingTabCheckInFlight = true;
  if (!options.silent) {
    onboardingTabState = { status: "checking" };
    renderOnboardingTabState();
  }

  let tabUrl = "";
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) {
      onboardingTabState = { status: "unavailable" };
      return;
    }
    tabUrl = String(tab.url || "").trim();
    if (tabUrl && !isLikelyVideoPageUrl(tabUrl)) {
      onboardingTabRetryCount = 0;
      clearOnboardingTabRetry();
      onboardingTabState = { status: "unavailable" };
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      action: "getPanelAvailability",
    });
    onboardingTabState = {
      status: response?.canOpen ? "ready" : "unavailable",
    };
    if (response?.canOpen) {
      onboardingTabRetryCount = 0;
      clearOnboardingTabRetry();
    } else {
      scheduleOnboardingTabRetry(tabUrl);
    }
  } catch {
    onboardingTabState = { status: "unavailable" };
    scheduleOnboardingTabRetry(tabUrl);
  } finally {
    onboardingTabCheckInFlight = false;
    renderOnboardingTabState();
  }
}

function updateOnboardingUI() {
  const onboardingCard = document.getElementById("popup-onboarding");
  const popupRoot = document.querySelector(".popup");
  const showOnboarding = shouldShowOnboarding();

  if (onboardingCard) onboardingCard.classList.toggle("hidden", !showOnboarding);
  popupRoot?.classList.toggle("popup-onboarding-active", showOnboarding);
  if (showOnboarding) {
    renderOnboardingTabState();
    void refreshOnboardingTabState();
  } else {
    setOnboardingFeedback("");
  }
}

function sanitizeFilenamePart(value, fallback = "video") {
  const normalized = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function formatHistoryTime(seconds) {
  const safeValue = Number(seconds) || 0;
  const hours = Math.floor(safeValue / 3600);
  const minutes = Math.floor((safeValue % 3600) / 60);
  const secs = Math.floor(safeValue % 60);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function triggerPopupDownload({ content = "", filename = "download.txt", type = "text/plain" } = {}) {
  const safeContent = String(content || "");
  if (!safeContent.trim()) return false;

  const blob = new Blob([safeContent], {
    type: `${type};charset=utf-8`,
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  return true;
}

function buildSummaryHistoryDownload(rawItem = {}) {
  const summaryText = String(
    rawItem?.summaryText || rawItem?.summary_text || "",
  ).trim();
  if (!summaryText) return null;

  const title =
    String(rawItem?.videoTitle || rawItem?.video_title || "").trim() ||
    msg("popupHistoryUntitled");
  const videoUrl = String(rawItem?.videoUrl || rawItem?.video_url || "").trim();
  const divider = "=".repeat(Math.min(title.length, 50));
  const fileSafeTitle = sanitizeFilenamePart(
    rawItem?.videoTitle || rawItem?.video_title || rawItem?.videoId,
    "summary",
  );

  return {
    filename: `${fileSafeTitle}_summary.txt`,
    content: `${title}\n${divider}\n\n${videoUrl ? `${videoUrl}\n\n` : ""}${summaryText}\n`,
    type: "text/plain",
  };
}

function buildTranslationHistoryDownload(rawItem = {}) {
  const subtitles = Array.isArray(rawItem?.translatedSubtitles)
    ? rawItem.translatedSubtitles
    : Array.isArray(rawItem?.translated_subtitles)
      ? rawItem.translated_subtitles
      : [];
  if (subtitles.length === 0) return null;

  const filePrefix = sanitizeFilenamePart(
    rawItem?.platform || "transcript",
    "transcript",
  );
  const title =
    String(rawItem?.videoTitle || rawItem?.video_title || "").trim() ||
    msg("popupHistoryUntitled");
  const videoUrl = String(rawItem?.videoUrl || rawItem?.video_url || "").trim();
  const divider = "=".repeat(Math.min(title.length, 50));
  const fileSafeTitle = sanitizeFilenamePart(
    rawItem?.videoTitle || rawItem?.video_title || rawItem?.videoId,
    "translation",
  );
  const content = subtitles
    .map((cue) => {
      return `${formatHistoryTime(cue?.start)} ${String(cue?.text || "").trim()}`;
    })
    .join("\n");

  return {
    filename: `${filePrefix}_${fileSafeTitle}.txt`,
    content: `${title}\n${divider}\n\n${videoUrl ? `${videoUrl}\n\n` : ""}${content}\n`,
    type: "text/plain",
  };
}

function getHistoryDownloadLabel(downloadType) {
  if (downloadType === "translation") {
    return msg("popupHistoryDownloadTranslation");
  }
  if (downloadType === "summary") {
    return msg("popupHistoryDownloadSummary");
  }
  return msg("popupHistoryDownloadUnavailable");
}

function downloadHistoryEntry(item) {
  const payload =
    item?.downloadType === "translation"
      ? buildTranslationHistoryDownload(item?.rawItem)
      : item?.downloadType === "summary"
        ? buildSummaryHistoryDownload(item?.rawItem)
        : null;

  if (!payload) {
    showError(msg("popupHistoryDownloadUnavailable"));
    return false;
  }

  const downloaded = triggerPopupDownload(payload);
  if (downloaded) {
    showInfo(msg("contentDownloaded"));
  } else {
    showError(msg("popupHistoryDownloadUnavailable"));
  }
  return downloaded;
}

function getHistoryTextArtifact(item) {
  const rawItem = item?.rawItem || {};
  if (item?.downloadType === "translation") {
    const subtitles = Array.isArray(rawItem?.translatedSubtitles)
      ? rawItem.translatedSubtitles
      : Array.isArray(rawItem?.translated_subtitles)
        ? rawItem.translated_subtitles
        : [];
    const content = subtitles
      .map((cue) => `${formatHistoryTime(cue?.start)} ${String(cue?.text || "").trim()}`)
      .filter((line) => line.trim())
      .join("\n");
    if (!content.trim()) return null;
    return {
      type: "translation",
      content_text: content,
      metadata_json: {
        cue_count: subtitles.length,
      },
    };
  }

  const summaryText = String(rawItem?.summaryText || rawItem?.summary_text || "").trim();
  if (!summaryText) return null;
  return {
    type: "summary",
    content_text: summaryText,
    metadata_json: {
      summary_type: rawItem?.summaryType || rawItem?.summary_type || "full",
    },
  };
}

function buildHistoryArchivePayload(item) {
  const rawItem = item?.rawItem || {};
  const artifact = getHistoryTextArtifact(item);
  if (!artifact) return null;

  const language = String(rawItem?.language || "original").trim() || "original";
  const title =
    String(rawItem?.videoTitle || rawItem?.video_title || "").trim() ||
    item?.title ||
    msg("popupHistoryUntitled");
  const videoUrl = String(rawItem?.videoUrl || rawItem?.video_url || "").trim();
  const platform = String(rawItem?.platform || "").trim().toLowerCase();
  const videoId = String(rawItem?.videoId || rawItem?.video_id || "").trim();

  return {
    source_kind:
      item?.downloadType === "translation"
        ? "extension_translation"
        : "extension_summary",
    title,
    source_url: videoUrl || undefined,
    platform: platform || undefined,
    external_id: videoId || undefined,
    language,
    status: "saved",
    metadata_json: {
      source: "popup_history",
      requested_at: rawItem?.requestedAt || rawItem?.requested_at || null,
      download_type: item?.downloadType || null,
    },
    artifacts: [
      {
        ...artifact,
        language,
      },
    ],
  };
}

async function saveHistoryEntryToArchive(item, button) {
  const payload = buildHistoryArchivePayload(item);
  if (!payload) {
    showError(msg("popupHistoryArchiveUnavailable"));
    return false;
  }

  if (button) button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      action: "saveArchiveMaterial",
      payload,
    });
    if (response?.error) throw new Error(response.error);
    if (response?.pairing_required) {
      showInfo(msg("popupHistoryArchivePairingStarted"));
    } else {
      showInfo(msg("popupHistoryArchiveSaved"));
    }
    return true;
  } catch (error) {
    showError(error?.message || msg("popupHistoryArchiveFailed"));
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}

function clampHistoryPage(key, items = []) {
  const totalPages = Math.max(
    1,
    Math.ceil((Array.isArray(items) ? items.length : 0) / POPUP_HISTORY_PAGE_SIZE) ||
      1,
  );
  historyPagination[key] = Math.min(
    Math.max(0, Number(historyPagination[key]) || 0),
    totalPages - 1,
  );
  return historyPagination[key];
}

function buildPageIndicator(page, totalPages) {
  return (
    msg("popupHistoryPageLabel", [String(page + 1), String(totalPages)]) ||
    `${page + 1} / ${totalPages}`
  );
}

function renderHistorySection({
  items,
  historyType = "all",
  sectionId,
  listId,
  emptyId,
  paginationId,
  pageIndicatorId,
  prevButtonId,
  nextButtonId,
  paginationKey,
  visible = true,
}) {
  const section = document.getElementById(sectionId);
  const list = document.getElementById(listId);
  const emptyState = document.getElementById(emptyId);
  const pagination = document.getElementById(paginationId);
  const pageIndicator = document.getElementById(pageIndicatorId);
  const prevButton = document.getElementById(prevButtonId);
  const nextButton = document.getElementById(nextButtonId);

  if (!section || !list || !emptyState || !pagination || !pageIndicator) return;

  section.classList.toggle("hidden", !visible);
  if (!visible) return;

  const builtItems = popupActivityHelpers.buildHistoryItems({
    entries: items,
    historyType,
    t: msg,
    now: Date.now(),
  });
  const page = clampHistoryPage(paginationKey, builtItems);
  const pageState = popupActivityHelpers.paginateHistoryItems(
    builtItems,
    page,
    POPUP_HISTORY_PAGE_SIZE,
  );

  list.innerHTML = "";
  pageState.items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "popup-history-item";

    const entry = document.createElement(item.url ? "a" : "div");
    entry.className = "popup-history-item-link";
    if (item.url) {
      entry.href = item.url;
      entry.target = "_blank";
      entry.rel = "noreferrer noopener";
    }
    entry.innerHTML = `
      <div class="popup-history-item-title">${escapeHtml(item.title)}</div>
      <div class="popup-history-item-meta">${escapeHtml(item.meta)}</div>
    `;

    const downloadButton = document.createElement("button");
    downloadButton.type = "button";
    downloadButton.className = "popup-history-download popup-history-file-download";
    downloadButton.title = getHistoryDownloadLabel(item.downloadType);
    downloadButton.setAttribute("aria-label", getHistoryDownloadLabel(item.downloadType));
    downloadButton.innerHTML = `
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M8 2.25a.75.75 0 0 1 .75.75v5.19l1.72-1.72a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 1 1 1.06-1.06l1.72 1.72V3A.75.75 0 0 1 8 2.25ZM3.5 11.5a.75.75 0 0 1 .75.75v.25h7.5v-.25a.75.75 0 0 1 1.5 0v1A.75.75 0 0 1 12.5 14h-9a.75.75 0 0 1-.75-.75v-1a.75.75 0 0 1 .75-.75Z"></path>
      </svg>
    `;
    if (!item.downloadType) {
      downloadButton.disabled = true;
    } else {
      downloadButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        downloadHistoryEntry(item);
      });
    }

    const archiveButton = document.createElement("button");
    archiveButton.type = "button";
    archiveButton.className = "popup-history-download popup-history-archive";
    archiveButton.title = msg("popupHistoryArchiveSave");
    archiveButton.setAttribute("aria-label", msg("popupHistoryArchiveSave"));
    archiveButton.innerHTML = `
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M4.75 2A1.75 1.75 0 0 0 3 3.75v8.89c0 1.02 1.17 1.59 1.98.97L8 11.29l3.02 2.32c.81.62 1.98.05 1.98-.97V3.75A1.75 1.75 0 0 0 11.25 2h-6.5Zm-.25 1.75c0-.14.11-.25.25-.25h6.5c.14 0 .25.11.25.25v8.38l-2.59-1.99a1.5 1.5 0 0 0-1.82 0L4.5 12.13V3.75Z"></path>
      </svg>
    `;
    if (!getHistoryTextArtifact(item)) {
      archiveButton.disabled = true;
    } else {
      archiveButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void saveHistoryEntryToArchive(item, archiveButton);
      });
    }

    row.append(entry, archiveButton, downloadButton);
    list.appendChild(row);
  });

  const isEmpty = builtItems.length === 0;
  list.classList.toggle("hidden", isEmpty);
  emptyState.classList.toggle("hidden", !isEmpty);
  pagination.classList.toggle("hidden", builtItems.length <= POPUP_HISTORY_PAGE_SIZE);
  pageIndicator.textContent = buildPageIndicator(
    pageState.page,
    pageState.totalPages,
  );

  if (prevButton) prevButton.disabled = !pageState.hasPrev;
  if (nextButton) nextButton.disabled = !pageState.hasNext;
}

function renderHistorySections() {
  const shouldRenderStack =
    ((Array.isArray(state.summaryHistory) && state.summaryHistory.length > 0) ||
      (Array.isArray(state.translationHistory) &&
        state.translationHistory.length > 0));

  document
    .getElementById("popup-history-stack")
    ?.classList.toggle("hidden", !shouldRenderStack);
  document
    .querySelector(".popup")
    ?.classList.toggle("popup-pro-history", shouldRenderStack);

  renderHistorySection({
    items: state.summaryHistory,
    historyType: "summary",
    sectionId: "popup-summary-history-section",
    listId: "popup-summary-history-list",
    emptyId: "popup-summary-history-empty",
    paginationId: "popup-summary-history-pagination",
    pageIndicatorId: "popup-summary-page-indicator",
    prevButtonId: "popup-summary-prev",
    nextButtonId: "popup-summary-next",
    paginationKey: "summary",
    visible:
      shouldRenderStack &&
      Array.isArray(state.summaryHistory) &&
      state.summaryHistory.length > 0,
  });

  renderHistorySection({
    items: state.translationHistory,
    historyType: "translation",
    sectionId: "popup-translation-history-section",
    listId: "popup-translation-history-list",
    emptyId: "popup-translation-history-empty",
    paginationId: "popup-translation-history-pagination",
    pageIndicatorId: "popup-translation-page-indicator",
    prevButtonId: "popup-translation-prev",
    nextButtonId: "popup-translation-next",
    paginationKey: "translation",
    visible:
      shouldRenderStack &&
      Array.isArray(state.translationHistory) &&
      state.translationHistory.length > 0,
  });
}

async function init() {
  await restoreEnabledStateIfNeeded();
  await loadRuntimeUiConfig();
  await loadState();
  updateUI();
  setupEventListeners();
  await forceRefreshProStatus();
  trackPopupViewedOnce();
}

async function loadRuntimeUiConfig() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: "getRuntimeUiConfig",
    });
    runtimeUiConfig = runtimeUiHelpers.normalizeRuntimeUiConfig(response);
  } catch (error) {
    runtimeUiConfig = runtimeUiHelpers.createEmptyRuntimeUiConfig();
  }
}

async function loadState() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.IS_UNLOCKED,
    STORAGE_KEYS.EMAIL,
    STORAGE_KEYS.PRODUCT_PRICE,
    STORAGE_KEYS.PENDING_PURCHASE_ID,
    STORAGE_KEYS.IS_PRO,
    STORAGE_KEYS.PRO_REASON,
    STORAGE_KEYS.PRO_PERIOD_END,
    STORAGE_KEYS.AI_LIMIT,
    STORAGE_KEYS.AI_USED,
    STORAGE_KEYS.SRT_UNLOCKED,
    STORAGE_KEYS.SUBSCRIPTION_PRICE,
    STORAGE_KEYS.SUBSCRIPTION_PLANS,
    STORAGE_KEYS.SUBSCRIPTION_PLAN_KEY,
    STORAGE_KEYS.CAN_UPGRADE_TO_YEARLY,
    STORAGE_KEYS.PENDING_SUBSCRIPTION_ID,
    STORAGE_KEYS.PENDING_SUBSCRIPTION_ORIGIN,
    STORAGE_KEYS.TRIAL_USED,
    STORAGE_KEYS.TRIAL_LIMIT,
    STORAGE_KEYS.SELECTED_LANGUAGE,
    STORAGE_KEYS.PANEL_THEME_MODE,
    STORAGE_KEYS.SUMMARY_HISTORY,
    STORAGE_KEYS.SUMMARY_ACTIVITY_STATS,
    STORAGE_KEYS.TRANSLATION_HISTORY,
  ]);

  state = {
    isUnlocked: data[STORAGE_KEYS.IS_UNLOCKED] || false,
    isPro: data[STORAGE_KEYS.IS_PRO] || false,
    proReason: data[STORAGE_KEYS.PRO_REASON] || null,
    periodEnd: data[STORAGE_KEYS.PRO_PERIOD_END] || null,
    aiLimit: data[STORAGE_KEYS.AI_LIMIT] || 30,
    aiUsed: data[STORAGE_KEYS.AI_USED] || 0,
    srtUnlocked: data[STORAGE_KEYS.SRT_UNLOCKED] || false,
    email: data[STORAGE_KEYS.EMAIL] || null,
    price:
      data[STORAGE_KEYS.SUBSCRIPTION_PRICE] ||
      data[STORAGE_KEYS.PRODUCT_PRICE] ||
      DEFAULT_PRODUCT_PRICE,
    subscriptionPlans: normalizeSubscriptionPlans(
      data[STORAGE_KEYS.SUBSCRIPTION_PLANS],
      data[STORAGE_KEYS.SUBSCRIPTION_PRICE] ||
        data[STORAGE_KEYS.PRODUCT_PRICE] ||
        DEFAULT_PRODUCT_PRICE,
    ),
    subscriptionPlanKey: data[STORAGE_KEYS.SUBSCRIPTION_PLAN_KEY] || null,
    canUpgradeToYearly:
      data[STORAGE_KEYS.CAN_UPGRADE_TO_YEARLY] === true,
    pendingSubscriptionId: data[STORAGE_KEYS.PENDING_SUBSCRIPTION_ID] || null,
    pendingSubscriptionOrigin:
      data[STORAGE_KEYS.PENDING_SUBSCRIPTION_ORIGIN] || null,
    trialUsed: data[STORAGE_KEYS.TRIAL_USED] || 0,
    trialLimit: data[STORAGE_KEYS.TRIAL_LIMIT] || DEFAULT_TRIAL_LIMIT,
    selectedLanguage: data[STORAGE_KEYS.SELECTED_LANGUAGE] || "original",
    panelThemeMode: data[STORAGE_KEYS.PANEL_THEME_MODE] || "dark",
    summaryHistory: Array.isArray(data[STORAGE_KEYS.SUMMARY_HISTORY])
      ? data[STORAGE_KEYS.SUMMARY_HISTORY]
      : [],
    translationHistory: Array.isArray(data[STORAGE_KEYS.TRANSLATION_HISTORY])
      ? data[STORAGE_KEYS.TRANSLATION_HISTORY]
      : [],
    summaryActivityStats: data[STORAGE_KEYS.SUMMARY_ACTIVITY_STATS] || {},
  };
}

async function restoreEnabledStateIfNeeded() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.EXTENSION_ENABLED]);
  const isEnabled = data[STORAGE_KEYS.EXTENSION_ENABLED] !== false;
  if (isEnabled) return;

  await chrome.storage.local.set({
    [STORAGE_KEYS.EXTENSION_ENABLED]: true,
  });

  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: "setEnabled",
          enabled: true,
        });
      } catch {
        // Tab may not have content script.
      }
    }
  } catch {
    // Popup should still restore the storage flag even if tab enumeration is unavailable.
  }
}

async function forceRefreshProStatus() {
  try {
    await chrome.runtime.sendMessage({ action: "getProductInfo" });
    await loadState();
    updateUI();
    if (!state.email) return;

    const result = await chrome.runtime.sendMessage({
      action: "checkProStatus",
      email: state.email,
    });

    if (!result || result.error) return;

    applyProStatusToState(state, result);
    updateUI();
  } catch (error) {
    console.error("Force refresh error:", error);
  }
}

async function handleOpenCurrentVideoPanel() {
  const button = document.getElementById("btn-open-panel");
  const initialLabel =
    String(button?.textContent || "").trim() || msg("popupOnboardingOpenButton");

  setOnboardingFeedback("");

  if (button) {
    button.disabled = true;
    button.textContent = msg("popupOnboardingOpening");
  }

  try {
    chrome.runtime.sendMessage({
      action: "trackEvent",
      eventType: "popup_open_panel_clicked",
      eventData: {},
    });

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab?.id) {
      setOnboardingFeedback(msg("popupOnboardingUnavailable"), "warning");
      return false;
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      action: "openPanel",
    });

    if (response?.canOpen) {
      chrome.runtime.sendMessage({
        action: "trackEvent",
        eventType: "popup_open_panel_succeeded",
        eventData: {
          has_subtitles: Boolean(response?.hasSubtitles),
        },
      });
      globalThis.close?.();
      return true;
    }

    chrome.runtime.sendMessage({
      action: "trackEvent",
      eventType: "popup_open_panel_failed",
      eventData: {
        reason: "player_not_ready",
        has_subtitles: Boolean(response?.hasSubtitles),
      },
    });
    setOnboardingFeedback(msg("popupOnboardingWaitForPlayer"), "warning");
    return false;
  } catch (error) {
    chrome.runtime.sendMessage({
      action: "trackEvent",
      eventType: "popup_open_panel_failed",
      eventData: {
        reason: "unsupported_tab",
      },
    });
    setOnboardingFeedback(msg("popupOnboardingUnavailable"), "warning");
    return false;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = initialLabel;
    }
  }
}

function updateUI() {
  const buyEmail = document.getElementById("buy-email");
  const restoreEmail = document.getElementById("restore-email");
  const reactivationContent = getReactivationContent();
  const isPartialUnlock = !state.isPro && (state.srtUnlocked || state.isUnlocked);
  const popupCopy = getPopupRuntimeCopy();
  const primaryCtaPrice = String(getPrimaryCtaMonthlyPrice());

  applyPopupRuntimeCopy();
  syncBuyViewCopy();
  renderBuyPlanSelector();
  updateOnboardingUI();

  if (buyEmail && state.email) buyEmail.value = state.email;
  if (restoreEmail && state.email) restoreEmail.value = state.email;

  if (state.isPro) {
    const upgradePlan = getBuyableSubscriptionPlans().find(
      (plan) => plan.key === "yearly",
    );
    const description = state.periodEnd
      ? msg("popupProActiveUntil", [
          new Date(state.periodEnd).toLocaleDateString(),
        ])
      : msg("popupAllUnlocked");
    setStatusCard({
      title: msg("popupProActivated"),
      description,
      tone: "success",
    });
    setMainActions({
      visible: isYearlyUpgradeFlow(),
      primaryText:
        isYearlyUpgradeFlow() && upgradePlan
          ? msg("popupUpgradeToYearlyBtn", [String(upgradePlan.price_rub)])
          : "",
      showSecondary: false,
    });
  } else if (reactivationContent) {
    setStatusCard({
      title: reactivationContent.title,
      description: reactivationContent.description,
      tone: reactivationContent.tone,
    });
    setMainActions({
      visible: true,
      primaryText: reactivationContent.buttonText,
      showSecondary: true,
    });
  } else if (isPartialUnlock) {
    setStatusCard({
      title:
        popupCopy.partial_unlock_title ||
        popupCopy.status_title ||
        msg("popupSrtUnlocked"),
      description:
        popupCopy.partial_unlock_desc ||
        popupCopy.status_desc ||
        msg("popupGetProForAI"),
      tone: "success",
    });
    setMainActions({
      visible: true,
      primaryText:
        popupCopy.partial_unlock_primary_cta_label ||
        popupCopy.primary_cta_label ||
        msg("popupSubscribeAIBtn", [primaryCtaPrice]),
      showSecondary: false,
    });
  } else {
    setStatusCard({
      title:
        popupCopy.free_status_title ||
        popupCopy.status_title ||
        msg("popupStatusFreeTitle"),
      description: buildFreeStatusDescription(),
    });
    setMainActions({
      visible: true,
      primaryText:
        popupCopy.free_primary_cta_label ||
        popupCopy.primary_cta_label ||
        msg("popupSubscribeBtn", [primaryCtaPrice]),
      showSecondary: true,
    });
  }

  toggleCancelSubscriptionLink(hasCancelableSubscription());

  if (state.pendingSubscriptionId && !state.isPro) {
    showView("pending");
  }

  renderHistorySections();
}

function setupEventListeners() {
  document
    .getElementById("btn-open-panel")
    ?.addEventListener("click", handleOpenCurrentVideoPanel);
  document.getElementById("btn-subscribe")?.addEventListener("click", () => {
    showView("buy");
  });
  document.getElementById("btn-restore")?.addEventListener("click", () => {
    showView("restore");
  });
  document.querySelectorAll(".back-btn, [data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.view;
      if (view) showView(view);
    });
  });
  document.getElementById("btn-pay")?.addEventListener("click", handleSubscribe);
  document
    .getElementById("btn-check-subscription")
    ?.addEventListener("click", handleCheckSubscription);
  document
    .getElementById("btn-check-license")
    ?.addEventListener("click", handleRestore);
  document.getElementById("btn-cancel-sub")?.addEventListener("click", () => {
    showView("cancel");
  });
  document
    .getElementById("btn-confirm-cancel")
    ?.addEventListener("click", handleCancelSubscription);
  document.getElementById("buy-email")?.addEventListener("input", (event) => {
    event.target.classList.remove("input-error");
  });
  document
    .getElementById("buy-legal-consent")
    ?.addEventListener("change", (event) => {
      document
        .querySelector('[data-consent="popup-legal"]')
        ?.classList.toggle(
          "popup-consent-invalid",
          event.target.checked !== true,
        );
    });
  document
    .getElementById("restore-email")
    ?.addEventListener("input", (event) => {
      event.target.classList.remove("input-error");
    });
  document
    .getElementById("popup-summary-prev")
    ?.addEventListener("click", () => {
      historyPagination.summary = Math.max(0, historyPagination.summary - 1);
      renderHistorySections();
    });
  document
    .getElementById("popup-summary-next")
    ?.addEventListener("click", () => {
      historyPagination.summary += 1;
      renderHistorySections();
    });
  document
    .getElementById("popup-translation-prev")
    ?.addEventListener("click", () => {
      historyPagination.translation = Math.max(
        0,
        historyPagination.translation - 1,
      );
      renderHistorySections();
    });
  document
    .getElementById("popup-translation-next")
    ?.addEventListener("click", () => {
      historyPagination.translation += 1;
      renderHistorySections();
    });
}

function showView(viewId) {
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.remove("active");
  });
  document.getElementById(`view-${viewId}`)?.classList.add("active");
  if (viewId === "buy") {
    renderBuyPlanSelector();
    syncBuyViewCopy();
  }
}

async function handleSubscribe() {
  const emailInput = document.getElementById("buy-email");
  const legalConsentInput = document.getElementById("buy-legal-consent");
  const marketingOptInInput = document.getElementById("buy-marketing-opt-in");
  const legalConsentRow = document.querySelector(
    '[data-consent="popup-legal"]',
  );
  const email = emailInput?.value?.trim();
  const entryPoint = getSubscriptionEntryPoint();
  const selectedPlan = getSelectedCheckoutPlan();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    emailInput?.classList.add("input-error");
    showError(msg("toastInvalidEmail"));
    return;
  }

  if (legalConsentInput?.checked !== true) {
    legalConsentRow?.classList.add("popup-consent-invalid");
    showError(msg("contentPaywallConsentRequired"));
    return;
  }

  const button = document.getElementById("btn-pay");
  if (button) {
    button.disabled = true;
    button.textContent = msg("popupCreatingSubscription") || msg("popupCreatingLink");
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: "createSubscription",
      email,
      entryPoint,
      marketingOptIn: marketingOptInInput?.checked === true,
      planKey: selectedPlan?.key || ensureSelectedCheckoutPlanKey(),
    });

    if (response?.error) throw new Error(response.error);
    if (!response?.payment_url) throw new Error("No payment URL");

    chrome.runtime.sendMessage({
      action: "trackEvent",
      eventType: "subscription_payment_started",
      eventData: { origin: entryPoint },
    });

    chrome.tabs.create({ url: response.payment_url });
    state.pendingSubscriptionId = response.subscription_id;
    state.pendingSubscriptionOrigin = entryPoint;
    showView("pending");
  } catch (error) {
    console.error("Subscribe error:", error);
    showError(error.message || msg("popupSubscriptionFailed"));
  } finally {
    if (button) {
      button.disabled = false;
      syncBuyViewCopy();
    }
  }
}

async function handleCheckSubscription() {
  const button = document.getElementById("btn-check-subscription");
  if (button) {
    button.disabled = true;
    button.textContent = msg("popupChecking");
  }

  try {
    const email =
      state.email ||
      (await chrome.storage.local.get([STORAGE_KEYS.EMAIL]))[STORAGE_KEYS.EMAIL];
    const result = await chrome.runtime.sendMessage({
      action: "checkProStatus",
      email,
    });

    if (!result?.is_pro) {
      showError(msg("popupPaymentPending"));
      return;
    }

    const pendingOrigin = state.pendingSubscriptionOrigin;
    applyProStatusToState(state, result);
    state.pendingSubscriptionId = null;
    state.pendingSubscriptionOrigin = null;

    await chrome.storage.local.set({
      [STORAGE_KEYS.PENDING_SUBSCRIPTION_ID]: null,
      [STORAGE_KEYS.PENDING_SUBSCRIPTION_ORIGIN]: null,
    });

    chrome.runtime.sendMessage({
      action: "trackEvent",
      eventType: "subscription_activated",
      eventData: {},
    });

    if (pendingOrigin === "summary_preview") {
      chrome.runtime.sendMessage({
        action: "trackEvent",
        eventType: "payment_completed_from_preview",
        eventData: { origin: "summary_preview" },
      });
    }

    showView("success");
    updateUI();
  } catch (error) {
    showError(msg("popupStatusCheckFailed"));
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = msg("popupCheckPayment");
    }
  }
}

async function handleCancelSubscription() {
  const button = document.getElementById("btn-confirm-cancel");
  if (button) {
    button.disabled = true;
    button.textContent = msg("popupCancelling");
  }

  try {
    const result = await chrome.runtime.sendMessage({
      action: "cancelSubscription",
      email: state.email,
    });
    if (result?.error) throw new Error(result.error);
    if (!result?.cancelled) return;

    chrome.runtime.sendMessage({
      action: "trackEvent",
      eventType: "subscription_cancelled",
      eventData: {},
    });

    showView("main");
    showInfo(msg("popupCancelSuccess"));
    toggleCancelSubscriptionLink(false);
  } catch (error) {
    console.error("Cancel error:", error);
    showError(error.message || msg("popupCancelFailed"));
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = msg("popupCancelConfirm");
    }
  }
}

async function handleRestore() {
  const emailInput = document.getElementById("restore-email");
  const email = emailInput?.value?.trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    emailInput?.classList.add("input-error");
    showError(msg("toastInvalidEmail"));
    return;
  }

  const button = document.getElementById("btn-check-license");
  if (button) {
    button.disabled = true;
    button.textContent = msg("popupChecking");
  }

  try {
    const proResult = await chrome.runtime.sendMessage({
      action: "checkProStatus",
      email,
    });

    if (proResult && (proResult.is_pro || proResult.srt_unlocked)) {
      applyProStatusToState(state, proResult);
      state.email = email;
      await chrome.storage.local.set({ [STORAGE_KEYS.EMAIL]: email });
      chrome.runtime.sendMessage({
        action: "trackEvent",
        eventType: "subscription_restored",
        eventData: { type: proResult.is_pro ? "pro" : "srt" },
      });
      showView("success");
      updateUI();
      return;
    }

    const legacyResult = await chrome.runtime.sendMessage({
      action: "checkLicense",
      email,
    });

    if (!legacyResult?.is_unlocked) {
      showError(msg("popupLicenseOrSubNotFound"));
      return;
    }

    state.isUnlocked = true;
    state.srtUnlocked = true;
    state.email = email;
    await chrome.storage.local.set({ [STORAGE_KEYS.EMAIL]: email });
    chrome.runtime.sendMessage({
      action: "trackEvent",
      eventType: "subscription_restored",
      eventData: { type: "license" },
    });
    showView("success");
    updateUI();
  } catch (error) {
    showError(msg("popupCheckFailed"));
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = msg("popupRestoreCheck");
    }
  }
}

function showError(message) {
  let element = document.querySelector(".popup-error-message");
  if (!element) {
    element = document.createElement("div");
    element.className = "popup-error-message";
    document.querySelector(".view.active")?.appendChild(element);
  }
  element.textContent = message;
  setTimeout(() => element.remove(), 5000);
}

function showInfo(message) {
  let element = document.querySelector(".popup-info-msg");
  if (!element) {
    element = document.createElement("div");
    element.className = "popup-info-msg";
    element.style.cssText =
      "color:#22c55e;font-size:13px;margin-top:8px;text-align:center;";
    document.querySelector(".view.active")?.appendChild(element);
  }
  element.textContent = message;
  setTimeout(() => element.remove(), 5000);
}

document.addEventListener("DOMContentLoaded", () => {
  applyI18n();
  renderBuyConsents();
  init();
});

globalThis.restoreEnabledStateIfNeeded = restoreEnabledStateIfNeeded;
globalThis.loadState = loadState;
globalThis.updateUI = updateUI;
