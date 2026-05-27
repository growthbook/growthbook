import { ID_LIST_DATATYPES, validateCondition } from "shared/util";
import { postSavedGroupValidator } from "shared/validators";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { validateListSize } from "back-end/src/routers/saved-group/saved-group.controller";
import { BadRequestError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";

export const postSavedGroup = createApiRequestHandler(postSavedGroupValidator)(
  async (req) => {
    const { name, attributeKey, values, condition, owner, projects } = req.body;
    const bypassApproval = req.body.bypassApproval === true;

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

    // Approval-flow gate. There's no existing entity to draft against on
    // create, so the only valid bypass path is "publish now with bypass + the
    // bypass permission". Without bypass we redirect to the revision flow
    // (which is currently UI-only — REST callers can manage drafts on an
    // existing saved group via /saved-groups/:id/revisions/...).
    const adapter = getAdapter("saved-group");
    const approvalRequired = adapter.isApprovalRequired(req.context);
    if (approvalRequired) {
      if (!bypassApproval) {
        throw new BadRequestError(
          "This organization requires approvals on saved groups. " +
            "Use the GrowthBook UI to create a saved group through the approval flow, " +
            'or pass `{ "bypassApproval": true }` if you have the `bypassApprovalChecks` permission on every target project.',
        );
      }
      // Scope the bypass permission to the *target* projects so a caller with
      // bypass in some projects can't create one in projects they can't bypass.
      const canBypass =
        !!req.organization.settings?.restApiBypassesReviews ||
        adapter.canBypassApproval(req.context, {
          projects: projects ?? [],
        } as Parameters<typeof adapter.canBypassApproval>[1]);
      if (!canBypass) {
        req.context.permissions.throwPermissionError();
      }
    }

    // If this is a condition group, make sure the condition is valid and not empty
    if (type === "condition") {
      if (attributeKey || values) {
        throw new Error(
          "Cannot specify attributeKey or values for condition groups",
        );
      }

      // Validate condition
      const allSavedGroups = await req.context.models.savedGroups.getAll();
      const groupMap = new Map(allSavedGroups.map((sg) => [sg.id, sg]));
      const conditionRes = validateCondition(condition, groupMap);
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

    const savedGroup = await req.context.models.savedGroups.create({
      type: type,
      values: values || [],
      groupName: name,
      owner: owner || "",
      condition: condition || "",
      attributeKey,
      projects,
    });

    return {
      savedGroup: await resolveOwnerEmail(
        req.context.models.savedGroups.toApiInterface(savedGroup),
        req.context,
      ),
    };
  },
);
