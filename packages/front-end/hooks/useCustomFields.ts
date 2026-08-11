import { CustomField, CustomFieldSection } from "shared/types/custom-fields";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  isCustomFieldBooleanTrue,
  toCustomFieldBooleanString,
} from "@/components/CustomFields/constants";

function normalizeProject(project: string | undefined) {
  // converts "" to undefined too
  const trimmedProject = (project ?? "").trim();
  return !trimmedProject ? undefined : trimmedProject;
}

export function useCustomFields() {
  const { customFields } = useDefinitions();
  return customFields;
}

/**
 * Coerce stored/API custom-field values into the string map the form uses.
 * Handles the legacy case where values arrive as a JSON string (e.g. when
 * duplicating an experiment).
 */
export function normalizeCustomFieldValues(
  values: Record<string, unknown> | string | null | undefined,
): Record<string, string> {
  let fields: Record<string, unknown>;
  if (typeof values === "string") {
    try {
      fields = JSON.parse(values);
    } catch {
      fields = {};
    }
  } else {
    fields = values ?? {};
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "boolean") {
      normalized[key] = toCustomFieldBooleanString(value);
    } else if (value === undefined || value === null) {
      normalized[key] = "";
    } else {
      normalized[key] = String(value);
    }
  }
  return normalized;
}

/**
 * The stored string value to seed for a field that has no value yet, or
 * `undefined` when the field has no configured default (leave it unset).
 */
export function getSeededCustomFieldDefaultValue(
  field: CustomField,
): string | undefined {
  const { defaultValue } = field;
  const hasDefaultValue =
    defaultValue !== undefined &&
    defaultValue !== null &&
    (Array.isArray(defaultValue)
      ? defaultValue.length > 0
      : defaultValue !== "");
  if (!hasDefaultValue) return undefined;

  if (field.type === "multiselect") {
    return Array.isArray(defaultValue)
      ? JSON.stringify(defaultValue)
      : JSON.stringify([defaultValue]);
  }
  if (field.type === "boolean") {
    return toCustomFieldBooleanString(isCustomFieldBooleanTrue(defaultValue));
  }
  return String(defaultValue);
}

/**
 * Reconcile stored values against the fields that currently apply: normalize
 * inputs, drop values for fields that no longer apply (e.g. after a project
 * change), and seed configured defaults for fields without a value yet.
 */
export function reconcileCustomFieldValues(
  availableFields: CustomField[] | undefined,
  currentValues: Record<string, unknown> | string | null | undefined,
): Record<string, string> {
  const normalized = normalizeCustomFieldValues(currentValues);
  const reconciled: Record<string, string> = {};
  if (!availableFields) return reconciled;

  for (const v of availableFields) {
    const currentValue = normalized[v.id];
    // "false" is a real value; only "" / missing counts as unset
    if (currentValue !== undefined && currentValue !== "") {
      reconciled[v.id] = currentValue;
      continue;
    }
    const seededDefault = getSeededCustomFieldDefaultValue(v);
    if (seededDefault !== undefined) {
      reconciled[v.id] = seededDefault;
    } else if (v.type === "boolean") {
      // Booleans always serialize explicitly, so unchecked saves as "false"
      reconciled[v.id] = "false";
    }
  }
  return reconciled;
}

export function customFieldValuesEqual(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

export function filterCustomFieldsForSectionAndProject(
  customFields: CustomField[] | undefined,
  section: CustomFieldSection,
  project: string | undefined,
) {
  const filteredCustomFields = customFields?.filter(
    (v) => v.active !== false && v.sections?.includes(section),
  );
  if (!filteredCustomFields || filteredCustomFields.length === 0) {
    return filteredCustomFields;
  }

  const normalizedProject = normalizeProject(project);
  const normalizedCustomFields = filteredCustomFields.map((v) => ({
    ...v,
    projects: (v.projects ?? []).map((p) => p.trim()).filter(Boolean),
  }));

  // if no selected project, show only globally available custom fields
  if (!normalizedProject) {
    return normalizedCustomFields.filter((v) => v.projects.length === 0);
  }

  // if selected project: show global fields + project scoped fields.
  return normalizedCustomFields.filter((v) => {
    return v.projects.length === 0 || v.projects.includes(normalizedProject);
  });
}
