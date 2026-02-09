import { CustomFieldTypes } from "shared/types/custom-fields";
import {
  isCustomFieldTypeChangeSafe,
  getCustomFieldChangeWarning,
} from "shared/util";

// Re-export shared utilities
export { isCustomFieldTypeChangeSafe, getCustomFieldChangeWarning };

/**
 * Convert a value from one custom field type to another
 * Returns null if conversion is not possible (value should be scrubbed)
 */
export function convertCustomFieldValue(
  value: unknown,
  fromType: CustomFieldTypes,
  toType: CustomFieldTypes,
  toValues?: string, // enum/multiselect options for validation
): unknown | null {
  if (value === null || value === undefined) {
    return null;
  }

  // No conversion needed
  if (fromType === toType) {
    // For enum/multiselect, validate against new options
    if ((toType === "enum" || toType === "multiselect") && toValues) {
      const validOptions = toValues.split(",").map((v) => v.trim());

      if (toType === "enum" && typeof value === "string") {
        return validOptions.includes(value) ? value : null;
      }

      if (toType === "multiselect" && Array.isArray(value)) {
        const filtered = value.filter((v) => validOptions.includes(String(v)));
        return filtered.length > 0 ? filtered : null;
      }
    }
    return value;
  }

  // String-like conversions
  const stringLikeTypes: CustomFieldTypes[] = [
    "text",
    "textarea",
    "markdown",
    "url",
  ];

  // enum → string-like
  if (fromType === "enum" && stringLikeTypes.includes(toType)) {
    return String(value);
  }

  // multiselect → string-like (join with commas)
  if (fromType === "multiselect" && stringLikeTypes.includes(toType)) {
    if (Array.isArray(value)) {
      return value.join(", ");
    }
    return String(value);
  }

  // boolean → string
  if (fromType === "boolean" && stringLikeTypes.includes(toType)) {
    return value ? "true" : "false";
  }

  // number → string
  if (fromType === "number" && stringLikeTypes.includes(toType)) {
    return String(value);
  }

  // date/datetime conversions
  if (fromType === "date" && toType === "datetime") {
    return value; // ISO date string works for both
  }
  if (fromType === "datetime" && toType === "date") {
    // Extract just the date part
    const dateStr = String(value);
    return dateStr.split("T")[0];
  }
  if (
    (fromType === "date" || fromType === "datetime") &&
    stringLikeTypes.includes(toType)
  ) {
    return String(value);
  }

  // String types to each other
  if (stringLikeTypes.includes(fromType) && stringLikeTypes.includes(toType)) {
    return String(value);
  }

  // string → enum: conditional (keep if in enum list, scrub otherwise)
  if (stringLikeTypes.includes(fromType) && toType === "enum" && toValues) {
    const validOptions = toValues.split(",").map((v) => v.trim());
    const strValue = String(value);
    return validOptions.includes(strValue) ? strValue : null;
  }

  // Unsafe conversion - scrub
  return null;
}
