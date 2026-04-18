import { AuditInterface } from "shared/types/audit";
import { LegacyFeatureInterface } from "shared/types/feature";
import { buildFeatureInterface } from "back-end/src/models/FeatureModel";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";

// Audit `details` is a JSON-stringified `{ pre?, post?, context? }` envelope
// (see `auditDetails{Create,Update,Delete}` in ./audit.ts). For feature events,
// `pre` and `post` often hold full feature documents that were captured at
// write time in whatever shape the feature was stored as then — meaning old
// audit rows carry v0/v1-shaped snapshots long after the live feature has
// been JIT-migrated to v2 on read.
//
// This module runs the same JIT feature migration over those embedded
// snapshots when audits are served to clients. The audit document on disk
// is not modified; only the response payload is upgraded.
//
// Not every feature audit carries a full feature snapshot — `feature.toggle`
// and `feature.archive`, for example, store small diff objects
// (`Record<string, boolean>` and `{ archived: boolean }`). The detector
// below deliberately requires strong feature-document markers so those
// partial snapshots pass through untouched.

/**
 * Heuristic: does `v` look like a full feature document snapshot that the
 * feature JIT upgrader can consume?
 *
 * Requires `id` plus one of the two strongest feature-doc markers
 * (`valueType` or `environmentSettings`). Partial snapshots used by
 * `feature.toggle` / `feature.archive` / similar lack both, so they don't
 * get mis-upgraded.
 */
function looksLikeFeatureSnapshot(v: unknown): v is LegacyFeatureInterface {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string") return false;
  return typeof o.valueType === "string" || "environmentSettings" in o;
}

type DetailsEnvelope = {
  pre?: unknown;
  post?: unknown;
  context?: unknown;
};

/**
 * Return `audit` with its `details` string re-serialized so any embedded
 * feature snapshots are in v2 shape. Returns the input unchanged when there
 * is nothing to upgrade or when upgrade would be unsafe.
 *
 * Safe to call on any audit entity type — non-feature audits pass through
 * immediately. Safe to call on feature audits whose snapshots are partial
 * (toggle maps, archive diffs) — those pass the inner payloads through
 * untouched. Parse/upgrade failures degrade to the original string so a
 * malformed legacy row never breaks the history endpoint.
 */
export function upgradeAuditDetailsForRead(
  audit: AuditInterface,
  context: ReqContext | ApiReqContext,
): AuditInterface {
  if (audit.entity.object !== "feature") return audit;
  if (!audit.details) return audit;

  let parsed: DetailsEnvelope;
  try {
    parsed = JSON.parse(audit.details) as DetailsEnvelope;
  } catch {
    return audit;
  }
  if (!parsed || typeof parsed !== "object") return audit;

  let mutated = false;
  const out: DetailsEnvelope = { ...parsed };

  for (const key of ["pre", "post"] as const) {
    const snapshot = parsed[key];
    if (!looksLikeFeatureSnapshot(snapshot)) continue;
    try {
      out[key] = buildFeatureInterface(snapshot, context);
      mutated = true;
    } catch (e) {
      logger.warn(
        { err: e, auditId: audit.id, key, featureId: audit.entity.id },
        "Failed to upgrade feature audit snapshot; returning original",
      );
      return audit;
    }
  }

  if (!mutated) return audit;

  try {
    return { ...audit, details: JSON.stringify(out) };
  } catch (e) {
    logger.warn(
      { err: e, auditId: audit.id },
      "Failed to re-stringify upgraded audit details; returning original",
    );
    return audit;
  }
}

/**
 * Convenience wrapper for mapping a list of audits. Preserves order and
 * skips nothing — non-feature audits simply pass through.
 */
export function upgradeAuditDetailsListForRead(
  audits: AuditInterface[],
  context: ReqContext | ApiReqContext,
): AuditInterface[] {
  return audits.map((a) => upgradeAuditDetailsForRead(a, context));
}
