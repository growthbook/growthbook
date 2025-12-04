import { UpdateProps } from "shared/types/base-model";
import {
  SavedQuery,
  savedQueryValidator,
} from "shared/src/validators/saved-queries";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: savedQueryValidator,
  collectionName: "savedqueries",
  idPrefix: "sq_",
  auditLog: {
    entity: "savedQuery",
    createEvent: "savedQuery.create",
    updateEvent: "savedQuery.update",
    deleteEvent: "savedQuery.delete",
  },
  globallyUniqueIds: false,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        dateCreated: -1,
      },
    },
  ],
});

export class SavedQueryDataModel extends BaseClass {
  protected canRead(doc: SavedQuery): boolean {
    const { datasource } = this.getForeignRefs(doc);
    return this.context.permissions.canViewSqlExplorerQueries({
      projects: datasource?.projects || [],
    });
  }
  protected canCreate(doc: SavedQuery): boolean {
    const { datasource } = this.getForeignRefs(doc);
    if (!datasource) {
      throw new Error("Datasource not found");
    }
    return this.context.permissions.canRunSqlExplorerQueries({
      projects: datasource?.projects || [],
    });
  }
  protected canUpdate(
    existing: SavedQuery,
    updates: UpdateProps<SavedQuery>,
  ): boolean {
    // Always get the datasource from the existing object
    const { datasource: existingDatasource } = this.getForeignRefs(existing);
    if (!existingDatasource) {
      throw new Error("Existing datasource not found");
    }

    // Get the datasource from the combined object
    const { datasource: newDatasource = existingDatasource } =
      this.getForeignRefs({
        ...existing,
        ...updates,
      });

    if (!newDatasource) {
      throw new Error("New datasource not found");
    }

    return this.context.permissions.canUpdateSqlExplorerQueries(
      {
        projects: existingDatasource.projects || [],
      },
      {
        projects: newDatasource.projects || [],
      },
    );
  }
  protected canDelete(doc: SavedQuery): boolean {
    const { datasource } = this.getForeignRefs(doc);
    return this.context.permissions.canDeleteSqlExplorerQueries({
      projects: datasource?.projects || [],
    });
  }
}
