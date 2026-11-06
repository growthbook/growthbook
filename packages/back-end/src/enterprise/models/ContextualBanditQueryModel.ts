import {
  ApiContextualBanditQueryInterface,
  assertExposureQueriesTargetingAttributeColumnsValid,
  ContextualBanditQueryInterface,
  contextualBanditQueryApiSpec,
  contextualBanditQueryValidator,
  isManagedWarehouseContextualBanditQuery,
} from "shared/validators";
import {
  ManagedWarehouseContextualBanditQuery,
  normalizeUserIdTypeName,
} from "shared/util";
import { SDKAttributeSchema } from "shared/types/organization";
import { MakeModelClass } from "back-end/src/models/BaseModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { resolveOwnerEmails } from "back-end/src/services/owner";
import { logger } from "back-end/src/util/logger";

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

  public async dangerouslySyncManagedWarehouseQueries(
    datasourceId: string,
    desired: ManagedWarehouseContextualBanditQuery[],
    attributeSchema: SDKAttributeSchema | undefined,
  ): Promise<void> {
    const writeOptions: WriteOptions = {
      managedWarehouseSync: { attributeSchema },
    };
    const existing =
      await this.getManagedWarehouseQueriesByDatasource(datasourceId);
    const stale = new Map(
      existing.map((q) => [normalizeUserIdTypeName(q.userIdType), q]),
    );

    for (const d of desired) {
      const key = normalizeUserIdTypeName(d.userIdType);
      const current = stale.get(key);
      stale.delete(key);
      if (!current) {
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
      }
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
    }

    for (const doc of stale.values()) {
      const referencing =
        await this.context.models.contextualBandits.getByContextualBanditQueryId(
          doc.id,
        );
      if (referencing.length > 0) {
        logger.warn(
          `Keeping Managed Warehouse contextual bandit query ${doc.id} (${doc.userIdType}) for org ${this.context.org.id}: identifier removed but still referenced by ${referencing.length} contextual bandit(s)`,
        );
        continue;
      }
      await this._deleteOne(doc, writeOptions, true);
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
