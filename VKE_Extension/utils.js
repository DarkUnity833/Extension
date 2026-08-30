// Pure utility functions for RuTube, VK Video & YouTube Transcript
// Extracted for testability — no DOM or Chrome API dependencies.
// Browser loads this as a plain content script (functions go to global scope).
// Tests import via tests/utils-esm.js wrapper.

function cleanSubtitleText(text) {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/\{[^}]+\}/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#10;|&#13;/g, " ")
    .trim();
}

function parseTimestamp(str) {
  if (!str) return null;
  const cleaned = str.replace(",", ".").trim();
  const parts = cleaned.split(":");
  if (parts.length === 3)
    return (
      parseFloat(parts[0]) * 3600 +
      parseFloat(parts[1]) * 60 +
      parseFloat(parts[2])
    );
  if (parts.length === 2)
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  return null;
}

function formatTime(s) {
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`
    : `${m}:${sec.toString().padStart(2, "0")}`;
}

function formatSRTTime(s) {
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = Math.floor(s % 60),
    ms = Math.floor((s % 1) * 1000);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")},${ms.toString().padStart(3, "0")}`;
}

function countNonWhitespaceChars(text) {
  return String(text || "").replace(/\s+/g, "").length;
}

function shouldRequestSummaryPreview(subtitles, options = {}) {
  const {
    minItems = 5,
    minChars = 280,
    isComplete = true,
    isLiveCapture = false,
  } = options;
  if (!Array.isArray(subtitles) || subtitles.length < minItems) return false;
  if (!isComplete || isLiveCapture) return false;
  const transcriptText = subtitles
    .map((subtitle) => subtitle?.text || "")
    .join(" ")
    .trim();
  return countNonWhitespaceChars(transcriptText) >= minChars;
}

function shouldShowSummaryPreviewNudge(
  lastPanelOpenedAt,
  lastNudgeShownAt,
  now = Date.now(),
) {
  const TWO_DAYS_MS = 48 * 60 * 60 * 1000;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const lastPanel = Number(lastPanelOpenedAt) || 0;
  const lastNudge = Number(lastNudgeShownAt) || 0;
  if (!lastPanel) return false;
  if (now - lastPanel < TWO_DAYS_MS) return false;
  if (lastNudge && now - lastNudge < ONE_DAY_MS) return false;
  return true;
}

function extractSummaryText(result, mode = "full") {
  if (!result || typeof result !== "object") return "";
  const candidates =
    mode === "preview"
      ? [
          result.preview_text,
          result.gist_text,
          result.summary_preview,
          result.summary_text,
        ]
      : [
          result.full_summary_text,
          result.full_text,
          result.summary_text,
          result.summary,
        ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

// Check if two texts represent the same growing phrase.
// True if one contains the other, or they share >60% of words.
function textsOverlap(a, b) {
  if (a.includes(b) || b.includes(a)) return true;
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  let common = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) common++;
  }
  const smaller = Math.min(wordsA.size, wordsB.size);
  return smaller > 0 && common / smaller > 0.6;
}

// VK Video karaoke-style cue deduplication.
// Groups by text containment, then trims word-level overlaps.
function deduplicateVKCues(cues) {
  const raw = [];
  for (const cue of cues) {
    const text = cleanSubtitleText(cue.text?.trim() || "");
    if (text) raw.push({ start: cue.startTime, end: cue.endTime, text });
  }
  if (raw.length === 0) return [];

  const groups = [];
  let cur = { start: raw[0].start, end: raw[0].end, text: raw[0].text };

  for (let i = 1; i < raw.length; i++) {
    const next = raw[i];
    if (textsOverlap(cur.text, next.text)) {
      if (next.text.length >= cur.text.length) {
        cur.text = next.text;
      }
      cur.end = Math.max(cur.end, next.end);
    } else {
      groups.push(cur);
      cur = { start: next.start, end: next.end, text: next.text };
    }
  }
  groups.push(cur);

  for (let i = 1; i < groups.length; i++) {
    const prev = groups[i - 1];
    const cur = groups[i];
    const prevWords = prev.text.split(/\s+/);
    const curWords = cur.text.split(/\s+/);

    let overlapLen = 0;
    const maxCheck = Math.min(prevWords.length, curWords.length, 8);
    for (let k = 1; k <= maxCheck; k++) {
      const suffix = prevWords.slice(-k).join(" ").toLowerCase();
      const prefix = curWords.slice(0, k).join(" ").toLowerCase();
      if (suffix === prefix) overlapLen = k;
    }

    if (overlapLen > 0) {
      const trimmed = curWords.slice(overlapLen).join(" ");
      if (trimmed) {
        cur.text = trimmed;
      } else {
        prev.end = Math.max(prev.end, cur.end);
        groups.splice(i, 1);
        i--;
      }
    }
  }

  return groups;
}

