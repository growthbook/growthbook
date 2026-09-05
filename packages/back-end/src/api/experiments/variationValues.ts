import {
  ExperimentInterface,
  FeatureInterface,
  getExperimentVariationValuesValidator,
  postExperimentVariationValuesDetachValidator,
  postExperimentVariationValuesDiscardValidator,
  postExperimentVariationValuesPublishValidator,
  postExperimentVariationValuesRebaseValidator,
  postExperimentVariationValuesRecallReviewValidator,
  postExperimentVariationValuesRequestReviewValidator,
  postExperimentVariationValuesSubmitReviewValidator,
  postExperimentVariationValuesUndoReviewValidator,
  postExperimentVariationValuesValidator,
  putExperimentVariationValuesValidator,
} from "shared/validators";
import { ANY_REVIEW_FOOTPRINT } from "shared/util";
import { EventUser } from "shared/types/events/event-types";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";
import {
  getExperimentById,
  clearPendingFeatureDraftsForRevision,
} from "back-end/src/models/ExperimentModel";
import { ApiReqContext } from "back-end/types/api";
import {
  discardRevision,
  getActiveDraft,
  getRevision,
  markRevisionAsReviewRequested,
  recallReview,
  ReviewSubmittedType,
  undoReview,
} from "back-end/src/models/FeatureRevisionModel";
import {
  canAdvanceFeatureDraft,
  canDiscardFeatureDraft,
  canRecallFeatureReview,
} from "back-end/src/revisions/featureDraftAuthority";
import { dispatchFeatureRevisionEvent } from "back-end/src/services/featureRevisionEvents";
import { submitFeatureRevisionReview } from "back-end/src/services/featureRevisionReview";
import { maybeAutoPublishFeatureRevision } from "back-end/src/api/features/autoPublishOnApproval";
import {
  adoptManagedFlagForExperiment,
  ejectManagedFeature,
  getManagedFeatureForExperiment,
  getManagedFlagState,
  publishManagedDraft,
  requestReviewForManagedDraft,
  updateManagedVariationValues,
} from "back-end/src/services/managedFeatures";
import { updateExperimentRuleEnvironments } from "back-end/src/services/experiment-feature";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import { rebaseFeatureRevision } from "back-end/src/api/features/postFeatureRevisionRebase";

/** The one response shape every endpoint here returns. */
async function respond(
  context: ApiReqContext,
  experiment: ExperimentInterface,
) {
  return { variationValues: await getManagedFlagState(context, experiment) };
}

async function requireExperiment(
  context: ApiReqContext,
  id: string,
): Promise<ExperimentInterface> {
  const experiment = await getExperimentById(context, id);
  if (!experiment) throw new NotFoundError("Experiment not found");
  return experiment;
}

/** The Feature Flag this experiment owns, or a 400 when it owns none. */
async function requireManagedFlag(
  context: ApiReqContext,
  experiment: ExperimentInterface,
): Promise<FeatureInterface> {
  const feature = await getManagedFeatureForExperiment(context, experiment);
  if (!feature) {
    throw new BadRequestError(
      "This experiment does not manage a Feature Flag. Create one first with POST /experiments/{id}/variation-values.",
    );
  }
  return feature;
}

export const getExperimentVariationValues = createApiRequestHandler(
  getExperimentVariationValuesValidator,
)(async (req) => {
  const experiment = await requireExperiment(req.context, req.params.id);
  return respond(req.context, experiment);
});

export const postExperimentVariationValues = createApiRequestHandler(
  postExperimentVariationValuesValidator,
)(async (req) => {
  const experiment = await requireExperiment(req.context, req.params.id);
  if (!req.context.permissions.canUpdateExperiment(experiment, {})) {
    req.context.permissions.throwPermissionError();
  }

  await adoptManagedFlagForExperiment({
    context: req.context,
    experiment,
    valueType: req.body.valueType,
    variations: req.body.values,
    sparse: req.body.sparse,
    featureId: req.body.featureKey,
    trackingKey: req.body.trackingKey,
    eventAudit: req.eventAudit,
    audit: req.audit,
  });

  // Re-read: adoption can rename the experiment and always links the new flag.
  return respond(
    req.context,
    await requireExperiment(req.context, experiment.id),
  );
});

