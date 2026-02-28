/**
 * Segment CTE Builder Tests
 *
 * These tests verify:
 * 1. The extracted buildSegmentCTE function works correctly
 * 2. The extracted function produces IDENTICAL results to the original
 *    SqlIntegration.getSegmentCTE private method (parity tests)
 *
 * The segment CTE builder is responsible for:
 * - Generating SQL CTEs for user segments
 * - Handling SQL-based and fact-table-based segments
 * - Applying identity joins when needed
 */

import BigQuery from "../../../../src/integrations/BigQuery";
import { SegmentInterface } from "shared/types/segment";
import { FactTableInterface } from "shared/types/fact-table";
import { SQLVars } from "shared/types/sql";
import { FactTableMap } from "../../../../src/models/FactTableModel";
import {
  buildSegmentCTE,
  buildFactSegmentCTE,
  SegmentCTEDialect,
  FactSegmentCTEDialect,
  SegmentCTEParams,
} from "../../../../src/integrations/sql-builders/cte-builders/segments";

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

// Get reference to ORIGINAL private methods (for parity testing)
const originalGetSegmentCTE = getPrivateMethod<
  (
    segment: SegmentInterface,
    baseIdType: string,
    idJoinMap: Record<string, string>,
    factTableMap: FactTableMap,
    sqlVars?: SQLVars
  ) => string
>("getSegmentCTE");

const originalGetFactSegmentCTE = getPrivateMethod<
  (params: {
    factTable: FactTableInterface;
    baseIdType: string;
    idJoinMap: Record<string, string>;
    filters?: string[];
    sqlVars?: SQLVars;
  }) => string
>("getFactSegmentCTE");

// Create a dialect adapter that wraps the BigQuery instance
function createBigQueryDialectAdapter(): FactSegmentCTEDialect {
  const castUserDateCol = getPrivateMethod<(column: string) => string>(
    "castUserDateCol"
  );

  return {
    castUserDateCol: (column) => castUserDateCol(column),
    getFactSegmentCTE: (params) => originalGetFactSegmentCTE(params),
  };
}

// ============================================================
// Test Fixtures
// ============================================================

function createSqlSegment(
  overrides: Partial<SegmentInterface> = {}
): SegmentInterface {
  return {
    id: "seg-1",
    name: "Test Segment",
    type: "SQL",
    sql: "SELECT user_id, date FROM users WHERE is_active = true",
    userIdType: "user_id",
    owner: "test-owner",
    datasource: "ds-1",
    dateCreated: new Date("2023-01-01"),
    dateUpdated: new Date("2023-01-01"),
    organization: "org-1",
    ...overrides,
  } as SegmentInterface;
}

function createFactSegment(
  overrides: Partial<SegmentInterface> = {}
): SegmentInterface {
  return {
    id: "seg-2",
    name: "Fact Segment",
    type: "FACT",
    factTableId: "ft-1",
    filters: [],
    userIdType: "user_id",
    owner: "test-owner",
    datasource: "ds-1",
    dateCreated: new Date("2023-01-01"),
    dateUpdated: new Date("2023-01-01"),
    organization: "org-1",
    ...overrides,
  } as SegmentInterface;
}

function createFactTable(
  overrides: Partial<FactTableInterface> = {}
): FactTableInterface {
  return {
    id: "ft-1",
    name: "Events",
    description: "Event fact table",
    organization: "org-1",
    datasource: "ds-1",
    userIdTypes: ["user_id"],
    sql: "SELECT user_id, timestamp FROM events",
    dateCreated: new Date("2023-01-01"),
    dateUpdated: new Date("2023-01-01"),
    columns: [],
    filters: [
      {
        id: "filter-1",
        name: "Active Users",
        value: "is_active = true",
        description: "",
      },
    ],
    ...overrides,
  } as FactTableInterface;
}

// ============================================================
// Unit Tests for buildSegmentCTE
// ============================================================

