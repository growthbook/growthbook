import type { Response } from "express";
import { ExperimentInterface } from "shared/types/experiment";
import {
  CreateExperimentQaOverridesBody,
  ExperimentQaOverrideInterface,
  UpdateExperimentQaOverrideBody,
} from "shared/types/experiment-qa-override";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  getExperimentById,
  getExperimentsByIds,
} from "back-end/src/models/ExperimentModel";
import {
  findSDKConnectionById,
  findSDKConnectionsByIds,
} from "back-end/src/models/SdkConnectionModel";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";

type QaOverrideSdkConnection = Pick<
  SDKConnectionInterface,
  "id" | "name" | "environment" | "projects" | "key" | "languages"
>;

type QaOverrideExperiment = Pick<
  ExperimentInterface,
  | "id"
  | "name"
  | "status"
  | "trackingKey"
  | "variations"
  | "phases"
  | "type"
  | "project"
  | "hashAttribute"
>;

const toConnectionSummary = (
  c: SDKConnectionInterface,
): QaOverrideSdkConnection => ({
  id: c.id,
  name: c.name,
  environment: c.environment,
  projects: c.projects,
  key: c.key,
  languages: c.languages,
});

const toExperimentSummary = (e: ExperimentInterface): QaOverrideExperiment => ({
  id: e.id,
  name: e.name,
  status: e.status,
  trackingKey: e.trackingKey,
  variations: e.variations,
  phases: e.phases,
  type: e.type,
  project: e.project,
  hashAttribute: e.hashAttribute,
});

async function loadExperiment(
  req: AuthRequest<unknown, { id: string }>,
): Promise<{
  context: ReturnType<typeof getContextFromReq>;
  experiment: ExperimentInterface;
}> {
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

export const getExperimentQaOverrides = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{
    status: 200;
    overrides: ExperimentQaOverrideInterface[];
    sdkConnections: QaOverrideSdkConnection[];
  }>,
) => {
  const { context, experiment } = await loadExperiment(req);
  const overrides = await context.models.experimentQaOverrides.findByExperiment(
    experiment.id,
  );
  const connections = overrides.length
    ? await findSDKConnectionsByIds(
        context,
        overrides.map((o) => o.sdkConnection),
      )
    : [];

  res.status(200).json({
    status: 200,
    overrides,
    sdkConnections: connections.map(toConnectionSummary),
  });
};

export const postExperimentQaOverrides = async (
  req: AuthRequest<CreateExperimentQaOverridesBody, { id: string }>,
  res: Response<{ status: 200; overrides: ExperimentQaOverrideInterface[] }>,
) => {
  const { context, experiment } = await loadExperiment(req);
  const { sdkConnections: connectionIds, ...fields } = req.body;

  const connections = await findSDKConnectionsByIds(context, connectionIds);
  const missing = connectionIds.filter(
    (id) => !connections.some((c) => c.id === id),
  );
  if (missing.length) {
    context.throwBadRequestError(
      `Could not find SDK Connection(s): ${missing.join(", ")}`,
    );
  }

  const existing = await context.models.experimentQaOverrides.findByExperiment(
    experiment.id,
  );

  const overrides: ExperimentQaOverrideInterface[] = [];
  for (const connection of connections) {
    const current = existing.find((o) => o.sdkConnection === connection.id);
    if (current) {
      overrides.push(
        await context.models.experimentQaOverrides.update(current, fields, {
          skipSDKRefresh: true,
        }),
      );
    } else {
      overrides.push(
        await context.models.experimentQaOverrides.create(
          {
            ...fields,
            experiment: experiment.id,
            sdkConnection: connection.id,
            environment: connection.environment,
            createdBy: context.userId,
          },
          { skipSDKRefresh: true },
        ),
      );
    }
  }

  queueSDKPayloadRefresh({
    context,
    payloadKeys: [],
    sdkConnections: connections,
    auditContext: {
      event: "updated",
      model: "experimentQaOverride",
      id: experiment.id,
    },
  });

  res.status(200).json({ status: 200, overrides });
};

export const deleteExperimentQaOverrides = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const { context, experiment } = await loadExperiment(req);
  const overrides = await context.models.experimentQaOverrides.findByExperiment(
    experiment.id,
  );
  for (const override of overrides) {
    await context.models.experimentQaOverrides.delete(override, {
      skipSDKRefresh: true,
    });
  }
  if (overrides.length) {
    const connections = await findSDKConnectionsByIds(
      context,
      overrides.map((o) => o.sdkConnection),
    );
    queueSDKPayloadRefresh({
      context,
      payloadKeys: [],
      sdkConnections: connections,
      auditContext: {
        event: "deleted",
        model: "experimentQaOverride",
        id: experiment.id,
      },
    });
  }
  res.status(200).json({ status: 200 });
};

export const putExperimentQaOverride = async (
  req: AuthRequest<UpdateExperimentQaOverrideBody, { id: string }>,
  res: Response<{ status: 200; override: ExperimentQaOverrideInterface }>,
) => {
  const context = getContextFromReq(req);
  const override = await context.models.experimentQaOverrides.updateById(
    req.params.id,
    req.body,
  );
  res.status(200).json({ status: 200, override });
};

export const deleteExperimentQaOverride = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);
  await context.models.experimentQaOverrides.deleteById(req.params.id);
  res.status(200).json({ status: 200 });
};

export const getSdkConnectionQaOverrides = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{
    status: 200;
    overrides: ExperimentQaOverrideInterface[];
    experiments: QaOverrideExperiment[];
  }>,
) => {
  const context = getContextFromReq(req);
  const connection = await findSDKConnectionById(context, req.params.id);
  if (!connection) {
    return context.throwNotFoundError("SDK Connection not found");
  }

  const overrides =
    await context.models.experimentQaOverrides.findBySdkConnection(
      connection.id,
    );
  const experiments = overrides.length
    ? await getExperimentsByIds(
        context,
        overrides.map((o) => o.experiment),
      )
    : [];

  res.status(200).json({
    status: 200,
    overrides,
    experiments: experiments.map(toExperimentSummary),
  });
};

export const deleteSdkConnectionQaOverrides = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);
  const connection = await findSDKConnectionById(context, req.params.id);
  if (!connection) {
    return context.throwNotFoundError("SDK Connection not found");
  }

  const overrides =
    await context.models.experimentQaOverrides.findBySdkConnection(
      connection.id,
    );
  for (const override of overrides) {
    await context.models.experimentQaOverrides.delete(override, {
      skipSDKRefresh: true,
    });
  }
  if (overrides.length) {
    queueSDKPayloadRefresh({
      context,
      payloadKeys: [],
      sdkConnections: [connection],
      auditContext: {
        event: "deleted",
        model: "experimentQaOverride",
        id: connection.id,
      },
    });
  }
  res.status(200).json({ status: 200 });
};
