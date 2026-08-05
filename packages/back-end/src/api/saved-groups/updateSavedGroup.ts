import { isEqual } from "lodash";
import { Revision } from "shared/enterprise";
import { validateCondition } from "shared/util";
import { updateSavedGroupValidator } from "shared/validators";
import { UpdateSavedGroupProps } from "shared/types/saved-group";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import { landDirectChange } from "back-end/src/revisions/revertActions";
import { runGuardedWrite } from "back-end/src/revisions/landingSequence";
import { holdsMoveDestination } from "back-end/src/revisions/moveAuthority";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { validateListSize } from "back-end/src/routers/saved-group/saved-group.controller";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import {
  buildPatchOps,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { dispatchSavedGroupRevisionEvent } from "back-end/src/services/savedGroupRevisionEvents";

export const updateSavedGroup = createApiRequestHandler(
  updateSavedGroupValidator,
)(async (req) => {
  const { name, values, condition, owner, projects } = req.body;
  const bypassApproval = req.body.bypassApproval === true;

  const { id } = req.params;

  const savedGroup = await req.context.models.savedGroups.getById(id);

  if (!savedGroup) {
    throw new NotFoundError(`Unable to locate the saved-group: ${id}`);
  }

  // Authoring gate; the landing gate is below. A move is checked on both sides
  // — you need authoring rights in the projects you're taking it out of and the
  // ones you're putting it into.
  if (
    !req.context.permissions.canRevisionAction(
      "saved-group",
      "draft",
      savedGroup,
    ) ||
    !req.context.permissions.canRevisionAction("saved-group", "draft", {
      projects: req.body.projects ?? savedGroup.projects ?? [],
    })
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
  // This endpoint always lands the change live (there's no draft mode), so it
  // needs publish authority on top of edit — same rule as the internal PUT.
  // Open a draft via POST /saved-groups-revisions/:id without it.
  if (
    !req.context.permissions.canRevisionAction(
      "saved-group",
      "publish",
      savedGroup,
    )
  ) {
    req.context.permissions.throwPermissionError();
  }
  // Landing a move takes publish in the destination too.
  if (
    !holdsMoveDestination({
      permissions: req.context.permissions,
      model: "saved-group",
      action: "publish",
      existing: savedGroup,
      proposed: {
        ...savedGroup,
        ...(projects === undefined ? {} : { projects }),
      },
    })
  ) {
    req.context.permissions.throwPermissionError();
  }

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
          `Use \`POST /saved-groups-revisions/${savedGroup.id}\` to open a draft, ` +
          'or pass `{ "bypassApproval": true }` if you have the `bypassApprovalSavedGroups` permission.',
      );
    }
    // Scope the bypass permission to the *existing* group's projects so a
    // `projects` move can't be paired with bypass-merge to launder a permission gap.
    const canBypass =
      canUseRestApiBypassSetting(req) ||
      adapter.canBypassApproval(
        req.context,
        savedGroup as Parameters<typeof adapter.canBypassApproval>[1],
      );
    if (!canBypass) {
      req.context.permissions.throwPermissionError();
    }
  }

  // One landing path whether or not approval was bypassed: every direct
  // update is recorded and guarded.
  await ensureLiveRevisionExists(
    req.context,
    "saved-group",
    savedGroup as unknown as Record<string, unknown> & {
      id: string;
      owner?: string;
      dateCreated?: Date;
    },
  );

  // Record the already-merged revision, then write live state. The earlier
  // ordering here wrote live first, reasoning that a draft-then-merge could
  // strand a draft — true, but that is not what this does: it records a single
  // already-merged revision, and removes it if the write fails. The orders are
  // not equally safe. History first fails to a detectable extra record with live
  // state correct; live first fails to a live change with no record of it, which
  // is the one outcome no retry can repair.
  const { merged, result: updatedSavedGroup } = await landDirectChange({
    context: req.context,
    entityType: "saved-group",
    entity: savedGroup as unknown as Record<string, unknown> & { id: string },
    patchOps,
    // Marks a skipped approval requirement; an org without one skips nothing.
    bypass: approvalRequired,
    changes: fieldsToUpdate as Record<string, unknown>,
    write: () =>
      runGuardedWrite("saved-group", savedGroup.id, () =>
        req.context.models.savedGroups.updateIfUnchanged(
          savedGroup,
          fieldsToUpdate,
        ),
      ),
    persistedFrom: (written) => written as unknown as Record<string, unknown>,
  });
  // Fire the revision-published event so REST-bypass publishes are observable
  // like every other publish path (the revert handler dispatches this too;
  // createMerged itself does not).
  await dispatchSavedGroupRevisionEvent(req.context, merged, {
    type: "published",
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
});
