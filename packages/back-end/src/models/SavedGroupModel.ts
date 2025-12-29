import { ApiSavedGroup } from "shared/types/openapi";
import {
  SavedGroupInterface,
  LegacySavedGroupInterface,
} from "shared/types/saved-group";
import { savedGroupValidator } from "shared/validators";
import { MakeModelClass } from "./BaseModel";

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
  globallyUniqueIds: true,
});

export class SavedGroupModel extends BaseClass {
  protected canRead(doc: SavedGroupInterface): boolean {
    return this.context.permissions.canReadMultiProjectResource(doc.projects);
  }

  protected canCreate(doc: SavedGroupInterface): boolean {
    return this.context.permissions.canCreateSavedGroup(doc);
  }

  protected canUpdate(
    existing: SavedGroupInterface,
    updates: SavedGroupInterface,
  ): boolean {
    return this.context.permissions.canUpdateSavedGroup(existing, updates);
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

  protected async beforeCreate(doc: SavedGroupInterface) {
    doc.useEmptyListGroup = true;
  }

  public async removeProject(project: string) {
    await this._dangerousGetCollection().updateMany(
      { organization: this.context.org.id, projects: project },
      // @ts-expect-error - Mongodb driver types are strict about $pull
      { $pull: { projects: project } },
    );
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
    };
  }
}
