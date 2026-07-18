import { postFeatureRevisionPublishValidator } from "shared/validators";
import {
  autoMerge,
  checkIfRevisionNeedsReview,
  draftDiffersFromLive,
  evaluatePublishGovernance,
  fillRevisionFromFeature,
  filterEnvironmentsByFeature,
  getEnvsFromRampSchedule,
  getLiveChangesSinceBase,
  liveRevisionFromFeature,
} from "shared/util";
import type { ApiRequestLocals } from "back-end/types/api";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  computeProposedFeatureForValidation,
  getFeature,
  publishRevision,
} from "back-end/src/models/FeatureModel";
import {
  computeRevisionPublishChanges,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { addTagsDiff } from "back-end/src/models/TagModel";
import {
  assertFeatureValuesValidForPublish,
  collectFeatureValueErrorsForPublish,
  getLiveAndBaseRevisionsForFeature,
  getMergeResultPublishEnvs,
  toApiRevision,
} from "back-end/src/services/features";
import { collectConfigBackedFeatureValueErrors } from "back-end/src/services/configValidation";
import {
  collectValidateFeatureHookResults,
  collectValidateFeatureRevisionHookResults,
} from "back-end/src/enterprise/sandbox/sandbox-eval";
import {
  dispatchFeatureRevisionEvent,
  getPublishedRevisionForEvents,
} from "back-end/src/services/featureRevisionEvents";
import { assertFeatureArchiveDependentsGuard } from "back-end/src/services/archiveDependentsGuard";
import { getEnvironments } from "back-end/src/util/organization.util";
import {
  BadRequestError,
  ConflictError,
  MergeConflictError,
  NotFoundError,
} from "back-end/src/util/errors";
import {
  evaluatePublishGates,
  PublishBlockedError,
  PublishGate,
  schemaFailureGateOverride,
} from "back-end/src/revisions/publishGates";
import { canUseRestApiBypassSetting } from "./reviewBypass";

export async function publishFeatureRevision(
  req: Pick<ApiRequestLocals, "context" | "organization" | "audit"> & {
    params: { id: string; version: number };
    body: {
      comment?: string;
      mergeNow?: boolean;
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

  if (!req.context.permissions.canUpdateFeature(feature, {})) {
    req.context.permissions.throwPermissionError();
  }

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

  const allEnvironments = getEnvironments(req.context.org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);

  const { live, base } = await getLiveAndBaseRevisionsForFeature({
    context: req.context,
    feature,
    revision,
  });

  const hasLinkedPendingRamp =
    (
      await req.context.models.rampSchedules.findByActivatingRevision(
        feature.id,
        revision.version,
      )
    ).length > 0;
  const hasChanges =
    draftDiffersFromLive(revision, live, feature, environmentIds) ||
    hasLinkedPendingRamp;
  if (!hasChanges) {
    throw new BadRequestError(
      "Cannot publish: no changes detected in this revision",
    );
  }

  // Review requirements are evaluated against the post-merge state.
  const mergeResult = autoMerge(
    liveRevisionFromFeature(live, feature),
    fillRevisionFromFeature(base, feature),
    revision,
    environmentIds,
    {},
  );

  if (!mergeResult.success) {
    throw new MergeConflictError(
      "Merge conflicts exist — rebase before publishing",
      mergeResult.conflicts,
    );
  }

  // Governance friction: when the org enforces same-base merges, a stale or
  // diverged draft can't be force-merged on publish without bypass authority.
  // `ignoreWarnings` (or the deprecated `mergeNow` alias) is the explicit
  // "merge anyway" opt-in but — like the dashboard's adminOverride — only takes
  // effect for callers with bypass-approval permission; asking without it fails
  // loudly rather than silently re-blocking. Read off the body, NOT
  // `req.context.ignoreWarnings`: armed publishes re-enter this function with a
  // background context whose ignoreWarnings is always true, and force-merge for
  // those must stay gated on the schedule's persisted bypass intent (mergeNow).
  // Computed unconditionally (it's a cheap in-memory check, no DB scan) so a
  // force-merged publish can still report the stale-base gate it bypassed;
  // enforced below after the aggregated publish-gate check.
  const canBypassGovernance =
    req.context.permissions.canBypassApprovalChecks(feature);
  const forceMergeRequested =
    !!req.body.mergeNow || req.body.ignoreWarnings === true;
  const rebaseGovernance = req.organization.settings?.requireRebaseBeforePublish
    ? evaluatePublishGovernance({
        revisionStatus: revision.status,
        baseVersion: revision.baseVersion,
        liveVersion: feature.version,
        mergeSuccess: mergeResult.success,
        liveChanges: getLiveChangesSinceBase(
          liveRevisionFromFeature(live, feature),
          fillRevisionFromFeature(base, feature),
          environmentIds,
        ),
        approvedBaseVersion: revision.approvedBaseVersion ?? null,
        requireRebaseBeforePublish: true,
      })
    : null;

  const filledLive = {
    ...live,
    ...liveRevisionFromFeature(live, feature),
  };
  // Post-unification `rules` is a flat `FeatureRule[]`. `mergeResult.result.rules`
  // is either absent (no rule change) or the authoritative merged array — no
  // per-env object merging needed. Spreading arrays into an object literal and
  // merging by numeric index here would silently corrupt downstream review /
  // permission checks that key off env names.
  const effectiveRevision = {
    ...filledLive,
    ...mergeResult.result,
    // rampActions live on the draft revision; autoMerge doesn't carry them
    // through MergeResultChanges, so we must re-attach them explicitly so
    // that checkIfRevisionNeedsReview can inspect the ramp-schedule changes.
    rampActions: revision.rampActions,
  };

  // For ramp `update` actions, the live schedule's step patches may include
  // environments that the new draft removes. Build a map so the review check
  // can union old+new environments and catch the "removing env" direction.
  const liveRampScheduleEnvs = new Map<string, string[] | "all">();
  for (const action of revision.rampActions ?? []) {
    if (action.mode !== "update") continue;
    const liveSchedule = await req.context.models.rampSchedules.getById(
      action.rampScheduleId,
    );
    if (liveSchedule) {
      liveRampScheduleEnvs.set(
        action.rampScheduleId,
        getEnvsFromRampSchedule(liveSchedule),
      );
    }
  }

  const requiresReview = checkIfRevisionNeedsReview({
    feature,
    baseRevision: filledLive,
    revision: effectiveRevision,
    allEnvironments: environmentIds,
    settings: req.organization.settings,
    requireApprovalsLicensed:
      req.context.hasPremiumFeature("require-approvals"),
    liveRampScheduleEnvs,
  });

  // Bypass via restApiBypassesReviews (API keys/PATs only — JWT-backed REST
  // calls should behave like dashboard actions) or bypassApprovalChecks.
  const canBypass =
    canUseRestApiBypass ||
    req.context.permissions.canBypassApprovalChecks(feature);

  // Aggregate every publish gate up front so a blocked publish returns ONE
  // structured 422 naming each gate, the flag that clears it, and a callable
  // resolution route. Gates are assembled for every ACTIVE condition (whether
  // or not the caller can bypass it) so a successful publish can report the ones
  // that were bypassed. The sequential checks below stay in place as the
  // enforcement backstop.
  const version = revision.version;
  const gates: PublishGate[] = [];
  if (rebaseGovernance?.rebaseRequired) {
    gates.push({
      type: "stale-base",
      severity: "blocker",
      messages: ["This revision was created against an older version."],
      override: "ignoreWarnings",
      requiresPermission: "bypassApprovalChecks",
      resolution: {
        action: "rebase",
        method: "POST",
        path: `/features/${feature.id}/revisions/${version}/rebase`,
      },
    });
  }
  if (requiresReview && revision.status !== "approved") {
    gates.push({
      type: "approval-required",
      severity: "blocker",
      messages: [
        `Requires approval before publishing (status: "${revision.status}").`,
      ],
      override: null,
      requiresPermission: "bypassApprovalChecks",
      resolution: {
        action: "request-review",
        method: "POST",
        path: `/features/${feature.id}/revisions/${version}/request-review`,
      },
    });
  }
  // Publish-time value + custom-hook validation, surfaced as gates instead of
  // thrown (mirrors the config publish handler) — but only for interactive REST
  // publishes. Armed/scheduled publishes keep the throwing checks below (their
  // suppress-vs-block behavior depends on the background context's always-true
  // ignoreWarnings, which the gate model — keyed on the body's mergeNow — would
  // not reproduce). When gated here, publishRevision is told to skip its
  // prevalidatePublishRevision re-run so the nets (and the sandboxed hooks) don't
  // double-execute.
  if (inlineValidationGates) {
    const { proposedFeature, defaultToCheck, rulesToCheck } =
      computeProposedFeatureForValidation(
        req.context,
        feature,
        revision,
        mergeResult.result,
      );

    // Schema-family failures: the feature's own JSON-schema value errors (checked
    // against the full merged values) plus the config-backed schema/invariant net
    // (only the changed subset, matching prevalidatePublishRevision). One gate,
    // override chosen by the org's blockPublishOnSchemaError setting: block ->
    // validation-class (skipSchemaValidation); warn -> acknowledge-class.
    const schemaErrors = [
      ...collectFeatureValueErrorsForPublish(feature, {
        defaultValue: mergeResult.result.defaultValue,
        rules: mergeResult.result.rules,
      }),
      ...(defaultToCheck !== undefined || rulesToCheck.length
        ? await collectConfigBackedFeatureValueErrors(
            req.context,
            proposedFeature,
            { defaultValue: defaultToCheck, rules: rulesToCheck },
          )
        : []),
    ];
    if (schemaErrors.length) {
      gates.push({
        type: "schema-break",
        severity: "warning",
        messages: ["Invalid feature value:", ...schemaErrors],
        ...schemaFailureGateOverride(
          req.context.org.settings?.blockPublishOnSchemaError !== false,
        ),
        resolution: null,
      });
    }

    // Custom validation hooks: a hard error (a hook threw) is validation-class
    // (skipSchemaValidation); a warning is acknowledge-class (ignoreWarnings). Run
    // both feature hook types here so prevalidatePublishRevision (skipped below)
    // doesn't re-execute the sandboxed hooks. `original` is the live feature/
    // revision so incrementalChangesOnly hooks can suppress pre-existing outcomes,
    // mirroring prevalidatePublishRevision.
    const featureHookResults = await collectValidateFeatureHookResults({
      context: req.context,
      feature: proposedFeature,
      original: feature,
    });
    const revisionHookResults = await collectValidateFeatureRevisionHookResults(
      {
        context: req.context,
        feature,
        revision: {
          ...revision,
          ...computeRevisionPublishChanges(
            revision,
            req.context.auditUser,
            req.body.comment ?? "",
          ),
        },
        original: revision,
      },
    );
    const hookHardErrors = [
      ...featureHookResults.hardErrors,
      ...revisionHookResults.hardErrors,
    ];
    const hookWarnings = [
      ...featureHookResults.warnings,
      ...revisionHookResults.warnings,
    ];
    if (hookHardErrors.length) {
      gates.push({
        type: "custom-hook",
        severity: "blocker",
        messages: [
          "A custom validation hook rejected this publish:",
          ...hookHardErrors,
        ],
        override: "skipHooks",
        requiresPermission: "bypassApprovalChecks",
        resolution: null,
      });
    }
    if (hookWarnings.length) {
      gates.push({
        type: "custom-hook",
        severity: "warning",
        messages: [
          "A custom validation hook raised a warning:",
          ...hookWarnings,
        ],
        override: "ignoreWarnings",
        requiresPermission: null,
        resolution: null,
      });
    }
  }

  // Feature governance gates rebase on the bypass-approval permission alone (not
  // the org REST setting), so `canForceMergeStaleBase` is the permission — matching
  // the sequential backstop below. Approval, however, is also bypassed by the REST
  // setting (`canUseRestApiBypass`).
  const { blocking, bypassed } = evaluatePublishGates(gates, {
    ignoreWarnings: forceMergeRequested,
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

  if (rebaseGovernance?.rebaseRequired) {
    if (forceMergeRequested && !canBypassGovernance) {
      req.context.permissions.throwPermissionError();
    }
    if (!canBypassGovernance) {
      throw new ConflictError(
        `${rebaseGovernance.blockReason} Rebase the revision (POST .../rebase) first, or pass \`"ignoreWarnings": true\` to force-merge (requires the bypass-approval permission).`,
      );
    }
  }

  if (requiresReview && revision.status !== "approved" && !canBypass) {
    throw new BadRequestError(
      `This revision requires approval before publishing (status: "${revision.status}"). ` +
        "Enable 'REST API always bypasses approval requirements' in organization settings, " +
        "or use a role/token that grants bypassApprovalChecks on this project.",
    );
  }

  const envsToCheck = await getMergeResultPublishEnvs({
    context: req.context,
    feature,
    filledLiveRules: filledLive.rules,
    result: mergeResult.result,
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
      defaultValue: mergeResult.result.defaultValue,
      rules: mergeResult.result.rules,
    });
  }

  // Archiving a feature that live features gate on as a prerequisite (or that
  // running experiments list as a prerequisite) drops those dependents from the
  // SDK payload — a soft, acknowledgeable warning, bypassable by ignoreWarnings
  // alone. Only the archive transition is guarded. Features have no arm-time
  // acknowledgment machinery, so a deferred (armed) fire re-enters with a
  // background context whose ignoreWarnings is always true and proceeds
  // (best-effort — see archiveDependentsGuard).
  if (mergeResult.result.archived === true && !feature.archived) {
    await assertFeatureArchiveDependentsGuard(req.context, feature);
  }

  const updatedFeature = await publishRevision({
    context: req.context,
    feature,
    revision,
    result: mergeResult.result,
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
    mergeResult.result.metadata?.tags !== undefined &&
    Array.isArray(mergeResult.result.metadata.tags)
  ) {
    await addTagsDiff(
      req.organization.id,
      feature.tags || [],
      mergeResult.result.metadata.tags,
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
