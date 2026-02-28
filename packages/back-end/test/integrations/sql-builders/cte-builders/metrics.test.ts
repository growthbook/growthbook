/**
 * Metric CTE Builder Tests
 *
 * These tests verify:
 * 1. The extracted buildMetricCTE function works correctly
 * 2. The extracted buildFactMetricCTE function works correctly
 * 3. The extracted functions produce IDENTICAL results to the original
 *    SqlIntegration private methods (parity tests)
 *
 * The metric CTE builders are responsible for:
 * - Generating SQL CTEs for metric calculations
 * - Handling SQL-based, builder-based, and fact-based metrics
 * - Applying identity joins when needed
 * - Date filtering and template variable substitution
 */

import BigQuery from "../../../../src/integrations/BigQuery";
import { ExperimentMetricInterface } from "shared/experiments";
import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { PhaseSQLVar } from "shared/types/sql";
import { FactTableMap } from "../../../../src/models/FactTableModel";
import {
  buildMetricCTE,
  buildFactMetricCTE,
  MetricCTEDialect,
  MetricCTEParams,
  FactMetricCTEParams,
} from "../../../../src/integrations/sql-builders/cte-builders/metrics";

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

// Get references to ORIGINAL private methods (for parity testing)
const originalGetMetricCTE = getPrivateMethod<
  (params: {
    metric: ExperimentMetricInterface;
    baseIdType: string;
    idJoinMap: Record<string, string>;
    startDate: Date;
    endDate: Date | null;
    experimentId?: string;
    factTableMap: FactTableMap;
    useDenominator?: boolean;
    phase?: PhaseSQLVar;
    customFields?: Record<string, unknown>;
  }) => string
>("getMetricCTE");

const originalGetFactMetricCTE = getPrivateMethod<
  (params: {
    metricsWithIndices: { metric: FactMetricInterface; index: number }[];
    factTable: FactTableInterface;
    baseIdType: string;
    idJoinMap: Record<string, string>;
    startDate: Date;
    endDate: Date | null;
    experimentId?: string;
    addFiltersToWhere?: boolean;
    phase?: PhaseSQLVar;
    customFields?: Record<string, unknown>;
    exclusiveStartDateFilter?: boolean;
    exclusiveEndDateFilter?: boolean;
    castIdToString?: boolean;
  }) => string
>("getFactMetricCTE");

// Create a dialect adapter that wraps the BigQuery instance
function createBigQueryDialectAdapter(): MetricCTEDialect {
  return {
    castUserDateCol: getPrivateMethod<(column: string) => string>("castUserDateCol"),
    toTimestamp: getPrivateMethod<(date: Date) => string>("toTimestamp"),
    toTimestampWithMs: getPrivateMethod<(date: Date) => string>("toTimestampWithMs"),
    getSchema: getPrivateMethod<() => string>("getSchema"),
    escapeStringLiteral: getPrivateMethod<(value: string) => string>("escapeStringLiteral"),
    extractJSONField: getPrivateMethod<(jsonCol: string, path: string, isNumeric: boolean) => string>("extractJSONField"),
    evalBoolean: getPrivateMethod<(value: boolean) => string>("evalBoolean"),
    getMetricQueryFormat: getPrivateMethod<(metric: ExperimentMetricInterface) => "sql" | "builder">("getMetricQueryFormat"),
    getMetricColumns: getPrivateMethod<(
      metric: ExperimentMetricInterface,
      factTableMap: FactTableMap,
      alias: string,
      useDenominator?: boolean
    ) => { userIds: Record<string, string>; timestamp: string; value: string }>("getMetricColumns"),
    getFactMetricColumn: getPrivateMethod<(
      metric: FactMetricInterface,
      columnRef: FactMetricInterface["numerator"],
      factTable: FactTableInterface,
      alias: string
    ) => { value: string }>("getFactMetricColumn"),
  };
}

// ============================================================
// Test Fixtures
// ============================================================

const startDate = new Date("2023-01-01T00:00:00Z");
const endDate = new Date("2023-01-31T00:00:00Z");

function createLegacyMetric(
  overrides: Partial<ExperimentMetricInterface> = {}
): ExperimentMetricInterface {
  return {
    id: "met-1",
    name: "Test Metric",
    type: "binomial",
    sql: "SELECT user_id, timestamp FROM events WHERE converted = true",
    userIdTypes: ["user_id"],
    windowSettings: {
      type: "conversion",
      windowUnit: "hours",
      windowValue: 72,
      delayUnit: "hours",
      delayValue: 0,
    },
    ...overrides,
  } as ExperimentMetricInterface;
}

