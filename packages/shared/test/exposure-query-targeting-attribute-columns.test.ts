import type { ExposureQuery } from "shared/types/datasource";
import type { SDKAttributeSchema } from "shared/types/organization";
import {
  assertExposureQueriesTargetingAttributeColumnsValid,
  formatInvalidTargetingAttributeColumnMessages,
  getAllowedTargetingAttributePropertyNames,
  getInvalidTargetingAttributeColumnsForExposureQueries,
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

  it("formatInvalidTargetingAttributeColumnMessages uses entered names and dedupes", () => {
    expect(
      formatInvalidTargetingAttributeColumnMessages(["planet", "planet", "x"]),
    ).toBe(
      `planet is not a saved targeting attribute. Column aliases in your assignment query must match organization targeting attributes (Settings → Attributes).\n\nx is not a saved targeting attribute. Column aliases in your assignment query must match organization targeting attributes (Settings → Attributes).`,
    );
  });
});
