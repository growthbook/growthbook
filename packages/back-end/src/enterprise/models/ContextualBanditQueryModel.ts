import {
  ApiContextualBanditQueryInterface,
  assertExposureQueriesTargetingAttributeColumnsValid,
  ContextualBanditQueryInterface,
  contextualBanditQueryValidator,
} from "shared/validators";
import { MakeModelClass } from "back-end/src/models/BaseModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { contextualBanditQueryApiSpec } from "back-end/src/api/specs/contextual-bandit-query.spec";

const BaseClass = MakeModelClass({
  schema: contextualBanditQueryValidator,
  collectionName: "contextualbanditqueries",
  idPrefix: "cbq_",
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        datasourceId: 1,
      },
    },
  ],
  apiConfig: {
    modelKey: "contextualBanditQueries",
    openApiSpec: contextualBanditQueryApiSpec,
  },
});

export class ContextualBanditQueryModel extends BaseClass {
  // Reads are org-scoped by BaseModel. Writes are gated against the owning
  // datasource's `editDatasourceSettings` permission in the before* hooks below,
  // because the permission depends on the datasource's projects which can't be
  // resolved synchronously here.
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

  /** Defense-in-depth: bandit queries are an Enterprise-only construct. */
  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("contextual-bandits");
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

  protected async beforeCreate(
    doc: ContextualBanditQueryInterface,
  ): Promise<void> {
    await this.assertCanEditDatasource(doc.datasourceId);
  }

  protected async beforeUpdate(
    existing: ContextualBanditQueryInterface,
  ): Promise<void> {
    await this.assertCanEditDatasource(existing.datasourceId);
  }

  protected async beforeDelete(
    doc: ContextualBanditQueryInterface,
  ): Promise<void> {
    await this.assertCanEditDatasource(doc.datasourceId);
  }

  /**
   * Server-side source of truth (also mirrored in the authoring modal):
   *  - at least one targeting attribute column (a CB must have context to split on)
   *  - every column is a safe SQL identifier (injection safety — they're interpolated
   *    as bare identifiers) AND maps to a non-archived org targeting attribute.
   */
  protected async customValidation(
    doc: ContextualBanditQueryInterface,
  ): Promise<void> {
    if ((doc.targetingAttributeColumns?.length ?? 0) === 0) {
      throw new Error(
        "A contextual bandit query must declare at least one targeting attribute column.",
      );
    }
    assertExposureQueriesTargetingAttributeColumnsValid(
      this.context.org.settings?.attributeSchema,
      [
        {
          id: doc.id,
          name: doc.name,
          targetingAttributeColumns: doc.targetingAttributeColumns,
        },
      ],
    );
  }

  protected toApiInterface(
    doc: ContextualBanditQueryInterface,
  ): ApiContextualBanditQueryInterface {
    return {
      id: doc.id,
      dateCreated: doc.dateCreated.toISOString(),
      dateUpdated: doc.dateUpdated.toISOString(),
      datasourceId: doc.datasourceId,
      name: doc.name,
      description: doc.description,
      userIdType: doc.userIdType,
      query: doc.query,
      targetingAttributeColumns: doc.targetingAttributeColumns,
      dimensions: doc.dimensions,
      hasNameCol: doc.hasNameCol,
    };
  }

  /** List, optionally scoped to one datasource (used by the CB create form's query picker). */
  public override async handleApiList(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiList"]>[0],
  ): Promise<ApiContextualBanditQueryInterface[]> {
    const { datasourceId } = req.query;
    const docs = datasourceId
      ? await this.getByDatasource(datasourceId)
      : await this.getAll();
    return docs.map((doc) => this.toApiInterface(doc));
  }

  /** All CB queries for a datasource. */
  public getByDatasource(
    datasourceId: string,
  ): Promise<ContextualBanditQueryInterface[]> {
    return this._find({ datasourceId });
  }
}
