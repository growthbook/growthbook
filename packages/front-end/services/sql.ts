import {
  InformationSchemaInterface,
  InformationSchemaTablesInterface,
} from "back-end/src/types/Integration";
import { CursorData } from "@/components/Segments/SegmentForm";
import { AceCompletion } from "@/components/Forms/CodeTextArea";

type Keywords = "SELECT" | "FROM" | "WHERE" | "GROUP BY" | "ORDER BY";

type AutocompleteContext = {
  type: Keywords;
  suggestions: AceCompletion[];
};

// Short-lived cache for table data
const tableDataCache: Record<string, InformationSchemaTablesInterface> = {};

// Function to fetch table data
async function fetchTableData(
  tableId: string,
  datasourceId: string,
  apiCall: (
    url: string,
    options?: RequestInit
  ) => Promise<{ table: InformationSchemaTablesInterface }>
): Promise<InformationSchemaTablesInterface | null> {
  // Check cache first
  if (tableDataCache[tableId]) {
    return tableDataCache[tableId];
  }

  try {
    const data = await apiCall(
      `/datasource/${datasourceId}/schema/table/${tableId}`
    );
    if (data.table) {
      tableDataCache[tableId] = data.table;
      return data.table;
    }
    return null;
  } catch (e) {
    console.error("Error fetching table data:", e);
    return null;
  }
}

// Function to get all table data for selected tables
async function getTableDataForAutocomplete(
  selectedTables: string[],
  datasourceId: string,
  apiCall: (
    url: string,
    options?: RequestInit
  ) => Promise<{ table: InformationSchemaTablesInterface }>
): Promise<Record<string, InformationSchemaTablesInterface>> {
  const tableDataMap: Record<string, InformationSchemaTablesInterface> = {};

  // Fetch data for each table in parallel
  await Promise.all(
    selectedTables.map(async (tableId) => {
      const tableData = await fetchTableData(tableId, datasourceId, apiCall);
      if (tableData) {
        tableDataMap[tableId] = tableData;
      }
    })
  );

  return tableDataMap;
}

export function getCurrentContext(
  cursorData: CursorData
): AutocompleteContext | null {
  const { row, column, input } = cursorData;
  const currentLine = input[row];
  const textBeforeCursor = currentLine.substring(0, column);

  // Get all text up to the current cursor position
  const textUpToCursor = input
    .slice(0, row)
    .concat(textBeforeCursor)
    .join("\n");

  // Look for the last SQL keyword before cursor
  const keywords: Keywords[] = [
    "SELECT",
    "FROM",
    "WHERE",
    "GROUP BY",
    "ORDER BY",
  ];

  // Find the last keyword and its position
  const lastKeyword = keywords
    .map((keyword) => ({
      keyword,
      index: textUpToCursor.toUpperCase().lastIndexOf(keyword),
    }))
    .filter((k) => k.index !== -1)
    .sort((a, b) => b.index - a.index)[0];

  if (!lastKeyword) return null;

  // Get the text between the last keyword and the cursor
  const textAfterKeyword = textUpToCursor.slice(
    lastKeyword.index + lastKeyword.keyword.length
  );

  // If we're in a FROM clause, check if we're after a comma
  if (lastKeyword.keyword === "FROM") {
    const lastComma = textAfterKeyword.lastIndexOf(",");
    if (lastComma !== -1) {
      // If we're after a comma, we're still in the FROM context
      return {
        type: "FROM",
        suggestions: [],
      };
    }
  }

  // If we're in a SELECT clause, check if we're after a comma
  if (lastKeyword.keyword === "SELECT") {
    const lastComma = textAfterKeyword.lastIndexOf(",");
    if (lastComma !== -1) {
      // If we're after a comma, we're still in the SELECT context
      return {
        type: "SELECT",
        suggestions: [],
      };
    }
  }

  // If we're in a WHERE clause, check if we're after AND/OR
  if (lastKeyword.keyword === "WHERE") {
    const lastAndOr = Math.max(
      textAfterKeyword.lastIndexOf(" AND "),
      textAfterKeyword.lastIndexOf(" OR ")
    );
    if (lastAndOr !== -1) {
      // If we're after AND/OR, we're still in the WHERE context
      return {
        type: "WHERE",
        suggestions: [],
      };
    }
  }

  return {
    type: lastKeyword.keyword,
    suggestions: [],
  };
}

