// Build info
const BUILD_VERSION = "3.4.0";

// API Configuration
const API_BASE_URL = "https://extension.implesol.com";
const CABINET_API_BASE_URL = "https://cabinet.implesol.com/api/v1";
const CABINET_WEB_BASE_URL = "https://cabinet.implesol.com";
const PRODUCT_ID = "rutube_transcript";
const API_KEY = "GyOJKsmFoa2b5czIdbvkAwokDgv9x1sV7BeIRIUCh24";

// Trial defaults — "safe" fallback when server is unreachable.
const DEFAULT_TRIAL_LIMIT = 3;
const DEFAULT_PRODUCT_PRICE = 299;
const DEFAULT_YEARLY_PRODUCT_PRICE = 1999;
const DEFAULT_YEARLY_MONTHLY_PRICE = 167;

// Storage keys
const STORAGE_KEYS = {
  DEVICE_ID: "device_id",
  FINGERPRINT: "fingerprint",
  TRIAL_USED: "transcript_trial_used",
  TRIAL_LIMIT: "transcript_trial_limit",
  IS_UNLOCKED: "transcript_is_unlocked",
  PENDING_INCREMENTS: "transcript_pending_increments",
  PENDING_INCREMENTS_TS: "transcript_pending_increments_ts",
  PRODUCT_PRICE: "transcript_price",
  EMAIL: "transcript_email",
  LAST_CHECK: "transcript_last_check",
  PENDING_PURCHASE_ID: "transcript_pending_purchase_id",
  // Pro subscription
  IS_PRO: "transcript_is_pro",
  PRO_REASON: "transcript_pro_reason",
  PRO_PERIOD_END: "transcript_pro_period_end",
  AI_LIMIT: "transcript_ai_limit",
  AI_USED: "transcript_ai_used",
  SRT_UNLOCKED: "transcript_srt_unlocked",
  SUBSCRIPTION_PRICE: "transcript_subscription_price",
  SUBSCRIPTION_PLANS: "transcript_subscription_plans",
  SUBSCRIPTION_PLAN_KEY: "transcript_subscription_plan_key",
  CAN_UPGRADE_TO_YEARLY: "transcript_can_upgrade_to_yearly",
  PENDING_SUBSCRIPTION_ID: "transcript_pending_subscription_id",
  PENDING_SUBSCRIPTION_ORIGIN: "transcript_pending_subscription_origin",
  HIGHLIGHT_TRANSCRIPT_BUTTON_ON_FIRST_VIDEO:
    "transcript_highlight_transcript_button_on_first_video",
  LAST_PANEL_OPENED_AT: "transcript_last_panel_opened_at",
  LAST_PREVIEW_NUDGE_SHOWN_AT: "transcript_last_preview_nudge_shown_at",
  EXTENSION_ENABLED: "transcript_extension_enabled",
  SELECTED_LANGUAGE: "transcript_selected_language",
  TRANSLATION_RESULT_CACHE: "transcript_translation_result_cache",
  PANEL_THEME_MODE: "transcript_panel_theme_mode",
  SUMMARY_PREVIEW_CACHE: "transcript_summary_preview_cache",
  SUMMARY_PREVIEW_METER: "transcript_summary_preview_meter",
  SUMMARY_FULL_CACHE: "transcript_summary_full_cache",
  SUMMARY_HISTORY: "transcript_summary_history",
  SUMMARY_ACTIVITY_STATS: "transcript_summary_activity_stats",
  TRANSLATION_HISTORY: "transcript_translation_history",
  RUNTIME_UI_CONFIG: "transcript_runtime_ui_config",
  RUNTIME_UI_CONFIG_EXPIRES_AT: "transcript_runtime_ui_config_expires_at",
  ARCHIVE_TOKEN: "transcript_archive_token",
  ARCHIVE_PAIRING_REQUEST_ID: "transcript_archive_pairing_request_id",
  ARCHIVE_PAIRING_REQUEST_TOKEN: "transcript_archive_pairing_request_token",
  ARCHIVE_PENDING_MATERIAL: "transcript_archive_pending_material",
};

// Check interval (don't spam backend)
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Offline pending increments limits
const PENDING_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours
const PENDING_MAX = 20; // max queued increments

// Rate limiting
const INCREMENT_COOLDOWN_MS = 2000;

// Make constants available for tests and bundling (CommonJS-compatible)
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    BUILD_VERSION,
    API_BASE_URL,
    CABINET_API_BASE_URL,
    CABINET_WEB_BASE_URL,
    PRODUCT_ID,
    API_KEY,
    DEFAULT_TRIAL_LIMIT,
    DEFAULT_PRODUCT_PRICE,
    DEFAULT_YEARLY_PRODUCT_PRICE,
    DEFAULT_YEARLY_MONTHLY_PRICE,
    STORAGE_KEYS,
    CHECK_INTERVAL_MS,
    PENDING_TTL_MS,
    PENDING_MAX,
    INCREMENT_COOLDOWN_MS,
  };
}
