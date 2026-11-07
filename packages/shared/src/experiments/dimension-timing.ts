import type { DimensionTiming } from "shared/validators";

export const DIMENSION_TIMESTAMP_COLUMN = "timestamp";
export const DIMENSION_START_TIMESTAMP_COLUMN = "start_timestamp";
export const DIMENSION_END_TIMESTAMP_COLUMN = "end_timestamp";

export const DIMENSION_NULL_LABEL_MAX_LENGTH = 100;

export function getDimensionNullValue(
  dimension: { nullLabel?: string },
  fallback: string,
): string {
  const label = dimension.nullLabel?.trim();
  return label ? label : fallback;
}

export function getDimensionTiming(dimension: {
  timing?: DimensionTiming;
}): DimensionTiming {
  return dimension.timing ?? "none";
}

export function isTimedDimension(dimension: {
  timing?: DimensionTiming;
}): boolean {
  return getDimensionTiming(dimension) !== "none";
}

export function getDimensionTimestampColumns(
  timing: DimensionTiming,
): string[] {
  switch (timing) {
    case "rowTimestamp":
      return [DIMENSION_TIMESTAMP_COLUMN];
    case "validityRange":
      return [DIMENSION_START_TIMESTAMP_COLUMN, DIMENSION_END_TIMESTAMP_COLUMN];
    case "none":
      return [];
  }
}

export function getDimensionRequiredColumns(dimension: {
  userIdType: string;
  timing?: DimensionTiming;
}): string[] {
  return [
    dimension.userIdType || "user_id",
    "value",
    ...getDimensionTimestampColumns(getDimensionTiming(dimension)),
  ];
}