export const putExperimentVariationValues = createApiRequestHandler(
  putExperimentVariationValuesValidator,
)(async (req) => {
  const experiment = await requireExperiment(req.context, req.params.id);
  if (!req.context.permissions.canUpdateExperiment(experiment, {})) {
    req.context.permissions.throwPermissionError();
  }
  const feature = await requireManagedFlag(req.context, experiment);

  // Validate everything before writing anything, so a bad environment list
  // cannot leave the values half-applied.
  const scope = req.body.environments;
  if (scope !== undefined && scope !== "all") {
    const known = getEnvironmentIdsFromOrg(req.context.org);
    const unknown = scope.filter((e) => !known.includes(e));
    if (unknown.length) {
      throw new BadRequestError(
        `Unknown environment${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`,
      );
    }
  }

  if (req.body.values) {
    await updateManagedVariationValues({
      context: req.context,
      experiment,
      variations: req.body.values,
      valueType: req.body.valueType,
      sparse: req.body.sparse,
      eventAudit: req.eventAudit,
      audit: req.audit,
    });
  }
  if (scope !== undefined) {
    const { version } = await updateExperimentRuleEnvironments({
      context: req.context,
      experiment,
      feature,
      allEnvironments: scope === "all",
      environments: scope === "all" ? [] : scope,
      eventAudit: req.eventAudit,
    });
    await requestReviewForManagedDraft({
      context: req.context,
      feature,
      version,
      eventAudit: req.eventAudit,
    });
  }

  return respond(req.context, experiment);
});

/** approve / request-changes / comment all land on the same review write. */
/** The pending draft, or a 400 when there is nothing waiting. */
async function requirePendingDraft(
  context: ApiReqContext,
  feature: FeatureInterface,
): Promise<FeatureRevisionInterface> {
  const draft = await getActiveDraft(context, feature);
  if (!draft) {
    throw new BadRequestError("There are no pending variation values.");
  }
  return draft;
}

async function reloadRevision(
  context: ApiReqContext,
  feature: FeatureInterface,
  draft: FeatureRevisionInterface,
): Promise<FeatureRevisionInterface> {
  return (
    (await getRevision({
      context,
      organization: context.org.id,
      featureId: feature.id,
      feature,
      version: draft.version,
    })) ?? draft
  );
}

async function submitManagedReview({
  context,
  experimentId,
  review,
  comment,
  eventAudit,
}: {
  context: ApiReqContext;
  experimentId: string;
  review: ReviewSubmittedType;
  comment: string;
  eventAudit: EventUser;
}) {
  const experiment = await requireExperiment(context, experimentId);
  const feature = await requireManagedFlag(context, experiment);

  const draft = await getActiveDraft(context, feature);
  if (!draft) {
    throw new BadRequestError(
      "There are no pending variation values to review.",
    );
  }

  await submitFeatureRevisionReview({
    context,
    feature,
    version: draft.version,
    review,
    comment,
    eventAudit,
  });

  return respond(context, experiment);
}

const REVIEW_BY_ACTION: Record<
  "approve" | "request-changes" | "comment",
  ReviewSubmittedType
> = {
  approve: "Approved",
  "request-changes": "Requested Changes",
  comment: "Comment",
};

export const postExperimentVariationValuesSubmitReview =
  createApiRequestHandler(postExperimentVariationValuesSubmitReviewValidator)(
    async (req) =>
      submitManagedReview({
        context: req.context,
        experimentId: req.params.id,
        review: REVIEW_BY_ACTION[req.body.action],
        comment: req.body.comment ?? "",
        eventAudit: req.eventAudit,
      }),
  );

export const postExperimentVariationValuesPublish = createApiRequestHandler(
  postExperimentVariationValuesPublishValidator,
)(async (req) => {
  const experiment = await requireExperiment(req.context, req.params.id);
  if (!req.context.permissions.canUpdateExperiment(experiment, {})) {
    req.context.permissions.throwPermissionError();
  }
  await requireManagedFlag(req.context, experiment);

  await publishManagedDraft({
    context: req.context,
    experiment,
    bypassApproval: !!req.body.bypassApproval,
    restApiBypass: canUseRestApiBypassSetting(req),
    comment: req.body.comment ?? "",
    audit: req.audit,
  });

  return respond(req.context, experiment);
});

