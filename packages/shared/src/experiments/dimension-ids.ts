import { PRECOMPUTED_DIMENSION_PREFIX } from "shared/constants";

export const DATE_CUTOFF_DIMENSION_PREFIX = "cutoff:";
export const COMBO_DIMENSION_PREFIX = "combo:";
export const COMBO_DIMENSION_SEPARATOR = "::";
// Fixed at 2 for now; the grammar itself supports more constituents.
export const COMBO_DIMENSION_LENGTH = 2;

export type ParsedDimensionId =
  | { kind: "experiment"; column: string; precomputed: boolean }
  | { kind: "user"; id: string }
  | { kind: "date" }
  | { kind: "activation" }
  | { kind: "datecutoff"; cutoff: Date }
  | { kind: "combo"; constituentIds: string[] }
  | { kind: "invalid"; id: string; reason: string };

function isValidComboConstituentId(id: string): boolean {
  if (!id || id.includes(COMBO_DIMENSION_SEPARATOR)) return false;
  const parsed = parseDimensionId(id);
  return parsed.kind === "experiment" || parsed.kind === "user";
}

/**
 * Parses a dimension id string into its typed form. Must branch on every
 * known prefix before the trailing user-dimension fallback, since user
 * dimension ids are unprefixed.
 *
 * None of the special prefixes may start with "pre:date" — the front-end
 * routes date-cohort results with `dimension.substring(0, 8) === "pre:date"`.
 */
export function parseDimensionId(id: string): ParsedDimensionId {
  if (id.startsWith(PRECOMPUTED_DIMENSION_PREFIX)) {
    return {
      kind: "experiment",
      column: id.substring(PRECOMPUTED_DIMENSION_PREFIX.length),
      precomputed: true,
    };
  }
  if (id.startsWith("exp:")) {
    return { kind: "experiment", column: id.substring(4), precomputed: false };
  }
  if (id.startsWith(DATE_CUTOFF_DIMENSION_PREFIX)) {
    const iso = id.substring(DATE_CUTOFF_DIMENSION_PREFIX.length);
    const cutoff = new Date(iso);
    if (isNaN(cutoff.getTime())) {
      return {
        kind: "invalid",
        id,
        reason: `Invalid cutoff datetime: "${iso}". Use an ISO 8601 datetime, e.g. 2026-01-15T00:12:00.000Z`,
      };
    }
    return { kind: "datecutoff", cutoff };
  }
  if (id.startsWith(COMBO_DIMENSION_PREFIX)) {
    const constituentIds = id
      .substring(COMBO_DIMENSION_PREFIX.length)
      .split(COMBO_DIMENSION_SEPARATOR);
    if (constituentIds.length !== COMBO_DIMENSION_LENGTH) {
      return {
        kind: "invalid",
        id,
        reason: `Combination dimensions must have exactly ${COMBO_DIMENSION_LENGTH} dimensions separated by "${COMBO_DIMENSION_SEPARATOR}"`,
      };
    }
    if (new Set(constituentIds).size !== constituentIds.length) {
      return {
        kind: "invalid",
        id,
        reason: "Combination dimensions must be distinct",
      };
    }
    const invalid = constituentIds.find((c) => !isValidComboConstituentId(c));
    if (invalid !== undefined) {
      return {
        kind: "invalid",
        id,
        reason: `Invalid combination dimension "${invalid}". Each must be an experiment dimension ("exp:<name>") or a unit dimension id`,
      };
    }
    return { kind: "combo", constituentIds };
  }
  if (id === "pre:date") {
    return { kind: "date" };
  }
  if (id === "pre:activation") {
    return { kind: "activation" };
  }
  if (id.startsWith("pre:")) {
    return {
      kind: "invalid",
      id,
      reason: `Unknown dimension "${id}". Supported built-in dimensions are "pre:date" and "pre:activation"`,
    };
  }
  return { kind: "user", id };
}

export function buildDateCutoffDimensionId(cutoff: Date): string {
  // Canonical ISO form only — snapshot caching matches on exact strings
  return `${DATE_CUTOFF_DIMENSION_PREFIX}${cutoff.toISOString()}`;
}

export function buildComboDimensionId(constituentIds: string[]): string {
  const id = `${COMBO_DIMENSION_PREFIX}${constituentIds.join(
    COMBO_DIMENSION_SEPARATOR,
  )}`;
  const parsed = parseDimensionId(id);
  if (parsed.kind === "invalid") {
    throw new Error(parsed.reason);
  }
  return id;
}

export function isSpecialDimensionId(id: string): boolean {
  return (
    id.startsWith(DATE_CUTOFF_DIMENSION_PREFIX) ||
    id.startsWith(COMBO_DIMENSION_PREFIX)
  );
}
