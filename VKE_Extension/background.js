// RuTube, VK Video & YouTube Transcript Pro - Background Service Worker

importScripts(
  "constants.js",
  "runtime-ui.js",
  "background/lifecycle-urls.js",
);

console.log(`[${PRODUCT_ID}] v${BUILD_VERSION} started`);

const lifecycleUrlHelpers = globalThis.__rutubeTranscriptLifecycleUrls || {
  buildTranscriptLifecycleUrl: () =>
    "https://implesol.com/extensions/transcript/thank-you",
};
const runtimeUiHelpers = globalThis.__rutubeTranscriptRuntimeUi || {
  createEmptyRuntimeUiConfig: () => ({
    version: "",
    ttl_seconds: 3600,
    ttlSeconds: 3600,
    assignments: {},
    payload: {},
    expires_at: 0,
    expiresAt: 0,
  }),
  getEventExperimentMetadata: () => ({}),
  normalizeRuntimeUiConfig: (value) => value || {},
};
let runtimeUiConfigCache = runtimeUiHelpers.createEmptyRuntimeUiConfig();
let runtimeUiConfigRequest = null;

// Rate limiting
let lastIncrementTime = 0;
const API_DETAIL_CODES_TO_PRESERVE = new Set([
  "TRIAL_LIMIT_REACHED",
  "AI_LIMIT_REACHED",
  "SUMMARY_PREVIEW_PAUSED",
  "SUMMARY_PREVIEW_METER_LIMIT_REACHED",
  "TRANSLATION_LIMIT_REACHED",
  "PRO_REQUIRED",
  "EMAIL_REQUIRED",
]);

function getHeaders() {
  return {
    "Content-Type": "application/json",
    "X-API-Key": API_KEY,
  };
}

function getCabinetHeaders(archiveToken = null) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (archiveToken) {
    headers.Authorization = `Bearer ${archiveToken}`;
  }
  return headers;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throwCabinetApiError(response, fallbackMessage) {
  let detail = "";
  try {
    const payload = await response.json();
    detail = typeof payload?.detail === "string" ? payload.detail : "";
  } catch {
    detail = "";
  }
  const error = new Error(detail || fallbackMessage);
  error.status = response.status;
  throw error;
}

async function cabinetJson(path, { method = "GET", body = null, archiveToken = null } = {}) {
  const response = await fetch(`${CABINET_API_BASE_URL}${path}`, {
    method,
    headers: getCabinetHeaders(archiveToken),
    body: body === null ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    await throwCabinetApiError(response, `Cabinet request failed: ${response.status}`);
  }
  return response.json();
}

async function readArchiveToken() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.ARCHIVE_TOKEN]);
  const token = String(data[STORAGE_KEYS.ARCHIVE_TOKEN] || "").trim();
  return token || null;
}

async function clearArchiveToken() {
  await chrome.storage.local.remove([STORAGE_KEYS.ARCHIVE_TOKEN]);
}

async function storeArchiveTokenFromPairingStatus(status) {
  const archiveToken = String(status?.archive_token || "").trim();
  if (!archiveToken) return null;

  await chrome.storage.local.set({
    [STORAGE_KEYS.ARCHIVE_TOKEN]: archiveToken,
  });
  await chrome.storage.local.remove([
    STORAGE_KEYS.ARCHIVE_PAIRING_REQUEST_ID,
    STORAGE_KEYS.ARCHIVE_PAIRING_REQUEST_TOKEN,
  ]);
  try {
    await flushPendingArchiveMaterial(archiveToken);
  } catch (error) {
    console.warn("Unable to flush pending archive material:", error);
  }
  return archiveToken;
}

async function recoverArchiveTokenFromPairing() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.ARCHIVE_PAIRING_REQUEST_ID,
    STORAGE_KEYS.ARCHIVE_PAIRING_REQUEST_TOKEN,
  ]);
  const requestId = String(data[STORAGE_KEYS.ARCHIVE_PAIRING_REQUEST_ID] || "").trim();
  const requestToken = String(data[STORAGE_KEYS.ARCHIVE_PAIRING_REQUEST_TOKEN] || "").trim();
  if (!requestId || !requestToken) return null;

  try {
    const status = await cabinetJson(
      `/extension-link/pairing-request/${encodeURIComponent(requestId)}?request_token=${encodeURIComponent(requestToken)}`,
    );
    const archiveToken = await storeArchiveTokenFromPairingStatus(status);
    if (archiveToken) return archiveToken;

    if (status?.status && status.status !== "pending") {
      await chrome.storage.local.remove([
        STORAGE_KEYS.ARCHIVE_PAIRING_REQUEST_ID,
        STORAGE_KEYS.ARCHIVE_PAIRING_REQUEST_TOKEN,
      ]);
    }
  } catch (error) {
    if (error?.status === 401 || error?.status === 403 || error?.status === 404) {
      await chrome.storage.local.remove([
        STORAGE_KEYS.ARCHIVE_PAIRING_REQUEST_ID,
        STORAGE_KEYS.ARCHIVE_PAIRING_REQUEST_TOKEN,
      ]);
      return null;
    }
    console.warn("Unable to recover archive pairing token:", error);
  }

  return null;
}

async function readUsableArchiveToken() {
  return (await readArchiveToken()) || (await recoverArchiveTokenFromPairing());
}

