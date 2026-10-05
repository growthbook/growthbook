import { getCreateReviewRequirement, orgRequiresAnyReview } from "shared/util";
import type { FeatureInterface } from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { ApiRequestLocals } from "back-end/types/api";
import type { BypassedGate } from "back-end/src/revisions/publishGates";
import {
  getEnvironmentIdsFromOrg,
  getEnvironments,
} from "back-end/src/services/organizations";
import { deleteFeature, getFeature } from "back-end/src/models/FeatureModel";
import {
  createRevision,
  getRevision,
  markRevisionAsReviewRequested,
} from "back-end/src/models/FeatureRevisionModel";
import {
  auditDetailsCreate,
  auditDetailsUpdate,
} from "back-end/src/services/audit";
import { dispatchFeatureRevisionEvent } from "back-end/src/services/featureRevisionEvents";
import {
  applySafetyCheck,
  formatList,
  strictEnvironmentChecksOn,
  type SafetyCheckRequest,
} from "back-end/src/util/apiSafetyChecks";
import { logger } from "back-end/src/util/logger";
import {
  canBypassReviewChecks,
  canUseRestApiBypassSetting,
} from "./reviewBypass";

type CreateRequest = SafetyCheckRequest &
  Pick<ApiRequestLocals, "context" | "isJwtAuth" | "audit">;

// The environments whose approval rules gate turning them on decide the create:
// rejected, reported, bypassed, or (with `requestReview`) switched off in
// `feature` and returned for a draft to turn on.
export function resolveCreateApproval(
  req: CreateRequest,
  feature: FeatureInterface,
  requestReview: boolean,
): { draftEnvironments: string[]; bypassedGates: BypassedGate[] } {
  const none = { draftEnvironments: [], bypassedGates: [] };
  if (!orgRequiresAnyReview(req.context.org.settings)) return none;
  const { environments } = getCreateReviewRequirement({
    feature,
    orgEnvironments: getEnvironments(req.context.org),
    settings: req.context.org.settings,
    requireApprovalsLicensed:
      req.context.hasPremiumFeature("require-approvals"),
  });
  if (!environments.length) return none;

  if (requestReview) {
    if (!req.context.permissions.canEditFeatureDrafts(feature)) {
      req.context.permissions.throwPermissionError();
    }
    for (const env of environments) {
      feature.environmentSettings[env] = {
        ...feature.environmentSettings[env],
        enabled: false,
      };
    }
    return { draftEnvironments: environments, bypassedGates: [] };
  }

  const canBypass = canBypassReviewChecks(req, feature);
  const list = formatList(environments);
  const fix = `Send \`requestReview: true\` to create it disabled in ${list}, with a draft that enables ${list} and requests review.`;
  applySafetyCheck(req, "create_requires_approval", {
    violated: !canBypass,
    message: `Enabling ${list} on a new Feature Flag requires approval. ${fix}`,
    notice: `Enabling ${list} on a new Feature Flag needs approval under this organization's review rules. ${fix}`,
    path: "environments",
    details: { environments },
  });
  if (!canBypass || !strictEnvironmentChecksOn(req.context.org)) return none;
  return {
    draftEnvironments: [],
    bypassedGates: [
      {
        type: "approval-required",
        outcome: "bypassed",
        via: canUseRestApiBypassSetting(req)
          ? "restApiBypassesReviews"
          : "bypassApprovalPermission",
      },
    ],
  };
}

// Run straight after the create. A failure removes the Feature Flag again, so
// the request either lands whole or not at all.
export async function openCreateReviewDraft(
  req: CreateRequest,
  created: FeatureInterface,
  environments: string[],
  comment: string,
): Promise<FeatureRevisionInterface> {
  try {
    const feature = await getFeature(req.context, created.id);
    if (!feature) throw new Error(`Feature id '${created.id}' not found.`);
    const draft = await createRevision({
      context: req.context,
      feature,
      user: req.context.auditUser,
      baseVersion: feature.version,
      comment,
      environments: getEnvironmentIdsFromOrg(req.context.org),
      publish: false,
      changes: {
        environmentsEnabled: Object.fromEntries(
          environments.map((env) => [env, true]),
        ),
      },
      org: req.context.org,
      canBypassApprovalChecks: false,
    });
    await markRevisionAsReviewRequested(
      req.context,
      draft,
      req.context.auditUser,
      comment,
    );
    const requested = await getRevision({
      context: req.context,
      organization: feature.organization,
      featureId: feature.id,
      feature,
      version: draft.version,
    });
    return requested ?? { ...draft, status: "pending-review" };
  } catch (e) {
    await deleteFeature(req.context, created).catch((cleanupError) =>
      logger.error(
        cleanupError,
        `Failed to remove feature ${created.id} after its review draft failed`,
      ),
    );
    throw e;
  }
}

export async function recordCreateReviewDraft(
  req: CreateRequest,
  feature: FeatureInterface,
  draft: FeatureRevisionInterface,
  comment: string,
): Promise<void> {
  await req.audit({
    event: "feature.revision.create",
    entity: { object: "feature", id: feature.id },
    details: auditDetailsCreate({
      featureId: feature.id,
      version: draft.version,
      baseVersion: draft.baseVersion,
      comment: draft.comment,
    }),
  });
  await req.audit({
    event: "feature.revision.requestReview",
    entity: { object: "feature", id: feature.id },
    details: auditDetailsUpdate(
      { status: "draft" },
      { status: draft.status },
      { version: draft.version, comment },
    ),
  });
  // Best-effort: the Feature Flag and its draft are already committed.
  try {
    await dispatchFeatureRevisionEvent(
      req.context,
      feature,
      draft,
      "revision.created",
      {},
    );
    await dispatchFeatureRevisionEvent(
      req.context,
      feature,
      draft,
      "revision.reviewRequested",
      { reviewComment: comment || null },
    );
  } catch (e) {
    logger.error(
      e,
      `Failed to dispatch review events for feature ${feature.id}`,
    );
  }
}
