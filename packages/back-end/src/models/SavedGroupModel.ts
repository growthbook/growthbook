import { isEqual, omit } from "lodash";
import {
  SavedGroupInterface,
  LegacySavedGroupInterface,
  SavedGroupWithoutValues,
} from "shared/types/saved-group";
import { savedGroupValidator, ApiSavedGroup } from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import { UpdateFilter } from "mongodb";
import { savedGroupUpdated } from "back-end/src/services/savedGroups";
import { assertRegisteredAttributes } from "back-end/src/services/attributes";
import {
  logSavedGroupCreatedEvent,
  logSavedGroupUpdatedEvent,
  logSavedGroupDeletedEvent,
} from "back-end/src/services/savedGroupEvents";
import { MakeModelClass } from "./BaseModel";

// `skipAttributeValidation` lets revert flows write a previously-published
// condition even if it now references attributes that have since been removed
// or archived from the org schema. Normal create/update paths leave it unset.
type WriteOptions = {
  skipAttributeValidation?: boolean;
};

const BaseClass = MakeModelClass({
  schema: savedGroupValidator,
  collectionName: "savedgroups",
  idPrefix: "grp_",
  auditLog: {
    entity: "savedGroup",
    createEvent: "savedGroup.created",
    updateEvent: "savedGroup.updated",
    deleteEvent: "savedGroup.deleted",
  },
  globallyUniquePrimaryKeys: true,
  // Org-scoped `getAll()` is on the SDK-payload build path. The default indexes
  // are id-leading (`{id, organization}`, `{id}`), which can't serve a filter on
  // `organization` alone — without this a payload rebuild full-scans the
  // collection. Mirrors FeatureModel's org-leading index.
  additionalIndexes: [{ fields: { organization: 1 } }],
});

export class SavedGroupModel extends BaseClass<WriteOptions> {
  protected canRead(doc: SavedGroupInterface): boolean {
    return this.context.permissions.canReadMultiProjectResource(doc.projects);
  }

  protected canCreate(doc: SavedGroupInterface): boolean {
    return this.context.permissions.canCreateSavedGroup(doc);
  }

  protected canUpdate(
    existing: SavedGroupInterface,
    _updates: UpdateProps<SavedGroupInterface>,
    newDoc: SavedGroupInterface,
  ): boolean {
    return this.context.permissions.canUpdateSavedGroup(existing, newDoc);
  }

  protected canDelete(doc: SavedGroupInterface): boolean {
    return this.context.permissions.canDeleteSavedGroup(doc);
  }

  public static migrateSavedGroup(
    legacyDoc: LegacySavedGroupInterface,
  ): SavedGroupInterface {
    // Add `type` field to legacy groups
    const { source, type, ...otherFields } = legacyDoc;
    const group: SavedGroupInterface = {
      ...otherFields,
      type: type || (source === "runtime" ? "condition" : "list"),
    };

    // Migrate legacy runtime groups to use a condition
    if (
      group.type === "condition" &&
      !group.condition &&
      source === "runtime" &&
      group.attributeKey
    ) {
      group.condition = JSON.stringify({
        $groups: {
          $elemMatch: {
            $eq: group.attributeKey,
          },
        },
      });
    }

    return group;
  }

  protected migrate(legacyDoc: LegacySavedGroupInterface): SavedGroupInterface {
    return SavedGroupModel.migrateSavedGroup(legacyDoc);
  }

  protected async customValidation(
    doc: SavedGroupInterface,
    previousDoc?: SavedGroupInterface,
    writeOptions?: WriteOptions,
  ) {
    if (writeOptions?.skipAttributeValidation) return;
    if (doc.type === "condition" && doc.condition) {
      assertRegisteredAttributes(
        this.context,
        { condition: doc.condition },
        "saved group",
        previousDoc ? { condition: previousDoc.condition } : undefined,
        doc.projects,
      );
    }
  }

  protected async beforeCreate(doc: SavedGroupInterface) {
    doc.useEmptyListGroup = true;
  }

  protected async afterCreate(doc: SavedGroupInterface) {
    await logSavedGroupCreatedEvent(this.context, this.toApiInterface(doc));
  }

  protected async afterUpdate(
    existing: SavedGroupInterface,
    updates: UpdateProps<SavedGroupInterface>,
    newDoc: SavedGroupInterface,
  ) {
    // If the values, condition, or projects change, we need to invalidate
    // cached feature rules.
    //
    // We don't refresh on `archived` changes: archiving is blocked while the
    // group is referenced (see the controller / archive endpoint guards), so
    // `filterUsedSavedGroups` will already exclude it from the payload, and
    // unarchiving doesn't change anything live until the group is referenced
    // again (which itself triggers a refresh via the feature edit).
    if (updates.values || updates.condition || updates.projects) {
      savedGroupUpdated(this.context).catch((e) => {
        this.context.logger.error(
          e,
          "Error refreshing SDK Payload on saved group update",
        );
      });
    }

    // Don't emit `savedGroup.updated` if nothing meaningful changed (e.g. only
    // `dateUpdated` was bumped) — mirrors the feature webhook behavior.
    const previous = this.toApiInterface(existing);
    const current = this.toApiInterface(newDoc);
    if (
      !isEqual(omit(previous, ["dateUpdated"]), omit(current, ["dateUpdated"]))
    ) {
      await logSavedGroupUpdatedEvent(this.context, previous, current);
    }
  }

  protected async afterDelete(doc: SavedGroupInterface) {
    await logSavedGroupDeletedEvent(this.context, this.toApiInterface(doc));
  }

  public async removeProjectIdFromAllGroups(projectId: string) {
    const pullOperation: UpdateFilter<SavedGroupInterface> = {
      projects: projectId,
    };
    await this._dangerousGetCollection().updateMany(
      { organization: this.context.org.id, projects: projectId },
      { $pull: pullOperation },
    );
  }

  public async getAllWithoutValues(): Promise<SavedGroupWithoutValues[]> {
    const groups = await this._find({}, { projection: { values: 0 } });
    return groups as SavedGroupWithoutValues[];
  }

  public toApiInterface(savedGroup: SavedGroupInterface): ApiSavedGroup {
    return {
      id: savedGroup.id,
      type: savedGroup.type,
      values: savedGroup.values || [],
      condition: savedGroup.condition || "",
      name: savedGroup.groupName,
      attributeKey: savedGroup.attributeKey || "",
      dateCreated: savedGroup.dateCreated.toISOString(),
      dateUpdated: savedGroup.dateUpdated.toISOString(),
      owner: savedGroup.owner || "",
      description: savedGroup.description,
      projects: savedGroup.projects || [],
      archived: !!savedGroup.archived,
      useEmptyListGroup: savedGroup.useEmptyListGroup,
    };
  }
}
