import { CustomField, CustomFieldSection } from "shared/types/custom-fields";
import { useDefinitions } from "@/services/DefinitionsContext";

export function useCustomFields() {
  const { customFields } = useDefinitions();
  return customFields;
}

export function filterCustomFieldsForSectionAndProject(
  customFields: CustomField[] | undefined,
  section: CustomFieldSection,
  project: string | undefined,
) {
  // for the moment, an experiment is in none/all projects, project scoped custom fields will not be available to it.
  // if (!project) {
  //   return customFields;
  // }
  const filteredCustomFields = customFields?.filter(
    (v) => v.section === section,
  );
  if (!filteredCustomFields || filteredCustomFields.length === 0 || !project) {
    return filteredCustomFields;
  }
  return filteredCustomFields.filter((v) => {
    if (v.projects && v.projects.length && v.projects[0] !== "") {
      let matched = false;
      v.projects.forEach((p) => {
        if (p === project) {
          matched = true;
        }
      });
      return matched;
    }
    return true;
  });
}
