import isEqual from "lodash/isEqual";
import omit from "lodash/omit";
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

// `orgCustomFields` is every field on the org, used only to explain why a key
// isn't usable here: deleted vs. disabled vs. out of scope.
export function validateCustomFieldValues(
  customFields: CustomField[],
  customFieldValues: Record<string, unknown>,
  orgCustomFields: CustomField[],
): void {
  // Ensure all custom fields being passed in, are valid keys
  const validKeys = new Set(customFields.map((v) => v.id));
  for (const key of Object.keys(customFieldValues)) {
    if (!validKeys.has(key)) {
      const field = orgCustomFields.find((f) => f.id === key);
      // Disabled is the one reason with a remedy that keeps the value.
      const reason = !field
        ? "It does not exist and may have been deleted. Remove it from this record's customFields to save changes."
        : field.active === false
          ? "It is disabled. Re-enable it to keep this value, or remove it from this record's customFields to save changes."
          : "It is not available for this record's project or section. Remove it from this record's customFields to save changes.";
      throw new Error(`Invalid custom field: ${key}. ${reason}`);
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

export type CustomFieldValidationResult<T> = {
  // `customFieldValues` with the keys in `prunedKeys` dropped. Persist it
  // whenever `prunedKeys` is non-empty so the record stops carrying dead keys.
  customFieldValues: Record<string, T>;
  prunedKeys: string[];
};

// A key whose field no longer exists on the org is dropped instead of rejected:
// the definition is gone, so the value is unrecoverable and would otherwise
// block every write to the record. Only values the record already carries are
// dropped — a newly supplied unknown key stays a client error. Keys whose field
// does exist but isn't usable here (disabled, another project or section) also
// still throw, since that state is reversible and the value still means
// something.
function pruneDeletedCustomFieldValues<T>({
  customFieldValues,
  existingCustomFieldValues,
  orgCustomFields,
}: {
  customFieldValues: Record<string, T>;
  existingCustomFieldValues: Record<string, unknown> | undefined;
  orgCustomFields: CustomField[];
}): CustomFieldValidationResult<T> {
  const definedKeys = new Set(orgCustomFields.map((f) => f.id));
  const prunedKeys = Object.keys(customFieldValues).filter(
    (key) =>
      !definedKeys.has(key) &&
      !!existingCustomFieldValues &&
      key in existingCustomFieldValues &&
      isEqual(customFieldValues[key], existingCustomFieldValues[key]),
  );

  return {
    customFieldValues: prunedKeys.length
      ? omit(customFieldValues, prunedKeys)
      : customFieldValues,
    prunedKeys,
  };
}

// Helper that fetches the required customfields to validate against. Pass
// `existingCustomFieldValues` on updates so values orphaned by a deleted field
// heal instead of blocking the write.
export async function validateCustomFieldsForSection<T>({
  customFieldValues,
  existingCustomFieldValues,
  project,
  section,
  customFieldsModel,
}: {
  customFieldValues: Record<string, T> | undefined;
  existingCustomFieldValues?: Record<string, unknown>;
  project: string | undefined;
  section: CustomFieldSection;
  customFieldsModel: CustomFieldModel;
}): Promise<CustomFieldValidationResult<T>> {
  const applicableCustomFields =
    (await customFieldsModel.getCustomFieldsBySectionAndProject({
      section,
      project,
    })) ?? [];
  // Only keys that aren't applicable here need the org-wide list, to tell a
  // deleted field from one that is merely disabled or out of scope. Skip that
  // read entirely when every key checks out, which is the common case.
  const applicableIds = new Set(applicableCustomFields.map((f) => f.id));
  const hasUnknownKey = Object.keys(customFieldValues ?? {}).some(
    (key) => !applicableIds.has(key),
  );
  const orgCustomFields = hasUnknownKey
    ? ((await customFieldsModel.getCustomFields())?.fields ?? [])
    : applicableCustomFields;

  const result = pruneDeletedCustomFieldValues({
    customFieldValues: customFieldValues ?? {},
    existingCustomFieldValues,
    orgCustomFields,
  });

  validateCustomFieldValues(
    applicableCustomFields,
    result.customFieldValues,
    orgCustomFields,
  );

  return result;
}
