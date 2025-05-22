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
    /FROM\s+([^;]+?)(?=\s+(?:WHERE|GROUP BY|ORDER BY|$)|$)/gi
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

function analyzeFromClause(
  textAfterFrom: string,
  informationSchema: InformationSchemaInterface
): {
  hasDatabase: boolean;
  hasSchema: boolean;
  databaseName?: string;
  schemaName?: string;
} {
  const parts = textAfterFrom.split(".").map((p) => p.trim().replace(/`/g, ""));

  // Check if the first part matches any database name
  const databasePart = parts[0] || "";
  const hasDatabase =
    databasePart !== "" &&
    informationSchema.databases.some(
      (db) => db.databaseName === databasePart || db.path === databasePart
    );

  // If we have a valid database, check if the second part matches any schema in that database
  const schemaPart = parts[1] || "";
  const hasSchema =
    (hasDatabase &&
      schemaPart !== "" &&
      informationSchema.databases
        .find(
          (db) => db.databaseName === databasePart || db.path === databasePart
        )
        ?.schemas.some(
          (schema) =>
            schema.schemaName === schemaPart || schema.path === schemaPart
        )) ||
    false;

  return {
    hasDatabase,
    hasSchema,
    databaseName: hasDatabase ? databasePart : undefined,
    schemaName: hasSchema ? schemaPart : undefined,
  };
}

function pathContainsBackticks(path: string): boolean {
  return path.startsWith("`");
}

function formatDatabaseCompletion(path: string): string {
  return pathContainsBackticks(path) ? `\`${path.replace(/`/g, "")}` : path;
}

function formatSchemaCompletion(path: string, hasDatabase: boolean): string {
  if (hasDatabase) {
    return path.replace(/`/g, "");
  }
  return pathContainsBackticks(path) ? `\`${path.replace(/`/g, "")}` : path;
}

function formatTableCompletion(
  tablePath: string,
  tableName: string,
  hasDatabase: boolean,
  hasSchema: boolean
): string {
  if (!hasDatabase && !hasSchema) {
    return tablePath;
  }

  return pathContainsBackticks(tablePath) ? `${tableName}\`` : tableName;
}

function getSchemaCompletions(
  textAfterFrom: string,
  informationSchema: InformationSchemaInterface
): AceCompletion[] {
  const { hasDatabase, databaseName } = analyzeFromClause(
    textAfterFrom,
    informationSchema
  );

  // If we have a database selected, only show schemas from that database
  if (hasDatabase && databaseName) {
    const selectedDatabase = informationSchema.databases.find(
      (db) => db.databaseName === databaseName || db.path === databaseName
    );

    if (selectedDatabase) {
      return selectedDatabase.schemas.map((schema) => ({
        value: schema.schemaName,
        meta: "SCHEMA",
        score: 950,
        caption: schema.schemaName,
      }));
    }
    return [];
  }

  // If no database selected, show all schemas with their database prefix
  return informationSchema.databases.flatMap((db) =>
    db.schemas.map((schema) => ({
      value: formatSchemaCompletion(
        schema.path || `${db.databaseName}.${schema.schemaName}`,
        hasDatabase
      ),
      meta: "SCHEMA",
      score: 950,
      caption: `${db.databaseName}.${schema.schemaName}`,
    }))
  );
}

function getTableCompletions(
  textAfterFrom: string,
  informationSchema: InformationSchemaInterface
): AceCompletion[] {
  const { hasDatabase, hasSchema, schemaName } = analyzeFromClause(
    textAfterFrom,
    informationSchema
  );

  // If we have a schema selected, only show tables from that schema
  if (hasSchema && schemaName) {
    // Find the schema across all databases
    for (const db of informationSchema.databases) {
      const selectedSchema = db.schemas.find(
        (schema) =>
          schema.schemaName === schemaName || schema.path === schemaName
      );

      if (selectedSchema) {
        return selectedSchema.tables.map((table) => ({
          value: formatTableCompletion(
            table.path,
            table.tableName,
            hasDatabase,
            hasSchema
          ),
          meta: "TABLE",
          score: 900,
          caption: table.tableName,
        }));
      }
    }
    return [];
  }

  // If only database is selected, don't show any table suggestions
  if (hasDatabase) {
    return [];
  }

  // If no database or schema selected, show all tables with their full path
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
  let textAfterFrom: string;
  let parts: string[];

  switch (context.type) {
    case "SELECT":
    case "WHERE":
    case "GROUP BY":
    case "ORDER BY":
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
      // Get the text after FROM up to the cursor
      textAfterFrom =
        cursorData.input
          .slice(0, cursorData.row)
          .concat(
            cursorData.input[cursorData.row].substring(0, cursorData.column)
          )
          .join("\n")
          .split("FROM")[1]
          ?.trim() || "";

      // If we're at the start of the FROM clause (no text after FROM), show databases, schemas, and tables
      if (!textAfterFrom) {
        const databaseCompletions = informationSchema.databases.map((db) => ({
          value: formatDatabaseCompletion(db.path || db.databaseName),
          meta: "DATABASE",
          score: 1000,
          caption: db.databaseName,
        }));

        const schemaCompletions = informationSchema.databases.flatMap((db) =>
          db.schemas.map((schema) => ({
            value: formatSchemaCompletion(
              `${db.databaseName}.${schema.schemaName}`,
              false
            ),
            meta: "SCHEMA",
            score: 950,
            caption: `${db.databaseName}.${schema.schemaName}`,
          }))
        );

        const tableCompletions = informationSchema.databases.flatMap((db) =>
          db.schemas.flatMap((schema) =>
            schema.tables.map((table) => ({
              value: table.path,
              meta: "TABLE",
              score: 900,
              caption: table.tableName,
            }))
          )
        );

        return [
          ...databaseCompletions,
          ...schemaCompletions,
          ...tableCompletions,
        ];
      }

      // If we have a database selected but no schema, show schemas
      parts = textAfterFrom.split(".");
      if (parts.length === 1 && parts[0].trim()) {
        return getSchemaCompletions(textAfterFrom, informationSchema);
      } else if (parts.length === 2 && parts[0].trim()) {
        // Handle case where database is followed by a dot
        return getSchemaCompletions(textAfterFrom, informationSchema);
      }

      // If we have a database and schema selected, or no selection yet, show tables
      return getTableCompletions(textAfterFrom, informationSchema);
    default:
      return [];
  }
}
