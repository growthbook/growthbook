import {
  ID_LIST_DATATYPES,
  validateCondition,
  isSavedGroupCyclic,
} from "shared/util";
import { PostSavedGroupResponse } from "back-end/types/openapi";
import {
  createSavedGroup,
  toSavedGroupApiInterface,
  getAllSavedGroups,
} from "back-end/src/models/SavedGroupModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { postSavedGroupValidator } from "back-end/src/validators/openapi";
import { validateListSize } from "back-end/src/routers/saved-group/saved-group.controller";
import { getSavedGroupMap } from "back-end/src/services/features";
import { getParsedCondition } from "back-end/src/util/features";
import { SavedGroupTargeting } from "back-end/types/feature";

export const postSavedGroup = createApiRequestHandler(postSavedGroupValidator)(
  async (req): Promise<PostSavedGroupResponse> => {
    // TODO: Update OpenAPI schema to include savedGroups field
    const { name, attributeKey, values, condition, owner, projects, savedGroups } = req.body as typeof req.body & { savedGroups?: SavedGroupTargeting[] };

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
          "Cannot specify attributeKey or values for condition groups",
        );
      }

      // Get all saved groups for cycle detection
      const allSavedGroups = await getAllSavedGroups(req.organization.id);
      const groupMap = await getSavedGroupMap(req.organization, allSavedGroups);

      // Validate condition if provided
      if (condition) {
        const conditionRes = validateCondition(condition);
        if (!conditionRes.success) {
          throw new Error(conditionRes.error);
        }
        // Allow empty condition if savedGroups is provided
        if (conditionRes.empty && (!savedGroups || savedGroups.length === 0)) {
          throw new Error("Either condition or saved group targeting must be specified");
        }
      }

      // Must have either condition or savedGroups
      const hasCondition = condition && condition !== "{}";
      const hasSavedGroups = savedGroups && savedGroups.length > 0;
      if (!hasCondition && !hasSavedGroups) {
        throw new Error("Either condition or saved group targeting must be specified");
      }

      // Check for circular references (check combined condition for cycle detection)
      const combinedCondition = getParsedCondition(
        groupMap,
        condition,
        savedGroups,
      );
      if (combinedCondition) {
        const conditionString = JSON.stringify(combinedCondition);
        const [isCyclic, cyclicGroupId] = isSavedGroupCyclic(
          undefined, // New group, ID not assigned yet
          conditionString,
          groupMap,
          undefined,
          savedGroups,
        );
        if (isCyclic) {
          throw new Error(
            `This saved group creates a circular reference${cyclicGroupId ? ` (cycle includes group: ${cyclicGroupId})` : ""}`,
          );
        }
      }
    }
    // If this is a list group, make sure the attributeKey is specified
    else if (type === "list") {
      if (!attributeKey || !values) {
        throw new Error(
          "Must specify an attributeKey and values for list groups",
        );
      }
      const attributeSchema = req.organization.settings?.attributeSchema || [];
      const datatype = attributeSchema.find(
        (sdkAttr) => sdkAttr.property === attributeKey,
      )?.datatype;
      if (!datatype) {
        throw new Error("Unknown attributeKey");
      }
      if (!ID_LIST_DATATYPES.includes(datatype)) {
        throw new Error(
          "Cannot create an ID List for the given attribute key. Try using a Condition Group instead.",
        );
      }
      if (condition) {
        throw new Error("Cannot specify a condition for list groups");
      }
      validateListSize(
        values,
        req.context.org.settings?.savedGroupSizeLimit,
        req.context.permissions.canBypassSavedGroupSizeLimit(projects),
      );
    } else {
      throw new Error("Must specify a saved group type");
    }

    // Store condition and savedGroups separately (don't combine on save)
    const savedGroup = await createSavedGroup(req.organization.id, {
      type: type,
      values: values || [],
      groupName: name,
      owner: owner || "",
      condition: condition || undefined,
      attributeKey,
      projects,
      savedGroups: type === "condition" ? savedGroups : undefined,
    });

    return {
      savedGroup: toSavedGroupApiInterface(savedGroup),
    };
  },
);