// VTT parsing
function parseVTT(text) {
  const parsed = [];
  const blocks = text.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("-->")) {
        const [startStr, endStr] = lines[i].split("-->").map((s) => s.trim());
        const start = parseTimestamp(startStr);
        const end = parseTimestamp(endStr);
        const textLines = lines
          .slice(i + 1)
          .join(" ")
          .trim();
        if (textLines && start !== null && end !== null)
          parsed.push({ start, end, text: cleanSubtitleText(textLines) });
        break;
      }
    }
  }
  return parsed;
}

// SRT parsing
function parseSRT(text) {
  const parsed = [];
  const blocks = text.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length >= 3 && lines[1].includes("-->")) {
      const [startStr, endStr] = lines[1].split("-->").map((s) => s.trim());
      const start = parseTimestamp(startStr);
      const end = parseTimestamp(endStr);
      const textLines = lines.slice(2).join(" ").trim();
      if (textLines && start !== null && end !== null)
        parsed.push({ start, end, text: cleanSubtitleText(textLines) });
    }
  }
  return parsed;
}

function findJsonArrayEnd(text, startIdx) {
  if (!text || startIdx < 0 || text[startIdx] !== "[") return -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "[") depth++;
    if (ch === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractYouTubeCaptionTracks(source) {
  if (!source) return [];
  const marker = '"captionTracks":';
  const markerIdx = source.indexOf(marker);
  if (markerIdx === -1) return [];

  const arrayStart = source.indexOf("[", markerIdx + marker.length);
  if (arrayStart === -1) return [];

  const arrayEnd = findJsonArrayEnd(source, arrayStart);
  if (arrayEnd === -1) return [];

  try {
    const rawJson = source
      .slice(arrayStart, arrayEnd + 1)
      .replace(/\\u0026/g, "&");
    const parsed = JSON.parse(rawJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function pickPreferredYouTubeCaptionTrack(
  captionTracks,
  preferredLanguages = [],
) {
  if (!Array.isArray(captionTracks) || captionTracks.length === 0) return null;

  const candidates = captionTracks.filter((track) => track && track.baseUrl);
  if (candidates.length === 0) return null;

  const nonAsrCandidates = candidates.filter((track) => track.kind !== "asr");
  const prioritized = nonAsrCandidates.length > 0 ? nonAsrCandidates : candidates;

  const normalizedPrefs = preferredLanguages
    .flatMap((lang) => {
      const exact = String(lang || "").toLowerCase().trim();
      if (!exact) return [];
      const base = exact.split("-")[0];
      return base && base !== exact ? [exact, base] : [exact];
    })
    .filter(Boolean);

  for (const pref of normalizedPrefs) {
    const exactMatch = prioritized.find(
      (track) => String(track.languageCode || "").toLowerCase() === pref,
    );
    if (exactMatch) return exactMatch;
  }

  for (const pref of normalizedPrefs) {
    const baseMatch = prioritized.find(
      (track) =>
        String(track.languageCode || "")
          .toLowerCase()
          .split("-")[0] === pref,
    );
    if (baseMatch) return baseMatch;
  }

  return prioritized[0];
}

function buildYouTubeCaptionUrl(baseUrl, format = "vtt") {
  if (!baseUrl) return "";
  try {
    const url = new URL(baseUrl);
    if (format) url.searchParams.set("fmt", format);
    else url.searchParams.delete("fmt");
    return url.toString();
  } catch (_) {
    return baseUrl;
  }
}

function parseYouTubeTimedTextXML(text) {
  const parsed = [];
  if (!text) return parsed;

  const matches = text.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g);
  for (const match of matches) {
    const attrs = match[1] || "";
    const rawText = match[2] || "";
    const start = parseFloat(
      attrs.match(/\bstart="([^"]+)"/)?.[1] ||
        attrs.match(/\bstart='([^']+)'/)?.[1],
    );
    const dur = parseFloat(
      attrs.match(/\bdur="([^"]+)"/)?.[1] ||
        attrs.match(/\bdur='([^']+)'/)?.[1],
    );
    const subtitleText = cleanSubtitleText(
      rawText.replace(/<br\s*\/?>/gi, " "),
    );
    if (!subtitleText || Number.isNaN(start)) continue;
    parsed.push({
      start,
      end: Number.isNaN(dur) ? start : start + Math.max(dur, 0),
      text: subtitleText,
    });
  }

  return parsed;
}

