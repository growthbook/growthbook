import {
  InformationSchemaInterface,
  InformationSchemaTablesInterface,
} from "back-end/src/types/Integration";
import { CursorData } from "@/components/Segments/SegmentForm";
import { AceCompletion } from "@/components/Forms/CodeTextArea";
import {
  getSqlKeywords,
  COMPLETION_SCORES,
  COMPLETION_TYPES,
} from "./sqlKeywords";

const templateCompletions: AceCompletion[] = [
  {
    value: `'{{ startDate }}'`,
    meta: COMPLETION_TYPES.TEMPLATE_VARIABLE,
    score: COMPLETION_SCORES.TEMPLATE_VARIABLE,
    caption: `{{ startDate }}`,
  },
  {
    value: `'{{ startDateISO }}'`,
    meta: COMPLETION_TYPES.TEMPLATE_VARIABLE,
    score: COMPLETION_SCORES.TEMPLATE_VARIABLE,
    caption: `{{ startDateISO }}`,
  },
  {
    value: `'{{ endDate }}'`,
    meta: COMPLETION_TYPES.TEMPLATE_VARIABLE,
    score: COMPLETION_SCORES.TEMPLATE_VARIABLE,
    caption: `{{ endDate }}`,
  },
  {
    value: `'{{ endDateISO }}'`,
    meta: COMPLETION_TYPES.TEMPLATE_VARIABLE,
    score: COMPLETION_SCORES.TEMPLATE_VARIABLE,
    caption: `{{ endDateISO }}`,
  },
];

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
  informationSchema: InformationSchemaInterface
): string[] {
  const sql = cursorData.input.join("\n");
  if (!sql.includes("eventName")) return selectedTables;

  // Find the table that matches the eventName
  const matchingTable = informationSchema.databases
    .flatMap((db) =>
      db.schemas.flatMap((schema) =>
        schema.tables.find((table) => table.tableName === eventName)
      )
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
  tableDataMap: Record<string, InformationSchemaTablesInterface>
): AceCompletion[] {
  if (Object.keys(tableDataMap).length === 0) {
    return [...templateCompletions, ...getSqlKeywords()];
  }

  // Combine columns from all tables
  const allColumns = Object.values(tableDataMap).flatMap((table) =>
    table.columns.map((col) => ({
      value: col.columnName,
      meta: col.dataType,
      score: COMPLETION_SCORES.COLUMN,
      caption: col.columnName,
    }))
  );

  return [...allColumns, ...templateCompletions, ...getSqlKeywords()];
}

/**
 * Returns all available completions for an empty FROM clause
 * @param informationSchema - Database schema information
 * @returns Array of completion suggestions including databases, schemas, and tables
 */
function getAllCompletionsForEmptyFrom(
  informationSchema: InformationSchemaInterface
): AceCompletion[] {
  const databaseCompletions = informationSchema.databases.map((db) => ({
    value: formatDatabaseCompletion(db.path || db.databaseName),
    meta: COMPLETION_TYPES.DATABASE,
    score: COMPLETION_SCORES.DATABASE,
    caption: db.databaseName,
  }));

  const schemaCompletions = informationSchema.databases.flatMap((db) =>
    db.schemas.map((schema) => ({
      value: formatSchemaCompletion(schema.path || schema.schemaName, false),
      meta: COMPLETION_TYPES.SCHEMA,
      score: COMPLETION_SCORES.SCHEMA,
      caption: `${db.databaseName}.${schema.schemaName}`,
    }))
  );

  const tableCompletions = informationSchema.databases.flatMap((db) =>
    db.schemas.flatMap((schema) =>
      schema.tables.map((table) => ({
        value: table.path,
        meta: COMPLETION_TYPES.TABLE,
        score: COMPLETION_SCORES.TABLE,
        caption: `${db.databaseName}.${schema.schemaName}.${table.tableName}`,
      }))
    )
  );

  return [
    ...databaseCompletions,
    ...schemaCompletions,
    ...tableCompletions,
    ...templateCompletions,
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
  informationSchema: InformationSchemaInterface
): AceCompletion[] {
  // If we're at the start of the FROM clause (no text after FROM), show all options
  if (!textAfterFrom) {
    return getAllCompletionsForEmptyFrom(informationSchema);
  }

  // Parse the text to determine what level of completion to provide
  const parts = textAfterFrom.split(".");

  if (parts.length === 1 && parts[0].trim()) {
    // Database selected, show schemas
    return [
      ...getSchemaCompletions(textAfterFrom, informationSchema),
      ...getSqlKeywords(),
    ];
  } else if (parts.length === 2 && parts[0].trim()) {
    // Database and potentially schema selected, show schemas
    return [
      ...getSchemaCompletions(textAfterFrom, informationSchema),
      ...getSqlKeywords(),
    ];
  }

  // Default case: show table completions
  return [
    ...getTableCompletions(textAfterFrom, informationSchema),
    ...getSqlKeywords(),
  ];
}

/**
 * Checks if the cursor is in a continuation context (after comma, AND, OR)
 * @param keyword - The SQL keyword context (FROM, SELECT, WHERE)
 * @param textAfterKeyword - Text following the keyword
 * @returns True if in a continuation context
 */
function isInContinuationContext(
  keyword: string,
  textAfterKeyword: string
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
        textAfterKeyword.lastIndexOf(" OR ")
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
  cursorData: CursorData
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
    lastKeyword.index + lastKeyword.keyword.length
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
        meta: COMPLETION_TYPES.SCHEMA,
        score: COMPLETION_SCORES.SCHEMA,
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
      meta: COMPLETION_TYPES.SCHEMA,
      score: COMPLETION_SCORES.SCHEMA,
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
          meta: COMPLETION_TYPES.TABLE,
          score: COMPLETION_SCORES.TABLE,
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
        meta: COMPLETION_TYPES.TABLE,
        score: COMPLETION_SCORES.TABLE,
        caption: table.tableName,
      }))
    )
  );
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
  informationSchema: InformationSchemaInterface | undefined,
  apiCall: (
    url: string,
    options?: RequestInit
  ) => Promise<{ table: InformationSchemaTablesInterface }>,
  eventName?: string
): Promise<AceCompletion[]> {
  const sqlKeywords = getSqlKeywords();

  // Always provide SQL keywords as a baseline
  if (!cursorData || !informationSchema) return sqlKeywords;

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
      informationSchema
    );
  }

  const tableDataMap = await getTableDataForAutocomplete(
    selectedTables,
    informationSchema.datasourceId,
    apiCall
  );

  // Generate suggestions based on context
  switch (context.type) {
    case "SELECT":
    case "WHERE":
    case "GROUP BY":
    case "ORDER BY":
      return handleColumnCompletions(tableDataMap);

    case "FROM": {
      // Get the text after FROM up to the cursor
      const textAfterFrom =
        cursorData.input
          .slice(0, cursorData.row)
          .concat(
            (cursorData.input[cursorData.row] || "").substring(
              0,
              cursorData.column
            )
          )
          .join("\n")
          .split("FROM")[1]
          ?.trim() || "";

      return handleFromClauseCompletions(textAfterFrom, informationSchema);
    }

    default:
      return sqlKeywords;
  }
}
