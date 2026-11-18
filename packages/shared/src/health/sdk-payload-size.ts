import type {
  OptionalPayloadSetting,
  SdkPayloadSize,
  SdkPayloadSizeAlert,
  SdkPayloadSizeBreakdown,
  SdkPayloadSizeLevel,
  SdkPayloadSizeRecommendation,
} from "shared/validators";
import {
  getConnectionSDKCapabilities,
  savedGroupFormatFromConnection,
  withoutUnsupportedSavedGroupCapabilities,
} from "shared/sdk-versioning";
import { SDK_OPTIONAL_PAYLOAD_SETTINGS } from "shared/constants";
import { SDKConnectionInterface } from "shared/types/sdk-connection";

// MongoDB's maximum document size. Used when the database doesn't report its own.
export const DEFAULT_SDK_PAYLOAD_SIZE_LIMIT_BYTES = 16 * 1024 * 1024;

export const SDK_PAYLOAD_SIZE_WARNING_FRACTION = 0.5;

const LEVEL_THRESHOLDS: [SdkPayloadSizeLevel, number][] = [
  ["over-limit", 1],
  ["danger", 0.8],
  ["warning", SDK_PAYLOAD_SIZE_WARNING_FRACTION],
];

// A level is only left once the payload shrinks this far below its threshold,
// so a payload hovering at a threshold doesn't notify on every publish
const SETTLE_MARGIN = 0.9;

const LEVEL_RANK: Record<SdkPayloadSizeLevel, number> = {
  ok: 0,
  warning: 1,
  danger: 2,
  "over-limit": 3,
};

const LARGEST_ENTRIES = 5;
// A flag or saved group is worth naming once it is this share of the payload
const NOTABLE_SHARE = 0.05;

type SizeAgainstLimit = Pick<SdkPayloadSize, "bytes" | "limitBytes">;

function levelFor(
  { bytes, limitBytes }: SizeAgainstLimit,
  margin: number,
): SdkPayloadSizeLevel {
  const fraction = bytes / limitBytes;
  return (
    LEVEL_THRESHOLDS.find(([, min]) => fraction >= min * margin)?.[0] ?? "ok"
  );
}

export function getSdkPayloadSizeLevel(
  size: SizeAgainstLimit,
): SdkPayloadSizeLevel {
  return levelFor(size, 1);
}

export function isWorseSdkPayloadSizeLevel(
  level: SdkPayloadSizeLevel,
  than: SdkPayloadSizeLevel,
): boolean {
  return LEVEL_RANK[level] > LEVEL_RANK[than];
}

export function worstSdkPayloadSizeLevel(
  levels: SdkPayloadSizeLevel[],
): SdkPayloadSizeLevel {
  return levels.reduce<SdkPayloadSizeLevel>(
    (worst, l) => (isWorseSdkPayloadSizeLevel(l, worst) ? l : worst),
    "ok",
  );
}

/**
 * The level to remember after measuring a payload, given the level last
 * announced. Returns `notify: true` only when the payload got worse.
 */
export function nextNotifiedSdkPayloadSizeLevel(
  size: SizeAgainstLimit,
  notified: SdkPayloadSizeLevel,
): { level: SdkPayloadSizeLevel; notify: boolean } {
  const level = getSdkPayloadSizeLevel(size);
  if (isWorseSdkPayloadSizeLevel(level, notified)) {
    return { level, notify: true };
  }
  const settled = levelFor(size, SETTLE_MARGIN);
  return {
    level: isWorseSdkPayloadSizeLevel(notified, settled) ? settled : notified,
    notify: false,
  };
}

// UTF-8 byte length counted in place, rather than encoding a copy of each part
function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code < 0xdc00 && i + 1 < text.length) {
      // A surrogate pair is one 4-byte character
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

const jsonByteLength = (value: unknown) =>
  utf8ByteLength(JSON.stringify(value) ?? "");

function largestEntries(section: unknown) {
  if (!section || typeof section !== "object" || Array.isArray(section)) {
    return [];
  }
  return Object.entries(section)
    .map(([id, value]) => ({ id, bytes: jsonByteLength(value) }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, LARGEST_ENTRIES);
}

function measureBreakdown(
  payload: Record<string, unknown>,
  bytes: number,
  now: Date,
): SdkPayloadSizeBreakdown {
  return {
    measuredAt: now,
    bytes,
    sections: Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [
        key,
        jsonByteLength(value),
      ]),
    ),
    largestFeatures: largestEntries(payload.features),
    largestSavedGroups: largestEntries(payload.savedGroups),
  };
}