async function readArchiveSubscriptionSnapshot() {
  const emailData = await chrome.storage.local.get([STORAGE_KEYS.EMAIL]);
  const email = String(emailData[STORAGE_KEYS.EMAIL] || "").trim();
  if (email) {
    await checkProStatus(email).catch((error) => {
      console.warn("Unable to refresh subscription before archive pairing:", error);
    });
  }

  const data = await chrome.storage.local.get([
    STORAGE_KEYS.EMAIL,
    STORAGE_KEYS.IS_PRO,
    STORAGE_KEYS.PRO_REASON,
    STORAGE_KEYS.PRO_PERIOD_END,
    STORAGE_KEYS.SRT_UNLOCKED,
    STORAGE_KEYS.SUBSCRIPTION_PRICE,
    STORAGE_KEYS.SUBSCRIPTION_PLANS,
    STORAGE_KEYS.SUBSCRIPTION_PLAN_KEY,
    STORAGE_KEYS.CAN_UPGRADE_TO_YEARLY,
    STORAGE_KEYS.PENDING_SUBSCRIPTION_ID,
  ]);
  const subscriptionPrice = Number(data[STORAGE_KEYS.SUBSCRIPTION_PRICE]);
  return {
    product_id: PRODUCT_ID,
    email: String(data[STORAGE_KEYS.EMAIL] || "").trim() || null,
    is_pro: data[STORAGE_KEYS.IS_PRO] === true,
    active: data[STORAGE_KEYS.IS_PRO] === true || data[STORAGE_KEYS.SRT_UNLOCKED] === true,
    reason: data[STORAGE_KEYS.PRO_REASON] || null,
    current_period_end: data[STORAGE_KEYS.PRO_PERIOD_END] || null,
    srt_unlocked: data[STORAGE_KEYS.SRT_UNLOCKED] === true,
    subscription_price_rub: Number.isFinite(subscriptionPrice) ? subscriptionPrice : null,
    subscription_plan_key: data[STORAGE_KEYS.SUBSCRIPTION_PLAN_KEY] || null,
    subscription_plans: normalizeSubscriptionPlans(
      data[STORAGE_KEYS.SUBSCRIPTION_PLANS],
      Number.isFinite(subscriptionPrice) ? subscriptionPrice : DEFAULT_PRODUCT_PRICE,
    ),
    can_upgrade_to_yearly: data[STORAGE_KEYS.CAN_UPGRADE_TO_YEARLY] === true,
    pending_subscription_id: data[STORAGE_KEYS.PENDING_SUBSCRIPTION_ID] || null,
    captured_at: new Date().toISOString(),
  };
}

async function attachArchiveSubscriptionSnapshot(payload) {
  const metadata =
    payload.metadata_json &&
    typeof payload.metadata_json === "object" &&
    !Array.isArray(payload.metadata_json)
      ? payload.metadata_json
      : {};
  return {
    ...payload,
    metadata_json: {
      ...metadata,
      extension_subscription: await readArchiveSubscriptionSnapshot(),
    },
  };
}

async function createArchivePairingRequest(pendingArchiveMaterial = null) {
  const [deviceId, fingerprint] = await Promise.all([getDeviceId(), getFingerprint()]);
  const metadata = {
    product_id: PRODUCT_ID,
    source: "extension_popup",
    subscription: await readArchiveSubscriptionSnapshot(),
  };
  if (pendingArchiveMaterial && typeof pendingArchiveMaterial === "object") {
    metadata.pending_archive_material = pendingArchiveMaterial;
  }

  const pairing = await cabinetJson("/extension-link/pairing-request", {
    method: "POST",
    body: {
      extension_device_id: deviceId,
      extension_fingerprint: fingerprint,
      extension_version: BUILD_VERSION,
      metadata_json: metadata,
    },
  });

  await chrome.storage.local.set({
    [STORAGE_KEYS.ARCHIVE_PAIRING_REQUEST_ID]: pairing.pairing_request_id,
    [STORAGE_KEYS.ARCHIVE_PAIRING_REQUEST_TOKEN]: pairing.request_token,
  });

  if (pairing.confirm_url) {
    await chrome.tabs.create({ url: pairing.confirm_url });
  }

  return pairing;
}

async function pollArchivePairingAndFlush(pairing) {
  const requestId = pairing?.pairing_request_id;
  const requestToken = pairing?.request_token;
  if (!requestId || !requestToken) return { ok: false, status: "invalid_pairing" };

  const keepAlive = setInterval(
    () => chrome.runtime.getPlatformInfo(() => {}),
    20 * 1000,
  );
  try {
    const expiresAt = Date.parse(pairing.expires_at || "");
    const deadline = Number.isFinite(expiresAt)
      ? Math.min(expiresAt, Date.now() + 3 * 60 * 1000)
      : Date.now() + 3 * 60 * 1000;

    while (Date.now() < deadline) {
      await wait(2000);
      const status = await cabinetJson(
        `/extension-link/pairing-request/${encodeURIComponent(requestId)}?request_token=${encodeURIComponent(requestToken)}`,
      );
      if (status.archive_token) {
        await storeArchiveTokenFromPairingStatus(status);
        return { ok: true, status: "confirmed" };
      }
      if (status.status && status.status !== "pending") {
        return { ok: false, status: status.status };
      }
    }
    return { ok: false, status: "timeout" };
  } finally {
    clearInterval(keepAlive);
  }
}

async function flushPendingArchiveMaterial(archiveToken) {
  const data = await chrome.storage.local.get([STORAGE_KEYS.ARCHIVE_PENDING_MATERIAL]);
  const payload = data[STORAGE_KEYS.ARCHIVE_PENDING_MATERIAL];
  if (!payload || typeof payload !== "object") return false;

  await cabinetJson("/archive/extension/materials", {
    method: "POST",
    archiveToken,
    body: payload,
  });
  await chrome.storage.local.remove([STORAGE_KEYS.ARCHIVE_PENDING_MATERIAL]);
  return true;
}

