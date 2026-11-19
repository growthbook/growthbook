import Agenda, { Job } from "agenda";
import omit from "lodash/omit";
import { DagInterface, DagNode } from "shared/validators";
import { DagModel } from "back-end/src/models/DagModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  createExperimentSnapshotModel,
  dangerousFindSnapshotStatusesByIds,
  deleteQueuedSnapshots,
  errorQueuedSnapshot,
  errorSnapshotIfStillRunning,
  findSnapshotsByIds,
  SnapshotRunStatus,
} from "back-end/src/models/ExperimentSnapshotModel";
import { INCREMENTAL_LOCK_STALE_MS } from "back-end/src/models/IncrementalRefreshModel";
import { QUERY_CANCELLED_BY_USER_ERROR } from "back-end/src/queryRunners/QueryRunner";
import {
  DagAction,
  DagNodeState,
  getDagActions,
} from "back-end/src/services/dags";
import { startQueuedBreakdown } from "back-end/src/services/experiments";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { getAgendaInstance } from "back-end/src/services/queueing";
import {
  SNAPSHOT_CANCELLED_ERROR,
  SNAPSHOT_INTERRUPTED_ERROR,
} from "back-end/src/services/snapshotCancellation";
import {
  ConcurrentIncrementalRefreshError,
  getErrorMessage,
  QueuedSnapshotSupersededError,
} from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import { generateId } from "back-end/src/util/uuid";

const QUEUE_DAG_TICKS = "queueDagTicks";
const RUN_DAG_TICK = "runDagTick";

type RunDagTickJob = Job<{ organization: string; dagId: string }>;

type AgendaJobContext = Awaited<
  ReturnType<typeof getContextForAgendaJobByOrgId>
>;

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_DAG_TICKS, sweepDags);
  agenda.define(RUN_DAG_TICK, runDagTick);

  const sweepJob = agenda.create(QUEUE_DAG_TICKS, {});
  sweepJob.unique({});
  sweepJob.repeatEvery("1 minute");
  await sweepJob.save();
}

// A run that a user cancelled or a newer Overall Results update interrupted
// was stopped on purpose, so running it again would undo that.
const NON_RETRYABLE_EXPERIMENT_SNAPSHOT_ERRORS = [
  SNAPSHOT_INTERRUPTED_ERROR,
  SNAPSHOT_CANCELLED_ERROR,
  QUERY_CANCELLED_BY_USER_ERROR,
];

// How long a snapshot the DAG started may stay running without saving any
// queries before the DAG marks it as failed.
const UNSTARTED_EXPERIMENT_SNAPSHOT_STALE_MS = INCREMENTAL_LOCK_STALE_MS;

export function getExperimentSnapshotNodeState(
  snapshot: SnapshotRunStatus | undefined,
  now: Date,
): DagNodeState {
  // Cancelling a running snapshot deletes it
  if (!snapshot) return { status: "missing" };
  switch (snapshot.status) {
    case "queued":
    case "success":
      return { status: snapshot.status };
    case "running":
      return {
        status: "running",
        stalled:
          snapshot.queryCount === 0 &&
          !!snapshot.runStarted &&
          now.getTime() - snapshot.runStarted.getTime() >
            UNSTARTED_EXPERIMENT_SNAPSHOT_STALE_MS,
      };
    case "error":
      return {
        status: "error",
        retryable: !NON_RETRYABLE_EXPERIMENT_SNAPSHOT_ERRORS.some((error) =>
          snapshot.error?.startsWith(error),
        ),
      };
    default:
      snapshot.status satisfies never;
      throw new Error(`Unknown snapshot status: ${snapshot.status}`);
  }
}

/** The state of each node's current attempt, keyed by target ID, in one query per node type. */
async function getStatesByTargetId(
  nodes: DagNode[],
): Promise<Map<string, DagNodeState>> {
  const targetIdsByType: Record<DagNode["type"], string[]> = {
    "experiment-snapshot": [],
  };
  nodes.forEach((node) => targetIdsByType[node.type].push(node.targetId));

  const snapshots = new Map(
    (
      await dangerousFindSnapshotStatusesByIds(
        targetIdsByType["experiment-snapshot"],
      )
    ).map((snapshot) => [snapshot.id, snapshot]),
  );

  const now = new Date();
  return new Map(
    nodes.map((node) => {
      switch (node.type) {
        case "experiment-snapshot":
          return [
            node.targetId,
            getExperimentSnapshotNodeState(snapshots.get(node.targetId), now),
          ];
        default:
          node.type satisfies never;
          throw new Error(`Unknown DAG node type: ${node.type}`);
      }
    }),
  );
}

// A DAG older than this is closed as it stands, so one that can never finish
// stops being read on every sweep.
const DAG_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export function getActions(
  dag: Pick<DagInterface, "nodes" | "dateCreated">,
  statesByTargetId: Map<string, DagNodeState>,
  now: Date,
): DagAction[] {
  const stateOf = (node: DagNode): DagNodeState =>
    statesByTargetId.get(node.targetId) ?? { status: "missing" };

  if (now.getTime() - dag.dateCreated.getTime() > DAG_MAX_AGE_MS) {
    // Nothing would ever start a node left queued by a DAG that is done
    return [
      ...dag.nodes
        .filter((node) => stateOf(node).status === "queued")
        .map((node) => ({ type: "drop" as const, nodeId: node.id })),
      { type: "done" },
    ];
  }

  return getDagActions(
    dag,
    new Map(dag.nodes.map((node) => [node.id, stateOf(node)])),
  );
}

