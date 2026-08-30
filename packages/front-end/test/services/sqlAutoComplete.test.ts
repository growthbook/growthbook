import { vi } from "vitest";
import {
  InformationSchemaInterfaceWithPaths,
  InformationSchemaTablesInterface,
} from "shared/types/integrations";
import {
  getCurrentContext,
  getSelectedTables,
  getAutoCompletions,
} from "@/services/sqlAutoComplete";
import { CursorData } from "@/components/Segments/SegmentForm";
import { getTemplateCompletions } from "@/services/sqlKeywords";

const mockSqlKeywords = [
  { value: "SELECT", meta: "CORE_KEYWORD", score: 500, caption: "SELECT" },
  { value: "FROM", meta: "CORE_KEYWORD", score: 500, caption: "FROM" },
  { value: "WHERE", meta: "CORE_KEYWORD", score: 500, caption: "WHERE" },
  { value: "GROUP BY", meta: "CORE_KEYWORD", score: 500, caption: "GROUP BY" },
  { value: "ORDER BY", meta: "CORE_KEYWORD", score: 500, caption: "ORDER BY" },
];

// Mock the sqlKeywords module to return a predictable small set of keywords
vi.mock("@/services/sqlKeywords", () => ({
  getSqlKeywords: vi.fn(() => mockSqlKeywords),
  getTemplateCompletions: vi.fn((source: "EditSqlModal" | "SqlExplorer") => {
    if (source === "EditSqlModal") {
      return [
        {
          value: `'{{ startDate }}'`,
          meta: "TEMPLATE_VARIABLE",
          score: 800,
          caption: `{{ startDate }}`,
        },
        {
          value: `'{{ startDateISO }}'`,
          meta: "TEMPLATE_VARIABLE",
          score: 800,
          caption: `{{ startDateISO }}`,
        },
        {
          value: `'{{ endDate }}'`,
          meta: "TEMPLATE_VARIABLE",
          score: 800,
          caption: `{{ endDate }}`,
        },
        {
          value: `'{{ endDateISO }}'`,
          meta: "TEMPLATE_VARIABLE",
          score: 800,
          caption: `{{ endDateISO }}`,
        },
      ];
    }
    return [];
  }),
  COMPLETION_SCORES: {
    CORE_KEYWORD: 500,
    COLUMN: 900,
    TABLE: 900,
    SCHEMA: 950,
    DATABASE: 1000,
    TEMPLATE_VARIABLE: 800,
  },
  COMPLETION_TYPES: {
    CORE_KEYWORD: "CORE_KEYWORD",
    COLUMN: "COLUMN",
    TABLE: "TABLE",
    SCHEMA: "SCHEMA",
    DATABASE: "DATABASE",
    TEMPLATE_VARIABLE: "TEMPLATE_VARIABLE",
  },
}));

/** This test suite tests the sqlAutoComplete logic - throughout the file you'll see different sql formats, especially with backticks
 * e.g. you'll see `analytics.public.table-users-123` and `analytics`.`public`.`table-events-456, and even analytics.public.table-users-123
 * Some of our data sources support backtics (e.g. BigQuery) and some support backticks around each part of the path (e.g. Postgres)
 * So the test suite uses all of these formats to ensure that the sqlAutoComplete logic is correct for all cases
 */

// Type for API call function parameters
type ApiCallParams = [string, RequestInit?];

// Type for API call return value
type ApiCallReturn = Promise<{ table: InformationSchemaTablesInterface }>;

// Type for the API call function
type ApiCallFunction = (url: string, options?: RequestInit) => ApiCallReturn;

