/**
 * Identity CTE Builder Tests
 *
 * These tests verify:
 * 1. The extracted buildIdentitiesCTE function works correctly
 * 2. The extracted function produces IDENTICAL results to the original
 *    SqlIntegration.getIdentitiesCTE private method (parity tests)
 *
 * The identity CTE builder is responsible for:
 * - Determining the base user ID type from multiple sources
 * - Generating SQL CTEs for joining different user ID types together
 */

import BigQuery from "../../../../src/integrations/BigQuery";
import { DataSourceSettings } from "shared/types/datasource";
import {
  buildIdentitiesCTE,
  IdentitiesCTEDialect,
  IdentitiesCTEParams,
  IdentitiesCTEResult,
} from "../../../../src/integrations/sql-builders/cte-builders/identities";

// ============================================================
// Test Setup
// ============================================================

// Create BigQuery instance for testing original private methods
// @ts-expect-error - context not needed for method testing
const bqInstance = new BigQuery("", {
  settings: {
    queries: {
      identityJoins: [
        {
          ids: ["user_id", "anonymous_id"],
          query: "SELECT user_id, anonymous_id FROM identity_table",
        },
      ],
    },
  },
});

// Helper to access private methods from original implementation
function getPrivateMethod<T>(methodName: string): T {
  return (bqInstance as unknown as Record<string, T>)[methodName].bind(
    bqInstance
  );
}

// Get reference to ORIGINAL private method (for parity testing)
const originalGetIdentitiesCTE = getPrivateMethod<
  (params: IdentitiesCTEParams) => IdentitiesCTEResult
>("getIdentitiesCTE");

// Create a dialect adapter that wraps the BigQuery instance for use with extracted function
function createBigQueryDialectAdapter(): IdentitiesCTEDialect {
  const getIdentitiesQuery = getPrivateMethod<
    (
      settings: DataSourceSettings,
      id1: string,
      id2: string,
      from: Date,
      to: Date | undefined,
      experimentId?: string
    ) => string
  >("getIdentitiesQuery");

  return {
    getIdentitiesQuery: (settings, id1, id2, from, to, experimentId) => {
      return getIdentitiesQuery(settings, id1, id2, from, to, experimentId);
    },
  };
}

// ============================================================
// Test Fixtures
// ============================================================

const testDatasourceSettings: DataSourceSettings = {
  queries: {
    identityJoins: [
      {
        ids: ["user_id", "anonymous_id"],
        query: "SELECT user_id, anonymous_id FROM identity_table",
      },
      {
        ids: ["user_id", "device_id"],
        query: "SELECT user_id, device_id FROM device_identity_table",
      },
    ],
  },
};

const baseDate = new Date("2023-01-01T00:00:00Z");
const endDate = new Date("2023-01-31T00:00:00Z");

// ============================================================
// Unit Tests for buildIdentitiesCTE
// ============================================================

