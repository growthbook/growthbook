import { CustomField, CustomFieldSection } from "shared/types/custom-fields";

function normalizeProject(project: string | undefined) {
  const trimmedProject = (project ?? "").trim();
  return !trimmedProject ? undefined : trimmedProject;
}

export function isCustomFieldBooleanTrue(value: unknown): boolean {
  return value === true || value === "true";
}

export function toCustomFieldBooleanString(value: boolean): string {
  return value ? "true" : "false";
}

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
 * Drops values for fields that no longer apply and seeds defaults for fields
 * with no entry. A present-but-empty value counts as set — re-seeding it would
 * make a field with a default impossible to clear.
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
    if (currentValue !== undefined) {
      reconciled[v.id] = currentValue;
      continue;
    }
    const seededDefault = getSeededCustomFieldDefaultValue(v);
    if (seededDefault !== undefined) {
      reconciled[v.id] = seededDefault;
    } else if (v.type === "boolean") {
      // Sent explicitly so an untouched toggle saves as false, not as absent.
      reconciled[v.id] = toCustomFieldBooleanString(false);
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

  if (!normalizedProject) {
    return normalizedCustomFields.filter((v) => v.projects.length === 0);
  }

  return normalizedCustomFields.filter((v) => {
    return v.projects.length === 0 || v.projects.includes(normalizedProject);
  });
}
