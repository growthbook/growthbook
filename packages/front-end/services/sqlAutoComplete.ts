import {
  InformationSchemaInterface,
  InformationSchemaInterfaceWithPaths,
  InformationSchemaTablesInterface,
} from "back-end/src/types/Integration";
import { DataSourceType } from "back-end/types/datasource";
import { CursorData } from "@/components/Segments/SegmentForm";
import { AceCompletion } from "@/components/Forms/CodeTextArea";
import {
  getSqlKeywords,
  COMPLETION_SCORES,
  COMPLETION_TYPES,
  getTemplateCompletions,
} from "./sqlKeywords";

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
    options?: RequestInit,
  ) => Promise<{ table: InformationSchemaTablesInterface }>,
): Promise<InformationSchemaTablesInterface | null> {
  // Check cache first
  if (tableDataCache[tableId]) {
    return tableDataCache[tableId];
  }

  try {
    const data = await apiCall(
      `/datasource/${datasourceId}/schema/table/${tableId}`,
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
    options?: RequestInit,
  ) => Promise<{ table: InformationSchemaTablesInterface }>,
): Promise<Record<string, InformationSchemaTablesInterface>> {
  const tableDataMap: Record<string, InformationSchemaTablesInterface> = {};

  // Fetch data for each table in parallel
  await Promise.all(
    selectedTables.map(async (tableId) => {
      const tableData = await fetchTableData(tableId, datasourceId, apiCall);
      if (tableData) {
        tableDataMap[tableId] = tableData;
      }
    }),
  );

  return tableDataMap;
}

/**
 * Adds event name table to selected tables
 * @param selectedTables - Array of currently selected table IDs
 * @param eventName - Event name to look for in the schema
 * @param cursorData - Current cursor position data
 * @param informationSchema - Database schema information
 * @returns Updated array of selected table IDs
 */
function addEventTableName(
  selectedTables: string[],
  eventName: string,
  cursorData: CursorData,
  informationSchema: InformationSchemaInterface,
): string[] {
  const sql = cursorData.input.join("\n");
  if (!sql.includes("eventName")) return selectedTables;

  // Find the table that matches the eventName
  const matchingTable = informationSchema.databases
    .flatMap((db) =>
      db.schemas.flatMap((schema) =>
        schema.tables.find((table) => table.tableName === eventName),
      ),
    )
    .filter((table) => table !== undefined)[0];

  return matchingTable ? [...selectedTables, matchingTable.id] : selectedTables;
}

/**
 * Handles column completions for SELECT, WHERE, GROUP BY, and ORDER BY contexts
 * @param tableDataMap - Map of table data by table ID
 * @returns Array of completion suggestions
 */
function handleColumnCompletions(
  tableDataMap: Record<string, InformationSchemaTablesInterface>,
  source: "EditSqlModal" | "SqlExplorer",
): AceCompletion[] {
  const baseCompletions = [
    ...getTemplateCompletions(source),
    ...getSqlKeywords(),
  ];
  // If there are no tables, then return template completions and sql keywords
  if (Object.keys(tableDataMap).length === 0) {
    return baseCompletions;
  }

  // Combine columns from all tables
  const allColumns = Object.values(tableDataMap).flatMap((table) =>
    table.columns.map((col) => ({
      value: col.columnName,
      meta: col.dataType,
      score: COMPLETION_SCORES.COLUMN,
      caption: col.columnName,
    })),
  );

  return [...allColumns, ...baseCompletions];
}

/**
 * Returns all available completions for an empty FROM clause
 * @param informationSchema - Database schema information
 * @returns Array of completion suggestions including databases, schemas, and tables
 */
function getAllCompletionsForEmptyFrom(
  informationSchema: InformationSchemaInterfaceWithPaths,
  source: "EditSqlModal" | "SqlExplorer",
): AceCompletion[] {
  const databaseCompletions: AceCompletion[] = [];
  for (const db of informationSchema.databases) {
    // Not all data sources support all 3 levels (db, schema, table) - and if they don't, the path will be empty
    // So we need to check if the path is empty before adding it to the completions
    if (db.path) {
      databaseCompletions.push({
        value: db.path,
        meta: COMPLETION_TYPES.DATABASE,
        score: COMPLETION_SCORES.DATABASE,
        caption: db.databaseName,
      });
    }
  }

  const schemaCompletions = informationSchema.databases.flatMap((db) =>
    db.schemas.map((schema) => ({
      value: schema.path,
      meta: COMPLETION_TYPES.SCHEMA,
      score: COMPLETION_SCORES.SCHEMA,
      caption: schema.schemaName,
    })),
  );

  const tableCompletions = informationSchema.databases.flatMap((db) =>
    db.schemas.flatMap((schema) =>
      schema.tables.map((table) => ({
        value: table.path,
        meta: COMPLETION_TYPES.TABLE,
        score: COMPLETION_SCORES.TABLE,
        caption: table.tableName,
      })),
    ),
  );

  return [
    ...databaseCompletions,
    ...schemaCompletions,
    ...tableCompletions,
    ...getTemplateCompletions(source),
    ...getSqlKeywords(),
  ];
}

/**
 * Handles FROM clause completions based on current text after FROM
 * @param textAfterFrom - Text following the FROM keyword
 * @param informationSchema - Database schema information
 * @returns Array of completion suggestions
 */
function handleFromClauseCompletions(
  textAfterFrom: string,
  informationSchema: InformationSchemaInterfaceWithPaths,
  source: "EditSqlModal" | "SqlExplorer",
): AceCompletion[] {
  // If we're at the start of the FROM clause (no text after FROM), show all options
  if (!textAfterFrom) {
    return getAllCompletionsForEmptyFrom(informationSchema, source);
  }

  // Parse the text to determine what level of completion to provide
  const parts = textAfterFrom.split(".").map((p) => p.trim().replace(/`/g, ""));

  // I'm not aware of a legit case where a FROM clause would have more than 3 parts
  // If this happens, we shouldn't try to parse the parts, just return sql keywords
  if (parts.length > 3) {
    return [...getSqlKeywords()];
  }

  let lastPart = parts[parts.length - 1];

  // If lastPart is empty, the user is typing, so get the last non-empty part
  if (lastPart === "") {
    lastPart = parts[parts.length - 2];
  }

  // Check if the lastPart is a schema - and if so, return table suggestions
  const hasSchema = informationSchema.databases.some((db) =>
    db.schemas.some((schema) => schema.schemaName === lastPart),
  );

  if (hasSchema) {
    const tableCompletions: AceCompletion[] = [];

    for (const db of informationSchema.databases) {
      for (const schema of db.schemas) {
        if (schema.schemaName === lastPart) {
          const tablesForThisSchema = schema.tables.map((table) => ({
            value: formatTableCompletion(table.path, table.tableName, true),
            meta: COMPLETION_TYPES.TABLE,
            score: COMPLETION_SCORES.TABLE,
            caption: table.tableName,
          }));
          tableCompletions.push(...tablesForThisSchema);
        }
      }
    }
    return [...tableCompletions, ...getSqlKeywords()];
  }

  // If the last part isn't a schema, then check if it's a database, and if so, return schema suggestions
  const hasDatabase = informationSchema.databases.some(
    (db) => db.databaseName === lastPart,
  );

  if (hasDatabase) {
    const schemaCompletions: AceCompletion[] = [];

    for (const db of informationSchema.databases) {
      if (db.databaseName === lastPart) {
        const schemasForThisDb = db.schemas.map((schema) => ({
          value: formatSchemaCompletion(schema.path, schema.schemaName, true),
          meta: COMPLETION_TYPES.SCHEMA,
          score: COMPLETION_SCORES.SCHEMA,
          caption: schema.schemaName,
        }));
        schemaCompletions.push(...schemasForThisDb);
      }
    }

    return [...schemaCompletions, ...getSqlKeywords()];
  }

  // If we can't find a schema or database, then we can't return any suggestions
  return [...getSqlKeywords()];
}

/**
 * Checks if the cursor is in a continuation context (after comma, AND, OR)
 * @param keyword - The SQL keyword context (FROM, SELECT, WHERE)
 * @param textAfterKeyword - Text following the keyword
 * @returns True if in a continuation context
 */
function isInContinuationContext(
  keyword: string,
  textAfterKeyword: string,
): boolean {
  switch (keyword) {
    case "FROM":
    case "SELECT":
      // Check if we're after a comma
      return textAfterKeyword.lastIndexOf(",") !== -1;

    case "WHERE": {
      // Check if we're after AND/OR
      const lastAndOr = Math.max(
        textAfterKeyword.lastIndexOf(" AND "),
        textAfterKeyword.lastIndexOf(" OR "),
      );
      return lastAndOr !== -1;
    }

    default:
      return false;
  }
}

/**
 * Analyzes the SQL text up to the cursor position to determine which SQL clause
 * the user is currently typing in. Supports detection of SELECT, FROM, WHERE,
 * GROUP BY, and ORDER BY contexts, including continuation contexts (after commas,
 * AND, OR operators).
 *
 * @param cursorData - Current cursor position and input data
 * @param cursorData.row - Zero-based row index of cursor position
 * @param cursorData.column - Zero-based column index of cursor position
 * @param cursorData.input - Array of strings representing each line of SQL input
 * @returns The detected SQL context object with type and suggestions array, or null if no context found
 *
 */
export function getCurrentContext(
  cursorData: CursorData,
): AutocompleteContext | null {
  const { row, column, input } = cursorData;
  const currentLine = input[row] || "";
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
    lastKeyword.index + lastKeyword.keyword.length,
  );

  // Check if we're in a continuation context
  if (isInContinuationContext(lastKeyword.keyword, textAfterKeyword)) {
    return {
      type: lastKeyword.keyword as Keywords,
      suggestions: [],
    };
  }

  return {
    type: lastKeyword.keyword as Keywords,
    suggestions: [],
  };
}

/**
 * Parses SQL text to find all tables referenced in FROM clauses and returns
 * their corresponding table IDs from the information schema. Supports various
 * table name formats including backticked names, fully qualified names, and
 * comma-separated table lists. Uses both exact path matching and table name
 * fallback for robust table identification.
 *
 * @param cursorData - Current cursor position and input data containing SQL text
 * @param cursorData.input - Array of strings representing each line of SQL input
 * @param informationSchema - Database schema information containing table definitions
 * @param informationSchema.databases - Array of database objects with schemas and tables
 * @returns Array of table IDs found in the SQL query, or empty array if none found
 *
 */
export function getSelectedTables(
  cursorData: CursorData,
  informationSchema: InformationSchemaInterfaceWithPaths,
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
      })),
    ),
  );

  // Find all FROM clauses in the query
  const fromClauses = (sql.match(
    /FROM\s+([^;]+?)(?=\s+(?:WHERE|GROUP BY|ORDER BY|$)|$)/gi,
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

function formatSchemaCompletion(
  path: string,
  tableName: string,
  hasDatabase: boolean,
): string {
  if (hasDatabase) {
    return tableName;
  }
  return path;
}

function formatTableCompletion(
  tablePath: string,
  tableName: string,
  hasSchema: boolean,
): string {
  if (!hasSchema) {
    return tablePath;
  }

  // If the path doesn't contain backticks, just return tableName
  if (!tablePath.includes("`")) {
    return tableName;
  }

  const pathParts = tablePath.split(".");

  const tablePartPath = pathParts[pathParts.length - 1];

  // If the table part path starts and ends with backticks, return tableName with backticks at the start and end
  if (tablePartPath.startsWith("`") && tablePartPath.endsWith("`")) {
    return "`" + tableName + "`";
  }

  // Otherwise the table part path ends with backticks, so return tableName with backticks at the end
  return tableName + "`";
}

/**
 * Main function to get autocompletion suggestions for SQL queries
 * @param cursorData - Current cursor position and input data
 * @param informationSchema - Database schema information
 * @param apiCall - Function to make API calls for table data
 * @param eventName - Optional event name for event-based queries
 * @returns Promise resolving to array of completion suggestions
 */
export async function getAutoCompletions(
  cursorData: CursorData | null,
  informationSchema: InformationSchemaInterfaceWithPaths | undefined,
  datasourceType: DataSourceType | undefined,
  apiCall: (
    url: string,
    options?: RequestInit,
  ) => Promise<{ table: InformationSchemaTablesInterface }>,
  source: "EditSqlModal" | "SqlExplorer",
  eventName?: string,
): Promise<AceCompletion[]> {
  const sqlKeywords = getSqlKeywords();

  // Always provide SQL keywords as a baseline
  if (!cursorData || !informationSchema || !datasourceType) return sqlKeywords;

  const context = getCurrentContext(cursorData);

  // If no context is detected, still provide SQL keywords
  if (!context?.type) return sqlKeywords;

  // Get selected tables and their data
  let selectedTables = getSelectedTables(cursorData, informationSchema);

  // Add event name table if eventName is provided and used in the query
  // When creating legacy metrics, we sometimes use the event name as a template variable
  // So adding the event name table to the selected tables is useful for autocompletion
  // Otherwise we wouldn't know what table to get column suggestions for
  if (eventName) {
    selectedTables = addEventTableName(
      selectedTables,
      eventName,
      cursorData,
      informationSchema,
    );
  }

  const tableDataMap = await getTableDataForAutocomplete(
    selectedTables,
    informationSchema.datasourceId,
    apiCall,
  );

  // Generate suggestions based on context
  // TODO: We should explore updating the WHERE, GROUP BY, and ORDER BY completions to use only the columns included in the query
  // In addition to the sqlKeywords & template variables
  // I don't think we want to show ALL columns if their not in the SELECT clause
  switch (context.type) {
    case "SELECT":
    case "WHERE":
    case "GROUP BY":
    case "ORDER BY":
      return handleColumnCompletions(tableDataMap, source);

    case "FROM": {
      // Get the sql text up to the cursor's current position
      // This allows us to ignore additional clauses like WHERE, GROUP BY, ORDER BY, etc.
      const textUpToCursor = cursorData.input
        .slice(0, cursorData.row)
        .concat(
          (cursorData.input[cursorData.row] || "").substring(
            0,
            cursorData.column,
          ),
        )
        .join("\n");

      // Isolate the text after the "FROM" or "from" SQL keyword
      // This allows us to identify if the FROM clause already has certain tables or schemas
      // for more accurate completions. e.g. if the FROM clause references a schema, only show tables in that schema
      const textAfterFrom =
        textUpToCursor.toLowerCase().split("from")[1]?.trim() || "";

      return handleFromClauseCompletions(
        textAfterFrom,
        informationSchema,
        source,
      );
    }

    default:
      return sqlKeywords;
  }
}
