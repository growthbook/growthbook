import { CustomField } from "shared/types/custom-fields";

const isEmptyValue = (value: string, type: CustomField["type"]): boolean => {
  if (!value || value.trim() === "") {
    return true;
  }

  if (type === "multiselect" && value.trim() === "[]") {
    return true;
  }

  return false;
};

export const validateCustomFieldValue = (
  customField: CustomField,
  value: string,
) => {
  if (customField.required && isEmptyValue(value, customField.type)) {
    throw new Error(`Custom field "${customField.name}" is required.`);
  }

  if (customField.type === "boolean") {
    if (value !== "true" && value !== "false") {
      throw new Error(
        `Invalid custom field value for boolean field ${customField.id}: ${value}. Valid values are: true, false`,
      );
    }
  }
  if (customField.type === "multiselect" || customField.type === "enum") {
    const fieldValues = value.split(",").map((v) => v.trim());
    if (customField.type === "enum" && fieldValues.length > 1) {
      throw new Error(
        `Invalid custom field value for enum field ${customField.id}: ${value}. Only one value is allowed for enum fields.`,
      );
    }
    const possibleValues = customField.values
      ? customField.values.split(",").map((v) => v.trim())
      : [];
    fieldValues.forEach((v) => {
      if (!possibleValues.includes(v)) {
        throw new Error(
          `Invalid custom field value for ${customField.type} field ${customField.id}: ${v}. Valid values are: ${customField.values}`,
        );
      }
    });
  }
  if (customField.type === "date") {
    if (isNaN(new Date(value).getTime())) {
      throw new Error(
        `Invalid custom field value for date field ${customField.id}: ${value}. Valid values are: ISO 8601 formatted dates. i.e. 2025-01-01.`,
      );
    }
  }
};

export const validateCustomFieldValues = (
  customFields: CustomField[],
  customFieldValues: Record<string, string>,
) => {
  for (const customField of customFields) {
    if (!(customField.id in customFieldValues)) {
      if (customField.required) {
        throw new Error(`Custom field "${customField.name}" is required.`);
      }
      continue;
    }
    validateCustomFieldValue(customField, customFieldValues[customField.id]);
  }
};