async function saveArchiveMaterial(payload) {
  const normalizedPayload =
    payload && typeof payload === "object"
      ? await attachArchiveSubscriptionSnapshot(payload)
      : null;
  if (!normalizedPayload) {
    throw new Error("Archive payload is empty");
  }

  let archiveToken = await readUsableArchiveToken();
  if (!archiveToken) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.ARCHIVE_PENDING_MATERIAL]: normalizedPayload,
    });
    const pairing = await createArchivePairingRequest(normalizedPayload);
    void pollArchivePairingAndFlush(pairing).catch((error) => {
      console.error("Archive pairing poll failed:", error);
    });
    return { ok: true, pairing_required: true, confirm_url: pairing.confirm_url };
  }

  try {
    const material = await cabinetJson("/archive/extension/materials", {
      method: "POST",
      archiveToken,
      body: normalizedPayload,
    });
    return { ok: true, material };
  } catch (error) {
    if (!String(error?.message || "").toLowerCase().includes("token")) {
      throw error;
    }
    await clearArchiveToken();
    await chrome.storage.local.set({
      [STORAGE_KEYS.ARCHIVE_PENDING_MATERIAL]: normalizedPayload,
    });
    const pairing = await createArchivePairingRequest(normalizedPayload);
    void pollArchivePairingAndFlush(pairing).catch((pollError) => {
      console.error("Archive pairing poll failed:", pollError);
    });
    return { ok: true, pairing_required: true, confirm_url: pairing.confirm_url };
  }
}

async function syncArchiveMaterial(payload) {
  const normalizedPayload =
    payload && typeof payload === "object"
      ? await attachArchiveSubscriptionSnapshot(payload)
      : null;
  if (!normalizedPayload) {
    throw new Error("Archive payload is empty");
  }

  const archiveToken = await readUsableArchiveToken();
  if (!archiveToken) {
    return { ok: true, linked: false, synced: false, skipped: "not_linked" };
  }

  const existing = await lookupArchiveMaterial(normalizedPayload);
  if (!existing?.linked) {
    return { ok: true, linked: false, synced: false, skipped: "not_linked" };
  }
  if (!existing?.material) {
    return { ok: true, linked: true, synced: false, skipped: "not_in_archive" };
  }

  const materialLanguage = String(existing.material?.language || "").trim();
  const syncPayload = materialLanguage
    ? {
        ...normalizedPayload,
        language: materialLanguage,
        artifacts: Array.isArray(normalizedPayload.artifacts)
          ? normalizedPayload.artifacts.map((artifact) => {
              const artifactLanguage = String(artifact?.language || "").trim();
              if (artifactLanguage && artifactLanguage !== "original") return artifact;
              return { ...artifact, language: materialLanguage };
            })
          : [],
      }
    : normalizedPayload;

  try {
    const material = await cabinetJson("/archive/extension/materials", {
      method: "POST",
      archiveToken,
      body: syncPayload,
    });
    return { ok: true, linked: true, synced: true, material };
  } catch (error) {
    if (error?.status === 401) {
      await clearArchiveToken();
      return { ok: true, linked: false, synced: false, skipped: "invalid_token" };
    }
    throw error;
  }
}

async function lookupArchiveMaterial(payload) {
  const normalizedPayload = payload && typeof payload === "object" ? payload : {};
  const archiveToken = await readUsableArchiveToken();
  if (!archiveToken) {
    return { ok: true, linked: false, material: null };
  }

  const params = new URLSearchParams();
  [
    ["platform", normalizedPayload.platform],
    ["external_id", normalizedPayload.external_id],
    ["source_url", normalizedPayload.source_url],
    ["language", normalizedPayload.language],
  ].forEach(([key, value]) => {
    const normalizedValue = String(value || "").trim();
    if (normalizedValue) params.set(key, normalizedValue);
  });

  if (!params.toString()) {
    return { ok: true, linked: true, material: null };
  }

  try {
    const material = await cabinetJson(`/archive/extension/materials/lookup?${params.toString()}`, {
      archiveToken,
    });
    return { ok: true, linked: true, material };
  } catch (error) {
    if (error?.status === 404) {
      return { ok: true, linked: true, material: null };
    }
    if (error?.status === 401) {
      await clearArchiveToken();
      return { ok: true, linked: false, material: null };
    }
    throw error;
  }
}

function buildArchiveMaterialUrl(materialId = "") {
  const normalizedId = String(materialId || "").trim();
  const path = normalizedId
    ? `/app/archive/${encodeURIComponent(normalizedId)}`
    : "/app/videos";
  return `${CABINET_WEB_BASE_URL}${path}`;
}

async function openArchiveMaterial(materialId = "") {
  const url = buildArchiveMaterialUrl(materialId);
  await chrome.tabs.create({ url });
  return { ok: true, url };
}

