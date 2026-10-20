import { escapeRegExp, isEqual } from "lodash";
import { getDataSourceSqlDialect } from "shared/dialects";
import {
  ApiInterleavingExposureQueryInterface,
  INTERLEAVING_EXPOSURE_REQUIRED_COLUMNS,
  InterleavingExposureQueryInterface,
  interleavingExposureQueryApiSpec,
  interleavingExposureQueryValidator,
} from "shared/validators";
import { MakeModelClass } from "back-end/src/models/BaseModel";
import { resolveOwnerEmails } from "back-end/src/services/owner";

const BaseClass = MakeModelClass({
  schema: interleavingExposureQueryValidator,
  collectionName: "interleavingexposurequeries",
  idPrefix: "ileq_",
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
    modelKey: "interleavingExposureQueries",
    openApiSpec: interleavingExposureQueryApiSpec,
  },
});

// Interleaving exposure queries are Data Source configuration (like Experiment
// Assignment Queries): readable by anyone who can read the Data Source,
// writable by anyone who can edit its settings.
export class InterleavingExposureQueryModel extends BaseClass {
  protected canRead(doc: InterleavingExposureQueryInterface): boolean {
    const { datasource } = this.getForeignRefs(doc);
    return (
      !!datasource &&
      this.context.permissions.canReadMultiProjectResource(datasource.projects)
    );
  }
  protected canCreate(doc: InterleavingExposureQueryInterface): boolean {
    const { datasource } = this.getForeignRefs(doc);
    return (
      !!datasource &&
      this.context.permissions.canUpdateDataSourceSettings(datasource)
    );
  }
  protected canUpdate(existing: InterleavingExposureQueryInterface): boolean {
    return this.canCreate(existing);
  }
  protected canDelete(doc: InterleavingExposureQueryInterface): boolean {
    return this.canCreate(doc);
  }

  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("interleaving");
  }

  protected async beforeDelete(
    doc: InterleavingExposureQueryInterface,
  ): Promise<void> {
    const referencing =
      await this.context.models.interleavings.getByInterleavingExposureQueryId(
        doc.id,
      );
    if (referencing.length > 0) {
      const names = referencing.map((i) => i.name).join(", ");
      throw new Error(
        `Cannot delete this interleaving exposure query because it is in use by ${referencing.length} interleaving experiment(s): ${names}. Update or remove those experiments first.`,
      );
    }
  }

  protected async customValidation(
    doc: InterleavingExposureQueryInterface,
    previousDoc?: InterleavingExposureQueryInterface,
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
    // Cheap text check that the required output columns are at least named;
    // the real shape is verified when the query runs
    const missing = [
      ...INTERLEAVING_EXPOSURE_REQUIRED_COLUMNS,
      ...doc.userIdTypes,
    ].filter(
      (col) => !new RegExp(`\\b${escapeRegExp(col)}\\b`, "i").test(doc.query),
    );
    if (missing.length > 0) {
      throw new Error(
        `Query must output the columns: ${missing.join(", ")}. Alias your columns to these names.`,
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
    doc: InterleavingExposureQueryInterface,
  ): ApiInterleavingExposureQueryInterface {
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
  ): Promise<ApiInterleavingExposureQueryInterface[]> {
    const { datasourceId } = req.query;
    const docs = await this._find(datasourceId ? { datasourceId } : {});
    return resolveOwnerEmails(
      docs.map((doc) => this.toApiInterface(doc)),
      this.context,
    );
  }
}
