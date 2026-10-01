import {
  ApiInterleavingQueryInterface,
  InterleavingQueryInterface,
  interleavingQueryApiSpec,
  interleavingQueryValidator,
} from "shared/validators";
import { MakeModelClass } from "back-end/src/models/BaseModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { resolveOwnerEmails } from "back-end/src/services/owner";

const BaseClass = MakeModelClass({
  schema: interleavingQueryValidator,
  collectionName: "interleavingqueries",
  idPrefix: "ilq_",
  globallyUniquePrimaryKeys: true,
  defaultValues: {
    owner: "",
  },
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

export class InterleavingQueryModel extends BaseClass {
  protected canRead(): boolean {
    return true;
  }
  protected canCreate(): boolean {
    return true;
  }
  protected canUpdate(): boolean {
    return true;
  }
  protected canDelete(): boolean {
    return true;
  }

  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("interleaving");
  }

  private async assertCanEditDatasource(datasourceId: string): Promise<void> {
    const datasource = await getDataSourceById(this.context, datasourceId);
    if (!datasource) {
      this.context.throwNotFoundError(`Datasource not found: ${datasourceId}`);
    }
    if (!this.context.permissions.canUpdateDataSourceSettings(datasource)) {
      this.context.permissions.throwPermissionError();
    }
  }

  protected async beforeCreate(doc: InterleavingQueryInterface): Promise<void> {
    await this.assertCanEditDatasource(doc.datasourceId);
  }

  protected async beforeUpdate(
    existing: InterleavingQueryInterface,
  ): Promise<void> {
    await this.assertCanEditDatasource(existing.datasourceId);
  }

  protected async beforeDelete(doc: InterleavingQueryInterface): Promise<void> {
    await this.assertCanEditDatasource(doc.datasourceId);
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
      userIdType: doc.userIdType,
      query: doc.query,
    };
  }

  /** List, optionally scoped to one datasource (used by the create form's query picker). */
  public override async handleApiList(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiList"]>[0],
  ): Promise<ApiInterleavingQueryInterface[]> {
    const { datasourceId } = req.query;
    const docs = datasourceId
      ? await this.getByDatasource(datasourceId)
      : await this.getAll();
    return resolveOwnerEmails(
      docs.map((doc) => this.toApiInterface(doc)),
      this.context,
    );
  }

  /** All interleaving queries for a datasource. */
  public getByDatasource(
    datasourceId: string,
  ): Promise<InterleavingQueryInterface[]> {
    return this._find({ datasourceId });
  }
}
