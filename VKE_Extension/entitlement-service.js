(function (global) {
  "use strict";

  const modules =
    global.__rutubeTranscriptModules ||
    (global.__rutubeTranscriptModules = {});

  function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
  }

  modules.createEntitlementService = function createEntitlementService(
    deps = {},
  ) {
    const storage = deps.storage || global.chrome?.storage?.local;
    const storageKeys = deps.storageKeys || {};
    const defaultTrialLimit = deps.defaultTrialLimit ?? 3;
    const defaultProductPrice = deps.defaultProductPrice ?? 299;
    const defaultYearlyProductPrice =
      deps.defaultYearlyProductPrice ??
      global.DEFAULT_YEARLY_PRODUCT_PRICE ??
      1999;
    const defaultAiLimit = deps.defaultAiLimit ?? 30;
    const defaultSubscriptionPlans = Array.isArray(deps.defaultSubscriptionPlans)
      ? deps.defaultSubscriptionPlans
      : [
          {
            key: "monthly",
            price_rub: defaultProductPrice,
            billing_period: "month",
            is_default: false,
            is_recommended: false,
          },
          {
            key: "yearly",
            price_rub: defaultYearlyProductPrice,
            billing_period: "year",
            is_default: true,
            is_recommended: true,
          },
        ];

    let trialState = {
      used: 0,
      limit: defaultTrialLimit,
      isUnlocked: false,
    };
    let proState = {
      isPro: false,
      reason: null,
      periodEnd: null,
      aiLimit: defaultAiLimit,
      aiUsed: 0,
      srtUnlocked: false,
      price: defaultProductPrice,
      subscriptionPlans: JSON.parse(JSON.stringify(defaultSubscriptionPlans)),
      subscriptionPlanKey: null,
      canUpgradeToYearly: false,
      email: "",
    };

    function notify() {
      deps.onStateChange?.({
        trialState: cloneState(trialState),
        proState: cloneState(proState),
      });
    }

    async function writeStorage(values) {
      if (!storage?.set || !values || Object.keys(values).length === 0) return;
      await storage.set(values);
    }

    function getTrialState() {
      return cloneState(trialState);
    }

    function getProState() {
      return cloneState(proState);
    }

    function getSnapshot() {
      return {
        trialState: getTrialState(),
        proState: getProState(),
      };
    }

    async function loadTrialState() {
      if (!storage?.get) return getTrialState();

      const data = await storage.get([
        storageKeys.TRIAL_USED,
        storageKeys.TRIAL_LIMIT,
        storageKeys.IS_UNLOCKED,
      ]);

      trialState = {
        used: data[storageKeys.TRIAL_USED] || 0,
        limit: data[storageKeys.TRIAL_LIMIT] || defaultTrialLimit,
        isUnlocked: data[storageKeys.IS_UNLOCKED] || false,
      };
      notify();
      return getTrialState();
    }

    async function loadProState() {
      if (!storage?.get) return getProState();

      const data = await storage.get([
        storageKeys.IS_PRO,
        storageKeys.PRO_REASON,
        storageKeys.PRO_PERIOD_END,
        storageKeys.AI_LIMIT,
        storageKeys.AI_USED,
        storageKeys.SRT_UNLOCKED,
        storageKeys.PRODUCT_PRICE,
        storageKeys.SUBSCRIPTION_PRICE,
        storageKeys.SUBSCRIPTION_PLANS,
        storageKeys.SUBSCRIPTION_PLAN_KEY,
        storageKeys.CAN_UPGRADE_TO_YEARLY,
        storageKeys.EMAIL,
      ]);

      proState = {
        isPro: data[storageKeys.IS_PRO] || false,
        reason: data[storageKeys.PRO_REASON] || null,
        periodEnd: data[storageKeys.PRO_PERIOD_END] || null,
        aiLimit: data[storageKeys.AI_LIMIT] ?? defaultAiLimit,
        aiUsed: data[storageKeys.AI_USED] ?? 0,
        srtUnlocked: data[storageKeys.SRT_UNLOCKED] || false,
        price:
          data[storageKeys.SUBSCRIPTION_PRICE] ??
          data[storageKeys.PRODUCT_PRICE] ??
          defaultProductPrice,
        subscriptionPlans: Array.isArray(data[storageKeys.SUBSCRIPTION_PLANS])
          ? JSON.parse(JSON.stringify(data[storageKeys.SUBSCRIPTION_PLANS]))
          : JSON.parse(JSON.stringify(defaultSubscriptionPlans)),
        subscriptionPlanKey: data[storageKeys.SUBSCRIPTION_PLAN_KEY] || null,
        canUpgradeToYearly:
          data[storageKeys.CAN_UPGRADE_TO_YEARLY] === true,
        email: data[storageKeys.EMAIL] || "",
      };
      notify();
      return getProState();
    }

    async function refresh() {
      await loadTrialState();
      await loadProState();
      return getSnapshot();
    }

    function canAccessSRT() {
      return trialState.isUnlocked || proState.isPro || proState.srtUnlocked;
    }

    function canAccessAI() {
      if (proState.isPro) return true;
      return trialState.used < trialState.limit;
    }

    function applyRemoteProStatus(status = {}, options = {}) {
      if (!status || status.error) return getProState();

      proState = {
        ...proState,
        isPro: Boolean(status.is_pro),
        reason: status.reason || null,
        periodEnd: status.current_period_end || null,
        aiLimit: status.ai_summary_limit_monthly ?? proState.aiLimit,
        aiUsed: status.ai_summary_used_this_period ?? 0,
        srtUnlocked: Boolean(status.srt_unlocked),
        price: status.subscription_price_rub ?? proState.price,
        subscriptionPlans: Array.isArray(status.subscription_plans)
          ? JSON.parse(JSON.stringify(status.subscription_plans))
          : proState.subscriptionPlans,
        subscriptionPlanKey: status.subscription_plan_key || null,
        canUpgradeToYearly: status.can_upgrade_to_yearly === true,
        email: options.email || proState.email || "",
      };
      notify();
      return getProState();
    }

    async function setCachedEmail(email, options = {}) {
      proState.email = String(email || "").trim();
      if (options.persist && proState.email) {
        await writeStorage({
          [storageKeys.EMAIL]: proState.email,
        });
      }
      notify();
      return proState.email;
    }

    async function syncProStatusFromBackend() {
      if (typeof deps.runtimeSendMessage !== "function") return null;

      const email =
        proState.email ||
        (storage?.get
          ? (await storage.get([storageKeys.EMAIL]))?.[storageKeys.EMAIL]
          : "");
      if (!email) return null;

      const result = await deps.runtimeSendMessage({
        action: "checkProStatus",
        email,
      });
      if (!result || result.error) return null;

      return applyRemoteProStatus(result, { email });
    }

    async function incrementAiUsage() {
      if (proState.isPro) {
        proState.aiUsed = (proState.aiUsed || 0) + 1;
        await writeStorage({
          [storageKeys.AI_USED]: proState.aiUsed,
        });
      } else {
        trialState.used = (trialState.used || 0) + 1;
        await writeStorage({
          [storageKeys.TRIAL_USED]: trialState.used,
        });
      }

      notify();
      return getSnapshot();
    }

    async function markProRestored({ email, proStatus }) {
      applyRemoteProStatus(proStatus, { email });
      trialState.isUnlocked = Boolean(
        proStatus?.is_pro || proStatus?.srt_unlocked,
      );
      await writeStorage({
        [storageKeys.IS_UNLOCKED]: true,
        [storageKeys.EMAIL]: email,
      });
      notify();
      return getSnapshot();
    }

    async function markLicenseRestored({ email }) {
      trialState.isUnlocked = true;
      proState.email = String(email || "").trim();
      await writeStorage({
        [storageKeys.IS_UNLOCKED]: true,
        [storageKeys.EMAIL]: proState.email,
      });
      notify();
      return getSnapshot();
    }

    function markLocallyUnlocked(options = {}) {
      trialState.isUnlocked = options.isUnlocked !== false;
      if (options.email) {
        proState.email = String(options.email).trim();
      }
      notify();
      return getSnapshot();
    }

    return {
      getTrialState,
      getProState,
      getSnapshot,
      loadTrialState,
      loadProState,
      refresh,
      canAccessSRT,
      canAccessAI,
      applyRemoteProStatus,
      setCachedEmail,
      syncProStatusFromBackend,
      incrementAiUsage,
      markProRestored,
      markLicenseRestored,
      markLocallyUnlocked,
    };
  };
})(globalThis);