describe("buildSegmentCTE", () => {
  const dialect = createBigQueryDialectAdapter();

  describe("SQL-based segments", () => {
    it("generates simple segment CTE when no joins needed", () => {
      const segment = createSqlSegment();
      const result = buildSegmentCTE(dialect, {
        segment,
        baseIdType: "user_id",
        idJoinMap: {},
        factTableMap: new Map(),
      });

      expect(result).toContain("-- Segment (Test Segment)");
      expect(result).toContain("SELECT user_id, date FROM users");
    });

    it("throws error when SQL segment has no sql value", () => {
      const segment = createSqlSegment({ sql: "" });

      expect(() =>
        buildSegmentCTE(dialect, {
          segment,
          baseIdType: "user_id",
          idJoinMap: {},
          factTableMap: new Map(),
        })
      ).toThrow("is a SQL Segment but has no SQL value");
    });

    it("applies template variables when provided", () => {
      const segment = createSqlSegment({
        sql: "SELECT user_id, date FROM users WHERE date >= {{ startDate }}",
      });
      const sqlVars: SQLVars = {
        startDate: new Date("2023-01-01"),
        endDate: new Date("2023-01-31"),
      };

      const result = buildSegmentCTE(dialect, {
        segment,
        baseIdType: "user_id",
        idJoinMap: {},
        factTableMap: new Map(),
        sqlVars,
      });

      expect(result).toContain("-- Segment (Test Segment)");
      // The template should be compiled
      expect(result).not.toContain("{{ startDate }}");
    });

    it("adds identity join when segment uses different ID type", () => {
      const segment = createSqlSegment({ userIdType: "anonymous_id" });
      const idJoinMap = { anonymous_id: "__identities_anonymous_id" };

      const result = buildSegmentCTE(dialect, {
        segment,
        baseIdType: "user_id",
        idJoinMap,
        factTableMap: new Map(),
      });

      expect(result).toContain("i.user_id");
      expect(result).toContain("JOIN __identities_anonymous_id i");
      expect(result).toContain("i.anonymous_id = s.anonymous_id");
    });

    it("casts date column when dialect requires it", () => {
      const segment = createSqlSegment();

      const result = buildSegmentCTE(dialect, {
        segment,
        baseIdType: "user_id",
        idJoinMap: {},
        factTableMap: new Map(),
      });

      // BigQuery casts to DATETIME
      expect(result).toContain("CAST(s.date as DATETIME)");
    });

    it("defaults userIdType to user_id when not specified", () => {
      const segment = createSqlSegment({ userIdType: undefined });

      const result = buildSegmentCTE(dialect, {
        segment,
        baseIdType: "user_id",
        idJoinMap: {},
        factTableMap: new Map(),
      });

      // Should work without needing a join
      expect(result).not.toContain("JOIN");
    });
  });

  describe("Fact-based segments", () => {
    it("generates fact segment CTE", () => {
      const segment = createFactSegment();
      const factTable = createFactTable();
      const factTableMap: FactTableMap = new Map([["ft-1", factTable]]);

      const result = buildSegmentCTE(dialect, {
        segment,
        baseIdType: "user_id",
        idJoinMap: {},
        factTableMap,
      });

      expect(result).toContain("-- Segment (Fact Segment)");
      expect(result).toContain("SELECT * FROM");
    });

    it("throws error when fact segment has no factTableId", () => {
      const segment = createFactSegment({ factTableId: undefined });

      expect(() =>
        buildSegmentCTE(dialect, {
          segment,
          baseIdType: "user_id",
          idJoinMap: {},
          factTableMap: new Map(),
        })
      ).toThrow("is a FACT Segment, but has no factTableId set");
    });

    it("throws error when fact table not found", () => {
      const segment = createFactSegment({ factTableId: "unknown-ft" });

      expect(() =>
        buildSegmentCTE(dialect, {
          segment,
          baseIdType: "user_id",
          idJoinMap: {},
          factTableMap: new Map(),
        })
      ).toThrow("Unknown fact table: unknown-ft");
    });
  });
});

// ============================================================
// Unit Tests for buildFactSegmentCTE
// ============================================================

describe("buildFactSegmentCTE", () => {
  // Create simple dialect for testing
  const simpleDialect: SegmentCTEDialect = {
    castUserDateCol: (column) => `CAST(${column} as DATETIME)`,
  };

  it("generates basic fact segment CTE", () => {
    const factTable = createFactTable();

    const result = buildFactSegmentCTE(simpleDialect, {
      factTable,
      baseIdType: "user_id",
      idJoinMap: {},
    });

    expect(result).toContain("-- Fact Table (Events)");
    expect(result).toContain("user_id as user_id");
    expect(result).toContain("CAST(m.timestamp as DATETIME) as date");
    expect(result).toContain("FROM(");
  });

  it("applies filters from fact table", () => {
    const factTable = createFactTable({
      filters: [
        { id: "filter-1", name: "Active", value: "is_active = true", description: "" },
        { id: "filter-2", name: "Paid", value: "is_paid = true", description: "" },
      ],
    });

    const result = buildFactSegmentCTE(simpleDialect, {
      factTable,
      baseIdType: "user_id",
      idJoinMap: {},
      filters: ["filter-1", "filter-2"],
    });

    expect(result).toContain("WHERE is_active = true AND is_paid = true");
  });

  it("ignores non-matching filters", () => {
    const factTable = createFactTable({
      filters: [
        { id: "filter-1", name: "Active", value: "is_active = true", description: "" },
      ],
    });

    const result = buildFactSegmentCTE(simpleDialect, {
      factTable,
      baseIdType: "user_id",
      idJoinMap: {},
      filters: ["filter-1", "non-existent-filter"],
    });

    expect(result).toContain("WHERE is_active = true");
    expect(result).not.toContain("non-existent");
  });

  it("adds identity join when fact table uses different ID type", () => {
    const factTable = createFactTable({
      userIdTypes: ["anonymous_id"],
    });
    const idJoinMap = { anonymous_id: "__identities_anonymous_id" };

    const result = buildFactSegmentCTE(simpleDialect, {
      factTable,
      baseIdType: "user_id",
      idJoinMap,
    });

    expect(result).toContain("i.user_id as user_id");
    expect(result).toContain("JOIN __identities_anonymous_id i");
    expect(result).toContain("i.anonymous_id = m.anonymous_id");
  });

  it("applies template variables when provided", () => {
    const factTable = createFactTable({
      sql: "SELECT user_id, timestamp FROM events WHERE date >= {{ startDate }}",
    });
    const sqlVars: SQLVars = {
      startDate: new Date("2023-01-01"),
      endDate: new Date("2023-01-31"),
    };

    const result = buildFactSegmentCTE(simpleDialect, {
      factTable,
      baseIdType: "user_id",
      idJoinMap: {},
      sqlVars,
    });

    expect(result).not.toContain("{{ startDate }}");
  });
});

