import {
  DataSourceParams,
  DataSourceSettings,
  ExposureQuery,
} from "shared/types/datasource";
import { describe, expect, it } from "vitest";
import {
  applyGoogleAnalytics4Settings,
  getGA4ExposureTemplate,
  getGoogleAnalytics4ExposureQueryDraft,
  getGoogleAnalytics4UserIdTypes,
  hasGoogleAnalytics4ExposureQuery,
} from "@/services/datasources";

describe("getGA4ExposureTemplate", () => {
  it("uses the Data Source's identifiers and the picked table", () => {
    const template = getGA4ExposureTemplate(["device_id"]);
    expect(template.columns.map((c) => c.column)).toContain("device_id");
    const sql = template.getSql(
      { path: "`proj.analytics_1.events_*`" } as Parameters<
        typeof template.getSql
      >[0],
      "",
    );
    expect(sql).toContain("user_pseudo_id as device_id");
    expect(sql).toContain("FROM\n  `proj.analytics_1.events_*`,");
  });
});

describe("hasGoogleAnalytics4ExposureQuery", () => {
  it("is true only when an exposure query uses the GA4 id", () => {
    expect(hasGoogleAnalytics4ExposureQuery(undefined)).toBe(false);
    expect(
      hasGoogleAnalytics4ExposureQuery({ queries: { exposure: [] } }),
    ).toBe(false);
    expect(
      hasGoogleAnalytics4ExposureQuery({
        queries: {
          exposure: [
            {
              id: "exq_1",
              name: "Custom",
              userIdType: "user_id",
              userIdTypes: ["user_id"],
              query: "SELECT 1",
              dimensions: [],
            },
          ],
        },
      }),
    ).toBe(false);
    expect(
      hasGoogleAnalytics4ExposureQuery({
        queries: {
          exposure: [
            {
              id: "ga4",
              name: "Google Analytics 4",
              userIdType: "anonymous_id",
              userIdTypes: ["anonymous_id", "user_id"],
              query: "SELECT 1",
              dimensions: [],
            },
          ],
        },
      }),
    ).toBe(true);
  });
});

describe("getGoogleAnalytics4UserIdTypes", () => {
  it("keeps existing types and adds only the missing GA4 ones", () => {
    const result = getGoogleAnalytics4UserIdTypes([
      { userIdType: "user_id", description: "Custom logged-in id" },
      { userIdType: "company_id", description: "Account" },
    ]);
    expect(result).toEqual([
      { userIdType: "user_id", description: "Custom logged-in id" },
      { userIdType: "company_id", description: "Account" },
      { userIdType: "anonymous_id", description: "Anonymous visitor id" },
    ]);
  });

  it("adds both GA4 types when none exist yet", () => {
    const result = getGoogleAnalytics4UserIdTypes([]);
    expect(result.map((type) => type.userIdType)).toEqual([
      "anonymous_id",
      "user_id",
    ]);
  });
});

describe("getGoogleAnalytics4ExposureQueryDraft", () => {
  it("builds a query covering both GA4 identifier types", () => {
    const params = {
      defaultProject: "analytics-prod",
      defaultDataset: "analytics_123",
    } as DataSourceParams;

    const draft = getGoogleAnalytics4ExposureQueryDraft(params);

    expect(draft).toMatchObject({
      id: "ga4",
      name: "Google Analytics 4",
      userIdType: "anonymous_id",
      userIdTypes: ["anonymous_id", "user_id"],
    });
    expect(draft.query).toContain(
      "`analytics-prod`.`analytics_123`.`events_*`",
    );
  });
});

describe("applyGoogleAnalytics4Settings", () => {
  const params = {
    defaultProject: "analytics-prod",
    defaultDataset: "analytics_123",
  } as DataSourceParams;

  const existingQuery: ExposureQuery = {
    id: "exq_custom",
    name: "Custom",
    userIdType: "company_id",
    userIdTypes: ["company_id"],
    query: "SELECT company_id",
    dimensions: ["plan"],
  };

  it("keeps existing settings and adds only the missing GA4 identifier types", () => {
    const settings: DataSourceSettings = {
      schemaFormat: "custom",
      schemaOptions: { exposureTableName: "events" },
      userIdTypes: [
        { userIdType: "user_id", description: "Custom logged-in id" },
        { userIdType: "company_id", description: "Account" },
      ],
      queries: {
        exposure: [existingQuery],
        identityJoins: [{ ids: ["user_id", "company_id"], query: "SELECT 1" }],
      },
    };

    const applied = applyGoogleAnalytics4Settings(settings, params);

    expect(applied.schemaFormat).toBe("ga4");
    expect(applied.schemaOptions).toEqual({ exposureTableName: "events" });
    expect(applied.queries?.identityJoins).toEqual(
      settings.queries?.identityJoins,
    );
    expect(applied.queries?.exposure?.[0]).toEqual(existingQuery);
    expect(applied.queries?.exposure).toHaveLength(2);
    expect(applied.queries?.exposure?.[1]).toMatchObject({
      id: "ga4",
      name: "Google Analytics 4",
      userIdType: "anonymous_id",
      userIdTypes: ["anonymous_id", "user_id"],
    });
    expect(applied.queries?.exposure?.[1]?.query).toContain(
      "`analytics-prod`.`analytics_123`.`events_*`",
    );
    expect(applied.userIdTypes).toEqual([
      { userIdType: "user_id", description: "Custom logged-in id" },
      { userIdType: "company_id", description: "Account" },
      { userIdType: "anonymous_id", description: "Anonymous visitor id" },
    ]);
  });

  it("does not add another query or identifier when applied twice", () => {
    const once = applyGoogleAnalytics4Settings(undefined, params);
    const twice = applyGoogleAnalytics4Settings(once, params);

    expect(twice.queries?.exposure).toHaveLength(1);
    expect(twice.queries?.exposure?.[0]?.id).toBe("ga4");
    expect(twice.userIdTypes?.map((type) => type.userIdType)).toEqual([
      "anonymous_id",
      "user_id",
    ]);
    expect(twice).toEqual(once);
  });
});