function getDefaultSubscriptionPlans(monthlyPrice = DEFAULT_PRODUCT_PRICE) {
  return [
    {
      key: "monthly",
      price_rub: Number(monthlyPrice) || DEFAULT_PRODUCT_PRICE,
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

function normalizeSubscriptionPlans(plans, fallbackPrice = DEFAULT_PRODUCT_PRICE) {
  if (!Array.isArray(plans) || plans.length === 0) {
    return getDefaultSubscriptionPlans(fallbackPrice);
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

async function throwStructuredApiError(response, fallbackMessage) {
  let detail = null;
  try {
    const error = await response.json();
    detail = error?.detail;
  } catch {
    detail = null;
  }

  if (detail && typeof detail === "object") {
    const code = typeof detail.code === "string" ? detail.code.trim() : "";
    const message =
      typeof detail.message === "string" ? detail.message.trim() : "";
    if (code && API_DETAIL_CODES_TO_PRESERVE.has(code)) {
      throw new Error(message ? `${code}: ${message}` : code);
    }
    throw new Error(message || code || fallbackMessage);
  }

  if (typeof detail === "string" && detail.trim()) {
    throw new Error(detail.trim());
  }

  throw new Error(fallbackMessage);
}

async function getDeviceId() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.DEVICE_ID]);
  if (data[STORAGE_KEYS.DEVICE_ID]) return data[STORAGE_KEYS.DEVICE_ID];
  const deviceId = "dev_" + crypto.randomUUID();
  await chrome.storage.local.set({ [STORAGE_KEYS.DEVICE_ID]: deviceId });
  return deviceId;
}

async function getFingerprint() {
  const components = [];
  components.push(navigator.language);
  components.push(navigator.languages?.join(",") || "");
  components.push(navigator.platform);
  components.push(navigator.hardwareConcurrency || 0);
  components.push(navigator.deviceMemory || 0);
  components.push(navigator.userAgent);
  components.push(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const dataStr = components.join("|||");
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(dataStr),
  );
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getInterfaceLocale() {
  try {
    return chrome.i18n?.getUILanguage?.() || navigator.language || "ru";
  } catch {
    return navigator.language || "ru";
  }
}

function getRuntimeUiConfigStorageKeys() {
  return [
    STORAGE_KEYS.RUNTIME_UI_CONFIG,
    STORAGE_KEYS.RUNTIME_UI_CONFIG_EXPIRES_AT,
  ];
}

async function readStoredRuntimeUiConfig() {
  if (
    !STORAGE_KEYS.RUNTIME_UI_CONFIG ||
    !STORAGE_KEYS.RUNTIME_UI_CONFIG_EXPIRES_AT
  ) {
    return runtimeUiHelpers.createEmptyRuntimeUiConfig();
  }

  const cached = await chrome.storage.local.get(getRuntimeUiConfigStorageKeys());
  runtimeUiConfigCache = runtimeUiHelpers.normalizeRuntimeUiConfig({
    ...(cached?.[STORAGE_KEYS.RUNTIME_UI_CONFIG] || {}),
    expiresAt: cached?.[STORAGE_KEYS.RUNTIME_UI_CONFIG_EXPIRES_AT] || 0,
  });
  return runtimeUiConfigCache;
}

function hasFreshRuntimeUiConfig(config) {
  const expiresAt = Number(config?.expiresAt || config?.expires_at || 0);
  return expiresAt > Date.now();
}

async function storeRuntimeUiConfig(config) {
  const normalized = runtimeUiHelpers.normalizeRuntimeUiConfig(config);
  const ttlSeconds =
    Number(normalized.ttlSeconds || normalized.ttl_seconds) || 3600;
  const expiresAt = Date.now() + ttlSeconds * 1000;
  runtimeUiConfigCache = runtimeUiHelpers.normalizeRuntimeUiConfig({
    ...normalized,
    expiresAt,
  });
  await chrome.storage.local.set({
    [STORAGE_KEYS.RUNTIME_UI_CONFIG]: {
      version: runtimeUiConfigCache.version,
      ttl_seconds: runtimeUiConfigCache.ttl_seconds,
      assignments: runtimeUiConfigCache.assignments,
      payload: runtimeUiConfigCache.payload,
    },
    [STORAGE_KEYS.RUNTIME_UI_CONFIG_EXPIRES_AT]: expiresAt,
  });
  return runtimeUiConfigCache;
}

async function fetchRuntimeUiConfigFromApi() {
  const [deviceId, fingerprint] = await Promise.all([
    getDeviceId(),
    getFingerprint(),
  ]);
  const response = await fetch(
    `${API_BASE_URL}/v1/products/${PRODUCT_ID}/runtime-ui-config/resolve`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        device_id: deviceId,
        fingerprint,
        locale: getInterfaceLocale(),
      }),
    },
  );

  if (!response.ok) {
    await throwStructuredApiError(response, "Runtime UI config failed");
  }

  return await response.json();
}

async function getRuntimeUiConfig(forceRefresh = false) {
  const cached = await readStoredRuntimeUiConfig();
  if (!forceRefresh && hasFreshRuntimeUiConfig(cached)) {
    return cached;
  }

  if (!runtimeUiConfigRequest) {
    runtimeUiConfigRequest = fetchRuntimeUiConfigFromApi()
      .then((resolvedConfig) => storeRuntimeUiConfig(resolvedConfig))
      .catch((error) => {
        if (error.message !== "Failed to fetch") {
          console.error("Runtime UI config error:", error);
        }
        return cached;
      })
      .finally(() => {
        runtimeUiConfigRequest = null;
      });
  }

  return await runtimeUiConfigRequest;
}

async function enrichEventDataWithRuntimeUi(eventData = null) {
  const baseEventData =
    eventData && typeof eventData === "object" ? { ...eventData } : {};
  const cachedConfig = hasFreshRuntimeUiConfig(runtimeUiConfigCache)
    ? runtimeUiConfigCache
    : await readStoredRuntimeUiConfig();
  const experimentMetadata =
    runtimeUiHelpers.getEventExperimentMetadata(cachedConfig);

  if (!Object.keys(experimentMetadata).length) {
    return Object.keys(baseEventData).length ? baseEventData : null;
  }

  return {
    ...baseEventData,
    ...experimentMetadata,
  };
}

