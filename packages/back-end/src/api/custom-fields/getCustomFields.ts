import { createApiRequestHandler } from "back-end/src/util/handler";
import { getCustomFieldsValidator } from "back-end/src/validators/openapi";
import { GetCustomFieldsResponse } from "back-end/types/openapi";

export const getCustomFields = createApiRequestHandler(
  getCustomFieldsValidator,
)(async (req): Promise<GetCustomFieldsResponse> => {
  const customFields = await req.context.models.customFields.getCustomFields();

  const projectId = req.query.projectId;
  if (!projectId) {
    return (
      customFields?.fields.map((f) => {
        return {
          id: f.id,
          name: f.name,
          type: f.type,
          section: f.section,
          values: f.values,
          dateCreated: f.dateCreated.toISOString(),
          dateUpdated: f.dateUpdated.toISOString(),
          active: f.active ?? true,
          required: f.required,
          projects: f.projects?.filter((p) => p !== ""),
        };
      }) ?? []
    );
  }

  const filteredCustomFields = customFields?.fields.filter(
    (f) =>
      f.projects?.includes(projectId) ||
      f.projects?.[0] === "" ||
      f.projects?.length === 0,
  );

  return (
    filteredCustomFields?.map((f) => {
      return {
        id: f.id,
        name: f.name,
        type: f.type,
        section: f.section,
        values: f.values,
        dateCreated: f.dateCreated.toISOString(),
        dateUpdated: f.dateUpdated.toISOString(),
        active: f.active ?? true,
        required: f.required,
        projects: f.projects?.filter((p) => p !== ""),
      };
    }) ?? []
  );
});
