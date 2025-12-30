import { validateCustomFieldValues } from "back-end/src/util/custom-fields";
import { ApiReqContext } from "back-end/types/api";

export const validateCustomFields = async (
  customFieldValues: Record<string, string>,
  context: ApiReqContext,
  project?: string,
) => {
  const validCustomFields =
    await context.models.customFields.getCustomFieldsBySectionAndProject({
      section: "experiment",
      project,
    });
  if (!validCustomFields || validCustomFields.length === 0) {
    throw new Error("No custom fields are available for this experiment.");
  }
  // Make sure all the customFieldValues keys are valid custom field ids
  const validKeys = new Set(validCustomFields.map((v) => v.id));
  for (const [key] of Object.entries(customFieldValues)) {
    if (!validKeys.has(key)) {
      throw new Error(
        `Invalid custom field key: ${key}. Valid keys are: ${Array.from(validKeys).join(", ")}`,
      );
    }
  }

  validateCustomFieldValues(validCustomFields, customFieldValues);
};
