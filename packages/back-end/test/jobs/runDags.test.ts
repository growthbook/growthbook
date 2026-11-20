import { DagNode } from "shared/validators";
import {
  getActions,
  getExperimentSnapshotNodeState,
  runDagTick,
} from "back-end/src/jobs/runDags";
import { DagNodeState } from "back-end/src/services/dags";
import {
  dangerousFindSnapshotStatusesByIds,
  deleteQueuedSnapshots,
  SnapshotRunStatus,
} from "back-end/src/models/ExperimentSnapshotModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { SNAPSHOT_INTERRUPTED_ERROR } from "back-end/src/services/snapshotCancellation";

jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgId: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  dangerousFindSnapshotStatusesByIds: jest.fn(),
  deleteQueuedSnapshots: jest.fn(),
}));

const now = new Date("2026-01-01T12:00:00Z");
const minutesAgo = (minutes: number) =>
  new Date(now.getTime() - minutes * 60 * 1000);

const snapshot = (
  overrides: Partial<SnapshotRunStatus>,
): SnapshotRunStatus => ({
  id: "snp_1",
  status: "running",
  error: null,
  runStarted: minutesAgo(1),
  queryCount: 0,
  ...overrides,
});

describe("getExperimentSnapshotNodeState", () => {
  it("reads a deleted snapshot as missing", () => {
    expect(getExperimentSnapshotNodeState(undefined, now)).toEqual({
      status: "missing",
    });
  });

  it("passes queued and success through", () => {
    expect(
      getExperimentSnapshotNodeState(
        snapshot({ status: "queued", runStarted: null }),
        now,
      ),
    ).toEqual({ status: "queued" });
    expect(
      getExperimentSnapshotNodeState(snapshot({ status: "success" }), now),
    ).toEqual({
      status: "success",
    });
  });

  it("is stalled only after ten minutes with no queries saved", () => {
    const stalled = (overrides: Partial<SnapshotRunStatus>) =>
      getExperimentSnapshotNodeState(snapshot(overrides), now);

    expect(stalled({ runStarted: minutesAgo(9) })).toEqual({
      status: "running",
      stalled: false,
    });
    expect(stalled({ runStarted: minutesAgo(11) })).toEqual({
      status: "running",
      stalled: true,
    });
    expect(stalled({ runStarted: minutesAgo(11), queryCount: 3 })).toEqual({
      status: "running",
      stalled: false,
    });
  });

  it("does not retry a run that was interrupted or cancelled", () => {
    const failed = (error: string) =>
      getExperimentSnapshotNodeState(snapshot({ status: "error", error }), now);

    expect(failed("Query timed out")).toEqual({
      status: "error",
      retryable: true,
    });
    expect(failed(SNAPSHOT_INTERRUPTED_ERROR)).toEqual({
      status: "error",
      retryable: false,
    });
    expect(failed("Query cancelled by user (jane@example.com)")).toEqual({
      status: "error",
      retryable: false,
    });
  });
});

describe("getActions", () => {
  const node = (id: string, dependsOn: string[]): DagNode => ({
    id,
    dependsOn,
    type: "experiment-snapshot",
    targetId: `snp_${id}`,
    previousTargetIds: [],
    maxAttempts: 1,
  });
  const nodes = [node("main", []), node("a", ["main"]), node("b", ["main"])];
  // A breakdown that is still queued, as when its start keeps being refused
  const states = new Map<string, DagNodeState>([
    ["snp_main", { status: "success" }],
    ["snp_a", { status: "queued" }],
  ]);

  it("keeps trying to start a queued node until the DAG is 48 hours old", () => {
    expect(
      getActions({ nodes, dateCreated: minutesAgo(47 * 60) }, states, now),
    ).toEqual([{ type: "start", nodeId: "a" }]);
  });

  it("drops what is still queued and closes a DAG older than 48 hours", () => {
    expect(
      getActions({ nodes, dateCreated: minutesAgo(49 * 60) }, states, now),
    ).toEqual([{ type: "drop", nodeId: "a" }, { type: "done" }]);
  });
});

describe("runDagTick", () => {
  const markDone = jest.fn();
  const tick = () =>
    runDagTick({
      attrs: { data: { organization: "org_1", dagId: "dag_1" } },
    } as Parameters<typeof runDagTick>[0]);

  beforeEach(() => {
    jest.clearAllMocks();
    // Older than 48 hours, with a breakdown still queued
    const dag = {
      id: "dag_1",
      status: "active",
      dateCreated: new Date(0),
      nodes: [
        {
          id: "a",
          dependsOn: [],
          type: "experiment-snapshot",
          targetId: "snp_a",
          previousTargetIds: [],
          maxAttempts: 1,
        },
      ],
    };
    jest.mocked(getContextForAgendaJobByOrgId).mockResolvedValue({
      models: { dags: { getById: async () => dag, markDone } },
    } as unknown as Awaited<ReturnType<typeof getContextForAgendaJobByOrgId>>);
    jest
      .mocked(dangerousFindSnapshotStatusesByIds)
      .mockResolvedValue([
        snapshot({ id: "snp_a", status: "queued", runStarted: null }),
      ]);
  });

  it("closes an expired DAG once its queued snapshots are deleted", async () => {
    await tick();

    expect(deleteQueuedSnapshots).toHaveBeenCalledWith(expect.anything(), {
      ids: ["snp_a"],
    });
    expect(markDone).toHaveBeenCalledWith("dag_1");
  });

  it("keeps an expired DAG active when deleting a queued snapshot fails", async () => {
    jest
      .mocked(deleteQueuedSnapshots)
      .mockRejectedValueOnce(new Error("Mongo unavailable"));

    await tick();

    expect(markDone).not.toHaveBeenCalled();
  });
});
