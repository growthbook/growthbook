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
    (v) => v.section === section,
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