// Mock data for testing
const mockInformationSchemaWithPaths: InformationSchemaInterfaceWithPaths = {
  id: "schema-123",
  datasourceId: "datasource-456",
  organization: "test-org",
  status: "COMPLETE",
  refreshMS: 1000,
  dateCreated: new Date("2023-01-01"),
  dateUpdated: new Date("2023-01-01"),
  databases: [
    {
      databaseName: "analytics",
      path: "`analytics`",
      dateCreated: new Date("2023-01-01"),
      dateUpdated: new Date("2023-01-01"),
      schemas: [
        {
          schemaName: "public",
          path: "`analytics`.`public`",
          dateCreated: new Date("2023-01-01"),
          dateUpdated: new Date("2023-01-01"),
          tables: [
            {
              tableName: "table-users-123",
              path: "`analytics`.`public`.`table-users-123`",
              id: "table-users-123",
              numOfColumns: 3,
              dateCreated: new Date("2023-01-01"),
              dateUpdated: new Date("2023-01-01"),
            },
            {
              tableName: "table-events-456",
              path: "`analytics`.`public`.`table-events-456`",
              id: "table-events-456",
              numOfColumns: 4,
              dateCreated: new Date("2023-01-01"),
              dateUpdated: new Date("2023-01-01"),
            },
          ],
        },
        {
          schemaName: "staging",
          path: "`analytics`.`staging`",
          dateCreated: new Date("2023-01-01"),
          dateUpdated: new Date("2023-01-01"),
          tables: [
            {
              tableName: "table-temp-789",
              path: "`analytics`.`staging`.`table-temp-789`",
              id: "table-temp-789",
              numOfColumns: 2,
              dateCreated: new Date("2023-01-01"),
              dateUpdated: new Date("2023-01-01"),
            },
          ],
        },
      ],
    },
    {
      databaseName: "warehouse",
      path: "`warehouse`",
      dateCreated: new Date("2023-01-01"),
      dateUpdated: new Date("2023-01-01"),
      schemas: [
        {
          schemaName: "prod",
          path: "`warehouse`.`prod`",
          dateCreated: new Date("2023-01-01"),
          dateUpdated: new Date("2023-01-01"),
          tables: [
            {
              tableName: "table-orders-999",
              path: "`warehouse`.`prod`.`table-orders-999`",
              id: "table-orders-999",
              numOfColumns: 5,
              dateCreated: new Date("2023-01-01"),
              dateUpdated: new Date("2023-01-01"),
            },
          ],
        },
      ],
    },
  ],
};

const mockTableColumns = [
  { columnName: "id", dataType: "INTEGER" },
  { columnName: "email", dataType: "VARCHAR" },
  { columnName: "created_at", dataType: "TIMESTAMP" },
];

const mockColumnSuggestions = mockTableColumns.map((column) => ({
  value: column.columnName,
  meta: column.dataType,
  score: 900,
  caption: column.columnName,
}));

const mockTableData: InformationSchemaTablesInterface = {
  id: "table-users-123",
  datasourceId: "datasource-456",
  organization: "test-org",
  tableName: "table-users-123",
  tableSchema: "public",
  databaseName: "analytics",
  refreshMS: 1000,
  dateCreated: new Date("2023-01-01"),
  dateUpdated: new Date("2023-01-01"),
  informationSchemaId: "schema-123",
  columns: mockTableColumns,
};

// Simple mock function implementation
let mockCalls: ApiCallParams[] = [];
const createMockFunction = (returnValue: ApiCallReturn): ApiCallFunction => {
  const mockFn: ApiCallFunction = (url: string, options?: RequestInit) => {
    mockCalls.push([url, options]);
    return returnValue;
  };
  return mockFn;
};

// Mock API call function
const mockApiCall = createMockFunction(
  Promise.resolve({ table: mockTableData }),
);

// Helper to reset mocks
const resetMocks = (): void => {
  mockCalls = [];
};