describe("buildIdentitiesCTE", () => {
  const dialect = createBigQueryDialectAdapter();

  describe("base ID type selection", () => {
    it("returns empty idJoinSQL when all objects use the same ID type", () => {
      const result = buildIdentitiesCTE(dialect, testDatasourceSettings, {
        objects: [["user_id"], ["user_id"], ["user_id"]],
        from: baseDate,
        to: endDate,
      });

      expect(result.baseIdType).toBe("user_id");
      expect(result.idJoinSQL).toBe("");
      expect(result.idJoinMap).toEqual({});
    });

    it("selects the most common ID type as base", () => {
      const result = buildIdentitiesCTE(dialect, testDatasourceSettings, {
        objects: [
          ["user_id"],
          ["user_id"],
          ["anonymous_id"],
        ],
        from: baseDate,
        to: endDate,
      });

      expect(result.baseIdType).toBe("user_id");
    });

    it("uses forcedBaseIdType when provided", () => {
      const result = buildIdentitiesCTE(dialect, testDatasourceSettings, {
        objects: [
          ["user_id"],
          ["anonymous_id"],
        ],
        from: baseDate,
        to: endDate,
        forcedBaseIdType: "anonymous_id",
      });

      expect(result.baseIdType).toBe("anonymous_id");
    });

    it("handles empty objects array", () => {
      const result = buildIdentitiesCTE(dialect, testDatasourceSettings, {
        objects: [],
        from: baseDate,
        to: endDate,
      });

      expect(result.baseIdType).toBe("");
      expect(result.idJoinSQL).toBe("");
      expect(result.idJoinMap).toEqual({});
    });
  });

  describe("identity join generation", () => {
    it("generates join CTE for objects that need different ID type", () => {
      const result = buildIdentitiesCTE(dialect, testDatasourceSettings, {
        objects: [
          ["user_id"],       // Exposure uses user_id
          ["anonymous_id"],  // Metric uses anonymous_id
        ],
        from: baseDate,
        to: endDate,
      });

      expect(result.baseIdType).toBe("user_id");
      expect(result.idJoinMap).toHaveProperty("anonymous_id");
      expect(result.idJoinMap["anonymous_id"]).toBe("__identities_anonymous_id");
      expect(result.idJoinSQL).toContain("__identities_anonymous_id as");
      expect(result.idJoinSQL).toContain("SELECT");
    });

    it("generates multiple join CTEs when needed", () => {
      const result = buildIdentitiesCTE(dialect, testDatasourceSettings, {
        objects: [
          ["user_id"],       // Base type
          ["anonymous_id"],  // Needs join
          ["device_id"],     // Needs join
        ],
        from: baseDate,
        to: endDate,
      });

      expect(result.baseIdType).toBe("user_id");
      expect(Object.keys(result.idJoinMap).length).toBe(2);
      expect(result.idJoinMap).toHaveProperty("anonymous_id");
      expect(result.idJoinMap).toHaveProperty("device_id");
      expect(result.idJoinSQL).toContain("__identities_anonymous_id");
      expect(result.idJoinSQL).toContain("__identities_device_id");
    });

    it("does not create duplicate joins for same ID type", () => {
      // Force user_id as base so that anonymous_id objects need joins
      const result = buildIdentitiesCTE(dialect, testDatasourceSettings, {
        objects: [
          ["user_id"],
          ["anonymous_id"],  // First object needing anonymous_id
          ["anonymous_id"],  // Second object needing anonymous_id
        ],
        from: baseDate,
        to: endDate,
        forcedBaseIdType: "user_id",
      });

      // Should only have one join entry for anonymous_id
      expect(Object.keys(result.idJoinMap).length).toBe(1);
      expect(result.idJoinMap).toHaveProperty("anonymous_id");
      // Count occurrences of the join CTE name
      const matches = result.idJoinSQL.match(/__identities_anonymous_id as/g);
      expect(matches?.length).toBe(1);
    });

    it("skips objects that support the base ID type", () => {
      const result = buildIdentitiesCTE(dialect, testDatasourceSettings, {
        objects: [
          ["user_id", "anonymous_id"], // Supports both
          ["user_id"],                 // Supports base
          ["anonymous_id"],            // Only supports anonymous_id
        ],
        from: baseDate,
        to: endDate,
      });

      // With user_id as base, only the third object needs a join
      expect(result.baseIdType).toBe("user_id");
      expect(Object.keys(result.idJoinMap).length).toBe(1);
    });
  });

  describe("ID type sanitization", () => {
    it("sanitizes ID types with special characters", () => {
      // Create mock dialect that accepts any ID types
      const mockDialect: IdentitiesCTEDialect = {
        getIdentitiesQuery: (_settings, id1, id2, _from, _to, _experimentId) => {
          return `SELECT ${id1}, ${id2} FROM mock_table`;
        },
      };

      const result = buildIdentitiesCTE(mockDialect, testDatasourceSettings, {
        objects: [
          ["user_id"],
          ["special-id.type"], // Contains dash and dot
        ],
        from: baseDate,
        to: endDate,
      });

      // The table name should be sanitized
      expect(result.idJoinMap["special-id.type"]).toBe("__identities_specialidtype");
    });
  });

  describe("date range handling", () => {
    it("passes date range to dialect", () => {
      let capturedFrom: Date | undefined;
      let capturedTo: Date | undefined;

      const mockDialect: IdentitiesCTEDialect = {
        getIdentitiesQuery: (_settings, _id1, _id2, from, to, _experimentId) => {
          capturedFrom = from;
          capturedTo = to;
          return "SELECT user_id, anonymous_id FROM mock_table";
        },
      };

      buildIdentitiesCTE(mockDialect, testDatasourceSettings, {
        objects: [["user_id"], ["anonymous_id"]],
        from: baseDate,
        to: endDate,
      });

      expect(capturedFrom).toEqual(baseDate);
      expect(capturedTo).toEqual(endDate);
    });

    it("handles undefined end date", () => {
      let capturedTo: Date | undefined = new Date();

      const mockDialect: IdentitiesCTEDialect = {
        getIdentitiesQuery: (_settings, _id1, _id2, _from, to, _experimentId) => {
          capturedTo = to;
          return "SELECT user_id, anonymous_id FROM mock_table";
        },
      };

      buildIdentitiesCTE(mockDialect, testDatasourceSettings, {
        objects: [["user_id"], ["anonymous_id"]],
        from: baseDate,
        // No 'to' date
      });

      expect(capturedTo).toBeUndefined();
    });
  });

  describe("experiment ID handling", () => {
    it("passes experiment ID to dialect", () => {
      let capturedExperimentId: string | undefined;

      const mockDialect: IdentitiesCTEDialect = {
        getIdentitiesQuery: (_settings, _id1, _id2, _from, _to, experimentId) => {
          capturedExperimentId = experimentId;
          return "SELECT user_id, anonymous_id FROM mock_table";
        },
      };

      buildIdentitiesCTE(mockDialect, testDatasourceSettings, {
        objects: [["user_id"], ["anonymous_id"]],
        from: baseDate,
        to: endDate,
        experimentId: "exp-123",
      });

      expect(capturedExperimentId).toBe("exp-123");
    });
  });
});

