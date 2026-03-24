import Handlebars from "handlebars";
import { SQLVars } from "shared/types/sql";
import { FactTableColumnType, JSONColumnFields } from "shared/types/fact-table";
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

function getSqlDateParts(date: Date) {
  const iso = date.toISOString();
  return {
    year: iso.substring(0, 4),
    month: iso.substring(5, 7),
    day: iso.substring(8, 10),
    dateTime: iso.substring(0, 19).replace("T", " "),
    iso,
    unix: "" + Math.floor(date.getTime() / 1000),
  };
}

// Compile sql template with handlebars, replacing vars (e.g. '{{startDate}}') and evaluating helpers (e.g. '{{camelcase eventName}}')
export function compileSqlTemplate(
  sql: string,
  {
    startDate,
    endDate,
    experimentId,
    templateVariables,
    customFields,
    phase,
  }: SQLVars,
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

  const startDateParts = getSqlDateParts(startDate);
  const endDateParts = getSqlDateParts(endDate);

  const customIncrementalStartDate =
    typeof customFields?.incrementalStartDate === "string"
      ? customFields.incrementalStartDate
      : undefined;
  const customIncrementalStartYear =
    typeof customFields?.incrementalStartYear === "string"
      ? customFields.incrementalStartYear
      : undefined;
  const customIncrementalStartMonth =
    typeof customFields?.incrementalStartMonth === "string"
      ? customFields.incrementalStartMonth
      : undefined;
  const customIncrementalStartDay =
    typeof customFields?.incrementalStartDay === "string"
      ? customFields.incrementalStartDay
      : undefined;

  const replacements: Record<string, unknown> = {
    ...templateVariables,
    customFields: customFields || {},
    phase: phase || {},
    startDateUnix: startDateParts.unix,
    startDateISO: startDateParts.iso,
    startDate: startDateParts.dateTime,
    startYear: startDateParts.year,
    startMonth: startDateParts.month,
    startDay: startDateParts.day,
    incrementalStartDate: customIncrementalStartDate || startDateParts.dateTime,
    incrementalStartYear: customIncrementalStartYear || startDateParts.year,
    incrementalStartMonth: customIncrementalStartMonth || startDateParts.month,
    incrementalStartDay: customIncrementalStartDay || startDateParts.day,
    endDateUnix: endDateParts.unix,
    endDateISO: endDateParts.iso,
    endDate: endDateParts.dateTime,
    endYear: endDateParts.year,
    endMonth: endDateParts.month,
    endDay: endDateParts.day,
    experimentId,
  };

  // Better error messages for known variables that are missing
  if (!templateVariables?.eventName && usesTemplateVariable(sql, "eventName")) {
    throw new Error(
      "Error compiling SQL template: You must set eventName first.",
    );
  }
  if (
    !templateVariables?.valueColumn &&
    usesTemplateVariable(sql, "valueColumn")
  ) {
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

function isJSON(str: string) {
  // Only match objects
  if (!str?.startsWith("{")) return false;

  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}

function getJSONFields(testValues: unknown[]): JSONColumnFields {
  const fields: JSONColumnFields = {};

  testValues.forEach((str) => {
    if (typeof str !== "string") return;
    try {
      const obj = JSON.parse(str);
      Object.keys(obj).forEach((key) => {
        if (fields[key]) return;
        if (obj[key] === null || obj[key] === undefined) return;
        if (Object.keys(fields).length > 50) return;

        fields[key] = {
          datatype:
            typeof obj[key] === "string"
              ? obj[key].match(/^[0-9]{4}-[0-9]{2}-[0-9]{2}($|[ T])/)
                ? "date"
                : "string"
              : typeof obj[key] === "number"
                ? "number"
                : typeof obj[key] === "boolean"
                  ? "boolean"
                  : "other",
        };
      });
    } catch (e) {
      // Skip value
    }
  });

  return fields;
}

export function determineColumnTypes(
  rows: Record<string, unknown>[],
  typeMap: Map<string, FactTableColumnType>,
): {
  column: string;
  datatype: FactTableColumnType;
  jsonFields?: JSONColumnFields;
}[] {
  if (!rows || !rows[0]) return [];
  const cols = Object.keys(rows[0]);

  const columns: {
    column: string;
    datatype: FactTableColumnType;
    jsonFields?: JSONColumnFields;
  }[] = [];

  cols.forEach((col) => {
    const testValues = rows
      .map((row) => row[col])
      .filter((val) => val !== null && val !== undefined);
    const testValue = testValues[0];

    const colType = typeMap.get(col);
    const shouldAttemptInference =
      colType === undefined ||
      colType === "" ||
      (colType === "string" &&
        typeof testValue === "string" &&
        isJSON(testValue));

    if (!shouldAttemptInference) {
      return;
    } else if (typeof testValue === "string" && isJSON(testValue)) {
      // Use all test values to determine JSON fields
      columns.push({
        column: col,
        datatype: "json",
        jsonFields: getJSONFields(testValues),
      });
    } else if (testValue && testValue?.constructor === Object) {
      // Use all test values to determine JSON fields
      columns.push({
        column: col,
        datatype: "json",
        jsonFields: getJSONFields(testValues.map((v) => JSON.stringify(v))),
      });
    } else if (testValue !== undefined) {
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