function parseYouTubeJson3(text) {
  const parsed = [];
  if (!text) return parsed;

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_) {
    return parsed;
  }

  if (!Array.isArray(payload?.events)) return parsed;

  for (const event of payload.events) {
    if (!Array.isArray(event?.segs) || event.segs.length === 0) continue;
    const subtitleText = cleanSubtitleText(
      event.segs.map((seg) => seg?.utf8 || "").join(" "),
    )
      .replace(/\s+/g, " ")
      .trim();
    const startMs = Number(event?.tStartMs);
    const durationMs = Number(event?.dDurationMs);
    if (!subtitleText || Number.isNaN(startMs)) continue;
    parsed.push({
      start: startMs / 1000,
      end:
        durationMs > 0 && !Number.isNaN(durationMs)
          ? (startMs + durationMs) / 1000
          : startMs / 1000,
      text: subtitleText,
    });
  }

  return parsed;
}

function parseYouTubeTranscriptResponse(text) {
  const parsed = [];
  if (!text) return parsed;

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_) {
    return parsed;
  }

  const seen = new Set();
  const extractRunsText = (value) => {
    if (!value) return "";
    if (typeof value.simpleText === "string") return value.simpleText;
    if (Array.isArray(value.runs)) {
      return value.runs.map((run) => run?.text || "").join("");
    }
    return "";
  };

  const visit = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== "object") return;

    const renderer = node.transcriptSegmentRenderer;
    if (renderer && typeof renderer === "object") {
      const startMs = Number(renderer.startMs);
      const endMs = Number(renderer.endMs);
      const subtitleText = cleanSubtitleText(extractRunsText(renderer.snippet))
        .replace(/\s+/g, " ")
        .trim();
      if (subtitleText && !Number.isNaN(startMs)) {
        const key = `${startMs}:${subtitleText}`;
        if (!seen.has(key)) {
          seen.add(key);
          parsed.push({
            start: startMs / 1000,
            end:
              !Number.isNaN(endMs) && endMs > 0
                ? endMs / 1000
                : startMs / 1000,
            text: subtitleText,
          });
        }
      }
    }

    for (const value of Object.values(node)) visit(value);
  };

  visit(payload);
  return parsed;
}

// Make functions available for testing (CommonJS-compatible)
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    cleanSubtitleText,
    parseTimestamp,
    formatTime,
    formatSRTTime,
    countNonWhitespaceChars,
    shouldRequestSummaryPreview,
    shouldShowSummaryPreviewNudge,
    extractSummaryText,
    textsOverlap,
    deduplicateVKCues,
    parseVTT,
    parseSRT,
    extractYouTubeCaptionTracks,
    pickPreferredYouTubeCaptionTrack,
    buildYouTubeCaptionUrl,
    parseYouTubeTimedTextXML,
    parseYouTubeJson3,
    parseYouTubeTranscriptResponse,
  };
}
