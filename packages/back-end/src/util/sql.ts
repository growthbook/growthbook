import { format as sqlFormat } from "sql-formatter";

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
export function replaceDateVars(sql: string, startDate: Date, endDate?: Date) {
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

  const replacements: Record<string, string> = {
    startDate: startDate.toISOString().substr(0, 19).replace("T", " "),
    startYear: startDate.toISOString().substr(0, 4),
    startMonth: startDate.toISOString().substr(5, 2),
    startDay: startDate.toISOString().substr(8, 2),
    endDate: endDate.toISOString().substr(0, 19).replace("T", " "),
    endYear: endDate.toISOString().substr(0, 4),
    endMonth: endDate.toISOString().substr(5, 2),
    endDay: endDate.toISOString().substr(8, 2),
  };

  Object.keys(replacements).forEach((key) => {
    const re = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
    sql = sql.replace(re, replacements[key]);
  });

  return sql;
}

export function format(sql: string) {
  return (
    sqlFormat(sql, {
      language: "redshift",
    })
      // Fix Snowflate syntax for flatten function
      .replace(/ = > /g, " => ")
  );
}