export const postExperimentVariationValuesDetach = createApiRequestHandler(
  postExperimentVariationValuesDetachValidator,
)(async (req) => {
  const experiment = await requireExperiment(req.context, req.params.id);
  if (!req.context.permissions.canUpdateExperiment(experiment, {})) {
    req.context.permissions.throwPermissionError();
  }
  const feature = await requireManagedFlag(req.context, experiment);

  await ejectManagedFeature({
    context: req.context,
    feature,
    experimentId: experiment.id,
    audit: req.audit,
  });

  return respond(req.context, experiment);
});

export const postExperimentVariationValuesRequestReview =
  createApiRequestHandler(postExperimentVariationValuesRequestReviewValidator)(
    async (req) => {
      const experiment = await requireExperiment(req.context, req.params.id);
      const feature = await requireManagedFlag(req.context, experiment);
      const draft = await requirePendingDraft(req.context, feature);
      if (draft.status !== "draft") {
        throw new BadRequestError(
          `The pending variation values are already ${draft.status}.`,
        );
      }
      if (
        !(await canAdvanceFeatureDraft({
          context: req.context,
          feature,
          draft,
        }))
      ) {
        req.context.permissions.throwPermissionError();
      }
      await markRevisionAsReviewRequested(
        req.context,
        draft,
        req.eventAudit,
        req.body.comment,
      );
      return respond(req.context, experiment);
    },
  );

export const postExperimentVariationValuesRecallReview =
  createApiRequestHandler(postExperimentVariationValuesRecallReviewValidator)(
    async (req) => {
      const experiment = await requireExperiment(req.context, req.params.id);
      const feature = await requireManagedFlag(req.context, experiment);
      const draft = await requirePendingDraft(req.context, feature);
      if (
        !(await canRecallFeatureReview({
          context: req.context,
          feature,
          draft,
        }))
      ) {
        req.context.permissions.throwPermissionError();
      }
      await recallReview(req.context, draft, req.eventAudit);
      await dispatchFeatureRevisionEvent(
        req.context,
        feature,
        await reloadRevision(req.context, feature, draft),
        "revision.recalled",
        {},
      );
      return respond(req.context, experiment);
    },
  );

export const postExperimentVariationValuesUndoReview = createApiRequestHandler(
  postExperimentVariationValuesUndoReviewValidator,
)(async (req) => {
  const experiment = await requireExperiment(req.context, req.params.id);
  const feature = await requireManagedFlag(req.context, experiment);
  if (
    !req.context.permissions.canReviewFeatureDrafts(
      feature,
      ANY_REVIEW_FOOTPRINT,
    )
  ) {
    req.context.permissions.throwPermissionError();
  }
  const draft = await requirePendingDraft(req.context, feature);
  const newStatus = await undoReview(req.context, draft, req.eventAudit);
  const afterUndo = await reloadRevision(req.context, feature, draft);
  await dispatchFeatureRevisionEvent(
    req.context,
    feature,
    afterUndo,
    "revision.reviewRetracted",
    {},
  );
  if (newStatus === "approved") {
    await maybeAutoPublishFeatureRevision(req.context, feature, afterUndo);
  }
  return respond(req.context, experiment);
});

export const postExperimentVariationValuesRebase = createApiRequestHandler(
  postExperimentVariationValuesRebaseValidator,
)(async (req) => {
  const experiment = await requireExperiment(req.context, req.params.id);
  const feature = await requireManagedFlag(req.context, experiment);
  const draft = await requirePendingDraft(req.context, feature);
  await rebaseFeatureRevision(
    req.context,
    req.organization,
    { id: feature.id, version: draft.version },
    {},
    req.audit,
  );
  return respond(req.context, experiment);
});

export const postExperimentVariationValuesDiscard = createApiRequestHandler(
  postExperimentVariationValuesDiscardValidator,
)(async (req) => {
  const experiment = await requireExperiment(req.context, req.params.id);
  const feature = await requireManagedFlag(req.context, experiment);
  const draft = await requirePendingDraft(req.context, feature);
  if (
    !(await canDiscardFeatureDraft({ context: req.context, feature, draft }))
  ) {
    req.context.permissions.throwPermissionError();
  }
  await discardRevision(req.context, draft, req.eventAudit, feature.version);
  await clearPendingFeatureDraftsForRevision(
    req.context,
    feature.id,
    draft.version,
    draft.rules,
  );
  await dispatchFeatureRevisionEvent(
    req.context,
    feature,
    await reloadRevision(req.context, feature, draft),
    "revision.discarded",
    {},
  );
  return respond(req.context, experiment);
});