function createFactMetric(
  overrides: Partial<FactMetricInterface> = {}
): FactMetricInterface {
  return {
    id: "fmet-1",
    name: "Fact Metric",
    metricType: "proportion",
    numerator: {
      factTableId: "ft-1",
      column: "$$count",
      filters: [],
    },
    windowSettings: {
      type: "conversion",
      windowUnit: "hours",
      windowValue: 72,
      delayUnit: "hours",
      delayValue: 0,
    },
    ...overrides,
  } as FactMetricInterface;
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
    sql: "SELECT user_id, timestamp, value FROM events",
    dateCreated: new Date("2023-01-01"),
    dateUpdated: new Date("2023-01-01"),
    columns: [
      { name: "value", column: "value", datatype: "number", numberFormat: "", deleted: false },
    ],
    filters: [],
    ...overrides,
  } as FactTableInterface;
}

// ============================================================
// Unit Tests for buildMetricCTE
// ============================================================

describe("buildMetricCTE", () => {
  const dialect = createBigQueryDialectAdapter();

  describe("SQL-based metrics", () => {
    it("generates metric CTE for SQL metric", () => {
      const metric = createLegacyMetric();
      const factTableMap: FactTableMap = new Map();

      const result = buildMetricCTE(dialect, {
        metric,
        baseIdType: "user_id",
        idJoinMap: {},
        startDate,
        endDate,
        factTableMap,
      });

      expect(result).toContain("-- Metric (Test Metric)");
      expect(result).toContain("user_id");
      expect(result).toContain("timestamp");
    });

    it("adds date filters", () => {
      const metric = createLegacyMetric();
      const factTableMap: FactTableMap = new Map();

      const result = buildMetricCTE(dialect, {
        metric,
        baseIdType: "user_id",
        idJoinMap: {},
        startDate,
        endDate,
        factTableMap,
      });

      expect(result).toContain(">=");
      expect(result).toContain("<=");
    });

    it("handles null end date", () => {
      const metric = createLegacyMetric();
      const factTableMap: FactTableMap = new Map();

      const result = buildMetricCTE(dialect, {
        metric,
        baseIdType: "user_id",
        idJoinMap: {},
        startDate,
        endDate: null,
        factTableMap,
      });

      expect(result).toContain(">=");
      expect(result).not.toContain("<=");
    });

    it("adds identity join when metric uses different ID type", () => {
      const metric = createLegacyMetric({
        userIdTypes: ["anonymous_id"],
      });
      const factTableMap: FactTableMap = new Map();
      const idJoinMap = { anonymous_id: "__identities_anonymous_id" };

      const result = buildMetricCTE(dialect, {
        metric,
        baseIdType: "user_id",
        idJoinMap,
        startDate,
        endDate,
        factTableMap,
      });

      expect(result).toContain("i.user_id");
      expect(result).toContain("JOIN __identities_anonymous_id");
    });
  });

  describe("Fact metrics", () => {
    it("generates metric CTE for fact metric", () => {
      const metric = createFactMetric();
      const factTable = createFactTable();
      const factTableMap: FactTableMap = new Map([["ft-1", factTable]]);

      const result = buildMetricCTE(dialect, {
        metric: metric as ExperimentMetricInterface,
        baseIdType: "user_id",
        idJoinMap: {},
        startDate,
        endDate,
        factTableMap,
      });

      expect(result).toContain("-- Metric (Fact Metric)");
    });

    it("throws when fact table not found", () => {
      const metric = createFactMetric();
      const factTableMap: FactTableMap = new Map();

      expect(() =>
        buildMetricCTE(dialect, {
          metric: metric as ExperimentMetricInterface,
          baseIdType: "user_id",
          idJoinMap: {},
          startDate,
          endDate,
          factTableMap,
        })
      ).toThrow("Could not find fact table");
    });
  });
});

// ============================================================
// Unit Tests for buildFactMetricCTE
// ============================================================

