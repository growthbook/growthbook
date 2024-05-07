import { format as sqlFormat, FormatOptions } from "sql-formatter";
import Handlebars from "handlebars";
import { SQLVars } from "../../types/sql";
import { FactTableColumnType } from "../../types/fact-table";
import { helpers } from "./handlebarsHelpers";

// Register all the helpers from handlebarsHelpers
Object.keys(helpers).forEach((helperName) => {
  Handlebars.registerHelper(helperName, helpers[helperName]);
});

export function getBaseIdTypeAndJoins(
  objects: string[][],
  forcedBaseIdType?: string,
) {
  // Get rid of empty ids, sort from least to most ids
  const sorted = objects
    .map((ids) => ids.filter(Boolean))
    .filter((ids) => ids.length > 0)
    .sort((a, b) => a.length - b.length);

  // Count how many objects use each id type
  const counts: Record<string, number> = {};
  objects.forEach((types) => {
    types.forEach((type) => {
      if (!type) return;
      counts[type] = counts[type] || 0;
      counts[type]++;
    });
  });

  const idTypesSortedByFrequency = Object.entries(counts).sort(
    (a, b) => b[1] - a[1],
  );

  // use most frequent ID as base type, unless forcedBaseIdType is passed
  const baseIdType = forcedBaseIdType || idTypesSortedByFrequency[0]?.[0] || "";

  const joinsRequired: Set<string> = new Set();
  sorted.forEach((types) => {
    // Object supports the base type already
    if (types.includes(baseIdType)) return;
    // Object supports one of the join types already
    if (types.filter((type) => joinsRequired.has(type)).length > 0) return;

    // Add id type that is most frequent to help minimize N joins needed
    joinsRequired.add(
      idTypesSortedByFrequency.find((x) => types.includes(x[0]))?.[0] ||
        types[0],
    );
  });

  return {
    baseIdType,
    joinsRequired: Array.from(joinsRequired),
  };
}

function usesTemplateVariable(sql: string, variableName: string) {
  return sql.match(new RegExp(`{{[^}]*${variableName}`, "g"));
}

// Compile sql template with handlebars, replacing vars (e.g. '{{startDate}}') and evaluating helpers (e.g. '{{camelcase eventName}}')
export function compileSqlTemplate(
  sql: string,
  { startDate, endDate, experimentId, templateVariables }: SQLVars,
) {
  // If there's no end date, use a near future date by default
  // We want to use at least 24 hours in the future in case of timezone issues
  // Set hours, minutes, seconds, ms to 0 so SQL can be more easily cached
  if (!endDate) {
    const now = new Date();
    endDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 2,
      0,
      0,
      0,
      0,
    );
  }

  // If we don't have an experimentId, fall back to using a percent sign
  // This way it can be used in a LIKE clause to match all experiment ids
  if (!experimentId) {
    experimentId = "%";
  }

  const replacements: Record<string, string> = {
    startDateUnix: "" + Math.floor(startDate.getTime() / 1000),
    startDateISO: startDate.toISOString(),
    startDate: startDate.toISOString().substr(0, 19).replace("T", " "),
    startYear: startDate.toISOString().substr(0, 4),
    startMonth: startDate.toISOString().substr(5, 2),
    startDay: startDate.toISOString().substr(8, 2),
    endDateUnix: "" + Math.floor(endDate.getTime() / 1000),
    endDateISO: endDate.toISOString(),
    endDate: endDate.toISOString().substr(0, 19).replace("T", " "),
    endYear: endDate.toISOString().substr(0, 4),
    endMonth: endDate.toISOString().substr(5, 2),
    endDay: endDate.toISOString().substr(8, 2),
    experimentId,
  };

  if (templateVariables?.eventName) {
    replacements.eventName = templateVariables.eventName;
  } else if (usesTemplateVariable(sql, "eventName")) {
    throw new Error(
      "Error compiling SQL template: You must set eventName first.",
    );
  }

  if (templateVariables?.valueColumn) {
    replacements.valueColumn = templateVariables.valueColumn;
  } else if (usesTemplateVariable(sql, "valueColumn")) {
    throw new Error(
      "Error compiling SQL template: You must set valueColumn first.",
    );
  }

  try {
    // TODO: Do sql escaping instead of html escaping for any new replacements
    const template = Handlebars.compile(sql, {
      strict: true,
      noEscape: true,
      knownHelpers: Object.keys(helpers).reduce(
        (acc, helperName) => {
          acc[helperName] = true;
          return acc;
        },
        {} as Record<string, true>,
      ),
      knownHelpersOnly: true,
    });
    return template(replacements);
  } catch (e) {
    if (e.message.includes("eventName")) {
      throw new Error(
        "Error compiling SQL template: You must set eventName first.",
      );
    }
    if (e.message.includes("valueColumn")) {
      throw new Error(
        "Error compiling SQL template: You must set valueColumn first.",
      );
    }
    if (e.message.includes("not defined in [object Object]")) {
      const variableName = e.message.match(/"(.+?)"/)[1];
      throw new Error(
        `Unknown variable: ${variableName}. Available variables: ${Object.keys(
          replacements,
        ).join(", ")}`,
      );
    }
    if (e.message.includes("unknown helper")) {
      const helperName = e.message.match(/unknown helper (\w*)/)[1];
      throw new Error(
        `Unknown helper: ${helperName}. Available helpers: ${Object.keys(
          helpers,
        ).join(", ")}`,
      );
    }
    throw new Error(`Error compiling SQL template: ${e.message}`);
  }
}