export function getSelectedTables(
  cursorData: CursorData,
  informationSchema: InformationSchemaInterface
): string[] {
  if (!cursorData || !informationSchema) return [];

  const { input } = cursorData;
  const sql = input.join("\n");

  // Get all known table names and their paths from the information schema
  const knownTables = informationSchema.databases.flatMap((db) =>
    db.schemas.flatMap((schema) =>
      schema.tables.map((table) => ({
        name: table.tableName,
        path: table.path,
        id: table.id,
      }))
    )
  );

  // Find all FROM clauses in the query
  const fromClauses = (sql.match(
    /FROM\s+([^;]+?)(?=\s+(?:WHERE|GROUP BY|ORDER BY|$))/gi
  ) || []) as string[];

  // Extract tables from FROM clauses
  const foundTables = new Set<string>();
  fromClauses.forEach((clause) => {
    // Get the part after FROM
    const tablesPart = clause.replace(/FROM\s+/i, "").trim();
    // Split by commas and check each part
    const tables = tablesPart.split(",").map((t) => t.trim());

    // Check if any known tables are in this FROM clause
    tables.forEach((table) => {
      // Remove backticks if present
      const cleanTable = table.replace(/`/g, "");
      // Try to find a matching table
      const knownTable = knownTables.find((kt) => {
        // Check if the table path matches exactly
        if (cleanTable === kt.path) return true;
        // Check if it's a fully qualified name that matches
        if (cleanTable.includes(".")) {
          const parts = cleanTable.split(".");
          return parts[parts.length - 1] === kt.name;
        }
        return false;
      });
      if (knownTable) {
        foundTables.add(knownTable.id);
      }
    });
  });

  return Array.from(foundTables);
}

export async function getAutoCompletions(
  cursorData: CursorData | null,
  informationSchema: InformationSchemaInterface | undefined,
  apiCall: (
    url: string,
    options?: RequestInit
  ) => Promise<{ table: InformationSchemaTablesInterface }>
): Promise<AceCompletion[]> {
  if (!cursorData || !informationSchema) return [];

  const context = getCurrentContext(cursorData);
  if (!context?.type) return [];

  // Get selected tables and their data
  const selectedTables = getSelectedTables(cursorData, informationSchema);
  const tableDataMap = await getTableDataForAutocomplete(
    selectedTables,
    informationSchema.datasourceId,
    apiCall
  );

  // Generate suggestions based on context
  switch (context.type) {
    case "SELECT":
      if (Object.keys(tableDataMap).length > 0) {
        // Combine columns from all tables
        const allColumns = Object.values(tableDataMap).flatMap((table) =>
          table.columns.map((col) => ({
            value: col.columnName,
            meta: col.dataType,
            score: 900,
            caption: col.columnName,
          }))
        );
        return allColumns;
      }
      return [];
    case "FROM":
      return informationSchema.databases.flatMap((db) =>
        db.schemas.flatMap((schema) =>
          schema.tables.map((table) => ({
            value: table.path,
            meta: "TABLE",
            score: 900,
            caption: table.tableName,
          }))
        )
      );
    case "WHERE":
      if (Object.keys(tableDataMap).length > 0) {
        // Combine columns from all tables
        const allColumns = Object.values(tableDataMap).flatMap((table) =>
          table.columns.map((col) => ({
            value: col.columnName,
            meta: col.dataType,
            score: 900,
            caption: col.columnName,
          }))
        );
        return allColumns;
      }
      return [];
    default:
      return [];
  }
}