// ponytail: every active DAG and its snapshots' statuses are read each minute.
// A DAG that cannot finish stays active until DAG_MAX_AGE_MS: one whose queued
// node can never start (unless its experiment is updated first), or whose
// first node died before saving its queries. Lower the cap if that list grows.
async function sweepDags() {
  const dags = await DagModel.dangerousFindAllActive();
  const states = await getStatesByTargetId(dags.flatMap((dag) => dag.nodes));
  const now = new Date();

  for (const dag of dags) {
    if (!getActions(dag, states, now).length) continue;
    const job = getAgendaInstance().create(RUN_DAG_TICK, {
      organization: dag.organization,
      dagId: dag.id,
    });
    job.unique({ organization: dag.organization, dagId: dag.id });
    job.schedule(new Date());
    await job.save();
  }
}

async function runDagTick(job: RunDagTickJob) {
  const { organization, dagId } = job.attrs.data ?? {};
  if (!organization || !dagId) return;

  const context = await getContextForAgendaJobByOrgId(organization);
  const dag = await context.models.dags.getById(dagId);
  if (!dag || dag.status !== "active") return;

  const actions = getActions(
    dag,
    await getStatesByTargetId(dag.nodes),
    new Date(),
  );
  for (const action of actions) {
    try {
      if (action.type === "done") {
        await context.models.dags.markDone(dag.id);
        continue;
      }
      const node = dag.nodes.find((n) => n.id === action.nodeId);
      if (!node) continue;
      switch (node.type) {
        case "experiment-snapshot":
          await applyExperimentSnapshotNodeAction(
            context,
            dag,
            node,
            action.type,
          );
          break;
        default:
          node.type satisfies never;
          throw new Error(`Unknown DAG node type: ${node.type}`);
      }
    } catch (e) {
      logger.error(
        { err: e, dagId: dag.id, action },
        "Failed to apply a DAG action",
      );
    }
  }
}

// Experiment snapshot handling below here
async function applyExperimentSnapshotNodeAction(
  context: AgendaJobContext,
  dag: DagInterface,
  node: DagNode,
  action: Exclude<DagAction["type"], "done">,
): Promise<void> {
  switch (action) {
    case "start":
      return startQueuedExperimentSnapshotNode(context, node.targetId);
    case "retry":
      return retryExperimentSnapshotNode(context, dag, node);
    case "drop":
      return deleteQueuedSnapshots(context, { ids: [node.targetId] });
    case "fail-unstarted":
      await errorSnapshotIfStillRunning(
        context,
        node.targetId,
        { error: "The update did not start." },
        "unknown",
        { concludedBy: "dag" },
      );
      return;
    default:
      action satisfies never;
      throw new Error(`Unknown DAG action: ${action}`);
  }
}

async function startQueuedExperimentSnapshotNode(
  context: AgendaJobContext,
  snapshotId: string,
): Promise<void> {
  const [snapshot] = await findSnapshotsByIds(context, [snapshotId]);
  if (!snapshot || snapshot.status !== "queued") return;

  const { runnerKind } = snapshot;
  const experiment = await getExperimentById(context, snapshot.experiment);
  if (!experiment || !runnerKind) {
    await deleteQueuedSnapshots(context, { ids: [snapshotId] });
    return;
  }

  try {
    await startQueuedBreakdown({
      queued: { ...snapshot, runnerKind },
      context,
      experiment,
    });
  } catch (e) {
    // The lock was refused: it stays queued for the next sweep, at no cost
    if (e instanceof ConcurrentIncrementalRefreshError) return;
    if (e instanceof QueuedSnapshotSupersededError) {
      await deleteQueuedSnapshots(context, { ids: [snapshotId] });
      return;
    }
    // Only matches a failure before the snapshot started; a later one was
    // already recorded on the running snapshot.
    await errorQueuedSnapshot(context, snapshotId, getErrorMessage(e));
    logger.error(
      { err: e, snapshotId },
      "Failed to start a queued experiment snapshot",
    );
  }
}

async function retryExperimentSnapshotNode(
  context: AgendaJobContext,
  dag: DagInterface,
  node: DagNode,
): Promise<void> {
  const [failed] = await findSnapshotsByIds(context, [node.targetId]);
  if (!failed) return;

  const copy = await createExperimentSnapshotModel({
    context,
    data: {
      ...omit(failed, [
        "hasChunkedAnalyses",
        "chunkedAnalysesMeta",
        "health",
        "banditResult",
      ]),
      id: generateId("snp_"),
      status: "queued",
      runStarted: null,
      dateCreated: new Date(),
      error: "",
      queries: [],
      unknownVariations: [],
      multipleExposures: 0,
      analyses: failed.analyses.map((analysis) => ({
        ...omit(analysis, "error"),
        dateCreated: new Date(),
        status: "running",
        results: [],
      })),
    },
  });

  // Another tick already retried this attempt
  if (
    !(await context.models.dags.replaceNodeTarget(
      dag.id,
      node.id,
      failed.id,
      copy.id,
    ))
  ) {
    await deleteQueuedSnapshots(context, { ids: [copy.id] });
  }
}