// The breakdown serializes every Feature Flag and Saved Group again, and
// payloads refresh on every publish (or thousands of times in a bulk update).
// It's measured again hourly, or sooner once the payload has changed enough
// for the largest entries to have moved, but never more than this often.
const BREAKDOWN_MAX_AGE_MS = 60 * 60 * 1000;
const BREAKDOWN_MIN_AGE_MS = 5 * 60 * 1000;
const BREAKDOWN_STALE_SIZE_CHANGE = 0.05;

// Smaller size changes aren't worth a write on every payload refresh
const RECORDED_SIZE_CHANGE = 0.01;

function reusableBreakdown(
  previous: SdkPayloadSize | null,
  bytes: number,
  now: Date,
): SdkPayloadSizeBreakdown | null {
  const breakdown = previous?.breakdown;
  if (!breakdown) return null;
  const age = now.getTime() - new Date(breakdown.measuredAt).getTime();
  if (age < BREAKDOWN_MIN_AGE_MS) return breakdown;
  const moved =
    Math.abs(bytes - breakdown.bytes) >
    breakdown.bytes * BREAKDOWN_STALE_SIZE_CHANGE;
  return age < BREAKDOWN_MAX_AGE_MS && !moved ? breakdown : null;
}

export function measureSdkPayloadSize(
  payload: Record<string, unknown>,
  bytes: number,
  limitBytes: number,
  previous: SdkPayloadSize | null,
  now: Date = new Date(),
): SdkPayloadSize {
  const reusable = reusableBreakdown(previous, bytes, now);
  // Kept below the warning level too, so a payload hovering at the threshold
  // doesn't measure again every time it crosses back over
  const breakdown =
    getSdkPayloadSizeLevel({ bytes, limitBytes }) === "ok"
      ? (previous?.breakdown ?? null)
      : (reusable ?? measureBreakdown(payload, bytes, now));
  return { bytes, limitBytes, measuredAt: now, breakdown };
}

// Whether a new measurement is worth writing over the stored one
export function shouldRecordSdkPayloadSize(
  previous: SdkPayloadSize | null,
  next: SdkPayloadSize,
): boolean {
  if (!previous) return true;
  if (getSdkPayloadSizeLevel(previous) !== getSdkPayloadSizeLevel(next)) {
    return true;
  }
  if (next.breakdown !== previous.breakdown) return true;
  return (
    Math.abs(next.bytes - previous.bytes) >
    previous.bytes * RECORDED_SIZE_CHANGE
  );
}

export function getSdkPayloadSizeRecommendations(
  connection: Pick<
    SDKConnectionInterface,
    | "languages"
    | "sdkVersion"
    | "projects"
    | "remoteEvalEnabled"
    | "savedGroupFormat"
    | "savedGroupReferencesEnabled"
    | OptionalPayloadSetting
  >,
  size: SdkPayloadSize,
): SdkPayloadSizeRecommendation[] {
  if (getSdkPayloadSizeLevel(size) === "ok") return [];

  const recommendations: SdkPayloadSizeRecommendation[] = [];

  const capabilities = withoutUnsupportedSavedGroupCapabilities(
    getConnectionSDKCapabilities(connection),
    connection,
  );
  if (
    savedGroupFormatFromConnection(connection) === "inline" &&
    capabilities.includes("savedGroupReferences")
  ) {
    recommendations.push({ type: "saved-group-references" });
  }

  if (!connection.projects?.length) {
    recommendations.push({ type: "limit-projects" });
  }

  const notable = (entries: { id: string; bytes: number }[]) =>
    entries.filter((e) => e.bytes >= size.bytes * NOTABLE_SHARE);
  const largeFeatures = notable(size.breakdown?.largestFeatures ?? []);
  if (largeFeatures.length) {
    recommendations.push({ type: "large-features", entries: largeFeatures });
  }
  const largeSavedGroups = notable(size.breakdown?.largestSavedGroups ?? []);
  if (largeSavedGroups.length) {
    recommendations.push({
      type: "large-saved-groups",
      entries: largeSavedGroups,
    });
  }

  // Archived flags leave the payload
  recommendations.push({ type: "archive-stale-features" });

  const settings = SDK_OPTIONAL_PAYLOAD_SETTINGS.filter((s) => connection[s]);
  if (settings.length) {
    recommendations.push({ type: "optional-payload-settings", settings });
  }

  return recommendations;
}