describe("getCurrentContext", () => {
  it("should detect SELECT context", () => {
    const cursorData: CursorData = { input: ["SELECT "], row: 0, column: 7 };
    const result = getCurrentContext(cursorData);
    expect(result).toEqual({
      type: "SELECT",
      suggestions: [],
    });
  });

  it("should detect FROM context", () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM "],
      row: 0,
      column: 14,
    };
    const result = getCurrentContext(cursorData);
    expect(result).toEqual({
      type: "FROM",
      suggestions: [],
    });
  });

  it("should detect WHERE context", () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM users WHERE "],
      row: 0,
      column: 27,
    };
    const result = getCurrentContext(cursorData);
    expect(result).toEqual({
      type: "WHERE",
      suggestions: [],
    });
  });

  it("should detect GROUP BY context", () => {
    const cursorData: CursorData = {
      input: ["SELECT count(*) FROM users GROUP BY "],
      row: 0,
      column: 37,
    };
    const result = getCurrentContext(cursorData);
    expect(result).toEqual({
      type: "GROUP BY",
      suggestions: [],
    });
  });

  it("should detect ORDER BY context", () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM users ORDER BY "],
      row: 0,
      column: 31,
    };
    const result = getCurrentContext(cursorData);
    expect(result).toEqual({
      type: "ORDER BY",
      suggestions: [],
    });
  });

  it("should handle continuation contexts with commas in SELECT", () => {
    const cursorData: CursorData = {
      input: ["SELECT id, "],
      row: 0,
      column: 11,
    };
    const result = getCurrentContext(cursorData);
    expect(result).toEqual({
      type: "SELECT",
      suggestions: [],
    });
  });

  it("should handle continuation contexts with commas in FROM", () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM users, "],
      row: 0,
      column: 21,
    };
    const result = getCurrentContext(cursorData);
    expect(result).toEqual({
      type: "FROM",
      suggestions: [],
    });
  });

  it("should handle continuation contexts with AND in WHERE", () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM users WHERE id = 1 AND "],
      row: 0,
      column: 37,
    };
    const result = getCurrentContext(cursorData);
    expect(result).toEqual({
      type: "WHERE",
      suggestions: [],
    });
  });

  it("should handle continuation contexts with OR in WHERE", () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM users WHERE id = 1 OR "],
      row: 0,
      column: 36,
    };
    const result = getCurrentContext(cursorData);
    expect(result).toEqual({
      type: "WHERE",
      suggestions: [],
    });
  });

  it("should return null for no context", () => {
    const cursorData: CursorData = { input: [""], row: 0, column: 0 };
    const result = getCurrentContext(cursorData);
    expect(result).toBeNull();
  });

  it("should handle multiline queries", () => {
    const cursorData: CursorData = {
      input: ["SELECT *", "FROM users", "WHERE "],
      row: 2,
      column: 6,
    };
    const result = getCurrentContext(cursorData);
    expect(result).toEqual({
      type: "WHERE",
      suggestions: [],
    });
  });

  it("should get the most recent keyword context", () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM users WHERE id IN (SELECT "],
      row: 0,
      column: 41,
    };
    const result = getCurrentContext(cursorData);
    expect(result).toEqual({
      type: "SELECT",
      suggestions: [],
    });
  });
});

describe("getSelectedTables", () => {
  it("should extract tables from simple FROM clause", () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM `analytics.public.table-users-123`"],
      row: 0,
      column: 42,
    };
    const result = getSelectedTables(
      cursorData,
      mockInformationSchemaWithPaths,
    );
    expect(result).toEqual(["table-users-123"]);
  });

  it("should extract tables from FROM clause with multiple tables", () => {
    const cursorData: CursorData = {
      input: [
        "SELECT * FROM `analytics.public.table-users-123`, `analytics.public.table-events-456`",
      ],
      row: 0,
      column: 74,
    };
    const result = getSelectedTables(
      cursorData,
      mockInformationSchemaWithPaths,
    );
    expect(result).toEqual(["table-users-123", "table-events-456"]);
  });

  it("should handle backticked table names", () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM `analytics`.`public`.`table-users-123`"],
      row: 0,
      column: 42,
    };
    const result = getSelectedTables(
      cursorData,
      mockInformationSchemaWithPaths,
    );
    expect(result).toEqual(["table-users-123"]);
  });

  it("should handle table names without backticks", () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM analytics.public.table-users-123"],
      row: 0,
      column: 36,
    };
    const result = getSelectedTables(
      cursorData,
      mockInformationSchemaWithPaths,
    );
    expect(result).toEqual(["table-users-123"]);
  });

  it("should handle complex queries with WHERE clause", () => {
    const cursorData: CursorData = {
      input: [
        "SELECT * FROM `analytics`.`public`.`table-users-123` WHERE id = 1",
      ],
      row: 0,
      column: 54,
    };
    const result = getSelectedTables(
      cursorData,
      mockInformationSchemaWithPaths,
    );
    expect(result).toEqual(["table-users-123"]);
  });

  it("should handle queries with GROUP BY and ORDER BY", () => {
    const cursorData: CursorData = {
      input: [
        "SELECT count(*) FROM `analytics`.`public`.`table-users-123` GROUP BY email ORDER BY count(*)",
      ],
      row: 0,
      column: 84,
    };
    const result = getSelectedTables(
      cursorData,
      mockInformationSchemaWithPaths,
    );
    expect(result).toEqual(["table-users-123"]);
  });

  it("should return empty array for no tables found", () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM unknown_table"],
      row: 0,
      column: 28,
    };
    const result = getSelectedTables(
      cursorData,
      mockInformationSchemaWithPaths,
    );
    expect(result).toEqual([]);
  });

  it("should return empty array for empty input", () => {
    const cursorData: CursorData = { input: [""], row: 0, column: 0 };
    const result = getSelectedTables(
      cursorData,
      mockInformationSchemaWithPaths,
    );
    expect(result).toEqual([]);
  });

  it("should handle queries without FROM clause", () => {
    const cursorData: CursorData = {
      input: ["SELECT 1 + 1"],
      row: 0,
      column: 13,
    };
    const result = getSelectedTables(
      cursorData,
      mockInformationSchemaWithPaths,
    );
    expect(result).toEqual([]);
  });

  it("should handle mixed backtick scenarios (production-like)", () => {
    // Test with production-like data where paths have backticks
    // but user-entered SQL doesn't have backticks

    // Test 1: SQL without backticks should still find table by name
    const cursorData1: CursorData = {
      input: ["SELECT * FROM analytics.public.table-users-123"],
      row: 0,
      column: 36,
    };
    const result1 = getSelectedTables(
      cursorData1,
      mockInformationSchemaWithPaths,
    );
    expect(result1).toEqual(["table-users-123"]);

    // Test 2: SQL with backticks should still find table by name
    const cursorData2: CursorData = {
      input: ["SELECT * FROM `analytics`.`public`.`table-users-123`"],
      row: 0,
      column: 42,
    };
    const result2 = getSelectedTables(
      cursorData2,
      mockInformationSchemaWithPaths,
    );
    expect(result2).toEqual(["table-users-123"]);
  });
});

