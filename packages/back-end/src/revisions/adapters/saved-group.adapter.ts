import { isEqual } from "lodash";
import { SavedGroupInterface } from "shared/types/saved-group";
import type { Context } from "back-end/src/models/BaseModel";
import { EntityRevisionAdapter } from "back-end/src/revisions/EntityRevisionAdapter";

const UPDATABLE_FIELDS = new Set<string>([
  "groupName",
  "owner",
  "values",
  "condition",
  "attributeKey",
  "description",
  "projects",
  "useEmptyListGroup",
  "archived",
]);

// User must be able to bypass approval in EVERY project the saved group
// belongs to (treats the empty-projects case as the global "" project).
// Used both for the bypass-approval gate and for non-author revision deletion,
// since discarding someone else's in-flight revision is an admin-level action.
function canBypassAcrossProjects(
  context: Context,
  snapshot: SavedGroupInterface,
): boolean {
  const projects = snapshot.projects?.length ? snapshot.projects : [""];
  return projects.every((project) =>
    context.permissions.canBypassApprovalChecks({ project }),
  );
}

// canCreate and canUpdate both gate on the saved-group edit permission;
// extract so the two stay in sync.
function canEditSavedGroup(
  context: Context,
  snapshot: SavedGroupInterface,
): boolean {
  return context.permissions.canUpdateSavedGroup(snapshot, {});
}

export const savedGroupAdapter: EntityRevisionAdapter<SavedGroupInterface> = {
  getModel(context: Context) {
    return context.models.savedGroups as {
      getById(id: string): Promise<SavedGroupInterface | null>;
    };
  },

  buildSnapshot(entity: SavedGroupInterface): SavedGroupInterface {
    const { _id, ...rest } = entity as SavedGroupInterface & {
      _id?: unknown;
    };
    return {
      ...rest,
      values: entity.values ?? undefined,
      condition: entity.condition ?? undefined,
      attributeKey: entity.attributeKey ?? undefined,
      description: entity.description ?? undefined,
      projects: entity.projects ?? undefined,
      useEmptyListGroup: entity.useEmptyListGroup ?? undefined,
    };
  },

  isRevisionRequired(context: Context): boolean {
    return context.org.settings?.approvalFlows?.savedGroups?.required || false;
  },

  getUpdatableFields(): ReadonlySet<string> {
    return UPDATABLE_FIELDS;
  },

  canRead(context: Context, snapshot: SavedGroupInterface): boolean {
    return context.permissions.canReadMultiProjectResource(snapshot.projects);
  },

  canCreate(context: Context, snapshot: SavedGroupInterface): boolean {
    return canEditSavedGroup(context, snapshot);
  },

  canUpdate(context: Context, snapshot: SavedGroupInterface): boolean {
    return canEditSavedGroup(context, snapshot);
  },

  // Gates non-author deletion of a revision document (authors can always
  // delete their own — see RevisionModel.canDelete). Restricted to users who
  // can bypass approval, since discarding another user's in-flight revision
  // is an admin-level action.
  canDelete(context: Context, snapshot: SavedGroupInterface): boolean {
    return canBypassAcrossProjects(context, snapshot);
  },

  isApprovalRequired(context: Context): boolean {
    return context.org.settings?.approvalFlows?.savedGroups?.required || false;
  },

  canBypassApproval(context: Context, snapshot: SavedGroupInterface): boolean {
    return canBypassAcrossProjects(context, snapshot);
  },

  async applyChanges(
    context: Context,
    entity: SavedGroupInterface,
    changes: Record<string, unknown>,
  ): Promise<void> {
    // Filter to updatable fields and only include fields that actually differ
    const filteredChanges: Record<string, unknown> = {};
    for (const key of Object.keys(changes)) {
      if (!UPDATABLE_FIELDS.has(key)) continue;
      const newVal = changes[key];
      const currentVal = (entity as Record<string, unknown>)[key];
      if (newVal !== undefined && !isEqual(newVal, currentVal)) {
        filteredChanges[key] = newVal;
      }
    }

    if (Object.keys(filteredChanges).length === 0) return;

    await context.models.savedGroups.update(
      entity,
      filteredChanges as Parameters<
        typeof context.models.savedGroups.update
      >[1],
    );
  },
};
