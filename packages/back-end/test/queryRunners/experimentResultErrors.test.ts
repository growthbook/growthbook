import type { Queries, QueryInterface } from "shared/types/query";
import type { QueryMap } from "back-end/src/queryRunners/QueryRunner";
import { getFailedExperimentMetricErrors } from "back-end/src/queryRunners/experimentResultErrors";

function query({
  id,
  status,
  error,
  dependencies = [],
}: {
  id: string;
  status: QueryInterface["status"];
  error?: string;
  dependencies?: string[];
}): QueryInterface {
  return {
    id,
    organization: "org",
    datasource: "datasource",
    language: "sql",
    query: "SELECT 1",
    status,
    error,
    dependencies,
    createdAt: new Date(),
    heartbeat: new Date(),
  };
}

describe("getFailedExperimentMetricErrors", () => {
  it("attributes a failed group only to its owned metrics", () => {
    const failedGroup = query({
      id: "qry_failed",
      status: "failed",
      error: "Warehouse timed out",
    });
    const survivingGroup = query({
      id: "qry_surviving",
      status: "succeeded",
    });
    const queryData: QueryMap = new Map([
      ["group_0", failedGroup],
      ["group_1", survivingGroup],
    ]);
    const queries: Queries = [
      {
        name: "group_0",
        query: failedGroup.id,
        status: "failed",
        resultMetricIds: ["metric_a", "metric_b"],
      },
      {
        name: "group_1",
        query: survivingGroup.id,
        status: "succeeded",
        resultMetricIds: ["metric_c"],
      },
    ];

    expect(
      getFailedExperimentMetricErrors({
        queryData,
        allQueryData: queryData,
        queries,
      }),
    ).toEqual(
      new Map([
        ["metric_a", "Warehouse timed out"],
        ["metric_b", "Warehouse timed out"],
      ]),
    );
  });

  it("resolves a dependency failure within its own dependency chain", () => {
    const rootCause = query({
      id: "qry_root",
      status: "failed",
      error: "Table not found",
    });
    const failedStatistics = query({
      id: "qry_statistics",
      status: "failed",
      error: "Dependencies failed: qry_root",
      dependencies: [rootCause.id],
    });
    const unrelatedFailure = query({
      id: "qry_unrelated",
      status: "failed",
      error: "Unrelated syntax error",
    });
    const scopedQueryData: QueryMap = new Map([
      ["statistics_group", failedStatistics],
    ]);
    const allQueryData: QueryMap = new Map([
      ["insert", rootCause],
      ["statistics_group", failedStatistics],
      ["unrelated", unrelatedFailure],
    ]);

    expect(
      getFailedExperimentMetricErrors({
        queryData: scopedQueryData,
        allQueryData,
        queries: [
          {
            name: "statistics_group",
            query: failedStatistics.id,
            status: "failed",
            resultMetricIds: ["metric_a"],
          },
        ],
      }),
    ).toEqual(new Map([["metric_a", "Table not found"]]));
  });

  it("matches ownership by query id after unit-dimension namespacing", () => {
    const failedUnitDimensionGroup = query({
      id: "qry_unit_dimension",
      status: "failed",
      error: "Unit dimension query failed",
    });
    const remappedQueryData: QueryMap = new Map([
      ["group_0", failedUnitDimensionGroup],
    ]);

    expect(
      getFailedExperimentMetricErrors({
        queryData: remappedQueryData,
        allQueryData: new Map([
          ["unitdim:dimension:group_0", failedUnitDimensionGroup],
        ]),
        queries: [
          {
            name: "unitdim:dimension:group_0",
            query: failedUnitDimensionGroup.id,
            status: "failed",
            resultMetricIds: ["metric_a"],
          },
        ],
      }),
    ).toEqual(new Map([["metric_a", "Unit dimension query failed"]]));
  });

  it("does not guess ownership for legacy pointers", () => {
    const failedGroup = query({
      id: "qry_failed",
      status: "failed",
      error: "Warehouse timed out",
    });
    const queryData: QueryMap = new Map([["group_0", failedGroup]]);

    expect(
      getFailedExperimentMetricErrors({
        queryData,
        allQueryData: queryData,
        queries: [
          {
            name: "group_0",
            query: failedGroup.id,
            status: "failed",
          },
        ],
      }),
    ).toEqual(new Map());
  });
});