async function buildLifecycleUrl(kind, source) {
  const [deviceId, fingerprint] = await Promise.all([
    getDeviceId(),
    getFingerprint(),
  ]);

  return lifecycleUrlHelpers.buildTranscriptLifecycleUrl(kind, {
    locale: getInterfaceLocale(),
    source,
    version: BUILD_VERSION,
    deviceId,
    fingerprint,
  });
}

async function configureUninstallUrl() {
  const uninstallUrl = await buildLifecycleUrl(
    "uninstall",
    "extension_uninstall",
  );
  try {
    await chrome.runtime.setUninstallURL(uninstallUrl);
  } catch (error) {
    console.error("Failed to set uninstall URL:", error);
  }
  return uninstallUrl;
}

// ─── Product Info ───

async function getProductInfo() {
  try {
    const response = await fetch(
      `${API_BASE_URL}/v1/products/${PRODUCT_ID}/info`,
      { headers: getHeaders() },
    );
    if (!response.ok) throw new Error("Product info failed");
    const data = await response.json();
    const subscriptionPlans = normalizeSubscriptionPlans(
      data.subscription_plans,
      data.price_rub,
    );
    await chrome.storage.local.set({
      [STORAGE_KEYS.PRODUCT_PRICE]: data.price_rub,
      [STORAGE_KEYS.TRIAL_LIMIT]: data.trial_limit,
      [STORAGE_KEYS.SUBSCRIPTION_PLANS]: subscriptionPlans,
    });
    return {
      ...data,
      subscription_plans: subscriptionPlans,
    };
  } catch (error) {
    if (error.message !== "Failed to fetch")
      console.error("Product info error:", error);
    const cached = await chrome.storage.local.get([
      STORAGE_KEYS.PRODUCT_PRICE,
      STORAGE_KEYS.TRIAL_LIMIT,
      STORAGE_KEYS.SUBSCRIPTION_PLANS,
    ]);
    const fallbackPrice =
      cached[STORAGE_KEYS.PRODUCT_PRICE] || DEFAULT_PRODUCT_PRICE;
    return {
      price_rub: fallbackPrice,
      trial_limit: cached[STORAGE_KEYS.TRIAL_LIMIT] || DEFAULT_TRIAL_LIMIT,
      subscription_plans: normalizeSubscriptionPlans(
        cached[STORAGE_KEYS.SUBSCRIPTION_PLANS],
        fallbackPrice,
      ),
    };
  }
}

// ─── Trial (legacy, kept for compatibility) ───

async function checkTrial() {
  const deviceId = await getDeviceId();
  const fingerprint = await getFingerprint();
  try {
    const response = await fetch(`${API_BASE_URL}/v1/trial/check`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        product_id: PRODUCT_ID,
        device_id: deviceId,
        fingerprint,
      }),
    });
    if (!response.ok) throw new Error("Trial check failed");
    const data = await response.json();
    await chrome.storage.local.set({
      [STORAGE_KEYS.TRIAL_USED]: data.actions_used,
      [STORAGE_KEYS.TRIAL_LIMIT]: data.actions_limit,
      [STORAGE_KEYS.IS_UNLOCKED]: data.is_unlocked,
      [STORAGE_KEYS.LAST_CHECK]: Date.now(),
    });
    await syncPendingIncrements();
    return data;
  } catch (error) {
    if (error.message !== "Failed to fetch")
      console.error("Trial check error:", error);
    const cached = await chrome.storage.local.get([
      STORAGE_KEYS.TRIAL_USED,
      STORAGE_KEYS.TRIAL_LIMIT,
      STORAGE_KEYS.IS_UNLOCKED,
    ]);
    return {
      actions_used: cached[STORAGE_KEYS.TRIAL_USED] || 0,
      actions_limit: cached[STORAGE_KEYS.TRIAL_LIMIT] || DEFAULT_TRIAL_LIMIT,
      is_unlocked: cached[STORAGE_KEYS.IS_UNLOCKED] || false,
    };
  }
}

async function incrementTrial() {
  const now = Date.now();
  if (now - lastIncrementTime < INCREMENT_COOLDOWN_MS)
    return { error: "rate_limited" };
  lastIncrementTime = now;
  const deviceId = await getDeviceId();
  const fingerprint = await getFingerprint();
  try {
    const response = await fetch(`${API_BASE_URL}/v1/trial/increment`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        product_id: PRODUCT_ID,
        device_id: deviceId,
        fingerprint,
      }),
    });
    if (!response.ok) throw new Error("Increment failed");
    const data = await response.json();
    await chrome.storage.local.set({
      [STORAGE_KEYS.TRIAL_USED]: data.actions_used,
    });
    return data;
  } catch (error) {
    console.error("Increment error:", error);
    const cached = await chrome.storage.local.get([
      STORAGE_KEYS.TRIAL_USED,
      STORAGE_KEYS.PENDING_INCREMENTS,
      STORAGE_KEYS.PENDING_INCREMENTS_TS,
    ]);
    const pending = cached[STORAGE_KEYS.PENDING_INCREMENTS] || 0;
    const pendingTs = cached[STORAGE_KEYS.PENDING_INCREMENTS_TS] || now;
    if (pending > 0 && now - pendingTs > PENDING_TTL_MS) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.PENDING_INCREMENTS]: 0,
        [STORAGE_KEYS.PENDING_INCREMENTS_TS]: 0,
      });
      return { error: "pending_expired" };
    }
    if (pending >= PENDING_MAX) return { error: "pending_limit_reached" };
    const newCount = (cached[STORAGE_KEYS.TRIAL_USED] || 0) + 1;
    await chrome.storage.local.set({
      [STORAGE_KEYS.TRIAL_USED]: newCount,
      [STORAGE_KEYS.PENDING_INCREMENTS]: pending + 1,
      [STORAGE_KEYS.PENDING_INCREMENTS_TS]: pending === 0 ? now : pendingTs,
    });
    return { actions_used: newCount };
  }
}

