import { z } from "zod";
import { getAffectedEnvsForExperiment } from "shared/util";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import { runContextualBanditSnapshot } from "back-end/src/services/experiments";
import { createApiRequestHandler } from "back-end/src/util/handler";

const idParams = z
  .object({
    id: z.string().describe("The id of the requested experiment"),
  })
  .strict();

const eventParams = idParams
  .extend({
    eventId: z.string(),
  })
  .strict();

const snapshotParams = idParams
  .extend({
    snapshotId: z.string(),
  })
  .strict();

const listQuery = z
  .object({
    limit: z.coerce.number().int().positive().max(100).optional(),
    cursor: z.string().optional(),
  })
  .strict();

const currentResponse = z
  .object({
    currentLeafWeights: z.array(z.any()),
    latestEvent: z.any().nullable(),
  })
  .strict();

async function getContextualBanditExperiment(req: {
  context: Parameters<typeof getExperimentById>[0];
  params: { id: string };
}) {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }
  if (experiment.type !== "contextual-bandit") {
    throw new Error("Experiment is not a contextual bandit");
  }
  if (
    !req.context.permissions.canReadSingleProjectResource(experiment.project)
  ) {
    req.context.permissions.throwPermissionError();
  }
  return experiment;
}

async function assertCanRefreshContextualBandit(req: {
  context: Parameters<typeof getExperimentById>[0];
  params: { id: string };
}) {
  const experiment = await getContextualBanditExperiment(req);
  const linkedFeatures = experiment.linkedFeatures?.length
    ? await getFeaturesByIds(req.context, experiment.linkedFeatures)
    : [];
  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: req.context.org.settings?.environments || [],
    linkedFeatures,
  });
  if (!req.context.permissions.canRunExperiment(experiment, envs)) {
    req.context.permissions.throwPermissionError();
  }
  return experiment;
}

export const getContextualBanditCurrent = createApiRequestHandler({
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: currentResponse,
  summary: "Get current contextual bandit weights",
  operationId: "getContextualBanditCurrent",
  tags: ["experiments"],
  method: "get" as const,
  path: "/experiments/:id/contextual-bandit/current",
})(async (req) => {
  const experiment = await getContextualBanditExperiment(req);
  const cb = await req.context.models.contextualBandits.getByExperimentId(
    experiment.id,
  );
  if (!cb) {
    throw new Error("Contextual bandit config not found");
  }
  const phase = experiment.phases.length - 1;
  const cbPhase = cb.phases.find((p) => p.phase === phase);
  const latestEvent =
    await req.context.models.contextualBanditEvents.getLatestForExperimentPhase(
      experiment.id,
      phase,
    );
  return {
    currentLeafWeights: cbPhase?.currentLeafWeights ?? [],
    latestEvent,
  };
});

export const listContextualBanditEvents = createApiRequestHandler({
  bodySchema: z.never(),
  querySchema: listQuery,
  paramsSchema: idParams,
  responseSchema: z.object({ events: z.array(z.any()) }).strict(),
  summary: "List contextual bandit events",
  operationId: "listContextualBanditEvents",
  tags: ["experiments"],
  method: "get" as const,
  path: "/experiments/:id/contextual-bandit/events",
})(async (req) => {
  const experiment = await getContextualBanditExperiment(req);
  const events =
    await req.context.models.contextualBanditEvents.listForExperiment(
      experiment.id,
      { limit: req.query.limit ?? 100 },
    );
  return { events };
});

export const getContextualBanditEvent = createApiRequestHandler({
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: eventParams,
  responseSchema: z.object({ event: z.any() }).strict(),
  summary: "Get a contextual bandit event",
  operationId: "getContextualBanditEvent",
  tags: ["experiments"],
  method: "get" as const,
  path: "/experiments/:id/contextual-bandit/events/:eventId",
})(async (req) => {
  const experiment = await getContextualBanditExperiment(req);
  const event = await req.context.models.contextualBanditEvents.getById(
    req.params.eventId,
  );
  if (!event || event.experiment !== experiment.id) {
    throw new Error("Contextual bandit event not found");
  }
  return { event };
});

export const listContextualBanditSnapshots = createApiRequestHandler({
  bodySchema: z.never(),
  querySchema: listQuery,
  paramsSchema: idParams,
  responseSchema: z.object({ snapshots: z.array(z.any()) }).strict(),
  summary: "List contextual bandit snapshots",
  operationId: "listContextualBanditSnapshots",
  tags: ["experiments"],
  method: "get" as const,
  path: "/experiments/:id/contextual-bandit/snapshots",
})(async (req) => {
  const experiment = await getContextualBanditExperiment(req);
  const snapshots =
    await req.context.models.contextualBanditSnapshots.listForExperiment(
      experiment.id,
      { limit: req.query.limit ?? 100 },
    );
  return { snapshots };
});

export const getContextualBanditSnapshot = createApiRequestHandler({
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: snapshotParams,
  responseSchema: z.object({ snapshot: z.any() }).strict(),
  summary: "Get a contextual bandit snapshot",
  operationId: "getContextualBanditSnapshot",
  tags: ["experiments"],
  method: "get" as const,
  path: "/experiments/:id/contextual-bandit/snapshots/:snapshotId",
})(async (req) => {
  const experiment = await getContextualBanditExperiment(req);
  const snapshot = await req.context.models.contextualBanditSnapshots.getById(
    req.params.snapshotId,
  );
  if (!snapshot || snapshot.experiment !== experiment.id) {
    throw new Error("Contextual bandit snapshot not found");
  }
  return { snapshot };
});

export const postContextualBanditRefresh = createApiRequestHandler({
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z.object({ snapshotId: z.string() }).strict(),
  summary: "Refresh contextual bandit weights",
  operationId: "postContextualBanditRefresh",
  tags: ["experiments"],
  method: "post" as const,
  path: "/experiments/:id/contextual-bandit/refresh",
})(async (req) => {
  const experiment = await assertCanRefreshContextualBandit(req);
  const result = await runContextualBanditSnapshot(req.context, experiment.id, {
    triggeredBy: "manual",
    triggeredByUser: req.context.userId,
  });
  return { snapshotId: result.snapshotId };
});
