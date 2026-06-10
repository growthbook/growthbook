import type { ExposureQuery } from "shared/types/datasource";
import type { SDKAttributeSchema } from "shared/types/organization";
import {
  assertExposureQueriesTargetingAttributeColumnsValid,
  formatInvalidTargetingAttributeColumnMessages,
  getAllowedTargetingAttributePropertyNames,
  getInvalidTargetingAttributeColumnsForExposureQueries,
  getMalformedTargetingAttributeColumnsForExposureQueries,
  isSafeSqlIdentifier,
} from "../src/validators/exposure-query-targeting-attribute-columns";

const schema: SDKAttributeSchema = [
  {
    property: "country",
    datatype: "string",
  },
  {
    property: "legacy",
    datatype: "string",
    archived: true,
  },
];

describe("exposure query targeting attribute columns", () => {
  it("getAllowedTargetingAttributePropertyNames skips archived", () => {
    const allowed = getAllowedTargetingAttributePropertyNames(schema);
    expect(allowed.has("country")).toBe(true);
    expect(allowed.has("legacy")).toBe(false);
  });

  it("getInvalidTargetingAttributeColumnsForExposureQueries lists unknown columns", () => {
    const queries: ExposureQuery[] = [
      {
        id: "q1",
        name: "Main",
        userIdType: "user_id",
        query: "SELECT 1",
        dimensions: [],
        targetingAttributeColumns: ["country", "planet"],
      },
    ];
    const invalid = getInvalidTargetingAttributeColumnsForExposureQueries(
      schema,
      queries,
    );
    expect(invalid).toEqual([{ queryLabel: "Main", column: "planet" }]);
  });

  it("assertExposureQueriesTargetingAttributeColumnsValid passes when empty or valid", () => {
    expect(() =>
      assertExposureQueriesTargetingAttributeColumnsValid(schema, []),
    ).not.toThrow();
    expect(() =>
      assertExposureQueriesTargetingAttributeColumnsValid(schema, [
        {
          id: "q1",
          name: "Main",
          userIdType: "user_id",
          query: "SELECT 1",
          dimensions: ["browser"],
          targetingAttributeColumns: ["country"],
        },
      ]),
    ).not.toThrow();
  });

  it("assertExposureQueriesTargetingAttributeColumnsValid throws with per-column message", () => {
    expect(() =>
      assertExposureQueriesTargetingAttributeColumnsValid(schema, [
        {
          id: "exq_1",
          name: "",
          userIdType: "user_id",
          query: "SELECT 1",
          dimensions: [],
          targetingAttributeColumns: ["nope"],
        },
      ]),
    ).toThrow(/nope is not a saved targeting attribute/);
  });

  it("assertContextualBanditExperimentFieldsValid is a no-op for non-CB types", () => {
    expect(() =>
      assertContextualBanditExperimentFieldsValid({
        experimentType: "standard",
        exposureQueryId: "q1",
        exposureQueries: [
          {
            id: "q1",
            name: "Q",
            userIdType: "user_id",
            query: "SELECT 1",
            dimensions: [],
            targetingAttributeColumns: ["country"],
          },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      assertContextualBanditExperimentFieldsValid({
        experimentType: "multi-armed-bandit",
        exposureQueryId: "q1",
        exposureQueries: [
          {
            id: "q1",
            name: "Q",
            userIdType: "user_id",
            query: "SELECT 1",
            dimensions: [],
          },
        ],
      }),
    ).not.toThrow();
  });

  it("assertContextualBanditExperimentFieldsValid rejects EAQ without targeting columns", () => {
    expect(() =>
      assertContextualBanditExperimentFieldsValid({
        experimentType: "contextual-bandit",
        exposureQueryId: "q1",
        exposureQueries: [
          {
            id: "q1",
            name: "Q",
            userIdType: "user_id",
            query: "SELECT 1",
            dimensions: ["device"],
          },
        ],
      }),
    ).toThrow(/targeting attribute columns/);
  });

  it("isSafeSqlIdentifier accepts identifiers and rejects unsafe input", () => {
    expect(isSafeSqlIdentifier("country")).toBe(true);
    expect(isSafeSqlIdentifier("_plan_tier2")).toBe(true);
    expect(isSafeSqlIdentifier("2country")).toBe(false);
    expect(isSafeSqlIdentifier("country; DROP TABLE users")).toBe(false);
    expect(isSafeSqlIdentifier("col-name")).toBe(false);
    expect(isSafeSqlIdentifier("")).toBe(false);
  });

  it("getMalformedTargetingAttributeColumnsForExposureQueries flags non-identifier columns", () => {
    const malformed = getMalformedTargetingAttributeColumnsForExposureQueries([
      {
        id: "q1",
        name: "Main",
        userIdType: "user_id",
        query: "SELECT 1",
        dimensions: [],
        targetingAttributeColumns: ["country", "bad; SELECT", "2plan"],
      },
    ]);
    expect(malformed).toEqual([
      { queryLabel: "Main", column: "bad; SELECT" },
      { queryLabel: "Main", column: "2plan" },
    ]);
  });

  it("assertExposureQueriesTargetingAttributeColumnsValid rejects malformed columns first", () => {
    expect(() =>
      assertExposureQueriesTargetingAttributeColumnsValid(schema, [
        {
          id: "q1",
          name: "Main",
          userIdType: "user_id",
          query: "SELECT 1",
          dimensions: [],
          // "planet" would fail membership, but malformed is reported first.
          targetingAttributeColumns: ["planet", "bad; SELECT"],
        },
      ]),
    ).toThrow(/is not a valid column name/);
  });

  it("formatInvalidTargetingAttributeColumnMessages uses entered names and dedupes", () => {
    expect(
      formatInvalidTargetingAttributeColumnMessages(["planet", "planet", "x"]),
    ).toBe(
      `planet is not a saved targeting attribute. Column aliases in your assignment query must match organization targeting attributes (Settings → Attributes).\n\nx is not a saved targeting attribute. Column aliases in your assignment query must match organization targeting attributes (Settings → Attributes).`,
    );
  });
});
