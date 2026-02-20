import { validateCustomFieldsForSection } from "back-end/src/util/custom-fields";
import { ApiReqContext } from "back-end/types/api";

export const validateCustomFields = async (
  customFieldValues: Record<string, unknown> | undefined,
  context: ApiReqContext,
  project?: string,
) => {
  await validateCustomFieldsForSection({
    customFieldValues,
    customFieldsModel: context.models.customFields,
    section: "feature",
    project,
  });
};
