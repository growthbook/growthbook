import { useMemo } from "react";
import { startCase } from "lodash";
import { FactTableDefinition } from "shared/types/fact-table";
import { ExplorationConfig } from "shared/validators";

export function getPreviewDateRange(
  now = new Date(),
): ExplorationConfig["dateRange"] {
  const start = new Date(now);
  const end = new Date(now);
  start.setUTCDate(start.getUTCDate() - 7);
  end.setUTCDate(end.getUTCDate() - 1);
  return {
    predefined: "customDateRange",
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

// Same object until the UTC day rolls over, so "last 7 days" stays current
// without changing the config on every render.
export function usePreviewDateRange(): ExplorationConfig["dateRange"] {
  const utcToday = new Date().toISOString().slice(0, 10);
  return useMemo(
    () => getPreviewDateRange(new Date(`${utcToday}T00:00:00Z`)),
    [utcToday],
  );
}

export function getPreviewUnitLabel(
  unit: string,
  factTable:
    | (Pick<FactTableDefinition, "userIdColumns"> & {
        columns: Pick<
          FactTableDefinition["columns"][number],
          "column" | "name"
        >[];
      })
    | null,
): { label: string; column: string } {
  const column = factTable?.userIdColumns?.[unit] || unit;
  const name = factTable?.columns
    .find((c) => c.column === column)
    ?.name?.trim();
  const commonNames: Record<string, string> = {
    userid: "Users",
    anonymousid: "Anonymous users",
    deviceid: "Devices",
    sessionid: "Sessions",
    accountid: "Accounts",
    organizationid: "Organizations",
    orgid: "Organizations",
    customerid: "Customers",
    visitorid: "Visitors",
  };
  const key = unit.replace(/[_\s-]/g, "").toLowerCase();
  return {
    label:
      name ||
      (Object.prototype.hasOwnProperty.call(commonNames, key)
        ? commonNames[key]
        : startCase(unit)),
    column,
  };
}

// Compact large values for preview headlines; preserve significant digits
// for small values instead of rounding them to zero.
export function formatPreviewHeadline(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 100_000) {
    return value.toLocaleString(undefined, {
      notation: "compact",
      maximumFractionDigits: 2,
    });
  }
  if (abs > 0 && abs < 0.001) return value.toExponential(2);
  if (abs > 0 && abs < 1) {
    return value.toLocaleString(undefined, { maximumSignificantDigits: 3 });
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