async function syncPendingIncrements() {
  const cached = await chrome.storage.local.get([
    STORAGE_KEYS.PENDING_INCREMENTS,
    STORAGE_KEYS.PENDING_INCREMENTS_TS,
  ]);
  const pending = cached[STORAGE_KEYS.PENDING_INCREMENTS] || 0;
  if (pending <= 0) return;
  const pendingTs = cached[STORAGE_KEYS.PENDING_INCREMENTS_TS] || 0;
  if (pendingTs > 0 && Date.now() - pendingTs > PENDING_TTL_MS) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.PENDING_INCREMENTS]: 0,
      [STORAGE_KEYS.PENDING_INCREMENTS_TS]: 0,
    });
    return;
  }
  const deviceId = await getDeviceId();
  const fingerprint = await getFingerprint();
  try {
    for (let i = 0; i < pending; i++) {
      const r = await fetch(`${API_BASE_URL}/v1/trial/increment`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          product_id: PRODUCT_ID,
          device_id: deviceId,
          fingerprint,
        }),
      });
      if (!r.ok) throw new Error("Sync increment failed");
    }
    await chrome.storage.local.set({
      [STORAGE_KEYS.PENDING_INCREMENTS]: 0,
      [STORAGE_KEYS.PENDING_INCREMENTS_TS]: 0,
    });
  } catch (error) {
    console.error("Sync pending increments failed:", error);
  }
}

// ─── Subscription / Pro Status ───

async function checkProStatus(email) {
  const deviceId = await getDeviceId();
  const fingerprint = await getFingerprint();
  try {
    const response = await fetch(`${API_BASE_URL}/v1/subscription/status`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        product_id: PRODUCT_ID,
        email: email || undefined,
        fingerprint,
        device_id: deviceId,
      }),
    });
    if (!response.ok) throw new Error("Pro status check failed");
    const data = await response.json();
    const subscriptionPlans = normalizeSubscriptionPlans(
      data.subscription_plans,
      data.subscription_price_rub,
    );
    await chrome.storage.local.set({
      [STORAGE_KEYS.IS_PRO]: data.is_pro,
      [STORAGE_KEYS.PRO_REASON]: data.reason,
      [STORAGE_KEYS.PRO_PERIOD_END]: data.current_period_end,
      [STORAGE_KEYS.AI_LIMIT]: data.ai_summary_limit_monthly,
      [STORAGE_KEYS.AI_USED]: data.ai_summary_used_this_period,
      [STORAGE_KEYS.SRT_UNLOCKED]: data.srt_unlocked,
      [STORAGE_KEYS.SUBSCRIPTION_PRICE]: data.subscription_price_rub,
      [STORAGE_KEYS.SUBSCRIPTION_PLANS]: subscriptionPlans,
      [STORAGE_KEYS.SUBSCRIPTION_PLAN_KEY]: data.subscription_plan_key || null,
      [STORAGE_KEYS.CAN_UPGRADE_TO_YEARLY]:
        data.can_upgrade_to_yearly === true,
      [STORAGE_KEYS.LAST_CHECK]: Date.now(),
      ...(email ? { [STORAGE_KEYS.EMAIL]: email } : {}),
    });
    // Sync IS_UNLOCKED for backward compat (SRT access)
    if (data.is_pro || data.srt_unlocked) {
      await chrome.storage.local.set({ [STORAGE_KEYS.IS_UNLOCKED]: true });
    }
    return data;
  } catch (error) {
    console.error("Pro status check error:", error);
    const cached = await chrome.storage.local.get([
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
    ]);
    const fallbackPrice =
      cached[STORAGE_KEYS.SUBSCRIPTION_PRICE] || DEFAULT_PRODUCT_PRICE;
    return {
      is_pro: cached[STORAGE_KEYS.IS_PRO] || false,
      reason: cached[STORAGE_KEYS.PRO_REASON] || null,
      current_period_end: cached[STORAGE_KEYS.PRO_PERIOD_END] || null,
      ai_summary_limit_monthly: cached[STORAGE_KEYS.AI_LIMIT] || 30,
      ai_summary_used_this_period: cached[STORAGE_KEYS.AI_USED] || 0,
      srt_unlocked: cached[STORAGE_KEYS.SRT_UNLOCKED] || false,
      subscription_price_rub: fallbackPrice,
      subscription_plans: normalizeSubscriptionPlans(
        cached[STORAGE_KEYS.SUBSCRIPTION_PLANS],
        fallbackPrice,
      ),
      subscription_plan_key:
        cached[STORAGE_KEYS.SUBSCRIPTION_PLAN_KEY] || null,
      can_upgrade_to_yearly:
        cached[STORAGE_KEYS.CAN_UPGRADE_TO_YEARLY] === true,
    };
  }
}

