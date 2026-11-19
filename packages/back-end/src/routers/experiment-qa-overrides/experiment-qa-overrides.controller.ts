import type { Response } from "express";
import { ExperimentInterface } from "shared/types/experiment";
import {
  CreateExperimentQaOverrideBody,
  ExperimentQaOverrideInterface,
  ExperimentQaOverrideWithStatus,
  ReorderExperimentQaOverridesBody,
  UpdateExperimentQaOverrideBody,
} from "shared/types/experiment-qa-override";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { getQaOverrideStatus } from "shared/util";
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

async function overridesResponse(
  context: Context,
  overrides: ExperimentQaOverrideInterface[],
  experiment: ExperimentInterface,
): Promise<OverridesResponse> {
  const linkedFeatures = overrides.length
    ? await getLinkedFeatureInfo(context, experiment)
    : [];
  const connectionIds = [
    ...new Set(overrides.flatMap((o) => o.filters.sdkConnections ?? [])),
  ];
  // Status reads every listed connection so it is the same for all viewers;
  // names only go to callers who can read the connection.
  const connections = connectionIds.length
    ? await findSDKConnectionsByIds(context, connectionIds)
    : [];
  return {
    status: 200,
    overrides: overrides.map((o) => ({
      ...o,
      ...getQaOverrideStatus(o, { experiment, linkedFeatures, connections }),
    })),
    sdkConnections: connections
      .filter((c) =>
        context.permissions.canReadMultiProjectResource(c.projects),
      )
      .map(({ id, name }) => ({ id, name })),
  };
}

async function overrideResponse(
  context: Context,
  override: ExperimentQaOverrideInterface,
  experiment: ExperimentInterface,
): Promise<OverrideResponse> {
  const { overrides, sdkConnections } = await overridesResponse(
    context,
    [override],
    experiment,
  );
  return { status: 200, override: overrides[0], sdkConnections };
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
  const override = await context.models.experimentQaOverrides.createLast({
    environment: req.body.environment,
    filters: req.body.filters ?? {},
    assignment: req.body.assignment,
    experiment: experiment.id,
    createdBy: context.userId,
  });
  res.status(200).json(await overrideResponse(context, override, experiment));
};

export const putExperimentQaOverridesOrder = async (
  req: AuthRequest<ReorderExperimentQaOverridesBody, { id: string }>,
  res: Response<OverridesResponse>,
) => {
  const { context, experiment } = await loadExperiment(req);
  const model = context.models.experimentQaOverrides;
  await model.reorder(
    experiment.id,
    req.body.environment,
    req.body.overrideIds,
  );
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