// ============================================================
// PARITY TESTS: Verify extracted code matches original
// ============================================================

describe("Parity Tests: buildSegmentCTE vs Original getSegmentCTE", () => {
  const dialect = createBigQueryDialectAdapter();

  // Helper to normalize SQL for comparison (remove extra whitespace)
  function normalizeSQL(sql: string): string {
    return sql.replace(/\s+/g, " ").trim();
  }

  describe("SQL segments", () => {
    const parityTestCases = [
      {
        name: "simple SQL segment - same ID type",
        segment: createSqlSegment(),
        baseIdType: "user_id",
        idJoinMap: {},
      },
      {
        name: "SQL segment with identity join",
        segment: createSqlSegment({ userIdType: "anonymous_id" }),
        baseIdType: "user_id",
        idJoinMap: { anonymous_id: "__identities_anonymous_id" },
      },
      {
        name: "SQL segment with default userIdType",
        segment: createSqlSegment({ userIdType: undefined }),
        baseIdType: "user_id",
        idJoinMap: {},
      },
    ];

    parityTestCases.forEach(({ name, segment, baseIdType, idJoinMap }) => {
      it(`matches original for: ${name}`, () => {
        const factTableMap: FactTableMap = new Map();

        // Get result from original implementation
        const originalResult = originalGetSegmentCTE(
          segment,
          baseIdType,
          idJoinMap,
          factTableMap,
          undefined
        );

        // Get result from extracted implementation
        const extractedResult = buildSegmentCTE(dialect, {
          segment,
          baseIdType,
          idJoinMap,
          factTableMap,
        });

        // Compare normalized SQL
        expect(normalizeSQL(extractedResult)).toBe(
          normalizeSQL(originalResult)
        );
      });
    });
  });

  describe("Fact segments", () => {
    it("matches original for fact segment", () => {
      const segment = createFactSegment();
      const factTable = createFactTable();
      const factTableMap: FactTableMap = new Map([["ft-1", factTable]]);

      // Get result from original implementation
      const originalResult = originalGetSegmentCTE(
        segment,
        "user_id",
        {},
        factTableMap,
        undefined
      );

      // Get result from extracted implementation
      const extractedResult = buildSegmentCTE(dialect, {
        segment,
        baseIdType: "user_id",
        idJoinMap: {},
        factTableMap,
      });

      // Compare normalized SQL
      expect(normalizeSQL(extractedResult)).toBe(normalizeSQL(originalResult));
    });
  });
});

describe("Parity Tests: buildFactSegmentCTE vs Original getFactSegmentCTE", () => {
  const dialect = createBigQueryDialectAdapter();

  function normalizeSQL(sql: string): string {
    return sql.replace(/\s+/g, " ").trim();
  }

  const parityTestCases = [
    {
      name: "basic fact table",
      factTable: createFactTable(),
      baseIdType: "user_id",
      idJoinMap: {},
      filters: undefined,
    },
    {
      name: "fact table with filters",
      factTable: createFactTable({
        filters: [
          { id: "f1", name: "Test", value: "active = true", description: "" },
        ],
      }),
      baseIdType: "user_id",
      idJoinMap: {},
      filters: ["f1"],
    },
    {
      name: "fact table with identity join",
      factTable: createFactTable({ userIdTypes: ["anonymous_id"] }),
      baseIdType: "user_id",
      idJoinMap: { anonymous_id: "__identities_anonymous_id" },
      filters: undefined,
    },
  ];

  parityTestCases.forEach(({ name, factTable, baseIdType, idJoinMap, filters }) => {
    it(`matches original for: ${name}`, () => {
      // Get result from original implementation
      const originalResult = originalGetFactSegmentCTE({
        factTable,
        baseIdType,
        idJoinMap,
        filters,
      });

      // Get result from extracted implementation
      const extractedResult = buildFactSegmentCTE(dialect, {
        factTable,
        baseIdType,
        idJoinMap,
        filters,
      });

      // Compare normalized SQL
      expect(normalizeSQL(extractedResult)).toBe(normalizeSQL(originalResult));
    });
  });
});