describe("getAutoCompletions", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("should return SQL keywords when no cursor data", async () => {
    const result = await getAutoCompletions(
      null,
      mockInformationSchemaWithPaths,
      "bigquery",
      mockApiCall,
      "EditSqlModal",
    );
    expect(result.length).toBe(mockSqlKeywords.length);
    expect(result).toEqual(mockSqlKeywords);
  });

  it("should return SQL keywords when no information schema", async () => {
    const cursorData: CursorData = { input: ["SELECT "], row: 0, column: 7 };
    const result = await getAutoCompletions(
      cursorData,
      undefined,
      "bigquery",
      mockApiCall,
      "EditSqlModal",
    );
    expect(result.length).toBe(mockSqlKeywords.length);
    expect(result).toEqual(mockSqlKeywords);
  });

  it("should return SQL keywords when no context detected", async () => {
    const cursorData: CursorData = { input: [""], row: 0, column: 0 };
    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchemaWithPaths,
      "bigquery",
      mockApiCall,
      "EditSqlModal",
    );
    expect(result.length).toBe(mockSqlKeywords.length);
    expect(result).toEqual(mockSqlKeywords);
  });

  it("should return template completions and keywords for SELECT with no tables", async () => {
    const cursorData: CursorData = { input: ["SELECT "], row: 0, column: 7 };
    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchemaWithPaths,
      "bigquery",
      mockApiCall,
      "EditSqlModal",
    );

    const templateCompletions = getTemplateCompletions("EditSqlModal");

    expect(result.length).toBe(
      mockSqlKeywords.length + templateCompletions.length,
    );
    expect(result).toEqual([...templateCompletions, ...mockSqlKeywords]);
  });

  it("should return no columns, just template keywords, and sql keywords when notables are selected in SELECT context", async () => {
    const cursorData: CursorData = { input: ["SELECT "], row: 0, column: 7 };

    // First, let's test that it returns template completions and keywords when no tables are selected
    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchemaWithPaths,
      "bigquery",
      mockApiCall,
      "EditSqlModal",
    );
    const templateCompletions = getTemplateCompletions("EditSqlModal");

    expect(result.length).toBe(
      mockSqlKeywords.length + templateCompletions.length,
    );
    expect(result).toEqual([...templateCompletions, ...mockSqlKeywords]);
    // Should NOT make API calls since no tables are selected
    expect(mockCalls.length).toBe(0);
  });

  it("should return databases, schemas, and tables for empty FROM clause", async () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM "],
      row: 0,
      column: 14,
    };
    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchemaWithPaths,
      "bigquery",
      mockApiCall,
      "EditSqlModal",
    );

    const templateCompletions = getTemplateCompletions("EditSqlModal");

    // Should still return SQL keywords + all iterations of databases, schemas, and tables
    expect(result.length).toBe(
      // 9 because there are 3 databases, 2 schemas, and 4 tables
      mockSqlKeywords.length + templateCompletions.length + 9,
    );
  });

  it("should return schemas when database is selected in FROM clause", async () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM analytics."],
      row: 0,
      column: 25,
    };
    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchemaWithPaths,
      "bigquery",
      mockApiCall,
      "EditSqlModal",
    );
    // Results should include the 2 schemas in the analytics database + all of the sqlKeywords
    expect(result.length).toBe(mockSqlKeywords.length + 2);
    expect(result.some((item) => item.caption === "public")).toBe(true);
    expect(result.some((item) => item.caption === "staging")).toBe(true);
    expect(result.some((item) => item.meta === "prod")).toBe(false); // prod is not in the analytics database
  });

  it("should return tables when schema is selected in FROM clause", async () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM analytics.public."],
      row: 0,
      column: 32,
    };
    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchemaWithPaths,
      "bigquery",
      mockApiCall,
      "EditSqlModal",
    );

    // Should include the 2 tables from analytics.public schema + all of the sqlKeywords
    expect(result.length).toBe(mockSqlKeywords.length + 2);
    expect(result.some((item) => item.caption === "table-users-123")).toBe(
      true,
    );
    expect(result.some((item) => item.caption === "table-events-456")).toBe(
      true,
    );
    // table-temp-789 is in analytics.staging not analytics.public
    expect(result.some((item) => item.meta === "table-temp-789")).toBe(false);
  });

  it("should return columns when tables are selected in WHERE context", async () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM `analytics`.`public`.`table-users-123` WHERE "],
      row: 0,
      column: 60, // Fixed: moved to end of string
    };

    // First let's check if getSelectedTables finds the table
    const selectedTables = getSelectedTables(
      cursorData,
      mockInformationSchemaWithPaths,
    );
    expect(selectedTables).toEqual(["table-users-123"]);

    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchemaWithPaths,
      "bigquery",
      mockApiCall,
      "EditSqlModal",
    );

    const templateCompletions = getTemplateCompletions("EditSqlModal");

    // If getSelectedTables works, then API calls should be made
    expect(mockCalls.length).toEqual(1);
    // Should include 3 columns from the table-users-123 table + all of the sqlKeywords + all of the template completions
    expect(result.length).toBe(
      mockSqlKeywords.length + 3 + templateCompletions.length,
    );
    expect(result).toEqual([
      ...mockColumnSuggestions,
      ...templateCompletions,
      ...mockSqlKeywords,
    ]);
  });

  it("should handle GROUP BY context", async () => {
    const cursorData: CursorData = {
      input: [
        "SELECT count(*) FROM `analytics`.`public`.`table-users-123` GROUP BY ",
      ],
      row: 0,
      column: 72, // Fixed: moved to end of string
    };

    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchemaWithPaths,
      "bigquery",
      mockApiCall,
      "EditSqlModal",
    );

    const templateCompletions = getTemplateCompletions("EditSqlModal");

    // Should include 3 columns from the table-users-123 table + all of the sqlKeywords + all of the template completions
    expect(result.length).toBe(
      mockSqlKeywords.length + 3 + templateCompletions.length,
    );
    expect(result).toEqual([
      ...mockColumnSuggestions,
      ...templateCompletions,
      ...mockSqlKeywords,
    ]);
  });

  it("should handle ORDER BY context", async () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM `analytics`.`public`.`table-users-123` ORDER BY "],
      row: 0,
      column: 65, // Fixed: moved to end of string
    };

    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchemaWithPaths,
      "bigquery",
      mockApiCall,
      "EditSqlModal",
    );

    const templateCompletions = getTemplateCompletions("EditSqlModal");

    // Should include 3 columns from the table-users-123 table + all of the sqlKeywords + all of the template completions
    expect(result.length).toBe(
      mockSqlKeywords.length + 3 + templateCompletions.length,
    );
    expect(result).toEqual([
      ...mockColumnSuggestions,
      ...templateCompletions,
      ...mockSqlKeywords,
    ]);
  });
});