async function createSubscription(
  email,
  entryPoint = null,
  marketingOptIn = false,
  planKey = "monthly",
) {
  const deviceId = await getDeviceId();
  const fingerprint = await getFingerprint();
  const response = await fetch(`${API_BASE_URL}/v1/subscription/create`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      product_id: PRODUCT_ID,
      email,
      plan_key: planKey === "yearly" ? "yearly" : "monthly",
      fingerprint,
      device_id: deviceId,
      entry_point: entryPoint || undefined,
      locale: getInterfaceLocale(),
      marketing_opt_in: marketingOptIn === true,
    }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Subscription creation failed");
  }
  const data = await response.json();
  await chrome.storage.local.set({
    [STORAGE_KEYS.EMAIL]: email,
    [STORAGE_KEYS.PENDING_SUBSCRIPTION_ID]: data.subscription_id,
    [STORAGE_KEYS.PENDING_SUBSCRIPTION_ORIGIN]: entryPoint || null,
  });
  return data;
}

async function cancelSubscription(email) {
  const fingerprint = await getFingerprint();
  const deviceId = await getDeviceId();
  const response = await fetch(`${API_BASE_URL}/v1/subscription/cancel`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      product_id: PRODUCT_ID,
      email,
      fingerprint,
      device_id: deviceId,
      locale: getInterfaceLocale(),
    }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Subscription cancel failed");
  }
  const data = await response.json();
  // Don't clear IS_PRO — access remains until current_period_end
  return data;
}

async function requestAISummary(
  transcriptText,
  platform,
  videoId,
  videoUrl,
  videoTitle,
  subtitleLanguage,
  targetLanguage = "original",
  mode = "full",
  entryPoint = "legacy",
) {
  const cached = await chrome.storage.local.get([STORAGE_KEYS.EMAIL]);
  const email = cached[STORAGE_KEYS.EMAIL];
  console.log("[Transcript BG] requestAISummary, email:", email);

  // Keep service worker alive during long AI request (up to 2 min)
  const keepAlive = setInterval(
    () => chrome.runtime.getPlatformInfo(() => {}),
    20000,
  );

  try {
    const fingerprint = await getFingerprint();
    const deviceId = await getDeviceId();
    console.log(
      "[Transcript BG] Sending to backend:",
      API_BASE_URL + "/v1/transcript/ai-summary",
    );
    const response = await fetch(`${API_BASE_URL}/v1/transcript/ai-summary`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        product_id: PRODUCT_ID,
        email: email || undefined,
        fingerprint,
        device_id: deviceId,
        platform,
        video_id: videoId,
        video_url: videoUrl,
        video_title: videoTitle,
        transcript_text: transcriptText,
        subtitle_language: subtitleLanguage || undefined,
        target_language: targetLanguage || "original",
        mode,
        entry_point: entryPoint,
      }),
    });
    if (!response.ok) {
      await throwStructuredApiError(response, "AI summary failed");
    }
    return await response.json();
  } finally {
    clearInterval(keepAlive);
  }
}

async function requestTranscriptTranslation(
  transcriptItems,
  platform,
  videoId,
  videoUrl,
  videoTitle,
  targetLanguage = "original",
) {
  const cached = await chrome.storage.local.get([STORAGE_KEYS.EMAIL]);
  const email = cached[STORAGE_KEYS.EMAIL];
  const keepAlive = setInterval(
    () => chrome.runtime.getPlatformInfo(() => {}),
    20000,
  );

  try {
    const fingerprint = await getFingerprint();
    const deviceId = await getDeviceId();
    const response = await fetch(`${API_BASE_URL}/v1/transcript/translate`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        product_id: PRODUCT_ID,
        email: email || undefined,
        fingerprint,
        device_id: deviceId,
        platform,
        video_id: videoId,
        video_url: videoUrl,
        video_title: videoTitle,
        target_language: targetLanguage || "original",
        transcript_items: Array.isArray(transcriptItems)
          ? transcriptItems
          : [],
      }),
    });
    if (!response.ok) {
      await throwStructuredApiError(response, "Transcript translation failed");
    }
    return await response.json();
  } finally {
    clearInterval(keepAlive);
  }
}


// ─── Event Tracking ───

async function trackEvent(eventType, eventData = null) {
  const deviceId = await getDeviceId();
  const fingerprint = await getFingerprint();
  const enrichedEventData = await enrichEventDataWithRuntimeUi(eventData);
  const platform = (enrichedEventData && enrichedEventData.platform) || "rutube";
  try {
    await fetch(`${API_BASE_URL}/v1/events/track`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        product_id: PRODUCT_ID,
        device_id: deviceId,
        fingerprint,
        event_type: eventType,
        platform,
        event_data: enrichedEventData,
      }),
    });
  } catch (e) {
    if (e.message !== "Failed to fetch") console.error("Track event error:", e);
  }
}

// ─── License (legacy, kept for restore flow) ───

async function checkLicense(email) {
  const deviceId = await getDeviceId();
  try {
    const response = await fetch(
      `${API_BASE_URL}/v1/license/status?product_id=${PRODUCT_ID}&email=${encodeURIComponent(email)}&device_id=${encodeURIComponent(deviceId)}`,
      { headers: getHeaders() },
    );
    if (!response.ok) throw new Error("License check failed");
    const data = await response.json();
    if (data.is_unlocked) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.IS_UNLOCKED]: true,
        [STORAGE_KEYS.EMAIL]: email,
      });
    }
    return data;
  } catch (error) {
    console.error("License check error:", error);
    return { is_unlocked: false };
  }
}