export type FormatDialect = FormatOptions["language"] | "";
export function format(sql: string, dialect?: FormatDialect) {
  if (!dialect) return sql;

  try {
    return sqlFormat(sql, {
      language: dialect,
    });
  } catch (e) {
    return sql;
  }
}

// used to support different server locations (e.g. for ClickHouse)
export function getHost(
  url: string | undefined,
  port: number,
): string | undefined {
  if (!url) return undefined;
  const host = new URL(!url.match(/^https?/) ? `http://${url}` : url);
  if (!host.port && port) host.port = port + "";
  return host.origin;
}

// Recursively create list of metric denominators in order
// For example, a "step3" metric has denominator "step2", which itself has denominator "step1"
// If you pass "step3" into this, it will return ["step1","step2","step3"]
export function expandDenominatorMetrics(
  metric: string,
  map: Map<string, { denominator?: string }>,
  visited?: Set<string>,
): string[] {
  visited = visited || new Set();
  const m = map.get(metric);
  if (!m) return [];
  if (visited.has(metric)) return [];

  visited.add(metric);
  if (!m.denominator) return [metric];
  return [...expandDenominatorMetrics(m.denominator, map, visited), metric];
}

// replace COUNT(*) with COUNT(${col}) to prevent counting null rows in some locations
export function replaceCountStar(aggregation: string, col: string) {
  return aggregation.replace(/count\(\s*\*\s*\)/gi, `COUNT(${col})`);
}

export function determineColumnTypes(
  rows: Record<string, unknown>[],
): { column: string; datatype: FactTableColumnType }[] {
  if (!rows || !rows[0]) return [];
  const cols = Object.keys(rows[0]);

  const columns: { column: string; datatype: FactTableColumnType }[] = [];
  cols.forEach((col) => {
    const testValue = rows
      .map((row) => row[col])
      .filter((val) => val !== null && val !== undefined)[0];

    if (testValue !== undefined) {
      columns.push({
        column: col,
        datatype:
          typeof testValue === "string"
            ? testValue.match(/^[0-9]{4}-[0-9]{2}-[0-9]{2}($|[ T])/)
              ? "date"
              : "string"
            : typeof testValue === "number"
              ? "number"
              : typeof testValue === "boolean"
                ? "boolean"
                : testValue && testValue instanceof Date
                  ? "date"
                  : "other",
      });
    } else {
      columns.push({
        column: col,
        datatype: "",
      });
    }
  });

  return columns;
}
