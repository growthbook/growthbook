import { isEqual } from "lodash";
import { getDataSourceSqlDialect } from "shared/dialects";
import {
  ApiInterleavingQueryInterface,
  InterleavingQueryInterface,
  interleavingQueryApiSpec,
  interleavingQueryValidator,
} from "shared/validators";
import { MakeModelClass } from "back-end/src/models/BaseModel";
import { resolveOwnerEmails } from "back-end/src/services/owner";

const BaseClass = MakeModelClass({
  schema: interleavingQueryValidator,
  collectionName: "interleavingqueries",
  idPrefix: "ilq_",
  globallyUniquePrimaryKeys: true,
  defaultValues: {
    owner: "",
  },
  readonlyFields: ["datasourceId"],
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        datasourceId: 1,
      },
    },
  ],
  apiConfig: {
    modelKey: "interleavingQueries",
    openApiSpec: interleavingQueryApiSpec,
  },
});

// Interleaving queries are Data Source configuration (like Experiment
// Assignment Queries): readable by anyone who can read the Data Source,
// writable by anyone who can edit its settings.
export class InterleavingQueryModel extends BaseClass {
  protected canRead(doc: InterleavingQueryInterface): boolean {
    const { datasource } = this.getForeignRefs(doc);
    return (
      !!datasource &&
      this.context.permissions.canReadMultiProjectResource(datasource.projects)
    );
  }
  protected canCreate(doc: InterleavingQueryInterface): boolean {
    const { datasource } = this.getForeignRefs(doc);
    return (
      !!datasource &&
      this.context.permissions.canUpdateDataSourceSettings(datasource)
    );
  }
  protected canUpdate(existing: InterleavingQueryInterface): boolean {
    return this.canCreate(existing);
  }
  protected canDelete(doc: InterleavingQueryInterface): boolean {
    return this.canCreate(doc);
  }

  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("interleaving");
  }

  protected async customValidation(
    doc: InterleavingQueryInterface,
    previousDoc?: InterleavingQueryInterface,
  ): Promise<void> {
    const { datasource } = this.getForeignRefs(doc);
    if (!datasource) {
      this.context.throwNotFoundError(
        `Data Source not found: ${doc.datasourceId}`,
      );
    }
    if (!getDataSourceSqlDialect(datasource.type)?.jsonArray) {
      throw new Error(
        "Interleaving is not supported for this Data Source type yet.",
      );
    }
    // Only a changed list is checked, so a query whose Data Source later
    // dropped an identifier type can still save unrelated edits
    if (previousDoc && isEqual(previousDoc.userIdTypes, doc.userIdTypes)) {
      return;
    }
    const defined = new Set(
      datasource.settings?.userIdTypes?.map((t) => t.userIdType),
    );
    const unknown = doc.userIdTypes.filter((t) => !defined.has(t));
    if (unknown.length > 0) {
      throw new Error(
        `Invalid userIdTypes: ${unknown.join(", ")}. Each must be one of the identifier types defined on the Data Source.`,
      );
    }
  }

  protected toApiInterface(
    doc: InterleavingQueryInterface,
  ): ApiInterleavingQueryInterface {
    return {
      id: doc.id,
      dateCreated: doc.dateCreated.toISOString(),
      dateUpdated: doc.dateUpdated.toISOString(),
      owner: doc.owner,
      datasourceId: doc.datasourceId,
      name: doc.name,
      description: doc.description,
      userIdTypes: doc.userIdTypes,
      query: doc.query,
    };
  }

  /** List, optionally scoped to one Data Source. */
  public override async handleApiList(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiList"]>[0],
  ): Promise<ApiInterleavingQueryInterface[]> {
    const { datasourceId } = req.query;
    const docs = await this._find(datasourceId ? { datasourceId } : {});
    return resolveOwnerEmails(
      docs.map((doc) => this.toApiInterface(doc)),
      this.context,
    );
  }
}
