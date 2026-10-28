import type { QueryStatus } from "shared/types/query";
import type { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import {
  getCancelledRunQueryStatuses,
  InterruptedRunQuery,
  isIncrementalRefreshRun,
  NOT_RUN_QUERY_ERROR,
  planInterruptedRunCleanup,
  releaseInterruptedRefresh,
  stopInterruptedRefresh,
} from "back-end/src/jobs/interruptedRefresh";
import {
  failQueuedQueries,
  getQueryStatusesByIds,
} from "back-end/src/models/QueryModel";
import { ApiReqContext } from "back-end/types/api";

jest.mock("back-end/src/models/QueryModel", () => ({
  failQueuedQueries: jest.fn(),
  getQueryStatusesByIds: jest.fn(),
}));

jest.mock("back-end/src/util/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const SNAPSHOT_ID = "snp_1";

type Statuses = Partial<Record<string, QueryStatus | null>>;

// Query names as ExperimentIncrementalRefreshQueryRunner schedules them.
function runQueries({
  fullRefresh = false,
  groups = ["ft1_abc0"],
  covariateGroups = [] as string[],
  statuses = {} as Statuses,
  defaultStatus = "succeeded" as QueryStatus | null,
}): InterruptedRunQuery[] {
  const names = [
    ...(fullRefresh
      ? [`drop_${SNAPSHOT_ID}_old`, `create_${SNAPSHOT_ID}`]
      : []),
    `update_${SNAPSHOT_ID}`,
    `drop_${SNAPSHOT_ID}`,
    `alter_${SNAPSHOT_ID}`,
    `max_timestamp_${SNAPSHOT_ID}`,
    ...groups.flatMap((g) => [
      `insert_metrics_source_data_${g}`,
      ...(covariateGroups.includes(g)
        ? [`insert_metrics_covariate_data_${g}`]
        : []),
      `max_timestamp_metrics_source_${g}`,
      `statistics_${g}`,
    ]),
    "traffic",
  ];
  return names.map((name) => ({
    name,
    status: name in statuses ? (statuses[name] ?? null) : defaultStatus,
  }));
}

function plan(args: Parameters<typeof runQueries>[0] = {}) {
  return planInterruptedRunCleanup({
    snapshotId: SNAPSHOT_ID,
    fullRefresh: !!args.fullRefresh,
    queries: runQueries(args),
  });
}

const NOTHING = { metricGroupIdsToRebuild: [], forceFullRefresh: false };

describe("planInterruptedRunCleanup", () => {
  it("needs nothing when every query succeeded", () => {
    expect(plan()).toEqual(NOTHING);
    expect(plan({ fullRefresh: true })).toEqual(NOTHING);
  });

  it("needs nothing when only statistics or traffic queries did not finish", () => {
    expect(
      plan({
        statuses: { statistics_ft1_abc0: "running", traffic: "failed" },
      }),
    ).toEqual(NOTHING);
  });

  it("needs nothing when the run stopped before any insert started", () => {
    expect(
      plan({
        statuses: {
          [`update_${SNAPSHOT_ID}`]: "running",
          [`drop_${SNAPSHOT_ID}`]: "queued",
          [`alter_${SNAPSHOT_ID}`]: "queued",
          [`max_timestamp_${SNAPSHOT_ID}`]: "queued",
          insert_metrics_source_data_ft1_abc0: "queued",
          max_timestamp_metrics_source_ft1_abc0: "queued",
        },
      }),
    ).toEqual(NOTHING);
  });

  it.each<QueryStatus>(["running", "succeeded", "failed"])(
    "rebuilds a source whose insert is %s and whose timestamp query did not succeed",
    (insertStatus) => {
      expect(
        plan({
          statuses: {
            insert_metrics_source_data_ft1_abc0: insertStatus,
            max_timestamp_metrics_source_ft1_abc0:
              insertStatus === "succeeded" ? "running" : "queued",
          },
        }),
      ).toEqual({
        metricGroupIdsToRebuild: ["ft1_abc0"],
        forceFullRefresh: false,
      });
    },
  );

  it("rebuilds a source whose timestamp query failed", () => {
    expect(
      plan({ statuses: { max_timestamp_metrics_source_ft1_abc0: "failed" } })
        .metricGroupIdsToRebuild,
    ).toEqual(["ft1_abc0"]);
  });

  it("keeps a source whose timestamp query succeeded", () => {
    expect(
      plan({
        groups: ["ft1_abc0", "ft2_def0"],
        statuses: {
          max_timestamp_metrics_source_ft2_def0: "running",
        },
      }).metricGroupIdsToRebuild,
    ).toEqual(["ft2_def0"]);
  });

  it("counts an insert whose status cannot be read as started", () => {
    expect(
      plan({
        statuses: {
          insert_metrics_source_data_ft1_abc0: null,
          max_timestamp_metrics_source_ft1_abc0: "queued",
        },
      }).metricGroupIdsToRebuild,
    ).toEqual(["ft1_abc0"]);
  });

  it("counts a timestamp query whose status cannot be read as not succeeded", () => {
    expect(
      plan({ statuses: { max_timestamp_metrics_source_ft1_abc0: null } })
        .metricGroupIdsToRebuild,
    ).toEqual(["ft1_abc0"]);
  });

  it("rebuilds a source whose timestamp query is missing from the run", () => {
    expect(
      planInterruptedRunCleanup({
        snapshotId: SNAPSHOT_ID,
        fullRefresh: false,
        queries: runQueries({}).filter(
          (q) => q.name !== "max_timestamp_metrics_source_ft1_abc0",
        ),
      }).metricGroupIdsToRebuild,
    ).toEqual(["ft1_abc0"]);
  });

  it("ignores covariate inserts", () => {
    expect(
      plan({
        covariateGroups: ["ft1_abc0"],
        statuses: { insert_metrics_covariate_data_ft1_abc0: "running" },
      }),
    ).toEqual(NOTHING);
  });

  it("keeps group ids that contain underscores intact", () => {
    expect(
      plan({
        groups: ["fact__orders_qtile_x1y2z0"],
        statuses: {
          max_timestamp_metrics_source_fact__orders_qtile_x1y2z0: "queued",
        },
      }).metricGroupIdsToRebuild,
    ).toEqual(["fact__orders_qtile_x1y2z0"]);
  });

  it.each<[QueryStatus | null, QueryStatus | null]>([
    ["running", "queued"],
    ["succeeded", "queued"],
    ["succeeded", "running"],
    ["succeeded", "failed"],
    ["failed", "queued"],
    [null, "queued"],
    ["succeeded", null],
  ])(
    "forces a full refresh when the units drop is %s and the rename is %s",
    (dropStatus, alterStatus) => {
      expect(
        plan({
          statuses: {
            [`drop_${SNAPSHOT_ID}`]: dropStatus,
            [`alter_${SNAPSHOT_ID}`]: alterStatus,
          },
        }).forceFullRefresh,
      ).toBe(true);
    },
  );

  it("does not force a full refresh when the units drop never started", () => {
    expect(
      plan({
        statuses: {
          [`update_${SNAPSHOT_ID}`]: "failed",
          [`drop_${SNAPSHOT_ID}`]: "queued",
          [`alter_${SNAPSHOT_ID}`]: "queued",
          [`max_timestamp_${SNAPSHOT_ID}`]: "queued",
          insert_metrics_source_data_ft1_abc0: "queued",
          max_timestamp_metrics_source_ft1_abc0: "queued",
        },
      }).forceFullRefresh,
    ).toBe(false);
  });

  it("does not force a full refresh when an update stopped after the rename", () => {
    expect(
      plan({ statuses: { [`max_timestamp_${SNAPSHOT_ID}`]: "running" } })
        .forceFullRefresh,
    ).toBe(false);
  });

  it("forces a full refresh when a full refresh stopped before saving the units timestamp", () => {
    expect(
      plan({
        fullRefresh: true,
        statuses: { [`max_timestamp_${SNAPSHOT_ID}`]: "running" },
      }).forceFullRefresh,
    ).toBe(true);
  });

  it("forces a full refresh when a full refresh stopped before saving a source timestamp", () => {
    expect(
      plan({
        fullRefresh: true,
        groups: ["ft1_abc0", "ft2_def0"],
        statuses: {
          insert_metrics_source_data_ft2_def0: "queued",
          max_timestamp_metrics_source_ft2_def0: "queued",
        },
      }),
    ).toEqual({ metricGroupIdsToRebuild: [], forceFullRefresh: true });
  });

  it("forces a full refresh when a full refresh stopped before it started", () => {
    expect(plan({ fullRefresh: true, defaultStatus: "queued" })).toEqual({
      metricGroupIdsToRebuild: [],
      forceFullRefresh: true,
    });
  });

  it("does not treat the full refresh's first drop as the units drop", () => {
    expect(
      plan({
        statuses: {
          [`drop_${SNAPSHOT_ID}_old`]: "succeeded",
          [`drop_${SNAPSHOT_ID}`]: "queued",
          [`alter_${SNAPSHOT_ID}`]: "queued",
          [`max_timestamp_${SNAPSHOT_ID}`]: "queued",
          insert_metrics_source_data_ft1_abc0: "queued",
          max_timestamp_metrics_source_ft1_abc0: "queued",
        },
      }).forceFullRefresh,
    ).toBe(false);
  });
});

describe("isIncrementalRefreshRun", () => {
  it.each([
    ["incremental-full", true],
    ["incremental-update", true],
    ["incremental-exploratory", false],
    ["results", false],
    [undefined, false],
  ] as const)("%s -> %s", (runnerKind, expected) => {
    expect(isIncrementalRefreshRun({ runnerKind })).toBe(expected);
  });
});

describe("releasing an interrupted refresh", () => {
  const releaseLockAfterInterruptedRun = jest.fn();
  const releaseLock = jest.fn();
  const context = {
    org: { id: "org_1" },
    models: {
      incrementalRefresh: { releaseLockAfterInterruptedRun, releaseLock },
    },
  } as unknown as ApiReqContext;

  function snapshot(
    runnerKind: ExperimentSnapshotInterface["runnerKind"] = "incremental-update",
  ) {
    return {
      id: SNAPSHOT_ID,
      organization: "org_1",
      experiment: "exp_1",
      runnerKind,
      queries: runQueries({}).map((q) => ({
        name: q.name,
        query: `qry_${q.name}`,
        status: "running" as QueryStatus,
      })),
    };
  }

  function statusMap(statuses: Statuses, defaultStatus: QueryStatus) {
    return new Map(
      runQueries({ statuses, defaultStatus })
        .filter((q) => q.status !== null)
        .map((q) => [`qry_${q.name}`, q.status as QueryStatus]),
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    releaseLockAfterInterruptedRun.mockResolvedValue(true);
    releaseLock.mockResolvedValue(undefined);
  });

  describe("releaseInterruptedRefresh", () => {
    it("releases the lock with nothing to drop when the run was clean", async () => {
      await expect(
        releaseInterruptedRefresh(
          context,
          snapshot(),
          statusMap({}, "succeeded"),
        ),
      ).resolves.toBe(false);
      expect(releaseLockAfterInterruptedRun).toHaveBeenCalledWith(
        "exp_1",
        SNAPSHOT_ID,
        NOTHING,
      );
    });

    it("drops the sources it may have appended to in the release write", async () => {
      await expect(
        releaseInterruptedRefresh(
          context,
          snapshot(),
          statusMap(
            {
              insert_metrics_source_data_ft1_abc0: "failed",
              max_timestamp_metrics_source_ft1_abc0: "failed",
            },
            "succeeded",
          ),
        ),
      ).resolves.toBe(false);
      expect(releaseLockAfterInterruptedRun).toHaveBeenCalledWith(
        "exp_1",
        SNAPSHOT_ID,
        { metricGroupIdsToRebuild: ["ft1_abc0"], forceFullRefresh: false },
      );
    });

    it("treats a query missing from the status map as unreadable", async () => {
      const statuses = statusMap({}, "succeeded");
      statuses.delete("qry_max_timestamp_metrics_source_ft1_abc0");
      await releaseInterruptedRefresh(context, snapshot(), statuses);
      expect(releaseLockAfterInterruptedRun).toHaveBeenCalledWith(
        "exp_1",
        SNAPSHOT_ID,
        { metricGroupIdsToRebuild: ["ft1_abc0"], forceFullRefresh: false },
      );
    });

    it("plans a full refresh run with the full refresh rules", async () => {
      await releaseInterruptedRefresh(
        context,
        snapshot("incremental-full"),
        statusMap({ [`max_timestamp_${SNAPSHOT_ID}`]: "failed" }, "succeeded"),
      );
      expect(releaseLockAfterInterruptedRun).toHaveBeenCalledWith(
        "exp_1",
        SNAPSHOT_ID,
        { metricGroupIdsToRebuild: [], forceFullRefresh: true },
      );
    });

    it("reports a full refresh is needed when the lock was already gone", async () => {
      releaseLockAfterInterruptedRun.mockResolvedValue(false);
      await expect(
        releaseInterruptedRefresh(
          context,
          snapshot(),
          statusMap(
            { max_timestamp_metrics_source_ft1_abc0: "failed" },
            "succeeded",
          ),
        ),
      ).resolves.toBe(true);
    });

    it("does not report a full refresh when the lock was gone but nothing needed dropping", async () => {
      releaseLockAfterInterruptedRun.mockResolvedValue(false);
      await expect(
        releaseInterruptedRefresh(
          context,
          snapshot(),
          statusMap({}, "succeeded"),
        ),
      ).resolves.toBe(false);
    });

    it("reports a full refresh is needed when the write fails", async () => {
      releaseLockAfterInterruptedRun.mockRejectedValue(new Error("mongo down"));
      await expect(
        releaseInterruptedRefresh(
          context,
          snapshot(),
          statusMap(
            { max_timestamp_metrics_source_ft1_abc0: "failed" },
            "succeeded",
          ),
        ),
      ).resolves.toBe(true);
      expect(releaseLock).toHaveBeenCalledWith("exp_1", SNAPSHOT_ID);
    });

    it("still resolves when the fallback release fails too", async () => {
      releaseLockAfterInterruptedRun.mockRejectedValue(new Error("mongo down"));
      releaseLock.mockRejectedValue(new Error("still down"));
      await expect(
        releaseInterruptedRefresh(context, snapshot(), statusMap({}, "queued")),
      ).resolves.toBe(false);
    });

    it("does not fall back to a plain release when the cleanup write succeeds", async () => {
      await releaseInterruptedRefresh(
        context,
        snapshot(),
        statusMap({}, "succeeded"),
      );
      expect(releaseLock).not.toHaveBeenCalled();
    });
  });

  describe("cancelled runs", () => {
    it("plans from the queries the cancel failed while still queued", async () => {
      const ids = (statuses: Statuses, defaultStatus: QueryStatus) =>
        [...statusMap(statuses, defaultStatus)].map(([id, status]) => ({
          id,
          status,
        }));
      // Cancelled after the insert succeeded but before its timestamp query ran.
      const before = ids(
        {
          max_timestamp_metrics_source_ft1_abc0: "queued",
          statistics_ft1_abc0: "queued",
          traffic: "running",
        },
        "succeeded",
      );
      const after = ids(
        {
          max_timestamp_metrics_source_ft1_abc0: "failed",
          statistics_ft1_abc0: "failed",
          traffic: "failed",
        },
        "succeeded",
      );

      await releaseInterruptedRefresh(
        context,
        snapshot(),
        getCancelledRunQueryStatuses(
          before.filter((q) => q.status === "queued").map((q) => q.id),
          after,
        ),
      );

      expect(releaseLockAfterInterruptedRun).toHaveBeenCalledWith(
        "exp_1",
        SNAPSHOT_ID,
        { metricGroupIdsToRebuild: ["ft1_abc0"], forceFullRefresh: false },
      );
    });

    it("treats only the queries the cancel failed while queued as not started", async () => {
      const after = [
        { id: "qry_insert_metrics_source_data_ft1_abc0", status: "failed" },
        { id: "qry_update_snp_1", status: "failed" },
      ] as const;

      const statuses = getCancelledRunQueryStatuses(
        ["qry_insert_metrics_source_data_ft1_abc0"],
        [...after],
      );

      expect(statuses).toEqual(
        new Map([
          ["qry_insert_metrics_source_data_ft1_abc0", "queued"],
          ["qry_update_snp_1", "failed"],
        ]),
      );
    });

    it("leaves out queries the second read could not find", () => {
      expect(getCancelledRunQueryStatuses(["q1"], []).has("q1")).toBe(false);
    });

    it("keeps statuses that finished on their own", () => {
      expect(
        getCancelledRunQueryStatuses([], [{ id: "q1", status: "succeeded" }]),
      ).toEqual(new Map([["q1", "succeeded"]]));
    });
  });

  describe("stopInterruptedRefresh", () => {
    function mockStatuses(statuses: Statuses, defaultStatus: QueryStatus) {
      (getQueryStatusesByIds as jest.Mock).mockResolvedValue(
        [...statusMap(statuses, defaultStatus)].map(([id, status]) => ({
          id,
          status,
        })),
      );
    }

    it("fails queued queries before planning, treating them as not started", async () => {
      mockStatuses(
        {
          insert_metrics_source_data_ft1_abc0: "failed",
          max_timestamp_metrics_source_ft1_abc0: "queued",
          statistics_ft1_abc0: "queued",
        },
        "succeeded",
      );
      (failQueuedQueries as jest.Mock).mockImplementation(
        async (ctx: unknown, ids: string[]) => ids,
      );

      const result = await stopInterruptedRefresh(context, snapshot());

      expect(failQueuedQueries).toHaveBeenCalledWith(
        context,
        [
          "qry_max_timestamp_metrics_source_ft1_abc0",
          "qry_statistics_ft1_abc0",
        ],
        NOT_RUN_QUERY_ERROR,
      );
      expect(result).toEqual({
        notRunQueryIds: [
          "qry_max_timestamp_metrics_source_ft1_abc0",
          "qry_statistics_ft1_abc0",
        ],
        needsFullRefresh: false,
      });
      expect(releaseLockAfterInterruptedRun).toHaveBeenCalledWith(
        "exp_1",
        SNAPSHOT_ID,
        { metricGroupIdsToRebuild: ["ft1_abc0"], forceFullRefresh: false },
      );
    });

    it("counts a queued query that started before it could be failed as started", async () => {
      mockStatuses(
        {
          [`drop_${SNAPSHOT_ID}`]: "succeeded",
          [`alter_${SNAPSHOT_ID}`]: "failed",
          [`max_timestamp_${SNAPSHOT_ID}`]: "queued",
          insert_metrics_source_data_ft1_abc0: "queued",
          max_timestamp_metrics_source_ft1_abc0: "queued",
        },
        "succeeded",
      );
      // The insert was promoted between the read and the write.
      (failQueuedQueries as jest.Mock).mockResolvedValue([
        `qry_max_timestamp_${SNAPSHOT_ID}`,
        "qry_max_timestamp_metrics_source_ft1_abc0",
      ]);

      await stopInterruptedRefresh(context, snapshot());

      expect(releaseLockAfterInterruptedRun).toHaveBeenCalledWith(
        "exp_1",
        SNAPSHOT_ID,
        { metricGroupIdsToRebuild: ["ft1_abc0"], forceFullRefresh: true },
      );
    });

    it("reports a full refresh is needed when the cleanup could not be written", async () => {
      mockStatuses(
        { max_timestamp_metrics_source_ft1_abc0: "failed" },
        "succeeded",
      );
      (failQueuedQueries as jest.Mock).mockResolvedValue([]);
      releaseLockAfterInterruptedRun.mockResolvedValue(false);

      await expect(
        stopInterruptedRefresh(context, snapshot()),
      ).resolves.toEqual({
        notRunQueryIds: [],
        needsFullRefresh: true,
      });
    });
  });
});