// ============================================================
// PARITY TESTS: Verify extracted code matches original
// ============================================================

describe("Parity Tests: buildIdentitiesCTE vs Original getIdentitiesCTE", () => {
  const dialect = createBigQueryDialectAdapter();

  // Helper to normalize SQL for comparison (remove extra whitespace)
  function normalizeSQL(sql: string): string {
    return sql.replace(/\s+/g, " ").trim();
  }

  const parityTestCases = [
    {
      name: "single ID type - no joins needed",
      params: {
        objects: [["user_id"], ["user_id"]],
        from: baseDate,
        to: endDate,
      },
    },
    {
      name: "two ID types - one join needed",
      params: {
        objects: [["user_id"], ["anonymous_id"]],
        from: baseDate,
        to: endDate,
      },
    },
    {
      name: "forced base ID type",
      params: {
        objects: [["user_id"], ["anonymous_id"]],
        from: baseDate,
        to: endDate,
        forcedBaseIdType: "user_id",
      },
    },
    {
      name: "with experiment ID",
      params: {
        objects: [["user_id"], ["anonymous_id"]],
        from: baseDate,
        to: endDate,
        experimentId: "test-experiment",
      },
    },
    {
      name: "empty objects array",
      params: {
        objects: [],
        from: baseDate,
        to: endDate,
      },
    },
    {
      name: "objects with multiple ID type support",
      params: {
        objects: [
          ["user_id", "anonymous_id"],
          ["user_id"],
          ["anonymous_id"],
        ],
        from: baseDate,
        to: endDate,
      },
    },
    {
      name: "without end date",
      params: {
        objects: [["user_id"], ["anonymous_id"]],
        from: baseDate,
      },
    },
  ];

  parityTestCases.forEach(({ name, params }) => {
    it(`matches original for: ${name}`, () => {
      // Get result from original implementation
      const originalResult = originalGetIdentitiesCTE(params);

      // Get result from extracted implementation
      const extractedResult = buildIdentitiesCTE(
        dialect,
        testDatasourceSettings,
        params
      );

      // Compare results
      expect(extractedResult.baseIdType).toBe(originalResult.baseIdType);
      expect(extractedResult.idJoinMap).toEqual(originalResult.idJoinMap);
      expect(normalizeSQL(extractedResult.idJoinSQL)).toBe(
        normalizeSQL(originalResult.idJoinSQL)
      );
    });
  });
});

// ============================================================
// Edge Case Tests
// ============================================================

describe("Edge Cases", () => {
  const dialect = createBigQueryDialectAdapter();

  it("handles deeply nested objects array", () => {
    const result = buildIdentitiesCTE(dialect, testDatasourceSettings, {
      objects: [
        ["user_id"],
        [],  // Empty inner array
        ["user_id"],
      ],
      from: baseDate,
      to: endDate,
    });

    expect(result.baseIdType).toBe("user_id");
    expect(result.idJoinSQL).toBe("");
  });

  it("handles objects with empty strings", () => {
    const result = buildIdentitiesCTE(dialect, testDatasourceSettings, {
      objects: [
        ["user_id", ""],  // Contains empty string
        ["user_id"],
      ],
      from: baseDate,
      to: endDate,
    });

    expect(result.baseIdType).toBe("user_id");
    expect(result.idJoinSQL).toBe("");
  });

  it("throws when identity join query is not configured", () => {
    const emptySettings: DataSourceSettings = {
      queries: {},
    };

    const mockDialect: IdentitiesCTEDialect = {
      getIdentitiesQuery: () => {
        throw new Error("No identity join configured");
      },
    };

    expect(() => {
      buildIdentitiesCTE(mockDialect, emptySettings, {
        objects: [["user_id"], ["anonymous_id"]],
        from: baseDate,
        to: endDate,
      });
    }).toThrow();
  });
});
