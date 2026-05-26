import { isEqual } from "lodash";
import { Revision } from "shared/enterprise";
import { validateCondition } from "shared/util";
import { updateSavedGroupValidator } from "shared/validators";
import { UpdateSavedGroupProps } from "shared/types/saved-group";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { validateListSize } from "back-end/src/routers/saved-group/saved-group.controller";
import { BadRequestError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import {
  buildPatchOps,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";

export const updateSavedGroup = createApiRequestHandler(
  updateSavedGroupValidator,
)(async (req) => {
  const { name, values, condition, owner, projects } = req.body;
  const bypassApproval = req.body.bypassApproval === true;

  const { id } = req.params;

  const savedGroup = await req.context.models.savedGroups.getById(id);

  if (!savedGroup) {
    throw new Error(`Unable to locate the saved-group: ${id}`);
  }

  if (
    !req.context.permissions.canUpdateSavedGroup(savedGroup, { ...req.body })
  ) {
    req.context.permissions.throwPermissionError();
  }

  // Sanity check to make sure arguments match the saved group type
  if (savedGroup.type === "condition" && values && values.length > 0) {
    throw new Error("Cannot specify values for condition groups");
  }
  if (savedGroup.type === "list" && condition && condition !== "{}") {
    throw new Error("Cannot specify a condition for list groups");
  }

  const fieldsToUpdate: UpdateSavedGroupProps = {};

  if (typeof name !== "undefined" && name !== savedGroup.groupName) {
    fieldsToUpdate.groupName = name;
  }
  if (typeof owner !== "undefined") {
    fieldsToUpdate.owner = owner;
  }
  if (
    savedGroup.type === "list" &&
    values &&
    !isEqual(values, savedGroup.values)
  ) {
    fieldsToUpdate.values = values;
    validateListSize(
      values,
      req.context.org.settings?.savedGroupSizeLimit,
      req.context.permissions.canBypassSavedGroupSizeLimit(projects),
    );
  }
  if (
    savedGroup.type === "condition" &&
    condition &&
    condition !== savedGroup.condition
  ) {
    const allSavedGroups = await req.context.models.savedGroups.getAll();
    const groupMap = new Map(allSavedGroups.map((sg) => [sg.id, sg]));
    // Include the updated condition in the groupMap for validation
    groupMap.set(savedGroup.id, {
      ...savedGroup,
      condition,
    });

    const conditionRes = validateCondition(condition, groupMap);
    if (!conditionRes.success) {
      throw new Error(conditionRes.error);
    }
    if (conditionRes.empty) {
      throw new Error("Condition cannot be empty");
    }

    fieldsToUpdate.condition = condition;
  }
  if (!isEqual(savedGroup.projects, projects)) {
    if (projects) {
      await req.context.models.projects.ensureProjectsExist(projects);
    }
    fieldsToUpdate.projects = projects;
  }

  // If there are no changes, return early
  if (Object.keys(fieldsToUpdate).length === 0) {
    return {
      savedGroup: await resolveOwnerEmail(
        req.context.models.savedGroups.toApiInterface(savedGroup),
        req.context,
      ),
    };
  }

  const adapter = getAdapter("saved-group");

  // Build the patch ops up front so the approval gate can honour the
  // saved-group adapter's metadata-only shortcut (`requireMetadataReview`),
  // matching POST .../revisions/{version}/publish. Without this, a
  // metadata-only change (name/owner/description) in an org that exempts
  // metadata from review would be blocked here even though publishing the
  // same change via a revision would be allowed.
  const patchOps = buildPatchOps(fieldsToUpdate as Record<string, unknown>);
  const approvalRequired = adapter.isApprovalRequiredForRevision
    ? adapter.isApprovalRequiredForRevision(req.context, {
        target: { proposedChanges: patchOps },
      } as unknown as Revision)
    : adapter.isApprovalRequired(req.context);

  if (approvalRequired) {
    if (!bypassApproval) {
      throw new BadRequestError(
        "This organization requires approvals on saved groups. " +
          `Use \`POST /saved-groups/${savedGroup.id}/revisions\` to open a draft, ` +
          'or pass `{ "bypassApproval": true }` if you have the `bypassApprovalChecks` permission.',
      );
    }
    // Scope the bypass permission to the *existing* group's projects so a
    // `projects` move can't be paired with bypass-merge to launder a permission gap.
    const canBypass =
      !!req.organization.settings?.restApiBypassesReviews ||
      adapter.canBypassApproval(
        req.context,
        savedGroup as Parameters<typeof adapter.canBypassApproval>[1],
      );
    if (!canBypass) {
      req.context.permissions.throwPermissionError();
    }

    // Route the bypass change through the revision system so the action lands
    // in `Revision.activityLog`.
    await ensureLiveRevisionExists(
      req.context,
      "saved-group",
      savedGroup as unknown as Record<string, unknown> & {
        id: string;
        owner?: string;
        dateCreated?: Date;
      },
    );

    // Persist the live change first, then record it as a single already-merged
    // revision. A draft-then-merge would be two non-transactional writes: if
    // the merge failed after the update landed, the draft would be stranded
    // and could never be published ("no changes detected" against the
    // now-updated live entity). Updating first also matches the precedence in
    // revision.controller.ts — persisting the real change takes priority over
    // revision bookkeeping.
    const updatedSavedGroup = await req.context.models.savedGroups.update(
      savedGroup,
      fieldsToUpdate,
    );
    await req.context.models.revisions.createMerged({
      type: "saved-group",
      id: savedGroup.id,
      snapshot: savedGroup as unknown as Record<string, unknown>,
      proposedChanges: patchOps,
      bypass: true,
    });

    return {
      savedGroup: await resolveOwnerEmail(
        req.context.models.savedGroups.toApiInterface({
          ...savedGroup,
          ...updatedSavedGroup,
        }),
        req.context,
      ),
    };
  }

  const updatedSavedGroup = await req.context.models.savedGroups.update(
    savedGroup,
    fieldsToUpdate,
  );

  const merged = { ...savedGroup, ...updatedSavedGroup };
  return {
    savedGroup: await resolveOwnerEmail(
      req.context.models.savedGroups.toApiInterface(merged),
      req.context,
    ),
  };
});
