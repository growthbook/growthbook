import {
  CustomFieldSection,
  CustomFieldTypes,
} from "shared/types/custom-fields";
import {
  isCustomFieldTypeChangeSafe,
  getCustomFieldChangeWarning,
} from "shared/util";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { FeatureModel } from "back-end/src/models/FeatureModel";
import { ExperimentModel } from "back-end/src/models/ExperimentModel";

// Re-export shared utilities
export { isCustomFieldTypeChangeSafe, getCustomFieldChangeWarning };

/**
 * Migrate custom field values in features and experiments after a type change.
 * Migrates for each section the field applies to.
 */
export async function migrateCustomFieldValues(
  context: ReqContext | ApiReqContext,
  fieldId: string,
  sections: CustomFieldSection[],
  fromType: CustomFieldTypes,
  toType: CustomFieldTypes,
  fromValues?: string,
  toValues?: string,
) {
  for (const section of sections) {
    if (section === "feature") {
      const features = await FeatureModel.find({
        organization: context.org.id,
        [`customFields.${fieldId}`]: { $exists: true },
      });

      for (const feature of features) {
        const oldValue = feature.customFields?.[fieldId];
        if (oldValue === null || oldValue === undefined) continue;

        const newValue = convertCustomFieldValue(
          oldValue,
          fromType,
          toType,
          toValues,
        );

        if (newValue === null) {
          await FeatureModel.updateOne(
            { _id: feature._id },
            { $unset: { [`customFields.${fieldId}`]: "" } },
          );
        } else if (newValue !== oldValue) {
          await FeatureModel.updateOne(
            { _id: feature._id },
            { $set: { [`customFields.${fieldId}`]: newValue } },
          );
        }
      }
    } else if (section === "experiment") {
      const experiments = await ExperimentModel.find({
        organization: context.org.id,
        [`customFields.${fieldId}`]: { $exists: true },
      });

      for (const experiment of experiments) {
        const oldValue = experiment.customFields?.[fieldId];
        if (oldValue === null || oldValue === undefined) continue;

        const newValue = convertCustomFieldValue(
          oldValue,
          fromType,
          toType,
          toValues,
        );

        if (newValue === null) {
          await ExperimentModel.updateOne(
            { _id: experiment._id },
            { $unset: { [`customFields.${fieldId}`]: "" } },
          );
        } else if (newValue !== oldValue) {
          await ExperimentModel.updateOne(
            { _id: experiment._id },
            { $set: { [`customFields.${fieldId}`]: newValue } },
          );
        }
      }
    }
  }
}

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

  // String-like types
  const stringLikeTypes: CustomFieldTypes[] = [
    "text",
    "textarea",
    "markdown",
    "url",
  ];

  // No conversion needed
  if (fromType === toType) {
    // For enum/multiselect, validate against new options
    if ((toType === "enum" || toType === "multiselect") && toValues) {
      const validOptions = toValues.split(",").map((v) => v.trim());

      if (toType === "enum") {
        const strValue = String(value);
        return validOptions.includes(strValue) ? strValue : null;
      }

      if (toType === "multiselect" && Array.isArray(value)) {
        const filtered = value.filter((v) => validOptions.includes(String(v)));
        return filtered.length > 0 ? filtered : null;
      }
    }
    return value;
  }

  // enum ↔ multiselect conversions
  if (fromType === "enum" && toType === "multiselect") {
    // "Option A" → ["Option A"]
    const strValue = String(value);
    if (toValues) {
      const validOptions = toValues.split(",").map((v) => v.trim());
      return validOptions.includes(strValue) ? [strValue] : null;
    }
    return [strValue];
  }

  if (fromType === "multiselect" && toType === "enum") {
    // ["Option A"] → "Option A" (take first item if single, scrub if multiple)
    if (Array.isArray(value) && value.length === 1) {
      const strValue = String(value[0]);
      if (toValues) {
        const validOptions = toValues.split(",").map((v) => v.trim());
        return validOptions.includes(strValue) ? strValue : null;
      }
      return strValue;
    }
    return null; // Scrub if multiple values
  }

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

  // boolean → string-like
  if (fromType === "boolean" && stringLikeTypes.includes(toType)) {
    return value ? "true" : "false";
  }

  // boolean → number
  if (fromType === "boolean" && toType === "number") {
    return value ? 1 : 0;
  }

  // number → string-like
  if (fromType === "number" && stringLikeTypes.includes(toType)) {
    return String(value);
  }

  // number → boolean
  if (fromType === "number" && toType === "boolean") {
    if (value === 1) return true;
    if (value === 0) return false;
    return null; // Scrub if not 0 or 1
  }

  // string-like → boolean (conditional)
  if (stringLikeTypes.includes(fromType) && toType === "boolean") {
    const strValue = String(value).toLowerCase().trim();
    if (["true", "1", "yes", "on"].includes(strValue)) return true;
    if (["false", "0", "no", "off", ""].includes(strValue)) return false;
    return null; // Scrub if ambiguous
  }

  // string-like → number (conditional)
  if (stringLikeTypes.includes(fromType) && toType === "number") {
    const num = Number(value);
    return isNaN(num) ? null : num; // Scrub if not a valid number
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

  // string-like → enum: conditional (keep if in enum list, scrub otherwise)
  if (stringLikeTypes.includes(fromType) && toType === "enum" && toValues) {
    const validOptions = toValues.split(",").map((v) => v.trim());
    const strValue = String(value);
    return validOptions.includes(strValue) ? strValue : null;
  }

  // string-like → multiselect: conditional (convert to array if in options, scrub otherwise)
  if (
    stringLikeTypes.includes(fromType) &&
    toType === "multiselect" &&
    toValues
  ) {
    const validOptions = toValues.split(",").map((v) => v.trim());
    const strValue = String(value);
    return validOptions.includes(strValue) ? [strValue] : null;
  }

  // Unsafe conversion - scrub
  return null;
}
