import {
  setFeatureEnvironmentDefaultValidator,
  unsetFeatureEnvironmentDefaultValidator,
} from "shared/validators";
import { validateFeatureValue } from "shared/util";
import type { EventUser } from "shared/types/events/event-types";
import type { OrganizationInterface } from "shared/types/organization";
import type { ApiReqContext } from "back-end/types/api";
import {
  createAndPublishRevision,
  getFeature,
} from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import {
  getApiFeatureObj,
  getSavedGroupMap,
} from "back-end/src/services/features";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { canUseRestApiBypassSetting } from "./reviewBypass";

// Builds the live feature's COMPLETE per-env override snapshot (every env that
// currently has an override; absence means "no override").
function liveEnvironmentDefaults(
  feature: Awaited<ReturnType<typeof getFeature>>,
): Record<string, string> {
  if (!feature) return {};
  return Object.fromEntries(
    Object.entries(feature.environmentSettings ?? {})
      .filter(([, val]) => val?.defaultValue !== undefined)
      .map(([env, val]) => [env, val.defaultValue as string]),
  );
}

// Shared implementation for both the set and unset endpoints. `nextValue ===
// undefined` removes the env's override (unset); otherwise it sets/updates it.
// The change is published through a new revision (full-map-replace) so envs the
// caller didn't touch keep their existing overrides.
async function applyEnvironmentDefault(
  context: ApiReqContext,
  organization: OrganizationInterface,
  eventAudit: EventUser,
  featureId: string,
  environment: string,
  nextValue: string | undefined,
  canUseRestApiBypass: boolean,
) {
  const feature = await getFeature(context, featureId);
  if (!feature) {
    throw new Error("Could not find a feature with that key");
  }

  const environmentIds = getEnvironmentIdsFromOrg(organization);
  if (!environmentIds.includes(environment)) {
    throw new Error(`Unknown environment: '${environment}'`);
  }

  if (
    !context.permissions.canUpdateFeature(feature, {}) ||
    !context.permissions.canPublishFeature(feature, [environment])
  ) {
    context.permissions.throwPermissionError();
  }

  const groupMap = await getSavedGroupMap(context);
  const safeRolloutMap =
    await context.models.safeRollout.getAllPayloadSafeRollouts();

  // Build the complete next snapshot by merging the change onto live.
  const nextEnvironmentDefaults = liveEnvironmentDefaults(feature);
  const currentValue = nextEnvironmentDefaults[environment];
  if (nextValue === undefined) {
    delete nextEnvironmentDefaults[environment];
  } else {
    nextEnvironmentDefaults[environment] = validateFeatureValue(
      feature,
      nextValue,
      "Value",
    );
  }

  // No-op — return current state without creating a revision.
  if (currentValue === nextEnvironmentDefaults[environment]) {
    const revision = await getRevision({
      context,
      organization: feature.organization,
      featureId: feature.id,
      feature,
      version: feature.version,
    });
    const experimentMap = await getExperimentMapForFeature(context, feature.id);
    return {
      feature,
      organization,
      groupMap,
      experimentMap,
      revision,
      safeRolloutMap,
    };
  }

  // JWT-backed REST calls behave like dashboard actions: the org-level REST
  // bypass setting only applies to API keys/PATs.
  const canBypass =
    canUseRestApiBypass || context.permissions.canBypassApprovalChecks(feature);

  // createAndPublishRevision enforces the review gate (throws when review is
  // required and the caller can't bypass).
  const { updatedFeature } = await createAndPublishRevision({
    context,
    feature,
    user: eventAudit,
    org: organization,
    changes: { environmentDefaults: nextEnvironmentDefaults },
    comment: "Created via REST API",
    canBypassApprovalChecks: canBypass,
  });

  const experimentMap = await getExperimentMapForFeature(
    context,
    updatedFeature.id,
  );
  const revision = await getRevision({
    context,
    organization: updatedFeature.organization,
    featureId: updatedFeature.id,
    feature: updatedFeature,
    version: updatedFeature.version,
  });
  return {
    feature: updatedFeature,
    organization,
    groupMap,
    experimentMap,
    revision,
    safeRolloutMap,
  };
}

export const setFeatureEnvironmentDefault = createApiRequestHandler(
  setFeatureEnvironmentDefaultValidator,
)(async (req) => {
  const data = await applyEnvironmentDefault(
    req.context,
    req.organization,
    req.eventAudit,
    req.params.id,
    req.body.environment,
    req.body.value,
    canUseRestApiBypassSetting(req),
  );
  return {
    feature: await resolveOwnerEmail(getApiFeatureObj(data), req.context),
  };
});

export const unsetFeatureEnvironmentDefault = createApiRequestHandler(
  unsetFeatureEnvironmentDefaultValidator,
)(async (req) => {
  const data = await applyEnvironmentDefault(
    req.context,
    req.organization,
    req.eventAudit,
    req.params.id,
    req.params.environment,
    undefined,
    canUseRestApiBypassSetting(req),
  );
  return {
    feature: await resolveOwnerEmail(getApiFeatureObj(data), req.context),
  };
});
