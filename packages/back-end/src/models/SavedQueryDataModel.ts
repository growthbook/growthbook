import {
  SavedQuery,
  savedQueryValidator,
} from "back-end/src/validators/saved-queries";
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
    return this.context.permissions.canRunSqlExplorerQueries({
      projects: datasource?.projects || [],
    });
  }
  protected canUpdate(existing: SavedQuery): boolean {
    const { datasource } = this.getForeignRefs(existing);
    return this.context.permissions.canUpdateSqlExplorerQueries({
      projects: datasource?.projects || [],
    });
  }
  protected canDelete(doc: SavedQuery): boolean {
    const { datasource } = this.getForeignRefs(doc);
    return this.context.permissions.canDeleteSqlExplorerQueries({
      projects: datasource?.projects || [],
    });
  }
}
