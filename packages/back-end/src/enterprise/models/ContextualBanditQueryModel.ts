import {
  ApiContextualBanditQueryInterface,
  assertExposureQueriesTargetingAttributeColumnsValid,
  ContextualBanditQueryInterface,
  contextualBanditQueryValidator,
} from "shared/validators";
import { MakeModelClass } from "back-end/src/models/BaseModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { resolveOwnerEmails } from "back-end/src/services/owner";
import { contextualBanditQueryApiSpec } from "back-end/src/api/specs/contextual-bandit-query.spec";

const BaseClass = MakeModelClass({
  schema: contextualBanditQueryValidator,
  collectionName: "contextualbanditqueries",
  idPrefix: "cbq_",
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
    modelKey: "contextualBanditQueries",
    openApiSpec: contextualBanditQueryApiSpec,
  },
});

export class ContextualBanditQueryModel extends BaseClass {
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

    const referencingBandits =
      await this.context.models.contextualBandits.getByContextualBanditQueryId(
        doc.id,
      );
    if (referencingBandits.length > 0) {
      const names = referencingBandits.map((b) => b.name).join(", ");
      throw new Error(
        `Cannot delete this contextual bandit query because it is in use by ${referencingBandits.length} contextual bandit(s): ${names}. Update or remove those bandits first.`,
      );
    }
  }

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
      owner: doc.owner,
      datasourceId: doc.datasourceId,
      name: doc.name,
      description: doc.description,
      userIdType: doc.userIdType,
      query: doc.query,
      targetingAttributeColumns: doc.targetingAttributeColumns,
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
    return resolveOwnerEmails(
      docs.map((doc) => this.toApiInterface(doc)),
      this.context,
    );
  }

  /** All CB queries for a datasource. */
  public getByDatasource(
    datasourceId: string,
  ): Promise<ContextualBanditQueryInterface[]> {
    return this._find({ datasourceId });
  }
}
