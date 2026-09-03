import {
  ExperimentInterface,
  FeatureInterface,
  getExperimentVariationValuesValidator,
  postExperimentVariationValuesApproveValidator,
  postExperimentVariationValuesCommentValidator,
  postExperimentVariationValuesDetachValidator,
  postExperimentVariationValuesPublishValidator,
  postExperimentVariationValuesRequestChangesValidator,
  postExperimentVariationValuesValidator,
  putExperimentVariationValuesValidator,
} from "shared/validators";
import { EventUser } from "shared/types/events/event-types";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { ApiReqContext } from "back-end/types/api";
import {
  getActiveDraft,
  ReviewSubmittedType,
} from "back-end/src/models/FeatureRevisionModel";
import { submitFeatureRevisionReview } from "back-end/src/services/featureRevisionReview";
import {
  adoptManagedFlagForExperiment,
  ejectManagedFeature,
  getManagedFeatureForExperiment,
  getManagedFlagState,
  publishManagedDraft,
  updateManagedVariationValues,
} from "back-end/src/services/managedFeatures";

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
      "This experiment does not manage a Feature Flag. Start serving values automatically first.",
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
  await requireManagedFlag(req.context, experiment);

  await updateManagedVariationValues({
    context: req.context,
    experiment,
    variations: req.body.values,
    valueType: req.body.valueType,
    sparse: req.body.sparse,
    eventAudit: req.eventAudit,
  });

  return respond(req.context, experiment);
});

/** approve / request-changes / comment all land on the same review write. */
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

export const postExperimentVariationValuesApprove = createApiRequestHandler(
  postExperimentVariationValuesApproveValidator,
)(async (req) =>
  submitManagedReview({
    context: req.context,
    experimentId: req.params.id,
    review: "Approved",
    comment: req.body.comment ?? "",
    eventAudit: req.eventAudit,
  }),
);

export const postExperimentVariationValuesRequestChanges =
  createApiRequestHandler(postExperimentVariationValuesRequestChangesValidator)(
    async (req) =>
      submitManagedReview({
        context: req.context,
        experimentId: req.params.id,
        review: "Requested Changes",
        comment: req.body.comment ?? "",
        eventAudit: req.eventAudit,
      }),
  );

export const postExperimentVariationValuesComment = createApiRequestHandler(
  postExperimentVariationValuesCommentValidator,
)(async (req) =>
  submitManagedReview({
    context: req.context,
    experimentId: req.params.id,
    review: "Comment",
    comment: req.body.comment,
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
  });

  return respond(req.context, experiment);
});