describe("Edge Cases", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("should handle malformed SQL gracefully", async () => {
    const cursorData: CursorData = {
      input: ["SELECT * FORM users WHRE"],
      row: 0,
      column: 25,
    };
    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchemaWithPaths,
      "bigquery",
      mockApiCall,
      "EditSqlModal",
    );

    const templateCompletions = getTemplateCompletions("EditSqlModal");

    // Should still return SQL keywords & template completions
    expect(result.length).toBe(
      mockSqlKeywords.length + templateCompletions.length,
    );
    expect(result).toEqual([...templateCompletions, ...mockSqlKeywords]);
  });

  it("should handle empty input gracefully", async () => {
    const cursorData: CursorData = { input: [""], row: 0, column: 0 };
    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchemaWithPaths,
      "bigquery",
      mockApiCall,
      "EditSqlModal",
    );

    expect(result.length).toBe(mockSqlKeywords.length);
    expect(result).toEqual(mockSqlKeywords);
  });

  it("should handle cursor at start of input", async () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM users"],
      row: 0,
      column: 0,
    };
    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchemaWithPaths,
      "bigquery",
      mockApiCall,
      "EditSqlModal",
    );

    expect(result.length).toBe(mockSqlKeywords.length);
    expect(result).toEqual(mockSqlKeywords);
  });

  it("should handle cursor at end of input", async () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM users"],
      row: 0,
      column: 19,
    };
    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchemaWithPaths,
      "bigquery",
      mockApiCall,
      "EditSqlModal",
    );

    expect(result.length).toEqual(mockSqlKeywords.length);
    expect(result).toEqual(mockSqlKeywords);
  });

  it("should handle API call failures gracefully", async () => {
    const failingApiCall = () => Promise.reject(new Error("API Error"));
    const cursorData: CursorData = {
      input: ["SELECT * FROM `analytics`.`public`.`users`", "SELECT "],
      row: 1,
      column: 7,
    };

    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchemaWithPaths,
      "bigquery",
      failingApiCall,
      "EditSqlModal",
    );

    const templateCompletions = getTemplateCompletions("EditSqlModal");

    // Should still return SQL keywords & template completions
    expect(result.length).toBe(
      mockSqlKeywords.length + templateCompletions.length,
    );
    expect(result).toEqual([...templateCompletions, ...mockSqlKeywords]);
  });

  it("should handle case insensitive SQL keywords", async () => {
    const cursorData: CursorData = {
      input: ["select * from "],
      row: 0,
      column: 14,
    };
    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchemaWithPaths,
      "bigquery",
      mockApiCall,
      "EditSqlModal",
    );

    const templateCompletions = getTemplateCompletions("EditSqlModal");

    // Should still return SQL keywords + all iterations of databases, schemas, and tables
    expect(result.length).toBe(
      // 9 because there are 3 databases, 2 schemas, and 4 tables
      mockSqlKeywords.length + templateCompletions.length + 9,
    );
  });

  it("should handle extra whitespace", async () => {
    const cursorData: CursorData = {
      input: ["SELECT   *   FROM   "],
      row: 0,
      column: 20,
    };
    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchemaWithPaths,
      "bigquery",
      mockApiCall,
      "EditSqlModal",
    );

    const templateCompletions = getTemplateCompletions("EditSqlModal");

    // Should still return SQL keywords + all iterations of databases, schemas, and tables
    expect(result.length).toBe(
      // 9 because there are 3 databases, 2 schemas, and 4 tables
      mockSqlKeywords.length + templateCompletions.length + 9,
    );
  });

  it("should handle incomplete table paths", async () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM analytics.public.unknown_table WHERE "],
      row: 0,
      column: 53,
    };

    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchemaWithPaths,
      "bigquery",
      mockApiCall,
      "EditSqlModal",
    );

    const templateCompletions = getTemplateCompletions("EditSqlModal");

    // If there is no known table, we return the SQL keywords & template completions
    expect(result.length).toBe(
      mockSqlKeywords.length + templateCompletions.length,
    );
    expect(result).toEqual([...templateCompletions, ...mockSqlKeywords]);
  });
});
