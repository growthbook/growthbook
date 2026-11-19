import type { Response } from "express";
import {
  ExperimentInterface,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import {
  CreateExperimentQaOverrideBody,
  ExperimentQaOverrideInterface,
  ExperimentQaOverrideWithStatus,
  ReorderExperimentQaOverridesBody,
  UpdateExperimentQaOverrideBody,
} from "shared/types/experiment-qa-override";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import {
  getQaOverrideWaitingFeatures,
  reorderQaOverridesInEnvironment,
} from "shared/util";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getLinkedFeatureInfo } from "back-end/src/services/experiments";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { findSDKConnectionsByIds } from "back-end/src/models/SdkConnectionModel";

type Context = ReturnType<typeof getContextFromReq>;

type QaOverrideSdkConnection = Pick<SDKConnectionInterface, "id" | "name">;

type OverridesResponse = {
  status: 200;
  overrides: ExperimentQaOverrideWithStatus[];
  sdkConnections: QaOverrideSdkConnection[];
};

type OverrideResponse = {
  status: 200;
  override: ExperimentQaOverrideWithStatus;
  sdkConnections: QaOverrideSdkConnection[];
};

function withStatus(
  override: ExperimentQaOverrideInterface,
  linkedFeatures: LinkedFeatureInfo[],
): ExperimentQaOverrideWithStatus {
  const waitingOn = getQaOverrideWaitingFeatures(override, linkedFeatures);
  return {
    ...override,
    status: waitingOn.length ? "waiting" : "active",
    waitingOn,
  };
}

async function loadExperiment(
  req: AuthRequest<unknown, { id: string }>,
): Promise<{ context: Context; experiment: ExperimentInterface }> {
  const context = getContextFromReq(req);
  const experiment = await getExperimentById(context, req.params.id);
  if (!experiment) {
    return context.throwNotFoundError("Experiment not found");
  }
  if (!context.permissions.canReadSingleProjectResource(experiment.project)) {
    context.permissions.throwPermissionError();
  }
  return { context, experiment };
}

async function loadOverride(
  req: AuthRequest<unknown, { id: string }>,
): Promise<{
  context: Context;
  override: ExperimentQaOverrideInterface;
  experiment: ExperimentInterface;
}> {
  const context = getContextFromReq(req);
  const override = await context.models.experimentQaOverrides.getById(
    req.params.id,
  );
  if (!override) return context.throwNotFoundError("QA override not found");
  const experiment = await getExperimentById(context, override.experiment);
  if (!experiment) return context.throwNotFoundError("Experiment not found");
  return { context, override, experiment };
}

// Only connections the caller may read.
async function filteredConnections(
  context: Context,
  overrides: ExperimentQaOverrideInterface[],
): Promise<QaOverrideSdkConnection[]> {
  const ids = [
    ...new Set(overrides.flatMap((o) => o.filters.sdkConnections ?? [])),
  ];
  if (!ids.length) return [];
  const connections = await findSDKConnectionsByIds(context, ids);
  return connections
    .filter((c) => context.permissions.canReadMultiProjectResource(c.projects))
    .map(({ id, name }) => ({ id, name }));
}

async function overrideResponse(
  context: Context,
  override: ExperimentQaOverrideInterface,
  experiment: ExperimentInterface,
): Promise<OverrideResponse> {
  const linkedFeatures = await getLinkedFeatureInfo(context, experiment);
  return {
    status: 200,
    override: withStatus(override, linkedFeatures),
    sdkConnections: await filteredConnections(context, [override]),
  };
}

async function overridesResponse(
  context: Context,
  overrides: ExperimentQaOverrideInterface[],
  experiment: ExperimentInterface,
): Promise<OverridesResponse> {
  const linkedFeatures = overrides.length
    ? await getLinkedFeatureInfo(context, experiment)
    : [];
  return {
    status: 200,
    overrides: overrides.map((o) => withStatus(o, linkedFeatures)),
    sdkConnections: await filteredConnections(context, overrides),
  };
}

export const getExperimentQaOverrides = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<OverridesResponse>,
) => {
  const { context, experiment } = await loadExperiment(req);
  const overrides = await context.models.experimentQaOverrides.findByExperiment(
    experiment.id,
  );
  res.status(200).json(await overridesResponse(context, overrides, experiment));
};

export const postExperimentQaOverride = async (
  req: AuthRequest<CreateExperimentQaOverrideBody, { id: string }>,
  res: Response<OverrideResponse>,
) => {
  const { context, experiment } = await loadExperiment(req);
  const existing = await context.models.experimentQaOverrides.findByExperiment(
    experiment.id,
  );
  const override = await context.models.experimentQaOverrides.create({
    environment: req.body.environment,
    filters: req.body.filters ?? {},
    assignment: req.body.assignment,
    experiment: experiment.id,
    order: existing.reduce((max, o) => Math.max(max, o.order + 1), 0),
    createdBy: context.userId,
  });
  res.status(200).json(await overrideResponse(context, override, experiment));
};

export const putExperimentQaOverridesOrder = async (
  req: AuthRequest<ReorderExperimentQaOverridesBody, { id: string }>,
  res: Response<OverridesResponse>,
) => {
  const { context, experiment } = await loadExperiment(req);
  const { environment, overrideIds } = req.body;
  const model = context.models.experimentQaOverrides;
  const changes = reorderQaOverridesInEnvironment(
    await model.findByExperiment(experiment.id),
    environment,
    overrideIds,
  );
  if (!changes) {
    return context.throwBadRequestError(
      "overrideIds must list every QA override in this environment exactly once",
    );
  }
  for (const { override, order } of changes) {
    await model.update(override, { order }, { skipSDKRefresh: true });
  }
  if (changes.length) await model.refreshEnvironments([environment]);
  res
    .status(200)
    .json(
      await overridesResponse(
        context,
        await model.findByExperiment(experiment.id),
        experiment,
      ),
    );
};

export const putExperimentQaOverride = async (
  req: AuthRequest<UpdateExperimentQaOverrideBody, { id: string }>,
  res: Response<OverrideResponse>,
) => {
  const { context, override, experiment } = await loadOverride(req);
  const updated = await context.models.experimentQaOverrides.update(
    override,
    req.body,
  );
  res.status(200).json(await overrideResponse(context, updated, experiment));
};

export const deleteExperimentQaOverride = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);
  await context.models.experimentQaOverrides.deleteById(req.params.id);
  res.status(200).json({ status: 200 });
};
