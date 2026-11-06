import {
  ApiContextualBanditQueryInterface,
  assertExposureQueriesTargetingAttributeColumnsValid,
  ContextualBanditQueryInterface,
  contextualBanditQueryApiSpec,
  contextualBanditQueryValidator,
  isManagedWarehouseContextualBanditQuery,
} from "shared/validators";
import { ManagedWarehouseContextualBanditQuerySyncPlan } from "shared/util";
import { SDKAttributeSchema } from "shared/types/organization";
import { MakeModelClass } from "back-end/src/models/BaseModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { resolveOwnerEmails } from "back-end/src/services/owner";
import { logger } from "back-end/src/util/logger";
import { isDuplicateKeyError } from "back-end/src/util/mongo.util";

type WriteOptions = {
  managedWarehouseSync?: {
    attributeSchema: SDKAttributeSchema | undefined;
    allowReferencedDelete?: boolean;
  };
};

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
    {
      fields: {
        organization: 1,
        datasourceId: 1,
        userIdType: 1,
      },
      unique: true,
      partialFilterExpression: { managedBy: "api" },
    },
  ],
  apiConfig: {
    modelKey: "contextualBanditQueries",
    openApiSpec: contextualBanditQueryApiSpec,
  },
});

function managedQueryError(action: "create" | "update" | "delete"): Error {
  return new Error(
    `Cannot ${action} a Managed Warehouse contextual bandit query. These queries are generated from your organization's attributes.`,
  );
}

export class ContextualBanditQueryModel extends BaseClass<WriteOptions> {
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
    writeOptions?: WriteOptions,
  ): Promise<void> {
    if (writeOptions?.managedWarehouseSync) return;
    if (isManagedWarehouseContextualBanditQuery(doc)) {
      throw managedQueryError("create");
    }
    await this.assertCanEditDatasource(doc.datasourceId);
  }

  protected async beforeUpdate(
    existing: ContextualBanditQueryInterface,
    updates: Partial<ContextualBanditQueryInterface>,
    newDoc: ContextualBanditQueryInterface,
    writeOptions?: WriteOptions,
  ): Promise<void> {
    if (writeOptions?.managedWarehouseSync) return;
    if (
      isManagedWarehouseContextualBanditQuery(existing) ||
      isManagedWarehouseContextualBanditQuery(newDoc)
    ) {
      throw managedQueryError("update");
    }
    await this.assertCanEditDatasource(existing.datasourceId);
  }

  protected async beforeDelete(
    doc: ContextualBanditQueryInterface,
    writeOptions?: WriteOptions,
  ): Promise<void> {
    const sync = writeOptions?.managedWarehouseSync;
    if (!sync) {
      if (isManagedWarehouseContextualBanditQuery(doc)) {
        throw managedQueryError("delete");
      }
      await this.assertCanEditDatasource(doc.datasourceId);
    }
    if (sync?.allowReferencedDelete) return;

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
    _previousDoc?: ContextualBanditQueryInterface,
    writeOptions?: WriteOptions,
  ): Promise<void> {
    if ((doc.targetingAttributeColumns?.length ?? 0) === 0) {
      throw new Error(
        "A contextual bandit query must declare at least one targeting attribute column.",
      );
    }
    const attributeSchema = writeOptions?.managedWarehouseSync
      ? writeOptions.managedWarehouseSync.attributeSchema
      : this.context.org.settings?.attributeSchema;
    assertExposureQueriesTargetingAttributeColumnsValid(attributeSchema, [
      {
        id: doc.id,
        name: doc.name,
        targetingAttributeColumns: doc.targetingAttributeColumns,
      },
    ]);
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
      managedBy: doc.managedBy,
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

  public async getManagedWarehouseQueriesByDatasource(
    datasourceId: string,
  ): Promise<ContextualBanditQueryInterface[]> {
    const docs = await this.getByDatasource(datasourceId);
    return docs.filter(isManagedWarehouseContextualBanditQuery);
  }

  public async dangerouslyApplyManagedWarehouseQuerySyncPlan(
    datasourceId: string,
    plan: ManagedWarehouseContextualBanditQuerySyncPlan<ContextualBanditQueryInterface>,
    attributeSchema: SDKAttributeSchema | undefined,
  ): Promise<void> {
    const writeOptions: WriteOptions = {
      managedWarehouseSync: { attributeSchema },
    };
    const orgId = this.context.org.id;
    const failures: string[] = [];
    const record = (label: string, e: unknown) => {
      logger.error(
        e,
        `Failed to ${label} Managed Warehouse contextual bandit query for org ${orgId}`,
      );
      failures.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    };

    for (const d of plan.create) {
      try {
        await this._createOne(
          {
            owner: "",
            datasourceId,
            name: d.name,
            userIdType: d.userIdType,
            query: d.query,
            targetingAttributeColumns: d.targetingAttributeColumns,
            managedBy: "api",
          },
          writeOptions,
          true,
        );
        continue;
      } catch (e) {
        if (!isDuplicateKeyError(e)) {
          record(`create ${d.userIdType}`, e);
          continue;
        }
      }
      const current = await this._findOne({
        datasourceId,
        managedBy: "api",
        userIdType: d.userIdType,
      });
      if (!current) {
        failures.push(`create ${d.userIdType}: duplicate key but no document`);
        continue;
      }
      try {
        await this._updateOne(
          current,
          {
            name: d.name,
            userIdType: d.userIdType,
            query: d.query,
            targetingAttributeColumns: d.targetingAttributeColumns,
          },
          { writeOptions, forceCanUpdate: true },
        );
      } catch (e) {
        record(`update ${current.id}`, e);
      }
    }

    for (const { existing, changes } of plan.update) {
      try {
        await this._updateOne(existing, changes, {
          writeOptions,
          forceCanUpdate: true,
        });
      } catch (e) {
        record(`update ${existing.id}`, e);
      }
    }

    for (const doc of plan.remove) {
      try {
        await this._deleteOne(doc, writeOptions, true);
      } catch (e) {
        record(`delete ${doc.id}`, e);
      }
    }

    if (failures.length) {
      throw new Error(
        `Managed Warehouse contextual bandit query sync had ${failures.length} failure(s): ${failures.join("; ")}`,
      );
    }
  }

  public async dangerouslyDeleteManagedWarehouseQueries(
    datasourceId: string,
  ): Promise<void> {
    const docs =
      await this.getManagedWarehouseQueriesByDatasource(datasourceId);
    for (const doc of docs) {
      await this._deleteOne(
        doc,
        {
          managedWarehouseSync: {
            attributeSchema: undefined,
            allowReferencedDelete: true,
          },
        },
        true,
      );
    }
  }
}
