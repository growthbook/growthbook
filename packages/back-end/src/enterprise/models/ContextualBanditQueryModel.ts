import {
  ApiContextualBanditQueryInterface,
  assertExposureQueriesTargetingAttributeColumnsValid,
  ContextualBanditQueryInterface,
  contextualBanditQueryValidator,
} from "shared/validators";
import { MakeModelClass } from "back-end/src/models/BaseModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";

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

  /** All CB queries for a datasource. */
  public getByDatasource(
    datasourceId: string,
  ): Promise<ContextualBanditQueryInterface[]> {
    return this._find({ datasourceId });
  }
}

export function toApiContextualBanditQuery(
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
