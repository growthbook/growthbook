import { getSnapshotNodeState } from "back-end/src/jobs/runDags";
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

describe("getSnapshotNodeState", () => {
  it("reads a deleted snapshot as missing", () => {
    expect(getSnapshotNodeState(undefined, now)).toEqual({ status: "missing" });
  });

  it("passes queued and success through", () => {
    expect(
      getSnapshotNodeState(
        snapshot({ status: "queued", runStarted: null }),
        now,
      ),
    ).toEqual({ status: "queued" });
    expect(getSnapshotNodeState(snapshot({ status: "success" }), now)).toEqual({
      status: "success",
    });
  });

  it("is stalled only after ten minutes with no queries saved", () => {
    const stalled = (overrides: Partial<SnapshotRunStatus>) =>
      getSnapshotNodeState(snapshot(overrides), now);

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
      getSnapshotNodeState(snapshot({ status: "error", error }), now);

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