describe("buildFactMetricCTE", () => {
  const dialect = createBigQueryDialectAdapter();

  it("generates fact metric CTE", () => {
    const metric = createFactMetric();
    const factTable = createFactTable();

    const result = buildFactMetricCTE(dialect, {
      metricsWithIndices: [{ metric, index: 0 }],
      factTable,
      baseIdType: "user_id",
      idJoinMap: {},
      startDate,
      endDate,
    });

    expect(result).toContain("-- Fact Table (Events)");
    expect(result).toContain("user_id");
    expect(result).toContain("timestamp");
  });

  it("generates multiple metric columns", () => {
    const metric1 = createFactMetric({ id: "m1", name: "Metric 1" });
    const metric2 = createFactMetric({ id: "m2", name: "Metric 2" });
    const factTable = createFactTable();

    const result = buildFactMetricCTE(dialect, {
      metricsWithIndices: [
        { metric: metric1, index: 0 },
        { metric: metric2, index: 1 },
      ],
      factTable,
      baseIdType: "user_id",
      idJoinMap: {},
      startDate,
      endDate,
    });

    expect(result).toContain("m0_value");
    expect(result).toContain("m1_value");
  });

  it("adds identity join when fact table uses different ID type", () => {
    const metric = createFactMetric();
    const factTable = createFactTable({
      userIdTypes: ["anonymous_id"],
    });
    const idJoinMap = { anonymous_id: "__identities_anonymous_id" };

    const result = buildFactMetricCTE(dialect, {
      metricsWithIndices: [{ metric, index: 0 }],
      factTable,
      baseIdType: "user_id",
      idJoinMap,
      startDate,
      endDate,
    });

    expect(result).toContain("i.user_id");
    expect(result).toContain("JOIN __identities_anonymous_id");
  });

  it("handles exclusive date filters", () => {
    const metric = createFactMetric();
    const factTable = createFactTable();

    const result = buildFactMetricCTE(dialect, {
      metricsWithIndices: [{ metric, index: 0 }],
      factTable,
      baseIdType: "user_id",
      idJoinMap: {},
      startDate,
      endDate,
      exclusiveStartDateFilter: true,
      exclusiveEndDateFilter: true,
    });

    expect(result).toContain(">");
    expect(result).toContain("<");
  });

  it("casts ID to string when requested", () => {
    const metric = createFactMetric();
    const factTable = createFactTable();

    const result = buildFactMetricCTE(dialect, {
      metricsWithIndices: [{ metric, index: 0 }],
      factTable,
      baseIdType: "user_id",
      idJoinMap: {},
      startDate,
      endDate,
      castIdToString: true,
    });

    expect(result).toContain("CAST(");
    expect(result).toContain("AS STRING)");
  });
});

// ============================================================
// PARITY TESTS: Verify extracted code matches original
// ============================================================

describe("Parity Tests: buildMetricCTE vs Original getMetricCTE", () => {
  const dialect = createBigQueryDialectAdapter();

  // Helper to normalize SQL for comparison
  function normalizeSQL(sql: string): string {
    return sql.replace(/\s+/g, " ").trim();
  }

  const parityTestCases = [
    {
      name: "SQL metric - same ID type",
      params: {
        metric: createLegacyMetric(),
        baseIdType: "user_id",
        idJoinMap: {},
        startDate,
        endDate,
        factTableMap: new Map() as FactTableMap,
      },
    },
    {
      name: "SQL metric - null end date",
      params: {
        metric: createLegacyMetric(),
        baseIdType: "user_id",
        idJoinMap: {},
        startDate,
        endDate: null,
        factTableMap: new Map() as FactTableMap,
      },
    },
  ];

  parityTestCases.forEach(({ name, params }) => {
    it(`matches original for: ${name}`, () => {
      // Get result from original implementation
      const originalResult = originalGetMetricCTE(params);

      // Get result from extracted implementation
      const extractedResult = buildMetricCTE(dialect, params);

      // Compare normalized SQL
      expect(normalizeSQL(extractedResult)).toBe(normalizeSQL(originalResult));
    });
  });
});

describe("Parity Tests: buildFactMetricCTE vs Original getFactMetricCTE", () => {
  const dialect = createBigQueryDialectAdapter();

  function normalizeSQL(sql: string): string {
    return sql.replace(/\s+/g, " ").trim();
  }

  const parityTestCases = [
    {
      name: "basic fact metric",
      params: {
        metricsWithIndices: [{ metric: createFactMetric(), index: 0 }],
        factTable: createFactTable(),
        baseIdType: "user_id",
        idJoinMap: {},
        startDate,
        endDate,
      },
    },
    {
      name: "fact metric with exclusive filters",
      params: {
        metricsWithIndices: [{ metric: createFactMetric(), index: 0 }],
        factTable: createFactTable(),
        baseIdType: "user_id",
        idJoinMap: {},
        startDate,
        endDate,
        exclusiveStartDateFilter: true,
        exclusiveEndDateFilter: true,
      },
    },
    {
      name: "fact metric with identity join",
      params: {
        metricsWithIndices: [{ metric: createFactMetric(), index: 0 }],
        factTable: createFactTable({ userIdTypes: ["anonymous_id"] }),
        baseIdType: "user_id",
        idJoinMap: { anonymous_id: "__identities_anonymous_id" },
        startDate,
        endDate,
      },
    },
  ];

  parityTestCases.forEach(({ name, params }) => {
    it(`matches original for: ${name}`, () => {
      // Get result from original implementation
      const originalResult = originalGetFactMetricCTE(params);

      // Get result from extracted implementation
      const extractedResult = buildFactMetricCTE(dialect, params);

      // Compare normalized SQL
      expect(normalizeSQL(extractedResult)).toBe(normalizeSQL(originalResult));
    });
  });
});
