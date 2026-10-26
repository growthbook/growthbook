import isEqual from "lodash/isEqual";
import { getRulesForEnvironment } from "shared/util";
import type { FeatureInterface, FeatureRule } from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { ReqContext } from "back-end/types/request";
import {
  scrubDeadProjectScopes,
  updateFeature,
} from "back-end/src/models/FeatureModel";
import { getFeatureValuesForDriftRepair } from "back-end/src/util/featureValues";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { CasConflictError } from "back-end/src/models/BaseModel";
import { LandingConflictError } from "back-end/src/revisions/landingSequence";
import { logger } from "back-end/src/util/logger";

// Detect drift between the live revision (source of truth) and the persisted
// `feature.rules` / `feature.defaultValue`. If found, repair in place by
// re-writing through `updateFeature` — which scrubs legacy
// `environmentSettings.{env}.rules` so the JIT read-time migration stops
// re-flattening them and shadowing the v2 top-level rules.
//
// Idempotent and converges in one round-trip. Mutates `feature` so callers in
// the same request see the repaired state without re-reading.
export async function repairFeatureDriftIfNeeded(
  context: ReqContext,
  feature: FeatureInterface,
  live: FeatureRevisionInterface | undefined,
  environmentIds: string[],
  { throwOnFailure = false }: { throwOnFailure?: boolean } = {},
): Promise<void> {
  if (!live) return;

  const repairValues = getFeatureValuesForDriftRepair(feature, live);
  // The live record keeps a deleted project's id; don't count it as drift.
  const scrubbedLive = await scrubDeadProjectScopes(context, {
    rules: repairValues.rules ?? [],
  });
  const liveRulesFlat: FeatureRule[] = scrubbedLive.rules ?? [];
  const featureRulesFlat: FeatureRule[] = feature.rules ?? [];
  const defaultValueDrift = repairValues.defaultValue !== feature.defaultValue;
  const driftedEnvs = environmentIds.filter(
    (env) =>
      !isEqual(
        getRulesForEnvironment(featureRulesFlat, env),
        getRulesForEnvironment(liveRulesFlat, env),
      ),
  );

  if (!defaultValueDrift && driftedEnvs.length === 0) return;

  logger.warn(
    {
      featureId: feature.id,
      orgId: context.org.id,
      defaultValueDrift,
      driftedEnvs,
    },
    "Repairing feature drift against live revision",
  );

  try {
    const original = { ...feature };
    const repaired = await updateFeature(
      context,
      feature,
      {
        ...(defaultValueDrift
          ? { defaultValue: repairValues.defaultValue }
          : {}),
        rules: liveRulesFlat,
      },
      { preserveStoredValues: true, casOnDateUpdated: feature.dateUpdated },
    );
    Object.assign(feature, repaired);

    // Record the repair in the audit history so automated rewrites are
    // visible and searchable (`context.autoRepair` in details). Non-fatal:
    // an audit write failure must not abort a publish/revert whose repair
    // succeeded.
    try {
      await context.auditLog({
        event: "feature.update",
        entity: {
          object: "feature",
          id: feature.id,
        },
        details: auditDetailsUpdate(original, repaired, {
          autoRepair: true,
          note: "Automatic drift repair: feature did not match its live revision and was rewritten from it",
          liveRevisionVersion: live.version,
          defaultValueDrift,
          driftedEnvs,
        }),
      });
    } catch (auditError) {
      logger.error(
        { err: auditError, featureId: feature.id, orgId: context.org.id },
        "Failed to write audit entry for feature drift repair",
      );
    }
  } catch (e) {
    // A rival landed since our read; it holds the truth now, so there is
    // nothing to repair. Writers retry like any lost landing; readers move on.
    if (e instanceof CasConflictError) {
      if (throwOnFailure) throw new LandingConflictError("feature", feature.id);
      return;
    }
    logger.error(
      { err: e, featureId: feature.id, orgId: context.org.id },
      "Failed to repair feature drift",
    );
    // Write callers (publish, revert) MUST abort if the repair fails —
    // otherwise the subsequent diff runs against the stale `feature.rules`
    // and the operation silently no-ops or produces an incorrect merge
    // (the exact failure this helper exists to prevent). Read callers
    // (e.g. getFeatureById) tolerate the stale response.
    if (throwOnFailure) {
      throw new Error(
        "Could not reconcile feature with its live revision. Please retry.",
      );
    }
  }
}
