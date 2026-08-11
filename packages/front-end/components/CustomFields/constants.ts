import { CustomFieldSection } from "shared/types/custom-fields";

/** Section value → display label. Object.keys defines sort order for table and form. */
export const CUSTOM_FIELD_SECTION_LABELS: Record<CustomFieldSection, string> = {
  feature: "Features",
  experiment: "Experiments",
};

export function isCustomFieldBooleanTrue(value: unknown): boolean {
  return value === true || value === "true";
}

export function toCustomFieldBooleanString(value: boolean): string {
  return value ? "true" : "false";
}