async function activateLicense(email) {
  const deviceId = await getDeviceId();
  try {
    const response = await fetch(`${API_BASE_URL}/v1/license/activate`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        product_id: PRODUCT_ID,
        email,
        device_id: deviceId,
      }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Activation failed");
    }
    const data = await response.json();
    if (data.is_unlocked) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.IS_UNLOCKED]: true,
        [STORAGE_KEYS.EMAIL]: email,
        [STORAGE_KEYS.PENDING_PURCHASE_ID]: null,
      });
    }
    return data;
  } catch (error) {
    console.error("License activation error:", error);
    throw error;
  }
}

async function createPayment(email) {
  const response = await fetch(`${API_BASE_URL}/v1/payments/create`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ product_id: PRODUCT_ID, email }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Payment creation failed");
  }
  const data = await response.json();
  await chrome.storage.local.set({
    [STORAGE_KEYS.EMAIL]: email,
    [STORAGE_KEYS.PENDING_PURCHASE_ID]: data.purchase_id,
  });
  return data;
}

async function checkPaymentStatus(purchaseId) {
  const response = await fetch(
    `${API_BASE_URL}/v1/tochka/check-payment/${purchaseId}`,
    { headers: getHeaders() },
  );
  if (!response.ok) throw new Error("Payment status check failed");
  const data = await response.json();
  if (data.is_paid) {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.EMAIL]);
    if (stored[STORAGE_KEYS.EMAIL]) {
      await activateLicense(stored[STORAGE_KEYS.EMAIL]);
    }
  }
  return data;
}

async function getRecommendations() {
  const fallbackRecommendations = [
    {
      icon_url: "https://implesol.com/extensions/icons/notes.png",
      icon_color: "teal",
      name: "RuTube & VK Video Notes",
      description: "Заметки к видео",
      url: "https://implesol.com/extensions/notes",
    },
    {
      icon_url: "https://implesol.com/extensions/icons/screenshot.png",
      icon_color: "blue",
      name: "RuTube & VK Video Screenshot",
      description: "Скриншоты из видео",
      url: "https://implesol.com/extensions/screenshot",
    },
    {
      icon_url: "https://implesol.com/extensions/icons/audio.png",
      icon_color: "pink",
      name: "RuTube & VK Video Audio",
      description: "Слушайте как подкаст",
      url: "https://implesol.com/extensions/audio",
    },
  ];
  try {
    const response = await fetch(
      `${API_BASE_URL}/v1/recommendations/${PRODUCT_ID}`,
      { headers: getHeaders() },
    );
    if (!response.ok) throw new Error("Recommendations fetch failed");
    const recommendations = await response.json();
    return {
      recommendations:
        recommendations.length > 0 ? recommendations : fallbackRecommendations,
    };
  } catch (error) {
    if (error.message !== "Failed to fetch")
      console.error("Recommendations error:", error);
    return { recommendations: fallbackRecommendations };
  }
}

// ─── Message handler ───

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handlers = {
    checkTrial: () => checkTrial(),
    incrementTrial: () => incrementTrial(),
    trackEvent: () => trackEvent(message.eventType, message.eventData),
    checkLicense: () => checkLicense(message.email),
    activateLicense: () => activateLicense(message.email),
    createPayment: () => createPayment(message.email),
    checkPaymentStatus: () => checkPaymentStatus(message.purchaseId),
    getProductInfo: () => getProductInfo(),
    getRuntimeUiConfig: () => getRuntimeUiConfig(message.forceRefresh),
    getRecommendations: () => getRecommendations(),
    // Pro subscription
    checkProStatus: () => checkProStatus(message.email),
    createSubscription: () =>
      createSubscription(
        message.email,
        message.entryPoint,
        message.marketingOptIn,
        message.planKey,
      ),
    cancelSubscription: () => cancelSubscription(message.email),
    requestAISummary: () =>
      requestAISummary(
        message.transcriptText,
        message.platform,
        message.videoId,
        message.videoUrl,
        message.videoTitle,
        message.subtitleLanguage,
        message.targetLanguage,
        message.mode,
        message.entryPoint,
      ),
    requestTranscriptTranslation: () =>
      requestTranscriptTranslation(
        message.transcriptItems,
        message.platform,
        message.videoId,
        message.videoUrl,
        message.videoTitle,
        message.targetLanguage,
      ),
    saveArchiveMaterial: () => saveArchiveMaterial(message.payload),
    syncArchiveMaterial: () => syncArchiveMaterial(message.payload),
    lookupArchiveMaterial: () => lookupArchiveMaterial(message.payload),
    openArchiveMaterial: () => openArchiveMaterial(message.materialId),
  };

  const handler = handlers[message.action];
  if (handler) {
    handler()
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  getProductInfo();
  checkTrial();
  getRuntimeUiConfig();
  chrome.storage.local.get([STORAGE_KEYS.EMAIL], (data) => {
    if (data[STORAGE_KEYS.EMAIL]) checkProStatus(data[STORAGE_KEYS.EMAIL]);
  });
  configureUninstallUrl();
  if (details?.reason === "install") {
    chrome.storage.local.set({
      [STORAGE_KEYS.HIGHLIGHT_TRANSCRIPT_BUTTON_ON_FIRST_VIDEO]: true,
    });
    buildLifecycleUrl("thank-you", "extension_install")
      .then((url) => {
        chrome.tabs.create({ url });
      })
      .catch((error) => {
        console.error("Failed to open install thank-you page:", error);
      });
  }
});

checkTrial();
getRuntimeUiConfig();
chrome.storage.local.get([STORAGE_KEYS.EMAIL], (data) => {
  if (data[STORAGE_KEYS.EMAIL]) {
    checkProStatus(data[STORAGE_KEYS.EMAIL]);
  }
});
configureUninstallUrl();
