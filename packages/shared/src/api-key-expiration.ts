// Expiration rules shared by the API key tables, the create/edit modal, the
// auth middleware, and the org-policy backfill, so all four agree on what
// "expired" and "non-compliant" mean.

/** How far ahead of expiry a key is surfaced as expiring soon. */
export const EXPIRING_SOON_DAYS = 7;

/** Durations offered in the create modal, before the org policy caps them. */
export const EXPIRATION_PRESET_DAYS = [7, 30, 60, 90, 180, 365] as const;

export type ExpirationStatus = "none" | "active" | "expiring-soon" | "expired";

/** Absent policy is `null`/`undefined`; any set value is a hard maximum in days. */
export type MaxLifetimeDays = number | null | undefined;

export type ExpiresAt = Date | string | null | undefined;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * MS_PER_DAY);
}

function toDate(expiresAt: ExpiresAt): Date | null {
  if ((expiresAt ?? null) === null) return null;
  const date =
    expiresAt instanceof Date ? expiresAt : new Date(expiresAt as string);
  // A stored value we can't parse must not read as "never expires".
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getExpirationStatus(
  expiresAt: ExpiresAt,
  now: Date = new Date(),
): ExpirationStatus {
  const date = toDate(expiresAt);
  if (!date) return "none";
  if (date.getTime() <= now.getTime()) return "expired";
  if (date.getTime() <= addDays(now, EXPIRING_SOON_DAYS).getTime()) {
    return "expiring-soon";
  }
  return "active";
}

export function isExpired(
  expiresAt: ExpiresAt,
  now: Date = new Date(),
): boolean {
  return getExpirationStatus(expiresAt, now) === "expired";
}

/** The latest expiry the policy allows, or `null` when expiry isn't required. */
export function maxExpirationDate(
  maxLifetimeDays: MaxLifetimeDays,
  now: Date = new Date(),
): Date | null {
  if ((maxLifetimeDays ?? null) === null) return null;
  return addDays(now, maxLifetimeDays as number);
}

/**
 * Non-compliant covers both halves of a policy: a key with no expiry at all,
 * and one whose expiry outlives the maximum. Backfilling only the first would
 * leave a 90-day key untouched under a 30-day policy.
 */
export function violatesExpirationPolicy(
  expiresAt: ExpiresAt,
  maxLifetimeDays: MaxLifetimeDays,
  now: Date = new Date(),
): boolean {
  const max = maxExpirationDate(maxLifetimeDays, now);
  if (!max) return false;
  const date = toDate(expiresAt);
  if (!date) return true;
  return date.getTime() > max.getTime();
}

/** Preset durations the policy still allows, longest last. */
export function allowedExpirationPresets(
  maxLifetimeDays: MaxLifetimeDays,
): number[] {
  if ((maxLifetimeDays ?? null) === null) return [...EXPIRATION_PRESET_DAYS];
  const max = maxLifetimeDays as number;
  const allowed = EXPIRATION_PRESET_DAYS.filter((days) => days <= max);
  // A policy shorter than every preset still needs one choice: its own maximum.
  return allowed.length ? [...allowed] : [max];
}
