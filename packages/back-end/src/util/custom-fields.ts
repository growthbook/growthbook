import isEqual from "lodash/isEqual";
import { CustomField, CustomFieldSection } from "shared/types/custom-fields";
import { CustomFieldModel } from "back-end/src/models/CustomFieldModel";

function isEmptyValue(value: unknown, type: CustomField["type"]): boolean {
  if (type === "enum" || type === "multiselect") {
    return parseSelectFieldValues(value, type).length === 0;
  }

  if (value === null || value === undefined) {
    return true;
  }

  return toStringValue(value).trim() === "";
}

function toStringValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function parseSelectFieldValues(
  value: unknown,
  type: "enum" | "multiselect",
): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => toStringValue(v).trim()).filter(Boolean);
  }

  const strValue = toStringValue(value).trim();
  if (!strValue) return [];

  if (strValue.startsWith("[") && strValue.endsWith("]")) {
    try {
      const parsed = JSON.parse(strValue);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => toStringValue(v).trim()).filter(Boolean);
      }
    } catch {
      // Ignore parse errors and fall through to string parsing.
    }
  }

  if (type === "enum") {
    return [strValue];
  }

  // Parse csv style input into array
  return strValue
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function validateSingleCustomFieldValue(
  customField: CustomField,
  value: unknown,
): void {
  if (customField.required && isEmptyValue(value, customField.type)) {
    throw new Error(`Custom field "${customField.id}" is required.`);
  }

  // Skip type-specific checks for optional empty values
  if (isEmptyValue(value, customField.type)) {
    return;
  }

  if (customField.type === "boolean") {
    const normalizedValue = (
      typeof value === "boolean" ? String(value) : toStringValue(value)
    ).trim();
    if (normalizedValue !== "true" && normalizedValue !== "false") {
      throw new Error(
        `Invalid boolean value for custom field ${customField.id} (${normalizedValue}). Valid values are: true, false`,
      );
    }
  }

  if (customField.type === "multiselect" || customField.type === "enum") {
    const fieldValues = parseSelectFieldValues(value, customField.type);
    if (customField.type === "enum" && fieldValues.length > 1) {
      throw new Error(
        `Invalid enum value for custom field ${customField.id} (${toStringValue(value)}). Only one value is allowed for enum fields.`,
      );
    }
    const possibleValues = customField.values
      ? customField.values
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
      : [];

    fieldValues.forEach((v) => {
      if (!possibleValues.includes(v)) {
        throw new Error(
          `Invalid ${customField.type} value for custom field ${customField.id} (${v}). Valid values are: ${customField.values}`,
        );
      }
    });
  }

  if (customField.type === "date" || customField.type === "datetime") {
    const normalizedValue = toStringValue(value).trim();
    if (isNaN(new Date(normalizedValue).getTime())) {
      throw new Error(
        `Invalid ${customField.type} value for custom field ${customField.id} (${normalizedValue}). Valid values are: ISO 8601 formatted dates.`,
      );
    }
  }

  if (customField.type === "number") {
    const normalizedValue = toStringValue(value).trim();
    const parsedValue = Number(normalizedValue);
    if (!Number.isFinite(parsedValue)) {
      throw new Error(
        `Invalid number value for custom field ${customField.id} (${normalizedValue}).`,
      );
    }
  }

  if (customField.type === "url") {
    const normalizedValue = toStringValue(value).trim();
    try {
      new URL(normalizedValue);
    } catch {
      throw new Error(
        `Invalid url value for custom field ${customField.id} (${normalizedValue}).`,
      );
    }
  }
}

export function validateCustomFieldValues(
  customFields: CustomField[],
  customFieldValues: Record<string, unknown>,
): void {
  if (customFields.length === 0) {
    if (customFieldValues && Object.keys(customFieldValues).length > 0) {
      throw new Error(`No custom fields are available to be defined.`);
    }

    // No custom fields defined + no fields being passed in = success
    return;
  }

  // Ensure all custom fields being passed in, are valid keys
  const validKeys = new Set(customFields.map((v) => v.id));
  for (const key of Object.keys(customFieldValues)) {
    if (!validKeys.has(key)) {
      throw new Error(
        `Invalid custom field: ${key}. This custom field does not exist.`,
      );
    }
  }

  for (const customField of customFields) {
    if (!(customField.id in customFieldValues)) {
      if (customField.required) {
        throw new Error(`Custom field "${customField.name}" is required.`);
      }

      // If not required, no need to validate it if it is not being provided
      continue;
    }

    validateSingleCustomFieldValue(
      customField,
      customFieldValues[customField.id],
    );
  }
}

export function shouldValidateCustomFieldsOnUpdate({
  existingCustomFieldValues,
  updatedCustomFieldValues,
}: {
  existingCustomFieldValues?: Record<string, unknown>;
  updatedCustomFieldValues?: Record<string, unknown>;
}): boolean {
  if (updatedCustomFieldValues === undefined) {
    return false;
  }

  return !isEqual(updatedCustomFieldValues, existingCustomFieldValues ?? {});
}

// Helper that fetches the required customfields to validate against
export async function validateCustomFieldsForSection({
  customFieldValues,
  project,
  section,
  customFieldsModel,
}: {
  customFieldValues: Record<string, unknown> | undefined;
  project: string | undefined;
  section: CustomFieldSection;
  customFieldsModel: CustomFieldModel;
}): Promise<void> {
  const applicableCustomFields =
    (await customFieldsModel.getCustomFieldsBySectionAndProject({
      section,
      project,
    })) ?? [];

  validateCustomFieldValues(applicableCustomFields, customFieldValues ?? {});
}
