import { DagNode } from "shared/validators";
import {
  getActions,
  getExperimentSnapshotNodeState,
} from "back-end/src/jobs/runDags";
import { DagNodeState } from "back-end/src/services/dags";
import { SnapshotRunStatus } from "back-end/src/models/ExperimentSnapshotModel";
import { SNAPSHOT_INTERRUPTED_ERROR } from "back-end/src/services/snapshotCancellation";

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
