import type { Response } from "express";
import { ExperimentInterface } from "shared/types/experiment";
import {
  CreateExperimentQaOverrideBody,
  ExperimentQaOverrideInterface,
  ReorderExperimentQaOverridesBody,
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

// Connections named by the overrides' filters, hydrated for display.
async function filteredConnections(
  context: ReturnType<typeof getContextFromReq>,
  overrides: ExperimentQaOverrideInterface[],
): Promise<QaOverrideSdkConnection[]> {
  const ids = [
    ...new Set(overrides.flatMap((o) => o.filters.sdkConnections ?? [])),
  ];
  if (!ids.length) return [];
  const connections = await findSDKConnectionsByIds(context, ids);
  return connections.map(toConnectionSummary);
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
  res.status(200).json({
    status: 200,
    overrides,
    sdkConnections: await filteredConnections(context, overrides),
  });
};

export const postExperimentQaOverride = async (
  req: AuthRequest<CreateExperimentQaOverrideBody, { id: string }>,
  res: Response<{ status: 200; override: ExperimentQaOverrideInterface }>,
) => {
  const { context, experiment } = await loadExperiment(req);
  const existing = await context.models.experimentQaOverrides.findByExperiment(
    experiment.id,
  );
  const override = await context.models.experimentQaOverrides.create({
    ...req.body,
    experiment: experiment.id,
    // New overrides go last; the first matching one wins in the payload.
    order: existing.reduce((max, o) => Math.max(max, o.order + 1), 0),
    createdBy: context.userId,
  });
  res.status(200).json({ status: 200, override });
};

export const putExperimentQaOverridesOrder = async (
  req: AuthRequest<ReorderExperimentQaOverridesBody, { id: string }>,
  res: Response<{ status: 200; overrides: ExperimentQaOverrideInterface[] }>,
) => {
  const { context, experiment } = await loadExperiment(req);
  const { overrideIds } = req.body;
  const existing = await context.models.experimentQaOverrides.findByExperiment(
    experiment.id,
  );
  const unknown = overrideIds.filter(
    (id) => !existing.some((o) => o.id === id),
  );
  if (unknown.length || new Set(overrideIds).size !== existing.length) {
    context.throwBadRequestError(
      "overrideIds must list every QA override of this experiment exactly once",
    );
  }

  const overrides: ExperimentQaOverrideInterface[] = [];
  const movedEnvironments = new Set<string>();
  for (const [order, id] of overrideIds.entries()) {
    const override = existing.find((o) => o.id === id);
    if (!override) continue;
    if (override.order === order) {
      overrides.push(override);
      continue;
    }
    movedEnvironments.add(override.environment);
    overrides.push(
      await context.models.experimentQaOverrides.update(
        override,
        { order },
        { skipSDKRefresh: true },
      ),
    );
  }
  // One refresh for the batch instead of one per moved row.
  await context.models.experimentQaOverrides.refreshEnvironments([
    ...movedEnvironments,
  ]);
  res.status(200).json({ status: 200, overrides });
};

export const deleteExperimentQaOverrides = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const { context, experiment } = await loadExperiment(req);
  await context.models.experimentQaOverrides.deleteByExperiment(experiment.id);
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
    await context.models.experimentQaOverrides.findForSdkConnection(connection);
  const experiments = overrides.length
    ? await getExperimentsByIds(context, [
        ...new Set(overrides.map((o) => o.experiment)),
      ])
    : [];
  const readable = overrides.filter((o) =>
    experiments.some(
      (e) =>
        e.id === o.experiment &&
        context.permissions.canReadSingleProjectResource(e.project),
    ),
  );

  res.status(200).json({
    status: 200,
    overrides: readable,
    experiments: experiments.map(toExperimentSummary),
  });
};