export function formatSdkPayloadBytes(bytes: number): string {
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`;
}

export function describeSdkPayloadSize(size: SizeAgainstLimit): string {
  const current = formatSdkPayloadBytes(size.bytes);
  // Rounded down, so a payload under the limit never reads as 100%
  const share = `${Math.floor((size.bytes / size.limitBytes) * 100)}%`;
  const ofLimit = `${share} of the ${formatSdkPayloadBytes(size.limitBytes)} cache limit`;
  switch (getSdkPayloadSizeLevel(size)) {
    case "over-limit":
      return `The SDK payload is ${current}, ${ofLimit}. SDKs get no updates until it's smaller.`;
    case "danger":
      return `The SDK payload is ${current}, ${ofLimit}. Past it, SDKs get no updates.`;
    case "warning":
      return `The SDK payload is ${current}, ${ofLimit}.`;
    case "ok":
      return `The SDK payload is ${current}.`;
  }
}

const OPTIONAL_PAYLOAD_SETTING_LABELS: Record<OptionalPayloadSetting, string> =
  {
    includeDraftExperiments: "draft experiments",
    includeVisualExperiments: "visual experiments",
    includeRedirectExperiments: "URL redirect experiments",
    includeProjectIdInMetadata: "Project ids in metadata",
    includeCustomFieldsInMetadata: "custom fields in metadata",
    includeTagsInMetadata: "tags in metadata",
    includeExperimentScheduleInMetadata: "experiment schedules in metadata",
  };

const listEntries = (entries: { id: string; bytes: number }[]) =>
  entries.map((e) => `${e.id} (${formatSdkPayloadBytes(e.bytes)})`).join(", ");

// Without names for audiences that may not be able to read every Project the
// connection covers, such as event subscribers
export function describeSdkPayloadSizeRecommendation(
  recommendation: SdkPayloadSizeRecommendation,
  { withNames }: { withNames: boolean },
): string {
  switch (recommendation.type) {
    case "saved-group-references":
      return "Send Saved Groups as references, so each group is sent once instead of inside every rule that uses it.";
    case "limit-projects":
      return "Limit this SDK Connection to the Projects its app uses.";
    case "archive-stale-features":
      return "Archive stale Feature Flags, which stay in the payload until archived.";
    case "large-features":
      return withNames
        ? `Shrink the largest Feature Flags: ${listEntries(recommendation.entries)}. Large JSON values and long lists in conditions are the usual cause.`
        : `Shrink the largest Feature Flags, listed on the SDK Connection's page. Large JSON values and long lists in conditions are the usual cause.`;
    case "large-saved-groups":
      return withNames
        ? `Shrink the largest Saved Groups: ${listEntries(recommendation.entries)}.`
        : "Shrink the largest Saved Groups, listed on the SDK Connection's page.";
    case "optional-payload-settings":
      return `Turn off payload options the app doesn't use: ${recommendation.settings
        .map((s) => OPTIONAL_PAYLOAD_SETTING_LABELS[s])
        .join(", ")}.`;
  }
}

type PayloadEntry = { id: string; bytes: number };

export type SdkPayloadSizeFix =
  | {
      type:
        | "saved-group-references"
        | "limit-projects"
        | "archive-stale-features"
        | "optional-payload-settings";
      connections: number;
    }
  | { type: "large-features" | "large-saved-groups"; entries: PayloadEntry[] };

const FIX_ORDER: SdkPayloadSizeRecommendation["type"][] = [
  "saved-group-references",
  "large-features",
  "large-saved-groups",
  "archive-stale-features",
  "limit-projects",
  "optional-payload-settings",
];

// Merges every connection's recommendations into one list of fixes: setting
// changes count the connections they apply to, and the largest Feature Flags
// and Saved Groups are combined, largest first
export function summarizeSdkPayloadSizeFixes(
  alerts: Pick<SdkPayloadSizeAlert, "recommendations">[],
): SdkPayloadSizeFix[] {
  const recommendations = alerts.flatMap((a) => a.recommendations);
  return FIX_ORDER.flatMap((type): SdkPayloadSizeFix[] => {
    const matching = recommendations.filter((r) => r.type === type);
    if (!matching.length) return [];
    if (type !== "large-features" && type !== "large-saved-groups") {
      return [{ type, connections: matching.length }];
    }
    const largest = new Map<string, number>();
    matching.forEach((r) => {
      if (!("entries" in r)) return;
      r.entries.forEach((e) =>
        largest.set(e.id, Math.max(e.bytes, largest.get(e.id) ?? 0)),
      );
    });
    const entries = [...largest]
      .map(([id, bytes]) => ({ id, bytes }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, LARGEST_ENTRIES);
    return [{ type, entries }];
  });
}
