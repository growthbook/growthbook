import { CustomField, CustomFieldSection } from "shared/types/custom-fields";
import { useDefinitions } from "@/services/DefinitionsContext";

function normalizeProject(project: string | undefined) {
  // converts "" to undefined too
  const trimmedProject = (project ?? "").trim();
  return !trimmedProject ? undefined : trimmedProject;
}

export function useCustomFields() {
  const { customFields } = useDefinitions();
  return customFields;
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

export function applyCustomFieldDefaults(
  customFieldsDef: CustomField[] | undefined,
  currentValues: Record<string, string> = {},
  treatEmptyStringAsMissing: boolean = false,
): Record<string, string> {
  if (!customFieldsDef || customFieldsDef.length === 0) return currentValues;

  const merged = { ...currentValues };
  customFieldsDef.forEach((v) => {
    const currentValue = merged[v.id];
    const missingCurrentValue =
      currentValue === undefined ||
      currentValue === null ||
      (treatEmptyStringAsMissing && currentValue === "");

    const hasDefaultValue =
      v.defaultValue !== undefined &&
      v.defaultValue !== null &&
      (Array.isArray(v.defaultValue)
        ? v.defaultValue.length > 0
        : v.defaultValue !== "");

    if (missingCurrentValue && hasDefaultValue) {
      if (v.type === "multiselect") {
        merged[v.id] = Array.isArray(v.defaultValue)
          ? JSON.stringify(v.defaultValue)
          : JSON.stringify([v.defaultValue]);
      } else if (v.type === "boolean") {
        const normalizedDefault =
          typeof v.defaultValue === "boolean"
            ? v.defaultValue
            : String(v.defaultValue).toLowerCase() === "true";
        merged[v.id] = String(normalizedDefault);
      } else {
        merged[v.id] = String(v.defaultValue);
      }
    }
  });

  return merged;
}
