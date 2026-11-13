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
import { getQaOverrideWaitingFeatures } from "shared/util";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getLinkedFeatureInfo } from "back-end/src/services/experiments";
import {
  getExperimentById,
  getExperimentsByIds,
} from "back-end/src/models/ExperimentModel";
import {
  findSDKConnectionById,
  findSDKConnectionsByIds,
} from "back-end/src/models/SdkConnectionModel";

type Context = ReturnType<typeof getContextFromReq>;

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

type OverrideResponse = {
  status: 200;
  override: ExperimentQaOverrideWithStatus;
  sdkConnections: QaOverrideSdkConnection[];
};

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

// Connections named by the overrides' filters, hydrated for display. Only
// ones the caller may read: the summary carries the client key.
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
    .map(toConnectionSummary);
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

// Writes `order` 0..n-1 in list order, touching only the rows that move, and
// refreshes each affected environment once.
async function applyOrder(
  context: Context,
  ordered: ExperimentQaOverrideInterface[],
): Promise<ExperimentQaOverrideInterface[]> {
  const out: ExperimentQaOverrideInterface[] = [];
  const movedEnvironments = new Set<string>();
  for (const [order, override] of ordered.entries()) {
    if (override.order === order) {
      out.push(override);
      continue;
    }
    movedEnvironments.add(override.environment);
    out.push(
      await context.models.experimentQaOverrides.update(
        override,
        { order },
        { skipSDKRefresh: true },
      ),
    );
  }
  await context.models.experimentQaOverrides.refreshEnvironments([
    ...movedEnvironments,
  ]);
  return out;
}

export const getExperimentQaOverrides = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{
    status: 200;
    overrides: ExperimentQaOverrideWithStatus[];
    sdkConnections: QaOverrideSdkConnection[];
  }>,
) => {
  const { context, experiment } = await loadExperiment(req);
  const overrides = await context.models.experimentQaOverrides.findByExperiment(
    experiment.id,
  );
  const linkedFeatures = overrides.length
    ? await getLinkedFeatureInfo(context, experiment)
    : [];
  res.status(200).json({
    status: 200,
    overrides: overrides.map((o) => withStatus(o, linkedFeatures)),
    sdkConnections: await filteredConnections(context, overrides),
  });
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
    // New overrides go last; the first matching one wins in the payload.
    order: existing.reduce((max, o) => Math.max(max, o.order + 1), 0),
    createdBy: context.userId,
  });
  res.status(200).json(await overrideResponse(context, override, experiment));
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
  const byId = new Map(existing.map((o) => [o.id, o]));
  if (
    overrideIds.length !== existing.length ||
    new Set(overrideIds).size !== existing.length ||
    overrideIds.some((id) => !byId.has(id))
  ) {
    context.throwBadRequestError(
      "overrideIds must list every QA override of this experiment exactly once",
    );
  }
  const overrides = await applyOrder(
    context,
    overrideIds.map((id) => byId.get(id) as ExperimentQaOverrideInterface),
  );
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
  res: Response<OverrideResponse>,
) => {
  const { context, override, experiment } = await loadOverride(req);
  const { order, ...fields } = req.body;
  let updated = Object.keys(fields).length
    ? await context.models.experimentQaOverrides.update(override, fields)
    : override;

  if (order !== undefined) {
    const others = (
      await context.models.experimentQaOverrides.findByExperiment(experiment.id)
    ).filter((o) => o.id !== updated.id);
    const ordered = [...others];
    ordered.splice(Math.min(order, others.length), 0, updated);
    updated =
      (await applyOrder(context, ordered)).find((o) => o.id === updated.id) ??
      updated;
  }
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

export const getSdkConnectionQaOverrides = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{
    status: 200;
    overrides: ExperimentQaOverrideWithStatus[];
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
    ? (
        await getExperimentsByIds(context, [
          ...new Set(overrides.map((o) => o.experiment)),
        ])
      ).filter((e) =>
        context.permissions.canReadSingleProjectResource(e.project),
      )
    : [];
  const linkedByExperiment = new Map<string, LinkedFeatureInfo[]>();
  for (const e of experiments) {
    linkedByExperiment.set(e.id, await getLinkedFeatureInfo(context, e));
  }

  res.status(200).json({
    status: 200,
    overrides: overrides
      .filter((o) => linkedByExperiment.has(o.experiment))
      .map((o) => withStatus(o, linkedByExperiment.get(o.experiment) ?? [])),
    experiments: experiments.map(toExperimentSummary),
  });
};
