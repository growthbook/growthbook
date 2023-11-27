import { format as sqlFormat, FormatOptions } from "sql-formatter";

function getBaseIdType(objects: string[][], forcedBaseIdType?: string) {
  // If a specific id type is already chosen as the base, return it
  if (forcedBaseIdType) return forcedBaseIdType;

  // Count how many objects use each id type
  const counts: Record<string, number> = {};
  objects.forEach((types) => {
    types.forEach((type) => {
      if (!type) return;
      counts[type] = counts[type] || 0;
      counts[type]++;
    });
  });

  // Sort to find the most used id type and set it as the baseIdType
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

export function getBaseIdTypeAndJoins(
  objects: string[][],
  forcedBaseIdType?: string
) {
  // Get rid of empty ids, sort from least to most ids
  const sorted = objects
    .map((ids) => ids.filter(Boolean))
    .filter((ids) => ids.length > 0)
    .sort((a, b) => a.length - b.length);

  // Determine which id type to use as the base
  const baseIdType = getBaseIdType(objects, forcedBaseIdType);

  // Determine the required joins
  // TODO: optimize this to always choose the minimum possible number of joins
  const joinsRequired: Set<string> = new Set();
  sorted.forEach((types) => {
    // Object supports the base type already
    if (types.includes(baseIdType)) return;
    // Object supports one of the join types already
    if (types.filter((type) => joinsRequired.has(type)).length > 0) return;
    // Need to join to a new id type
    joinsRequired.add(types[0]);
  });

  return {
    baseIdType,
    joinsRequired: Array.from(joinsRequired),
  };
}

// Replace vars in SQL queries (e.g. '{{startDate}}')
export type SQLVars = {
  startDate: Date;
  endDate?: Date;
  experimentId?: string;
};
export function replaceKustoVars(
  sql: string,
  { startDate, endDate, experimentId }: SQLVars
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
      0
    );
  }

  // If we don't have an experimentId, fall back to using a percent sign
  // This way it can be used in a LIKE clause to match all experiment ids
  if (!experimentId) {
    experimentId = "%";
  }

  const replacements: Record<string, string> = {
    startDateUnix: "" + Math.floor(startDate.getTime() / 1000),
    startDate: startDate.toISOString().substr(0, 19).replace("T", " "),
    startYear: startDate.toISOString().substr(0, 4),
    startMonth: startDate.toISOString().substr(5, 2),
    startDay: startDate.toISOString().substr(8, 2),
    endDateUnix: "" + Math.floor(endDate.getTime() / 1000),
    endDate: endDate.toISOString().substr(0, 19).replace("T", " "),
    endYear: endDate.toISOString().substr(0, 4),
    endMonth: endDate.toISOString().substr(5, 2),
    endDay: endDate.toISOString().substr(8, 2),
    experimentId,
  };

  Object.keys(replacements).forEach((key) => {
    const re = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
    sql = sql.replace(re, replacements[key]);
  });

  return sql;
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

// Recursively create list of metric denominators in order
// For example, a "step3" metric has denominator "step2", which itself has denominator "step1"
// If you pass "step3" into this, it will return ["step1","step2","step3"]
export function expandDenominatorMetrics(
  metric: string,
  map: Map<string, { denominator?: string }>,
  visited?: Set<string>
): string[] {
  visited = visited || new Set();
  const m = map.get(metric);
  if (!m) return [];
  if (visited.has(metric)) return [];

  visited.add(metric);
  if (!m.denominator) return [metric];
  return [...expandDenominatorMetrics(m.denominator, map, visited), metric];
}

export function removeComments(kql: string): string {
  //Takes a string of code, not an actual function.
  return kql.replace(/\/\*[\s\S]*?\*\/|(?<=[^:])\/\/.*|^\/\/.*/g, "").trim(); //Strip comments
}
