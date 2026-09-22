import type { ReqContext } from "back-end/types/request";
import {
  trackQueryFailed,
  trackQueryFailedForOrganizationId,
  trackQuerySucceeded,
} from "back-end/src/services/queryTelemetry";
import {
  trackEventForContext,
  trackEventForOrganizationId,
} from "back-end/src/services/growthbook";

jest.mock("back-end/src/services/growthbook");

describe("query telemetry", () => {
  const context = { org: { id: "org_1" } } as unknown as ReqContext;
  const query = {
    id: "qry_1",
    queryType: "experimentResults" as const,
    datasource: "ds_1",
    error: "raw warehouse error echoing 'secret'",
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("sends the same fields for success and failure, plus an error type on failure", () => {
    const source = {
      query,
      datasource: { id: "ds_1", type: "bigquery" as const },
      durationMs: 1200,
    };
    const expected = {
      queryId: "qry_1",
      queryType: "experimentResults",
      datasourceId: "ds_1",
      datasourceType: "bigquery",
      durationMs: 1200,
    };

    trackQuerySucceeded(context, source);
    trackQueryFailed(context, source, "warehouse-error");

    expect(trackEventForContext).toHaveBeenNthCalledWith(
      1,
      context,
      "Query Succeeded",
      expected,
    );
    expect(trackEventForContext).toHaveBeenNthCalledWith(
      2,
      context,
      "Query Failed",
      { ...expected, errorType: "warehouse-error" },
    );
    expect(
      JSON.stringify(jest.mocked(trackEventForContext).mock.calls),
    ).not.toContain("secret");
  });

  it("sends null datasource type and duration when unknown", () => {
    trackQueryFailedForOrganizationId(
      "org_1",
      { query: { id: "qry_2" }, datasource: null, durationMs: null },
      "stale-heartbeat",
    );

    expect(trackEventForOrganizationId).toHaveBeenCalledWith(
      "org_1",
      "Query Failed",
      {
        queryId: "qry_2",
        queryType: "unknown",
        datasourceId: null,
        datasourceType: null,
        durationMs: null,
        errorType: "stale-heartbeat",
      },
    );
  });

  it("never throws when the tracker does", () => {
    jest.mocked(trackEventForContext).mockImplementation(() => {
      throw new Error("telemetry down");
    });

    expect(() =>
      trackQueryFailed(
        context,
        { query, datasource: null, durationMs: null },
        "orphaned",
      ),
    ).not.toThrow();
  });
});
