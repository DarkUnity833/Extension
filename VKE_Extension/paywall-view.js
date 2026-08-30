(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});
  const DEFAULT_PAYWALL_MONTHLY_PRICE_RUB =
    Number(global.DEFAULT_PRODUCT_PRICE) || 299;
  const DEFAULT_PAYWALL_YEARLY_PRICE_RUB =
    Number(global.DEFAULT_YEARLY_PRODUCT_PRICE) || 1999;
  const DEFAULT_PAYWALL_YEARLY_MONTHLY_PRICE_RUB =
    Number(global.DEFAULT_YEARLY_MONTHLY_PRICE) || 167;

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
  }

  function getDefaultFeatureItems(t) {
    return [
      {
        text: t("contentPaywallAI30sec"),
        tone: "highlight",
      },
      {
        text: t("contentPaywallTimecodes"),
        tone: "highlight",
      },
      {
        text: t("contentPaywall30summaries"),
        tone: "highlight",
      },
      {
        text: t("contentPaywallSRT"),
      },
      {
        text: t("contentPaywallViewCopy"),
        tone: "dim",
      },
      {
        text: t("contentPaywallTXT"),
        tone: "dim",
      },
    ];
  }

  function buildFeatureMarkup(item = {}) {
    const text =
      typeof item === "string" ? item : String(item.text || "").trim();
    const tone =
      typeof item === "string" ? "" : String(item.tone || "").trim();
    const classNames = ["paywall-feature"];

    if (tone === "highlight" || tone === "dim") {
      classNames.push(tone);
    }

    return `<div class="${classNames.join(" ")}">${escapeHtml(text)}</div>`;
  }

  function buildConsentMarkup(t, legalLinks = {}) {
    const offerUrl = String(legalLinks.offerUrl || "#").trim() || "#";
    const privacyUrl = String(legalLinks.privacyUrl || "#").trim() || "#";
    const agreementUrl = String(legalLinks.agreementUrl || "#").trim() || "#";

    return `
      <div class="paywall-consents">
        <label class="paywall-consent is-required" data-consent="legal">
          <input type="checkbox" id="paywall-legal-consent" checked>
          <span class="paywall-consent-text">
            ${escapeHtml(t("contentPaywallConsentPrefix"))}
            <a class="paywall-consent-link" href="${escapeHtml(offerUrl)}" target="_blank" rel="noreferrer noopener">${escapeHtml(t("contentPaywallConsentOffer"))}</a>,
            <a class="paywall-consent-link" href="${escapeHtml(privacyUrl)}" target="_blank" rel="noreferrer noopener">${escapeHtml(t("contentPaywallConsentPrivacy"))}</a>
            ${escapeHtml(t("contentPaywallConsentAnd"))}
            <a class="paywall-consent-link" href="${escapeHtml(agreementUrl)}" target="_blank" rel="noreferrer noopener">${escapeHtml(t("contentPaywallConsentAgreement"))}</a>
          </span>
        </label>
        <label class="paywall-consent" data-consent="marketing">
          <input type="checkbox" id="paywall-marketing-opt-in" checked>
          <span class="paywall-consent-text">
            ${escapeHtml(t("contentPaywallMarketingOptIn"))}
          </span>
        </label>
      </div>
    `;
  }

  function normalizePlans(plans, fallbackPrice) {
    if (!Array.isArray(plans) || plans.length === 0) {
      return [
        {
          key: "monthly",
          price_rub: Number(fallbackPrice) || DEFAULT_PAYWALL_MONTHLY_PRICE_RUB,
          billing_period: "month",
          is_default: false,
          is_recommended: false,
        },
        {
          key: "yearly",
          price_rub: DEFAULT_PAYWALL_YEARLY_PRICE_RUB,
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
          ? DEFAULT_PAYWALL_YEARLY_PRICE_RUB
          : Number(fallbackPrice) || DEFAULT_PAYWALL_MONTHLY_PRICE_RUB),
      billing_period: plan?.billing_period === "year" ? "year" : "month",
      is_default: Boolean(plan?.is_default),
      is_recommended: Boolean(plan?.is_recommended),
    }));
  }

  function resolveSelectedPlanKey(plans, defaultPlanKey) {
    if (
      Array.isArray(plans) &&
      plans.some((plan) => plan.key === defaultPlanKey)
    ) {
      return defaultPlanKey;
    }
    const explicitDefault = Array.isArray(plans)
      ? plans.find((plan) => plan.is_default)
      : null;
    if (explicitDefault) return explicitDefault.key;
    const recommended = Array.isArray(plans)
      ? plans.find((plan) => plan.is_recommended)
      : null;
    if (recommended) return recommended.key;
    return Array.isArray(plans) && plans[0] ? plans[0].key : "monthly";
  }

  function formatPlanAmount(plan) {
    const price = Number(plan?.price_rub) || 0;
    return `${price} \u20BD`;
  }

  function getYearlyMonthlyEquivalentPrice(plan = null) {
    const price = Number(plan?.price_rub) || DEFAULT_PAYWALL_YEARLY_PRICE_RUB;
    return Math.ceil(price / 12) || DEFAULT_PAYWALL_YEARLY_MONTHLY_PRICE_RUB;
  }

  function getPrimaryCtaMonthlyPrice(plans = []) {
    const yearlyPlan =
      plans.find((plan) => plan?.key === "yearly" && plan?.is_recommended) ||
      plans.find((plan) => plan?.key === "yearly");
    return yearlyPlan
      ? getYearlyMonthlyEquivalentPrice(yearlyPlan)
      : DEFAULT_PAYWALL_YEARLY_MONTHLY_PRICE_RUB;
  }

  function formatPlanCardAmount(plan) {
    if (plan?.billing_period === "year") {
      return `${getYearlyMonthlyEquivalentPrice(plan)} \u20BD`;
    }
    return formatPlanAmount(plan);
  }

  function formatPlanPeriod(plan, t) {
    return plan?.billing_period === "year"
      ? t("contentPaywallPlanPerYear")
      : t("contentPaywallPlanPerMonth");
  }

  function formatPlanCardPeriod(_plan, t) {
    return t("contentPaywallPlanPerMonth");
  }

  function formatPlanSecondaryLabel(plan, t) {
    if (plan?.billing_period !== "year") return "";
    return `${formatPlanAmount(plan)} ${formatPlanPeriod(plan, t)}`.trim();
  }

  function buildPlanCardMarkup(plan, selected, t) {
    const badge = plan?.is_recommended
      ? `<div class="paywall-plan-badge">${escapeHtml(
          t("contentPaywallPlanRecommended"),
        )}</div>`
      : "";
    return `
      <button
        type="button"
        class="paywall-plan-card${selected ? " active" : ""}"
        data-plan-key="${escapeHtml(plan.key)}"
      >
        ${badge}
        <div class="paywall-plan-copy">
          <div class="paywall-plan-label">${escapeHtml(
            plan.key === "yearly"
              ? t("contentPaywallPlanYearly")
              : t("contentPaywallPlanMonthly"),
          )}</div>
          <div class="paywall-plan-price-row">
            <span class="paywall-plan-price">${escapeHtml(
              formatPlanCardAmount(plan),
            )}</span>
            <span class="paywall-plan-period">${escapeHtml(
              formatPlanCardPeriod(plan, t),
            )}</span>
          </div>
          ${
            formatPlanSecondaryLabel(plan, t)
              ? `<div class="paywall-plan-secondary-price">${escapeHtml(
                  formatPlanSecondaryLabel(plan, t),
                )}</div>`
              : ""
          }
        </div>
        <span class="paywall-plan-radio" aria-hidden="true"></span>
      </button>
    `;
  }

  function buildPlansMarkup(plans, selectedPlanKey, t) {
    if (!Array.isArray(plans) || plans.length === 0) return "";

    return `
      <div class="paywall-plan-selector">
        ${plans
          .map((plan) =>
            buildPlanCardMarkup(plan, plan.key === selectedPlanKey, t),
          )
          .join("")}
      </div>
    `;
  }

  function buildSubscriptionMarkup({
    t,
    featureTitle,
    featureSubtitle,
    featureListLabel,
    featureItems = [],
    buyButtonLabel = "",
    payButtonLabel = "",
    restoreButtonLabel = "",
    laterButtonLabel = "",
    priceLabel = "",
    emailPlaceholder = "",
    backButtonLabel = "",
    footerLabel = "",
    legalLinks,
    price,
    plans = [],
    selectedPlanKey = "monthly",
  }) {
    const normalizedFeatureItems =
      Array.isArray(featureItems) && featureItems.length > 0
        ? featureItems
        : getDefaultFeatureItems(t);
    const featuresLabel =
      featureListLabel || t("contentPaywallIncludesLabel");
    const closeLabel = t("contentPaywallDismiss") || t("contentClose");
    const primaryCtaPrice = getPrimaryCtaMonthlyPrice(plans);

    return `
      <div class="paywall-card">
        <button type="button" class="paywall-close" id="paywall-close" aria-label="${escapeHtml(closeLabel)}">&times;</button>
        <h3 class="paywall-title">${escapeHtml(featureTitle)}</h3>
        <p class="paywall-subtitle">${escapeHtml(featureSubtitle)}</p>
        ${buildPlansMarkup(plans, selectedPlanKey, t)}
        <div class="paywall-features-label">${escapeHtml(featuresLabel)}</div>
        <div class="paywall-features">
          ${normalizedFeatureItems.map((item) => buildFeatureMarkup(item)).join("")}
        </div>
        <div id="paywall-step1" class="paywall-step">
          <button class="paywall-btn primary" id="paywall-buy">${escapeHtml(
            buyButtonLabel || t("contentPaywallBuyBtn", [String(primaryCtaPrice)]),
          )}</button>
          <button type="button" class="paywall-link-btn" id="paywall-restore">${escapeHtml(
            restoreButtonLabel || t("contentPaywallRestore"),
          )}</button>
        </div>
        <div id="paywall-step2" class="paywall-step" style="display: none;">
          <div class="paywall-price-box">
            <span class="paywall-price" data-selected-plan-price>${escapeHtml(
              formatPlanAmount({ price_rub: price }),
            )}</span>
            <span class="paywall-price-label" data-selected-plan-period>${escapeHtml(
              priceLabel || t("contentPaywallPriceLabel"),
            )}</span>
          </div>
          <input type="email" class="paywall-input" placeholder="${escapeHtml(
            emailPlaceholder || t("contentPaywallEmailPlaceholder"),
          )}" id="paywall-email">
          ${buildConsentMarkup(t, legalLinks)}
          <button class="paywall-btn primary" id="paywall-pay">${escapeHtml(
            payButtonLabel || t("contentPaywallSubscribe"),
          )}</button>
          <button type="button" class="paywall-link-btn" id="paywall-back">${escapeHtml(
            backButtonLabel || t("contentPaywallBack"),
          )}</button>
        </div>
        <div class="paywall-footer">${escapeHtml(
          footerLabel || t("contentPaywallAutoRenew"),
        )}</div>
      </div>
    `;
  }

  function buildRestoreMarkup({ t }) {
    const closeLabel = t("contentPaywallDismiss") || t("contentClose");

    return `
      <div class="paywall-card">
        <button type="button" class="paywall-close" id="restore-close" aria-label="${escapeHtml(closeLabel)}">&times;</button>
        <h3 class="paywall-title">${escapeHtml(t("contentRestoreTitle"))}</h3>
        <p class="paywall-subtitle">${escapeHtml(t("contentRestoreSubtitle"))}</p>
        <input type="email" class="paywall-input" placeholder="${escapeHtml(
          t("contentRestoreEmailPlaceholder"),
        )}" id="restore-email">
        <button class="paywall-btn primary" id="restore-check">${t(
          "contentRestoreCheck",
        )}</button>
        <button type="button" class="paywall-link-btn" id="restore-cancel">${t(
          "contentRestoreCancel",
        )}</button>
      </div>
    `;
  }

  function removeExistingModal(document) {
    const existing = document.querySelector(".rutube-transcript-paywall");
    if (existing) existing.remove();
  }

  modules.createPaywallView = function createPaywallView() {
    return {
      escapeHtml,
      isValidEmail,
      buildSubscriptionMarkup,
      buildRestoreMarkup,
      openSubscriptionPaywall({
        document,
        t,
        featureTitle,
        featureSubtitle,
        featureListLabel,
        featureItems,
        buyButtonLabel,
        payButtonLabel,
        restoreButtonLabel,
        laterButtonLabel,
        priceLabel,
        emailPlaceholder,
        backButtonLabel,
        footerLabel,
        legalLinks,
        price,
        plans = [],
        defaultPlanKey = null,
        initialEmail = "",
        onClose,
        onRestore,
        onSubmit,
        onValidationError,
        onConsentRequired,
      }) {
        removeExistingModal(document);
        const availablePlans = normalizePlans(plans, price);
        let selectedPlanKey = resolveSelectedPlanKey(
          availablePlans,
          defaultPlanKey,
        );

        const modal = document.createElement("div");
        modal.className = "rutube-transcript-paywall";
        modal.innerHTML = buildSubscriptionMarkup({
          t,
          featureTitle,
          featureSubtitle,
          featureListLabel,
          featureItems,
          buyButtonLabel,
          payButtonLabel,
          restoreButtonLabel,
          laterButtonLabel,
          priceLabel,
          emailPlaceholder,
          backButtonLabel,
          footerLabel,
          legalLinks,
          price:
            availablePlans.find((plan) => plan.key === selectedPlanKey)
              ?.price_rub || price,
          plans: availablePlans,
          selectedPlanKey,
        });
        document.body.appendChild(modal);

        const step1 = modal.querySelector("#paywall-step1");
        const step2 = modal.querySelector("#paywall-step2");
        const card = modal.querySelector(".paywall-card");
        const emailInput = modal.querySelector("#paywall-email");
        const payButton = modal.querySelector("#paywall-pay");
        const selectedPlanPrice = modal.querySelector(
          "[data-selected-plan-price]",
        );
        const selectedPlanPeriod = modal.querySelector(
          "[data-selected-plan-period]",
        );
        const legalConsentInput = modal.querySelector(
          "#paywall-legal-consent",
        );
        const marketingOptInInput = modal.querySelector(
          "#paywall-marketing-opt-in",
        );
        const legalConsentRow = modal.querySelector('[data-consent="legal"]');
        const defaultPayLabel = payButton.textContent;

        if (initialEmail) emailInput.value = initialEmail;

        const remove = () => modal.remove();
        const close = (reason = "close") => {
          remove();
          onClose?.(reason);
        };
        const setSubmitting = (isSubmitting, label = defaultPayLabel) => {
          payButton.disabled = Boolean(isSubmitting);
          payButton.textContent = isSubmitting ? label : defaultPayLabel;
        };
        const syncSelectedPlanUi = () => {
          const selectedPlan =
            availablePlans.find((plan) => plan.key === selectedPlanKey) || null;
          modal.querySelectorAll("[data-plan-key]").forEach((button) => {
            button.classList.toggle(
              "active",
              button.dataset.planKey === selectedPlanKey,
            );
          });
          if (selectedPlanPrice && selectedPlan) {
            selectedPlanPrice.textContent = formatPlanAmount(selectedPlan);
          }
          if (selectedPlanPeriod && selectedPlan) {
            selectedPlanPeriod.textContent = formatPlanPeriod(selectedPlan, t);
          }
        };

        emailInput.addEventListener("input", () =>
          emailInput.classList.remove("paywall-input-invalid"),
        );
        legalConsentInput?.addEventListener("change", () => {
          legalConsentRow?.classList.toggle(
            "paywall-consent-invalid",
            legalConsentInput.checked !== true,
          );
        });
        modal.querySelectorAll("[data-plan-key]").forEach((button) => {
          button.addEventListener("click", () => {
            selectedPlanKey = button.dataset.planKey || selectedPlanKey;
            syncSelectedPlanUi();
          });
        });
        syncSelectedPlanUi();

        modal.querySelector("#paywall-close").addEventListener("click", () => {
          close("button");
        });

        modal.addEventListener("click", (event) => {
          if (event.target === modal) close("backdrop");
        });

        modal.querySelector("#paywall-buy").addEventListener("click", () => {
          step1.style.display = "none";
          step2.style.display = "block";
          card?.classList.add("checkout-open");
          emailInput.focus();
        });

        modal.querySelector("#paywall-back").addEventListener("click", () => {
          step2.style.display = "none";
          step1.style.display = "block";
          card?.classList.remove("checkout-open");
        });

        modal
          .querySelector("#paywall-restore")
          .addEventListener("click", () => {
            remove();
            onRestore?.();
          });

        payButton.addEventListener("click", async () => {
          const email = emailInput.value.trim();
          if (!isValidEmail(email)) {
            emailInput.classList.add("paywall-input-invalid");
            onValidationError?.();
            return;
          }
          if (legalConsentInput?.checked !== true) {
            legalConsentRow?.classList.add("paywall-consent-invalid");
            onConsentRequired?.();
            return;
          }

          await onSubmit?.({
            email,
            planKey: selectedPlanKey,
            termsAccepted: true,
            marketingOptIn: marketingOptInInput?.checked === true,
            close,
            remove,
            setSubmitting,
            markInvalid() {
              emailInput.classList.add("paywall-input-invalid");
            },
          });
        });

        return {
          modal,
          close,
          remove,
          setSubmitting,
        };
      },
      openRestoreModal({
        document,
        t,
        initialEmail = "",
        onSubmit,
        onValidationError,
      }) {
        removeExistingModal(document);

        const modal = document.createElement("div");
        modal.className = "rutube-transcript-paywall";
        modal.innerHTML = buildRestoreMarkup({ t });
        document.body.appendChild(modal);

        const emailInput = modal.querySelector("#restore-email");
        const checkButton = modal.querySelector("#restore-check");
        const defaultCheckLabel = checkButton.textContent;

        if (initialEmail) emailInput.value = initialEmail;

        const remove = () => modal.remove();
        const setSubmitting = (isSubmitting, label = defaultCheckLabel) => {
          checkButton.disabled = Boolean(isSubmitting);
          checkButton.textContent = isSubmitting ? label : defaultCheckLabel;
        };

        emailInput.addEventListener("input", () =>
          emailInput.classList.remove("error"),
        );

        modal.addEventListener("click", (event) => {
          if (event.target === modal) remove();
        });

        modal
          .querySelector("#restore-close")
          .addEventListener("click", () => remove());

        modal
          .querySelector("#restore-cancel")
          .addEventListener("click", () => remove());

        modal
          .querySelector("#restore-check")
          .addEventListener("click", async () => {
            const email = emailInput.value.trim();
            if (!isValidEmail(email)) {
              emailInput.classList.add("error");
              onValidationError?.();
              return;
            }

            await onSubmit?.({
              email,
              remove,
              setSubmitting,
              markInvalid() {
                emailInput.classList.add("error");
              },
            });
          });

        return {
          modal,
          remove,
          setSubmitting,
        };
      },
    };
  };
})(globalThis);
