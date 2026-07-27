import {
  assertClickHouseQueryWasCancelled,
  ClickHouseClusterConfigurationError,
  getClickHouseCluster,
  getClickHouseOnClusterClause,
} from "back-end/src/integrations/clickhouse/cancelQuery";

describe("ClickHouse query cancellation helpers", () => {
  it("uses an explicitly configured cluster", () => {
    expect(
      getClickHouseCluster(
        { url: "http://clickhouse.internal", cluster: "analytics-prod" },
        false,
      ),
    ).toBe("analytics-prod");
  });

  it("uses the default cluster for ClickHouse Cloud", () => {
    expect(
      getClickHouseCluster(
        { url: "https://instance.us-east-1.aws.clickhouse.cloud" },
        false,
      ),
    ).toBe("default");
  });

  it("uses the default cluster for a managed warehouse", () => {
    expect(
      getClickHouseCluster(
        { url: "https://managed-warehouse-placeholder.invalid" },
        true,
      ),
    ).toBe("default");
  });

  it("uses a bare statement for a self-hosted single node", () => {
    expect(
      getClickHouseCluster({ url: "http://clickhouse.internal" }, false),
    ).toBeNull();
  });

  it("accepts ClickHouse cluster names containing dots and hyphens", () => {
    expect(getClickHouseOnClusterClause("all_groups.default")).toBe(
      " ON CLUSTER `all_groups.default`",
    );
    expect(getClickHouseOnClusterClause("analytics-prod")).toBe(
      " ON CLUSTER `analytics-prod`",
    );
  });

  it("rejects an unsafe cluster name", () => {
    expect(() =>
      getClickHouseOnClusterClause("analytics; DROP TABLE x"),
    ).toThrow(ClickHouseClusterConfigurationError);
  });

  it("identifies a missing cluster configuration when no node finds the query", () => {
    expect(() => assertClickHouseQueryWasCancelled([], null)).toThrow(
      ClickHouseClusterConfigurationError,
    );
  });

  it("accepts a successful kill response", () => {
    expect(() =>
      assertClickHouseQueryWasCancelled(
        [{ kill_status: "finished" }],
        "default",
      ),
    ).not.toThrow();
  });
});
