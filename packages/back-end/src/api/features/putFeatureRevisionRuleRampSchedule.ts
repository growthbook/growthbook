import type { OrganizationInterface } from "shared/types/organization";
import {
  RevisionRampUpdateAction,
  RampStartState,
  putFeatureRevisionRuleRampScheduleValidator,
} from "shared/validators";
import { resetReviewOnChange } from "shared/util";
import { resolveRampStartState } from "back-end/src/services/rampSchedule";
import type { ApiReqContext } from "back-end/types/api";
import { toApiRevision } from "back-end/src/services/features";
import { recordRevisionUpdate } from "back-end/src/services/featureRevisionEvents";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import {
  getApplicableEnvIds,
  resolveRampTarget,
  ruleFootprint,
} from "back-end/src/util/flattenRules";
import { getEnvironments } from "back-end/src/util/organization.util";
import {
  assertValidEnvironment,
  discardIfJustCreated,
  isDraftStatus,
  normalizeInlineRampSchedule,
  resolveOrCreateRevision,
} from "./validations";

export async function setRuleRampSchedule(
  context: ApiReqContext,
  organization: OrganizationInterface,
  params: { id: string; version: number | "new"; ruleId: string },
  body: {
    environment?: string;
    revisionTitle?: string;
    revisionComment?: string;
    // All remaining fields are forwarded as the inline schedule definition.
    [k: string]: unknown;
  },
) {
  const feature = await getFeature(context, params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (!context.permissions.canManageFeatureDrafts(feature)) {
    context.permissions.throwPermissionError();
  }

  const { ruleId } = params;
  const { environment, revisionTitle, revisionComment, ...scheduleInput } =
    body;
  if (environment) assertValidEnvironment(context, environment);

  const { revision, created } = await resolveOrCreateRevision(
    context,
    organization.id,
    feature,
    params.version,
    { title: revisionTitle, comment: revisionComment },
  );

  try {
    if (!isDraftStatus(revision.status)) {
      throw new BadRequestError(
        `Cannot edit a revision with status "${revision.status}"`,
      );
    }

    const envSuffix = environment ? ` in environment "${environment}"` : "";

    // Check draft first, then live — a ramp schedule may target a live rule
    // the draft hasn't touched. resolveRampTarget matches the v2 unified
    // rules array via stem+env quadrants (see its JSDoc).
    const draftMatch = resolveRampTarget(
      { ruleId, environment: environment ?? null },
      revision.rules ?? [],
    );
    const liveMatch = resolveRampTarget(
      { ruleId, environment: environment ?? null },
      feature.rules ?? [],
    );
    const match = draftMatch ?? liveMatch;
    if (!match) {
      throw new NotFoundError(`Rule "${ruleId}" not found${envSuffix}`);
    }

    // Canonical id the revision stores this rule under. All persisted
    // references (rampActions.ruleId, audit subject, event payload) must use
    // `match.id`, not the caller's URL param — otherwise round-trip cleanup
    // (DELETE by the GET-returned id) breaks for stem↔suffix ambiguity.
    const canonicalRuleId = match.id;

    // If an active live schedule controls this rule, queue a deferred
    // revision-time `update` action instead of requiring an instant write via
    // PUT /ramp-schedule/:id. This keeps config edits revision-controlled.
    const liveSchedules = await context.models.rampSchedules.findByTargetRule(
      canonicalRuleId,
      environment ?? undefined,
    );
    const existingLiveSchedule = liveSchedules[0];

    // Resolve the rollback anchor. An explicit `startState` is converted to
    // startActions (merged onto the rule's current state); when omitted, the
    // anchor is derived at publish from the rule's coverage — and we warn if
    // that isn't 0% on create.
    const startStateProvided = scheduleInput.startState !== undefined;
    const { startActions: resolvedStartActions, warning: startStateWarning } =
      resolveRampStartState({
        rule: match,
        ruleId: canonicalRuleId,
        startState: scheduleInput.startState as RampStartState | undefined,
        isCreate: !existingLiveSchedule,
      });
    if (resolvedStartActions) {
      scheduleInput.startActions = resolvedStartActions;
    }
    delete scheduleInput.startState;

    const warnings: string[] = [];
    if (startStateWarning) warnings.push(startStateWarning);
    // The rollback anchor is only persisted while a schedule is pending/ready
    // (see FeatureModel). Updating an already-active schedule's startState is a
    // no-op, so tell the caller rather than returning a misleading success.
    if (
      startStateProvided &&
      existingLiveSchedule &&
      existingLiveSchedule.status !== "pending" &&
      existingLiveSchedule.status !== "ready"
    ) {
      warnings.push(
        `startState was ignored: ramp schedule "${existingLiveSchedule.id}" is "${existingLiveSchedule.status}", and the rollback anchor can only be changed while a schedule is pending or ready.`,
      );
    }

    const action = normalizeInlineRampSchedule(
      scheduleInput as Parameters<typeof normalizeInlineRampSchedule>[0],
      canonicalRuleId,
    );

    // Replace any existing pending ramp action for this rule. Filter tolerant
    // to both the canonical id AND the caller-provided id, so stale entries
    // written under either form (legacy buggy writes, or stem/suffix variants)
    // get cleaned up on the next set.
    const filtered = (revision.rampActions ?? []).filter(
      (a) =>
        !("ruleId" in a) ||
        (a.ruleId !== canonicalRuleId && a.ruleId !== ruleId),
    );
    const revisionAction = existingLiveSchedule
      ? ({
          ...action,
          mode: "update",
          rampScheduleId: existingLiveSchedule.id,
        } as RevisionRampUpdateAction)
      : action;
    const newRampActions = [...filtered, revisionAction];

    // `changedEnvironments` drives per-env review reset and audit env fanout.
    // When the caller didn't specify an env, use the resolved rule's full env
    // footprint — semantically the ramp affects every env the rule covers.
    const orgEnvs = getEnvironments(organization);
    const applicableEnvs = getApplicableEnvIds(orgEnvs, feature.project);
    const changedEnvironments = environment
      ? [environment]
      : ruleFootprint(match, applicableEnvs);

    await updateRevision(
      context,
      feature,
      revision,
      { rampActions: newRampActions },
      {
        user: context.auditUser,
        action: "set ramp schedule",
        subject: canonicalRuleId,
        value: JSON.stringify(revisionAction),
      },
      resetReviewOnChange({
        feature,
        changedEnvironments,
        defaultValueChanged: false,
        settings: organization.settings,
      }),
    );

    const updated = await getRevision({
      context,
      organization: organization.id,
      featureId: feature.id,
      feature,
      version: revision.version,
    });
    const finalRevision = updated ?? revision;

    await recordRevisionUpdate(
      context,
      feature,
      finalRevision,
      "rule.rampSchedule.set",
      {
        environments: changedEnvironments,
        auditDetails: { ruleId: canonicalRuleId },
      },
    );

    return {
      feature,
      revision: finalRevision,
      warnings: warnings.length ? warnings : undefined,
    };
  } catch (err) {
    await discardIfJustCreated(context, revision, created);
    throw err;
  }
}

export const putFeatureRevisionRuleRampSchedule = createApiRequestHandler(
  putFeatureRevisionRuleRampScheduleValidator,
)(async (req) => {
  const { feature, revision } = await setRuleRampSchedule(
    req.context,
    req.organization,
    req.params,
    req.body,
  );
  return { revision: toApiRevision(revision, req.context, feature) };
});
