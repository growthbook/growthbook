import { Response } from "express";
import {
  apiCreateContextualBanditQueryBody,
  apiUpdateContextualBanditQueryBody,
  ContextualBanditEventInterface,
  ContextualBanditQueryInterface,
  ContextualBanditSnapshotInterface,
  LeafWeight,
} from "shared/validators";
import { getAffectedEnvsForExperiment } from "shared/util";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getContextFromReq } from "back-end/src/services/organizations";
import { runContextualBanditSnapshot } from "back-end/src/services/experiments";
import { AuthRequest } from "back-end/src/types/AuthRequest";

type ListQuery = {
  datasource?: string;
  limit?: string;
};

async function getContextualBanditExperiment(
  req: AuthRequest<unknown, { id: string }>,
) {
  const context = getContextFromReq(req);
  const experiment = await getExperimentById(context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }
  if (experiment.type !== "contextual-bandit") {
    throw new Error("Experiment is not a contextual bandit");
  }
  if (!context.permissions.canReadSingleProjectResource(experiment.project)) {
    context.permissions.throwPermissionError();
  }
  return { context, experiment };
}

export async function getContextualBanditQueries(
  req: AuthRequest<unknown, unknown, ListQuery>,
  res: Response<{
    status: 200;
    cbaqs: ContextualBanditQueryInterface[];
  }>,
) {
  const context = getContextFromReq(req);
  const cbaqs = req.query.datasource
    ? await context.models.contextualBanditQueries.getByDatasourceId(
        req.query.datasource,
      )
    : await context.models.contextualBanditQueries.getAll();

  res.status(200).json({
    status: 200,
    cbaqs,
  });
}

export async function postContextualBanditQuery(
  req: AuthRequest<unknown>,
  res: Response<{
    status: 200;
    contextualBanditQuery: ContextualBanditQueryInterface;
  }>,
) {
  const context = getContextFromReq(req);
  const payload = apiCreateContextualBanditQueryBody.parse(req.body);
  const datasource = await getDataSourceById(context, payload.datasource);
  if (!datasource) {
    throw new Error("Datasource not found");
  }

  const contextualBanditQuery =
    await context.models.contextualBanditQueries.create({
      name: payload.name,
      description: payload.description ?? "",
      datasource: payload.datasource,
      projects: datasource.projects ?? [],
      userIdType: payload.userIdType,
      query: payload.query,
      attributes: payload.attributes,
      topValuesLookbackDays: payload.topValuesLookbackDays ?? 30,
      owner: payload.owner ?? context.userId,
    });

  res.status(200).json({
    status: 200,
    contextualBanditQuery,
  });
}

export async function putContextualBanditQuery(
  req: AuthRequest<unknown, { id: string }>,
  res: Response<{
    status: 200;
    contextualBanditQuery: ContextualBanditQueryInterface;
  }>,
) {
  const context = getContextFromReq(req);
  const existing = await context.models.contextualBanditQueries.getById(
    req.params.id,
  );
  if (!existing) {
    throw new Error("Contextual bandit query not found");
  }
  const payload = apiUpdateContextualBanditQueryBody.parse(req.body);
  const updated = await context.models.contextualBanditQueries.updateById(
    req.params.id,
    {
      ...(payload.name !== undefined && { name: payload.name }),
      ...(payload.description !== undefined && {
        description: payload.description,
      }),
      ...(payload.userIdType !== undefined && {
        userIdType: payload.userIdType,
      }),
      ...(payload.query !== undefined && { query: payload.query }),
      ...(payload.attributes !== undefined && {
        attributes: payload.attributes,
      }),
      ...(payload.topValuesLookbackDays !== undefined && {
        topValuesLookbackDays: payload.topValuesLookbackDays,
      }),
    },
  );

  res.status(200).json({
    status: 200,
    contextualBanditQuery: updated,
  });
}

export async function deleteContextualBanditQuery(
  req: AuthRequest<unknown, { id: string }>,
  res: Response<{ status: 200 }>,
) {
  const context = getContextFromReq(req);
  const existing = await context.models.contextualBanditQueries.getById(
    req.params.id,
  );
  if (!existing) {
    throw new Error("Contextual bandit query not found");
  }
  await context.models.contextualBanditQueries.deleteById(req.params.id);
  res.status(200).json({ status: 200 });
}

export async function getContextualBanditCurrent(
  req: AuthRequest<unknown, { id: string }>,
  res: Response<{
    status: 200;
    currentLeafWeights: LeafWeight[];
    latestEvent: ContextualBanditEventInterface | null;
  }>,
) {
  const { context, experiment } = await getContextualBanditExperiment(req);
  const cb = await context.models.contextualBandits.getByExperimentId(
    experiment.id,
  );
  if (!cb) {
    throw new Error("Contextual bandit config not found");
  }
  const phase = experiment.phases.length - 1;
  const cbPhase = cb.phases.find((p) => p.phase === phase);
  const latestEvent =
    await context.models.contextualBanditEvents.getLatestForExperimentPhase(
      experiment.id,
      phase,
    );

  res.status(200).json({
    status: 200,
    currentLeafWeights: cbPhase?.currentLeafWeights ?? [],
    latestEvent,
  });
}

export async function getContextualBanditSnapshots(
  req: AuthRequest<unknown, { id: string }, ListQuery>,
  res: Response<{
    status: 200;
    snapshots: ContextualBanditSnapshotInterface[];
  }>,
) {
  const { context, experiment } = await getContextualBanditExperiment(req);
  const limit = Math.min(
    Math.max(parseInt(req.query.limit ?? "100", 10) || 100, 1),
    100,
  );
  const snapshots =
    await context.models.contextualBanditSnapshots.listForExperiment(
      experiment.id,
      { limit },
    );

  res.status(200).json({
    status: 200,
    snapshots,
  });
}

export async function postContextualBanditRefresh(
  req: AuthRequest<unknown, { id: string }>,
  res: Response<{ status: 200; snapshotId: string }>,
) {
  const { context, experiment } = await getContextualBanditExperiment(req);
  const linkedFeatures = experiment.linkedFeatures?.length
    ? await getFeaturesByIds(context, experiment.linkedFeatures)
    : [];
  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });
  if (!context.permissions.canRunExperiment(experiment, envs)) {
    context.permissions.throwPermissionError();
  }

  const result = await runContextualBanditSnapshot(context, experiment.id, {
    triggeredBy: "manual",
    triggeredByUser: context.userId,
  });

  res.status(200).json({
    status: 200,
    snapshotId: result.snapshotId,
  });
}
