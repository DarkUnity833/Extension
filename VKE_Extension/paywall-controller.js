(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});
  const SOURCE_EVENT_NAMES = {
    paywall_shown: {
      translation: "paywall_shown_translation",
      srt: "paywall_shown_srt",
      ai_limit: "paywall_shown_ai_limit",
      preview_meter: "paywall_shown_preview_meter",
    },
    payment_started: {
      translation: "payment_started_translation",
      srt: "payment_started_srt",
      ai_limit: "payment_started_ai_limit",
      preview_meter: "payment_started_preview_meter",
    },
  };

  modules.createPaywallController = function createPaywallController(
    deps = {},
  ) {
    const currentPlatform = deps.currentPlatform || "unknown";
    const defaultSiteBaseUrl = "https://extension.implesol.com";

    function buildFeature(text, tone = "") {
      return {
        text,
        tone,
      };
    }

    function resolvePaywallSource(feature, options = {}) {
      const entryPoint = options.entryPoint || null;
      const copyVariant = options.copyVariant || null;

      if (
        feature === "translation" ||
        copyVariant === "translation" ||
        entryPoint === "transcript_language_selector"
      ) {
        return "translation";
      }

      if (
        copyVariant === "srt_download" ||
        entryPoint === "transcript_srt_download" ||
        feature === "srt"
      ) {
        return "srt";
      }

      if (
        copyVariant === "preview_meter" ||
        entryPoint === "preview_meter"
      ) {
        return "preview_meter";
      }

      if (
        copyVariant === "summary_limit" ||
        entryPoint === "summary_preview"
      ) {
        return "ai_limit";
      }

      return "";
    }

    function trackSourceEvent(prefix, paywallSource, eventData = {}) {
      const eventName = SOURCE_EVENT_NAMES[prefix]?.[paywallSource] || "";
      if (!eventName) return;
      trackEvent(eventName, eventData);
    }

    function resolveSiteBaseUrl() {
      const siteBaseUrl = String(deps.siteBaseUrl || "").trim();
      return (siteBaseUrl || defaultSiteBaseUrl).replace(/\/+$/, "");
    }

    function resolveLegalLinks() {
      const siteBaseUrl = resolveSiteBaseUrl();
      const locale = String(deps.getInterfaceLocale?.() || "ru").toLowerCase();
      const isEnglish = locale.startsWith("en");
      const localePrefix = isEnglish ? "/en" : "";

      return {
        offerUrl: `${siteBaseUrl}${localePrefix}/offer`,
        privacyUrl: `${siteBaseUrl}${localePrefix}/policy`,
        agreementUrl: `${siteBaseUrl}${localePrefix}/agreement`,
      };
    }

    function buildDefaultPaywallContent(feature) {
      return {
        featureTitle:
          feature === "ai"
            ? deps.t("contentPaywallAITitle")
            : deps.t("contentPaywallSRTTitle"),
        featureSubtitle:
          feature === "ai"
            ? deps.t("contentPaywallAISubtitle")
            : deps.t("contentPaywallSubTitle"),
        featureListLabel: deps.t("contentPaywallIncludesLabel"),
        featureItems: [
          buildFeature(deps.t("contentPaywallAI30sec"), "highlight"),
          buildFeature(deps.t("contentPaywallTimecodes"), "highlight"),
          buildFeature(deps.t("contentPaywall30summaries"), "highlight"),
          buildFeature(deps.t("contentPaywallSRT")),
          buildFeature(deps.t("contentPaywallViewCopy"), "dim"),
          buildFeature(deps.t("contentPaywallTXT"), "dim"),
        ],
      };
    }

    function normalizeFeatureItems(featureItems = []) {
      if (!Array.isArray(featureItems) || featureItems.length === 0) return null;

      const normalizedItems = featureItems
        .map((item) => {
          if (typeof item === "string") {
            const text = String(item || "").trim();
            return text ? buildFeature(text) : null;
          }

          if (!item || typeof item !== "object") return null;
          const text = String(item.text || "").trim();
          const tone = String(item.tone || "").trim();
          return text ? buildFeature(text, tone) : null;
        })
        .filter(Boolean);

      return normalizedItems.length > 0 ? normalizedItems : null;
    }

    function applyRuntimePaywallCopy(baseContent, variantKey = "default") {
      const runtimeCopy = deps.getRuntimeUiCopy?.(variantKey) || {};
      if (!runtimeCopy || typeof runtimeCopy !== "object") {
        return baseContent;
      }

      const normalizedItems = normalizeFeatureItems(runtimeCopy.feature_items);

      return {
        ...baseContent,
        featureTitle: runtimeCopy.feature_title || baseContent.featureTitle,
        featureSubtitle:
          runtimeCopy.feature_subtitle || baseContent.featureSubtitle,
        featureListLabel:
          runtimeCopy.feature_list_label || baseContent.featureListLabel,
        featureItems: normalizedItems || baseContent.featureItems,
        buyButtonLabel:
          runtimeCopy.buy_button_label ||
          runtimeCopy.primary_cta_label ||
          baseContent.buyButtonLabel,
        payButtonLabel:
          runtimeCopy.pay_button_label ||
          runtimeCopy.primary_cta_label ||
          baseContent.payButtonLabel,
        restoreButtonLabel:
          runtimeCopy.restore_button_label || baseContent.restoreButtonLabel,
        laterButtonLabel:
          runtimeCopy.later_button_label || baseContent.laterButtonLabel,
        priceLabel: runtimeCopy.price_label || baseContent.priceLabel,
        emailPlaceholder:
          runtimeCopy.email_placeholder || baseContent.emailPlaceholder,
        backButtonLabel:
          runtimeCopy.back_button_label || baseContent.backButtonLabel,
        footerLabel: runtimeCopy.footer_label || baseContent.footerLabel,
      };
    }

    function applyTaskCompletionPaywallCopy(baseContent, paywallSource) {
      if (paywallSource === "translation") {
        return {
          ...baseContent,
          featureTitle: deps.t("contentPaywallTaskTranslationTitle"),
          featureSubtitle: deps.t("contentPaywallTaskSubtitle"),
          buyButtonLabel: deps.t("contentPaywallTaskTranslationCta"),
          payButtonLabel: deps.t("contentPaywallSubscribe"),
          featureItems: [
            buildFeature(deps.t("contentPaywallTaskTranslationFeature"), "highlight"),
            buildFeature(deps.t("contentPaywallTaskReadyTextFeature"), "highlight"),
            buildFeature(deps.t("contentPaywallTaskProFeature"), "highlight"),
          ],
        };
      }

      if (paywallSource === "srt") {
        return {
          ...baseContent,
          featureTitle: deps.t("contentPaywallTaskSRTTitle"),
          featureSubtitle: deps.t("contentPaywallTaskSubtitle"),
          buyButtonLabel: deps.t("contentPaywallTaskSRTCta"),
          payButtonLabel: deps.t("contentPaywallSubscribe"),
          featureItems: [
            buildFeature(deps.t("contentPaywallTaskSRTFeature"), "highlight"),
            buildFeature(deps.t("contentPaywallTaskReadyTextFeature"), "highlight"),
            buildFeature(deps.t("contentPaywallTaskProFeature"), "highlight"),
          ],
        };
      }

      return baseContent;
    }

    function resolvePaywallContent(feature, options = {}) {
      const entryPoint = options.entryPoint || null;
      const copyVariant = options.copyVariant || null;
      const paywallSource = resolvePaywallSource(feature, options);
      const paywallVariant =
        options.variant ||
        deps.getRuntimeUiVariant?.(paywallSource) ||
        "current";

      if (
        feature === "translation" ||
        copyVariant === "translation" ||
        entryPoint === "transcript_language_selector"
      ) {
        const content = applyRuntimePaywallCopy(
          {
            featureTitle: deps.t("contentPaywallTranslationTitle"),
            featureSubtitle: deps.t("contentPaywallTranslationSubtitle"),
            featureListLabel: deps.t("contentPaywallIncludesLabel"),
            featureItems: [
              buildFeature(
                deps.t("contentPaywallTranslationFeatureInstant"),
                "highlight",
              ),
              buildFeature(
                deps.t("contentPaywallTranslationFeatureLanguages"),
                "highlight",
              ),
              buildFeature(
                deps.t("contentPaywallTranslationFeatureAnyVideo"),
                "highlight",
              ),
            ],
            buyButtonLabel: deps.t("contentPaywallTranslationCta"),
            payButtonLabel: deps.t("contentPaywallSubscribe"),
            restoreButtonLabel: deps.t("contentPaywallRestore"),
            laterButtonLabel: deps.t("contentPaywallLater"),
            priceLabel: deps.t("contentPaywallPriceLabel"),
            emailPlaceholder: deps.t("contentPaywallEmailPlaceholder"),
            backButtonLabel: deps.t("contentPaywallBack"),
            footerLabel: deps.t("contentPaywallAutoRenew"),
          },
          "translation",
        );
        return paywallVariant === "task_completion"
          ? applyTaskCompletionPaywallCopy(content, "translation")
          : content;
      }

      if (copyVariant === "summary_limit") {
        return applyRuntimePaywallCopy(
          {
            featureTitle: deps.t("contentPaywallSummaryLimitTitle"),
            featureSubtitle: deps.t("contentPaywallSummaryLimitSubtitle"),
            featureListLabel: deps.t("contentPaywallIncludesLabel"),
            featureItems: [
              buildFeature(
                deps.t("contentPaywallSummaryLimitFeatureContinue"),
                "highlight",
              ),
              buildFeature(
                deps.t("contentPaywallSummaryLimitFeatureAnyVideo"),
                "highlight",
              ),
              buildFeature(deps.t("contentPaywall30summaries"), "highlight"),
            ],
            buyButtonLabel: deps.t("contentPaywallSummaryLimitCta"),
            payButtonLabel: deps.t("contentPaywallSubscribe"),
            restoreButtonLabel: deps.t("contentPaywallRestore"),
            laterButtonLabel: deps.t("contentPaywallLater"),
            priceLabel: deps.t("contentPaywallPriceLabel"),
            emailPlaceholder: deps.t("contentPaywallEmailPlaceholder"),
            backButtonLabel: deps.t("contentPaywallBack"),
            footerLabel: deps.t("contentPaywallAutoRenew"),
          },
          "summary_limit",
        );
      }

      if (copyVariant === "preview_meter" || entryPoint === "preview_meter") {
        return applyRuntimePaywallCopy(
          {
            featureTitle: deps.t("contentPaywallPreviewMeterTitle"),
            featureSubtitle: deps.t("contentPaywallPreviewMeterSubtitle"),
            featureListLabel: deps.t("contentPaywallIncludesLabel"),
            featureItems: [
              buildFeature(
                deps.t("contentPaywallPreviewMeterFeatureFull"),
                "highlight",
              ),
              buildFeature(
                deps.t("contentPaywallPreviewMeterFeaturePreview"),
                "highlight",
              ),
              buildFeature(deps.t("contentPaywall30summaries"), "highlight"),
            ],
            buyButtonLabel: deps.t("contentPaywallPreviewMeterCta"),
            payButtonLabel: deps.t("contentPaywallSubscribe"),
            restoreButtonLabel: deps.t("contentPaywallRestore"),
            laterButtonLabel: deps.t("contentPaywallLater"),
            priceLabel: deps.t("contentPaywallPriceLabel"),
            emailPlaceholder: deps.t("contentPaywallEmailPlaceholder"),
            backButtonLabel: deps.t("contentPaywallBack"),
            footerLabel: deps.t("contentPaywallAutoRenew"),
          },
          "preview_meter",
        );
      }

      if (
        copyVariant === "srt_download" ||
        entryPoint === "transcript_srt_download"
      ) {
        const content = applyRuntimePaywallCopy(
          {
            featureTitle: deps.t("contentPaywallSRTDownloadTitle"),
            featureSubtitle: deps.t("contentPaywallSRTDownloadSubtitle"),
            featureListLabel: deps.t("contentPaywallIncludesLabel"),
            featureItems: [
              buildFeature(
                deps.t("contentPaywallSRTDownloadFeatureFile"),
                "highlight",
              ),
              buildFeature(
                deps.t("contentPaywallSRTDownloadFeatureUse"),
                "highlight",
              ),
              buildFeature(
                deps.t("contentPaywallSRTDownloadFeatureNoCopy"),
                "highlight",
              ),
            ],
            buyButtonLabel: deps.t("contentPaywallSRTDownloadCta"),
            payButtonLabel: deps.t("contentPaywallSubscribe"),
            restoreButtonLabel: deps.t("contentPaywallRestore"),
            laterButtonLabel: deps.t("contentPaywallLater"),
            priceLabel: deps.t("contentPaywallPriceLabel"),
            emailPlaceholder: deps.t("contentPaywallEmailPlaceholder"),
            backButtonLabel: deps.t("contentPaywallBack"),
            footerLabel: deps.t("contentPaywallAutoRenew"),
          },
          "srt_download",
        );
        return paywallVariant === "task_completion"
          ? applyTaskCompletionPaywallCopy(content, "srt")
          : content;
      }

      return applyRuntimePaywallCopy(
        {
          ...buildDefaultPaywallContent(feature),
          buyButtonLabel: "",
          payButtonLabel: deps.t("contentPaywallSubscribe"),
          restoreButtonLabel: deps.t("contentPaywallRestore"),
          laterButtonLabel: deps.t("contentPaywallLater"),
          priceLabel: deps.t("contentPaywallPriceLabel"),
          emailPlaceholder: deps.t("contentPaywallEmailPlaceholder"),
          backButtonLabel: deps.t("contentPaywallBack"),
          footerLabel: deps.t("contentPaywallAutoRenew"),
        },
        "default",
      );
    }

    function trackEvent(eventType, eventData) {
      deps.trackEvent?.(eventType, eventData);
    }

    function showToast(type, title, subtitle) {
      deps.showToast?.(type, title, subtitle);
    }

    async function showRestoreModal() {
      const proState = deps.entitlementService?.getProState?.() || {};

      deps.view?.openRestoreModal?.({
        document: deps.document,
        t: deps.t,
        initialEmail: proState.email,
        onValidationError: () => {
          showToast(
            "error",
            deps.t("contentError"),
            deps.t("contentInvalidEmail"),
          );
        },
        onSubmit: async ({ email, remove, setSubmitting }) => {
          setSubmitting(true, deps.t("contentRestoreCheck"));
          try {
            const proStatus = await deps.runtimeSendMessage?.({
              action: "checkProStatus",
              email,
            });

            if (proStatus && (proStatus.is_pro || proStatus.srt_unlocked)) {
              await deps.entitlementService?.markProRestored?.({
                email,
                proStatus,
              });
              remove();
              showToast(
                "success",
                deps.t("contentRestored"),
                proStatus.is_pro
                  ? deps.t("contentProActivated")
                  : deps.t("contentSrtUnlocked"),
              );
              trackEvent("subscription_restored", {
                platform: currentPlatform,
                type: proStatus.is_pro ? "pro" : "srt",
              });
              return;
            }

            const status = await deps.runtimeSendMessage?.({
              action: "checkLicense",
              email,
            });

            if (status && status.is_unlocked) {
              await deps.entitlementService?.markLicenseRestored?.({ email });
              remove();
              showToast(
                "success",
                deps.t("contentRestored"),
                deps.t("contentLicenseActivated"),
              );
              trackEvent("subscription_restored", {
                platform: currentPlatform,
                type: "license",
              });
              return;
            }

            showToast(
              "error",
              deps.t("contentNotFound"),
              deps.t("contentLicenseNotFound"),
            );
            setSubmitting(false);
          } catch (error) {
            showToast(
              "error",
              deps.t("contentError"),
              deps.t("contentCheckFailed"),
            );
            setSubmitting(false);
          }
        },
      });
    }

    async function showSubscriptionPaywall(feature, options = {}) {
      try {
        await deps.runtimeSendMessage?.({
          action: "getProductInfo",
        });
        await deps.entitlementService?.refresh?.();
      } catch (error) {
        // Keep rendering with cached/default price if product info is unavailable.
      }

      const entryPoint = options.entryPoint || null;
      const paywallSource = resolvePaywallSource(feature, options);
      const paywallVariant =
        options.variant ||
        deps.getRuntimeUiVariant?.(paywallSource) ||
        "current";
      const proState = deps.entitlementService?.getProState?.() || {};
      const paywallContent = resolvePaywallContent(feature, options);
      const subscriptionPlans = Array.isArray(proState.subscriptionPlans)
        ? proState.subscriptionPlans
        : [];
      const defaultPlanKey =
        subscriptionPlans.find((plan) => plan.is_default)?.key ||
        subscriptionPlans.find((plan) => plan.is_recommended)?.key ||
        "yearly";
      const eventData = {
        feature,
        platform: currentPlatform,
        entry_point: entryPoint,
        paywall_source: paywallSource || feature || "default",
        paywall_variant: paywallVariant,
        variant: paywallVariant,
      };

      trackEvent("subscription_paywall_shown", eventData);
      trackSourceEvent("paywall_shown", paywallSource, eventData);
      if (entryPoint === "summary_preview" || entryPoint === "preview_meter") {
        trackEvent("paywall_shown_from_preview", eventData);
      }

      deps.view?.openSubscriptionPaywall?.({
        document: deps.document,
        t: deps.t,
        featureTitle: paywallContent.featureTitle,
        featureSubtitle: paywallContent.featureSubtitle,
        featureListLabel: paywallContent.featureListLabel,
        featureItems: paywallContent.featureItems,
        buyButtonLabel: paywallContent.buyButtonLabel,
        payButtonLabel: paywallContent.payButtonLabel,
        restoreButtonLabel: paywallContent.restoreButtonLabel,
        laterButtonLabel: paywallContent.laterButtonLabel,
        priceLabel: paywallContent.priceLabel,
        emailPlaceholder: paywallContent.emailPlaceholder,
        backButtonLabel: paywallContent.backButtonLabel,
        footerLabel: paywallContent.footerLabel,
        legalLinks: resolveLegalLinks(),
        price: proState.price,
        plans: subscriptionPlans,
        defaultPlanKey,
        initialEmail: proState.email,
        onClose: (reason) => {
          trackEvent("subscription_paywall_closed", {
            ...eventData,
            reason: reason || "close",
          });
        },
        onValidationError: () => {
          showToast(
            "error",
            deps.t("contentError"),
            deps.t("contentInvalidEmail"),
          );
        },
        onConsentRequired: () => {
          showToast(
            "warning",
            deps.t("contentError"),
            deps.t("contentPaywallConsentRequired"),
          );
        },
        onSubmit: async ({
          email,
          planKey,
          marketingOptIn = false,
          remove,
          setSubmitting,
        }) => {
          const effectivePlanKey = planKey || defaultPlanKey;
          const selectedPlan =
            subscriptionPlans.find((plan) => plan.key === effectivePlanKey) || null;
          setSubmitting(true, deps.t("contentPaywallCreating"));
          await deps.entitlementService?.setCachedEmail?.(email);
          trackEvent("subscription_payment_started", {
            ...eventData,
            plan_key: effectivePlanKey,
            billing_period: selectedPlan?.billing_period || null,
          });
          trackSourceEvent("payment_started", paywallSource, {
            ...eventData,
            plan_key: effectivePlanKey,
          });
          if (entryPoint === "summary_preview" || entryPoint === "preview_meter") {
            trackEvent("payment_started_from_preview", {
              ...eventData,
              plan_key: effectivePlanKey,
            });
          }
          try {
            const response = await deps.runtimeSendMessage?.({
              action: "createSubscription",
              email,
              entryPoint,
              marketingOptIn,
              planKey: effectivePlanKey,
            });
            if (response?.error) throw new Error(response.error);
            if (!response?.payment_url) throw new Error("No payment URL");

            deps.openExternal?.(response.payment_url);
            remove();
            showToast(
              "success",
              deps.t("contentPaywallOpened"),
              deps.t("contentPaywallOpenedDesc"),
            );
          } catch (error) {
            console.error("Subscription error:", error);
            showToast(
              "error",
              deps.t("contentError"),
              error.message || deps.t("contentPaywallLinkFailed"),
            );
            setSubmitting(false);
          }
        },
        onRestore: () => {
          showRestoreModal();
        },
      });
    }

    return {
      showSubscriptionPaywall,
      showRestoreModal,
    };
  };
})(globalThis);
