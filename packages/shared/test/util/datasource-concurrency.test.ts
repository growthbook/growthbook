import {
  getDefaultMaxConcurrentQueries,
  getMaxConcurrentQueriesLimit,
} from "shared/util";

describe("getDefaultMaxConcurrentQueries", () => {
  it("defaults Adobe Experience Platform Query Service to 1", () => {
    expect(
      getDefaultMaxConcurrentQueries("adobe_experience_platform_query_service"),
    ).toBe(1);
  });

  it("defaults other datasources to 0 (no limit)", () => {
    expect(getDefaultMaxConcurrentQueries("postgres")).toBe(0);
    expect(getDefaultMaxConcurrentQueries("bigquery")).toBe(0);
  });
});

describe("getMaxConcurrentQueriesLimit", () => {
  it("falls back to the type default when the setting is blank or missing", () => {
    expect(
      getMaxConcurrentQueriesLimit(
        "adobe_experience_platform_query_service",
        undefined,
      ),
    ).toBe(1);
    expect(
      getMaxConcurrentQueriesLimit(
        "adobe_experience_platform_query_service",
        "",
      ),
    ).toBe(1);
    expect(getMaxConcurrentQueriesLimit("postgres", undefined)).toBe(0);
    expect(getMaxConcurrentQueriesLimit("postgres", "")).toBe(0);
  });

  it("honors an explicit 0 as no limit, overriding the default", () => {
    expect(
      getMaxConcurrentQueriesLimit(
        "adobe_experience_platform_query_service",
        "0",
      ),
    ).toBe(0);
  });

  it("uses an explicit numeric setting", () => {
    expect(
      getMaxConcurrentQueriesLimit(
        "adobe_experience_platform_query_service",
        "5",
      ),
    ).toBe(5);
    expect(getMaxConcurrentQueriesLimit("postgres", "10")).toBe(10);
  });

  it("falls back to the default for a non-numeric setting", () => {
    expect(
      getMaxConcurrentQueriesLimit(
        "adobe_experience_platform_query_service",
        "abc",
      ),
    ).toBe(1);
    expect(getMaxConcurrentQueriesLimit("postgres", "abc")).toBe(0);
  });
});
