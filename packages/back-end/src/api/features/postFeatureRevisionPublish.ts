import { postFeatureRevisionPublishValidator } from "shared/validators";
import type { ApiRequestLocals } from "back-end/types/api";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature, publishRevision } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { addTagsDiff } from "back-end/src/models/TagModel";
import {
  assertFeatureValuesValidForPublish,
  getMergeResultPublishEnvs,
  toApiRevision,
} from "back-end/src/services/features";
import {
  dispatchFeatureRevisionEvent,
  getPublishedRevisionForEvents,
} from "back-end/src/services/featureRevisionEvents";
import {
  collectFeaturePublishGates,
  planFeatureRevisionMerge,
} from "back-end/src/services/featurePublishGates";
import { assertFeatureArchiveDependentsGuard } from "back-end/src/services/archiveDependentsGuard";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "back-end/src/util/errors";
import {
  evaluatePublishGates,
  PublishBlockedError,
} from "back-end/src/revisions/publishGates";
import { canUseRestApiBypassSetting } from "./reviewBypass";

export async function publishFeatureRevision(
  req: Pick<ApiRequestLocals, "context" | "organization" | "audit"> & {
    params: { id: string; version: number };
    body: {
      comment?: string;
      ignoreWarnings?: boolean;
    };
  },
  canUseRestApiBypass: boolean,
  // Interactive REST publishes surface publish-time value + custom-hook failures
  // as structured publish gates (and skip the throwing re-run inside
  // publishRevision). Armed/scheduled publishes (no interactive request
  // disposition) leave this false and keep the original throwing checks so their
  // block-vs-suppress behavior — which relies on the background context's
  // always-true ignoreWarnings — is preserved exactly.
  inlineValidationGates: boolean = false,
) {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  // Publish is gated per-env by canPublishFeature below; no manage required.

  const revision = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    feature,
    version: req.params.version,
  });
  if (!revision) throw new NotFoundError("Could not find feature revision");

  if (revision.status === "published" || revision.status === "discarded") {
    throw new BadRequestError(
      `Cannot publish a revision with status "${revision.status}"`,
    );
  }

  // Merge planning (autoMerge, rebase governance, review requirement) is the
  // shared implementation also used by the bulk publisher's feature adapter.
  const plan = await planFeatureRevisionMerge({
    context: req.context,
    feature,
    revision,
  });
  const { environmentIds, mergeResult: mergeChanges } = plan;
  if (!plan.hasChanges) {
    throw new BadRequestError(
      "Cannot publish: no changes detected in this revision",
    );
  }

  // Governance friction: when the org enforces same-base merges, a stale or
  // diverged draft can't be force-merged on publish without bypass authority.
  // `ignoreWarnings` is the explicit "merge anyway" opt-in but — like the
  // dashboard's adminOverride — only takes effect for callers with
  // bypass-approval permission; asking without it fails loudly rather than
  // silently re-blocking. Read off the body, NOT `req.context.ignoreWarnings`:
  // armed publishes re-enter this function with a background context whose
  // ignoreWarnings is always true, and force-merge for those must stay gated on
  // the schedule's persisted bypass intent (passed as body ignoreWarnings).
  const canBypassGovernance =
    req.context.permissions.canBypassApprovalChecks(feature);
  const forceMergeRequested = req.body.ignoreWarnings === true;

  // Bypass via restApiBypassesReviews (API keys/PATs only — JWT-backed REST
  // calls should behave like dashboard actions) or bypassApprovalChecks.
  const canBypass =
    canUseRestApiBypass ||
    req.context.permissions.canBypassApprovalChecks(feature);

  // Aggregate every publish gate up front so a blocked publish returns ONE
  // structured 422 naming each gate, the flag that clears it, and a callable
  // resolution route. Gates are assembled for every ACTIVE condition (whether
  // or not the caller can bypass it) so a successful publish can report the
  // ones that were bypassed. Shared implementation with the bulk publisher's
  // feature adapter; the sequential checks below stay as the enforcement
  // backstop. Validation/hook gates run only for interactive publishes
  // (armed/scheduled ones keep the throwing checks — their suppress-vs-block
  // behavior relies on the background context's always-true ignoreWarnings);
  // when gated here, publishRevision skips its prevalidatePublishRevision
  // re-run so the nets (and the sandboxed hooks) don't double-execute.
  const gates = await collectFeaturePublishGates({
    context: req.context,
    feature,
    revision,
    plan,
    comment: req.body.comment,
    includeValidationGates: inlineValidationGates,
  });

  // Feature governance gates rebase on the bypass-approval permission alone (not
  // the org REST setting), so `canForceMergeStaleBase` is the permission — matching
  // the sequential backstop below. Approval, however, is also bypassed by the REST
  // setting (`canUseRestApiBypass`).
  const { blocking, bypassed } = evaluatePublishGates(gates, {
    // On the interactive path also honor the query alias (`?ignoreWarnings=true`)
    // via context.ignoreWarnings, matching the other entities. NOT on the armed
    // path: a background context has ignoreWarnings always-true, and its
    // stale-base force-merge must stay gated on the body's persisted intent —
    // see forceMergeRequested above.
    ignoreWarnings:
      forceMergeRequested ||
      (inlineValidationGates && req.context.ignoreWarnings),
    skipSchemaValidation: req.context.skipSchemaValidation,
    skipHooks: req.context.skipHooks,
    bypassApprovalPermission:
      req.context.permissions.canBypassApprovalChecks(feature),
    restApiBypassesReviews: canUseRestApiBypass,
    canForceMergeStaleBase: canBypassGovernance,
  });
  if (blocking.length) {
    throw new PublishBlockedError(blocking);
  }

  if (plan.rebaseRequired) {
    if (forceMergeRequested && !canBypassGovernance) {
      req.context.permissions.throwPermissionError();
    }
    if (!canBypassGovernance) {
      throw new ConflictError(
        `${plan.rebaseBlockReason} Rebase the revision (POST .../rebase) first, or pass \`"ignoreWarnings": true\` to force-merge (requires the bypass-approval permission).`,
      );
    }
  }

  if (plan.requiresReview && revision.status !== "approved" && !canBypass) {
    throw new BadRequestError(
      `This revision requires approval before publishing (status: "${revision.status}"). ` +
        "Enable 'REST API always bypasses approval requirements' in organization settings, " +
        "or use a role/token that grants bypassApprovalChecks on this project.",
    );
  }

  const envsToCheck = await getMergeResultPublishEnvs({
    context: req.context,
    feature,
    filledLiveRules: plan.filledLiveRules,
    result: mergeChanges,
    environmentIds,
  });
  if (!req.context.permissions.canPublishFeature(feature, envsToCheck)) {
    req.context.permissions.throwPermissionError();
  }

  // Armed/scheduled path only: the feature's own-schema value net still throws
  // here (interactive publishes ran it above as a gate). The config-backed net +
  // custom hooks run in publishRevision -> prevalidatePublishRevision below.
  if (!inlineValidationGates) {
    assertFeatureValuesValidForPublish(req.context, feature, {
      defaultValue: mergeChanges.defaultValue,
      rules: mergeChanges.rules,
    });
  }

  // Armed/scheduled path only: the same archive-dependents check as a throw
  // (interactive publishes emitted it as a gate above). Features have no arm-time
  // acknowledgment machinery, so a deferred fire re-enters with a background
  // context whose ignoreWarnings is always true and proceeds (best-effort).
  if (
    !inlineValidationGates &&
    mergeChanges.archived === true &&
    !feature.archived
  ) {
    await assertFeatureArchiveDependentsGuard(req.context, feature);
  }

  const updatedFeature = await publishRevision({
    context: req.context,
    feature,
    revision,
    result: mergeChanges,
    comment: req.body.comment ?? "",
    // bypassLockdown intentionally mirrors canBypassApprovalChecks. The policy
    // choice: anyone who can skip the revision-review queue (admins and API keys
    // with restApiBypassesReviews) can also override a ramp lockdown. Lockdown is
    // a safety gate against accidental live-traffic changes, not a security
    // boundary — the same elevated trust that lets you skip review also lets you
    // push through a lockdown. If you need a stricter separation in the future,
    // introduce a dedicated canBypassRampLockdown() permission method here.
    bypassLockdown: canBypass,
    // Interactive publishes already ran the config-backed net + hooks above as
    // publish gates; skip the prevalidatePublishRevision re-run so hooks don't
    // double-execute and gated failures aren't re-thrown outside the structured
    // 422. Armed/scheduled publishes keep the throwing re-run.
    skipPrevalidateValidation: inlineValidationGates,
  });

  if (
    mergeChanges.metadata?.tags !== undefined &&
    Array.isArray(mergeChanges.metadata.tags)
  ) {
    await addTagsDiff(
      req.organization.id,
      feature.tags || [],
      mergeChanges.metadata.tags,
    );
  }

  await req.audit({
    event: "feature.publish",
    entity: {
      object: "feature",
      id: feature.id,
    },
    details: auditDetailsUpdate(feature, updatedFeature, {
      revision: revision.version,
      comment: req.body.comment ?? "",
    }),
  });

  // Re-read so the event carries the published status; falls back to the
  // in-memory revision instead of failing the already-committed publish.
  const finalRevision = await getPublishedRevisionForEvents(
    req.context,
    updatedFeature,
    revision,
  );

  await dispatchFeatureRevisionEvent(
    req.context,
    updatedFeature,
    finalRevision,
    "revision.published",
    {},
  );

  return {
    feature,
    revision: finalRevision,
    bypassedGates: bypassed.length ? bypassed : undefined,
  };
}

export const postFeatureRevisionPublish = createApiRequestHandler(
  postFeatureRevisionPublishValidator,
)(async (req) => {
  const { feature, revision, bypassedGates } = await publishFeatureRevision(
    req,
    canUseRestApiBypassSetting(req),
    true,
  );
  return {
    revision: toApiRevision(revision, req.context, feature),
    ...(bypassedGates?.length ? { bypassedGates } : {}),
  };
});
