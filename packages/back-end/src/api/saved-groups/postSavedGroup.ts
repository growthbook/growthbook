import { ID_LIST_DATATYPES, validateCondition } from "shared/util";
import { PostSavedGroupResponse } from "back-end/types/openapi";
import {
  createSavedGroup,
  toSavedGroupApiInterface,
} from "back-end/src/models/SavedGroupModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { postSavedGroupValidator } from "back-end/src/validators/openapi";

export const postSavedGroup = createApiRequestHandler(postSavedGroupValidator)(
  async (req): Promise<PostSavedGroupResponse> => {
    const { name, attributeKey, values, condition, owner, projects } = req.body;

    if (!req.context.permissions.canCreateSavedGroup({ ...req.body })) {
      req.context.permissions.throwPermissionError();
    }

    if (projects) {
      await req.context.models.projects.ensureProjectsExist(projects);
    }

    let { type } = req.body;

    // Infer type from arguments if not specified
    if (!type) {
      if (condition) {
        type = "condition";
      } else if (attributeKey && values) {
        type = "list";
      }
    }

    // If this is a condition group, make sure the condition is valid and not empty
    if (type === "condition") {
      if (attributeKey || values) {
        throw new Error(
          "Cannot specify attributeKey or values for condition groups"
        );
      }

      const conditionRes = validateCondition(condition);
      if (!conditionRes.success) {
        throw new Error(conditionRes.error);
      }
      if (conditionRes.empty) {
        throw new Error("Condition cannot be empty");
      }
    }
    // If this is a list group, make sure the attributeKey is specified
    else if (type === "list") {
      if (!attributeKey || !values) {
        throw new Error(
          "Must specify an attributeKey and values for list groups"
        );
      }
      const attributeSchema = req.organization.settings?.attributeSchema || [];
      const datatype = attributeSchema.find(
        (sdkAttr) => sdkAttr.property === attributeKey
      )?.datatype;
      if (!datatype) {
        throw new Error("Unknown attributeKey");
      }
      if (!ID_LIST_DATATYPES.includes(datatype)) {
        throw new Error(
          "Cannot create an ID List for the given attribute key. Try using a Condition Group instead."
        );
      }
      if (condition) {
        throw new Error("Cannot specify a condition for list groups");
      }
    } else {
      throw new Error("Must specify a saved group type");
    }

    const savedGroup = await createSavedGroup(req.organization.id, {
      type: type,
      values: values || [],
      groupName: name,
      owner: owner || "",
      condition: condition || "",
      attributeKey,
      projects,
    });

    return {
      savedGroup: toSavedGroupApiInterface(savedGroup),
    };
  }
);
