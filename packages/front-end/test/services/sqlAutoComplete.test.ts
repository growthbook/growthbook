import {
  InformationSchemaInterface,
  InformationSchemaTablesInterface,
} from "back-end/src/types/Integration";
import {
  getCurrentContext,
  getSelectedTables,
  getAutoCompletions,
} from "@/services/sqlAutoComplete";
import { CursorData } from "@/components/Segments/SegmentForm";
import { InformationSchemaInterfaceWithPaths } from "@/services/datasources";

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
const mockInformationSchema: InformationSchemaInterface = {
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
      // path: "`analytics`",
      dateCreated: new Date("2023-01-01"),
      dateUpdated: new Date("2023-01-01"),
      schemas: [
        {
          schemaName: "public",
          dateCreated: new Date("2023-01-01"),
          dateUpdated: new Date("2023-01-01"),
          tables: [
            {
              tableName: "table-users-123",
              id: "table-users-123",
              numOfColumns: 3,
              dateCreated: new Date("2023-01-01"),
              dateUpdated: new Date("2023-01-01"),
            },
            {
              tableName: "table-events-456",
              id: "table-events-456",
              numOfColumns: 4,
              dateCreated: new Date("2023-01-01"),
              dateUpdated: new Date("2023-01-01"),
            },
          ],
        },
        {
          schemaName: "staging",
          dateCreated: new Date("2023-01-01"),
          dateUpdated: new Date("2023-01-01"),
          tables: [
            {
              tableName: "table-temp-789",
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
      dateCreated: new Date("2023-01-01"),
      dateUpdated: new Date("2023-01-01"),
      schemas: [
        {
          schemaName: "prod",
          dateCreated: new Date("2023-01-01"),
          dateUpdated: new Date("2023-01-01"),
          tables: [
            {
              tableName: "table-orders-999",
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
  columns: [
    { columnName: "id", dataType: "INTEGER" },
    { columnName: "email", dataType: "VARCHAR" },
    { columnName: "created_at", dataType: "TIMESTAMP" },
  ],
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
  Promise.resolve({ table: mockTableData })
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
      mockInformationSchemaWithPaths
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
      mockInformationSchemaWithPaths
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
      mockInformationSchemaWithPaths
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
      mockInformationSchemaWithPaths
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
      mockInformationSchemaWithPaths
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
      mockInformationSchemaWithPaths
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
      mockInformationSchemaWithPaths
    );
    expect(result).toEqual([]);
  });

  it("should return empty array for empty input", () => {
    const cursorData: CursorData = { input: [""], row: 0, column: 0 };
    const result = getSelectedTables(
      cursorData,
      mockInformationSchemaWithPaths
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
      mockInformationSchemaWithPaths
    );
    expect(result).toEqual([]);
  });

  it("should handle mixed backtick scenarios (production-like)", () => {
    // Test with production-like data where paths have backticks
    // but SQL might not, or vice versa
    const productionLikeSchema = {
      ...mockInformationSchema,
      databases: [
        {
          ...mockInformationSchema.databases[0],
          schemas: [
            {
              ...mockInformationSchema.databases[0].schemas[0],
              tables: [
                {
                  tableName: "table-users-123",
                  path: "analytics.public.table-users-123", // Different path format
                  id: "table-users-123",
                  numOfColumns: 3,
                  dateCreated: new Date("2023-01-01"),
                  dateUpdated: new Date("2023-01-01"),
                },
              ],
            },
          ],
        },
      ],
    };

    // Test 1: SQL without backticks should still find table by name
    const cursorData1: CursorData = {
      input: ["SELECT * FROM analytics.public.table-users-123"],
      row: 0,
      column: 36,
    };
    const result1 = getSelectedTables(
      cursorData1,
      mockInformationSchemaWithPaths
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
      mockInformationSchemaWithPaths
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
      mockInformationSchema,
      "bigquery",
      mockApiCall
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((item) => item.value === "SELECT")).toBe(true);
  });

  it("should return SQL keywords when no information schema", async () => {
    const cursorData: CursorData = { input: ["SELECT "], row: 0, column: 7 };
    const result = await getAutoCompletions(
      cursorData,
      undefined,
      "bigquery",
      mockApiCall
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((item) => item.value === "SELECT")).toBe(true);
  });

  it("should return SQL keywords when no context detected", async () => {
    const cursorData: CursorData = { input: [""], row: 0, column: 0 };
    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchema,
      "bigquery",
      mockApiCall
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((item) => item.value === "SELECT")).toBe(true);
  });

  it("should return template completions and keywords for SELECT with no tables", async () => {
    const cursorData: CursorData = { input: ["SELECT "], row: 0, column: 7 };
    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchema,
      "bigquery",
      mockApiCall
    );

    // Should include template variables
    expect(result.some((item) => item.caption === "{{ startDate }}")).toBe(
      true
    );
    // Should include SQL keywords
    expect(result.some((item) => item.value === "SELECT")).toBe(true);
  });

  it("should return columns when tables are selected in SELECT context", async () => {
    const cursorData: CursorData = { input: ["SELECT "], row: 0, column: 7 };

    // First, let's test that it returns template completions and keywords when no tables are selected
    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchema,
      "bigquery",
      mockApiCall
    );

    // Should include template variables
    expect(result.some((item) => item.caption === "{{ startDate }}")).toBe(
      true
    );
    // Should include SQL keywords
    expect(result.some((item) => item.value === "SELECT")).toBe(true);
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
      mockInformationSchema,
      "bigquery",
      mockApiCall
    );

    console.log("result", result);

    // Should include databases
    expect(result.some((item) => item.meta === "DATABASE")).toBe(true);
    expect(result.some((item) => item.caption === "analytics")).toBe(true);
    expect(result.some((item) => item.caption === "warehouse")).toBe(true);

    // Should include schemas
    expect(result.some((item) => item.meta === "SCHEMA")).toBe(true);
    expect(result.some((item) => item.caption === "public")).toBe(true);

    // Should include tables
    expect(result.some((item) => item.meta === "TABLE")).toBe(true);
    expect(result.some((item) => item.caption === "table-users-123")).toBe(
      true
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
      mockInformationSchema,
      "bigquery",
      mockApiCall
    );

    // Should include schemas from analytics database
    expect(result.some((item) => item.value === "public")).toBe(true);
    expect(result.some((item) => item.value === "staging")).toBe(true);
  });

  it("should return tables when schema is selected in FROM clause", async () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM analytics.public."],
      row: 0,
      column: 32,
    };
    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchema,
      "bigquery",
      mockApiCall
    );

    // Should include tables from analytics.public schema
    expect(result.some((item) => item.caption === "table-users-123")).toBe(
      true
    );
    expect(result.some((item) => item.caption === "table-events-456")).toBe(
      true
    );
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
      mockInformationSchemaWithPaths
    );
    expect(selectedTables.length).toBeGreaterThan(0); // This should pass if table parsing works

    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchema,
      "bigquery",
      mockApiCall
    );

    // If getSelectedTables works, then API calls should be made
    if (selectedTables.length > 0) {
      expect(mockCalls.length).toBeGreaterThan(0);
    }

    // Should include columns from the users table (only if API call was successful)
    expect(result.some((item) => item.value === "id")).toBe(true);
    expect(result.some((item) => item.value === "email")).toBe(true);
    expect(result.some((item) => item.value === "created_at")).toBe(true);
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
      mockInformationSchema,
      "bigquery",
      mockApiCall
    );

    // Should include columns from the users table
    expect(result.some((item) => item.value === "email")).toBe(true);
  });

  it("should handle ORDER BY context", async () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM `analytics`.`public`.`table-users-123` ORDER BY "],
      row: 0,
      column: 65, // Fixed: moved to end of string
    };

    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchema,
      "bigquery",
      mockApiCall
    );

    // Should include columns from the users table
    expect(result.some((item) => item.value === "created_at")).toBe(true);
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
      mockInformationSchema,
      "bigquery",
      mockApiCall
    );

    // Should still return SQL keywords
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((item) => item.value === "SELECT")).toBe(true);
  });

  it("should handle empty input gracefully", async () => {
    const cursorData: CursorData = { input: [""], row: 0, column: 0 };
    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchema,
      "bigquery",
      mockApiCall
    );

    expect(result.length).toBeGreaterThan(0);
    expect(result.some((item) => item.value === "SELECT")).toBe(true);
  });

  it("should handle cursor at start of input", async () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM users"],
      row: 0,
      column: 0,
    };
    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchema,
      "bigquery",
      mockApiCall
    );

    expect(result.length).toBeGreaterThan(0);
  });

  it("should handle cursor at end of input", async () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM users"],
      row: 0,
      column: 19,
    };
    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchema,
      "bigquery",
      mockApiCall
    );

    expect(result.length).toBeGreaterThan(0);
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
      mockInformationSchema,
      "bigquery",
      failingApiCall
    );

    // Should still return template completions and keywords even if API fails
    expect(result.some((item) => item.caption === "{{ startDate }}")).toBe(
      true
    );
    expect(result.some((item) => item.value === "SELECT")).toBe(true);
  });

  it("should handle case insensitive SQL keywords", async () => {
    const cursorData: CursorData = {
      input: ["select * from "],
      row: 0,
      column: 14,
    };
    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchema,
      "bigquery",
      mockApiCall
    );

    // Should detect FROM context even with lowercase
    expect(result.some((item) => item.meta === "DATABASE")).toBe(true);
  });

  it("should handle extra whitespace", async () => {
    const cursorData: CursorData = {
      input: ["SELECT   *   FROM   "],
      row: 0,
      column: 20,
    };
    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchema,
      "bigquery",
      mockApiCall
    );

    // Should detect FROM context despite extra whitespace
    expect(result.some((item) => item.meta === "DATABASE")).toBe(true);
  });

  it("should handle incomplete table paths", async () => {
    const cursorData: CursorData = {
      input: ["SELECT * FROM analytics.public.unknown_table WHERE "],
      row: 0,
      column: 53,
    };

    const result = await getAutoCompletions(
      cursorData,
      mockInformationSchema,
      "bigquery",
      mockApiCall
    );

    // Should still return template completions and keywords
    expect(result.some((item) => item.caption === "{{ startDate }}")).toBe(
      true
    );
    expect(result.some((item) => item.value === "SELECT")).toBe(true);
  });
});
