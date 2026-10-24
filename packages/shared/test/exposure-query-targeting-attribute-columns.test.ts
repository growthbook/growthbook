import type { SDKAttributeSchema } from "shared/types/organization";
import {
  assertExposureQueriesTargetingAttributeColumnsValid,
  formatInvalidTargetingAttributeColumnMessages,
  getAllowedTargetingAttributePropertyNames,
  getInvalidTargetingAttributeColumnsForExposureQueries,
  getMalformedTargetingAttributeColumnsForExposureQueries,
  isSafeSqlIdentifier,
  queryHasContextualBanditSrmColumns,
  queryHasContextualBanditVersionColumn,
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
    const queries = [
      {
        id: "q1",
        name: "Main",
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
          targetingAttributeColumns: ["planet", "bad; SELECT"],
        },
      ]),
    ).toThrow(/is not a valid column name/);
  });

  describe("queryHasContextualBanditSrmColumns", () => {
    it("detects all required SRM columns", () => {
      expect(
        queryHasContextualBanditSrmColumns(
          "SELECT bandit_version, leaf_id, variation_weights FROM exposures",
        ),
      ).toBe(true);
    });

    it("ignores required columns that appear only in comments", () => {
      expect(
        queryHasContextualBanditSrmColumns(
          "SELECT bandit_version, leaf_id -- variation_weights not selected\nFROM exposures",
        ),
      ).toBe(false);
    });

    it("detects required columns exposed via double-quoted (ANSI/PostgreSQL) aliases", () => {
      expect(
        queryHasContextualBanditSrmColumns(
          'SELECT source.version AS "bandit_version", source.leaf AS "leaf_id", source.weights AS "variation_weights" FROM exposures',
        ),
      ).toBe(true);
    });

    it("still ignores a required column that only appears in a single-quoted string", () => {
      expect(
        queryHasContextualBanditSrmColumns(
          "SELECT bandit_version, leaf_id, 'variation_weights' AS note FROM exposures",
        ),
      ).toBe(false);
    });

    it("ignores required columns that are only filtered on, not selected", () => {
      expect(
        queryHasContextualBanditSrmColumns(
          "SELECT leaf_id, variation_weights FROM exposures WHERE bandit_version >= 2",
        ),
      ).toBe(false);
    });
  });

  describe("queryHasContextualBanditVersionColumn", () => {
    it("detects the version column in the SELECT projection", () => {
      expect(
        queryHasContextualBanditVersionColumn(
          "SELECT user_id, bandit_version FROM exposures",
        ),
      ).toBe(true);
    });

    it("does not treat a WHERE-only reference as an output column", () => {
      expect(
        queryHasContextualBanditVersionColumn(
          "SELECT user_id FROM exposures WHERE bandit_version >= 2",
        ),
      ).toBe(false);
    });
  });

  it("formatInvalidTargetingAttributeColumnMessages uses entered names and dedupes", () => {
    expect(
      formatInvalidTargetingAttributeColumnMessages(["planet", "planet", "x"]),
    ).toBe(
      `planet is not a saved targeting attribute. Column aliases in your assignment query must match organization targeting attributes (Settings → Attributes).\n\nx is not a saved targeting attribute. Column aliases in your assignment query must match organization targeting attributes (Settings → Attributes).`,
    );
  });
});
