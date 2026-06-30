import {
  EventForwarderConfigInterface,
  eventForwarderConfigValidator,
} from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import { createModelAuditLogger } from "back-end/src/services/audit";
import { MakeModelClass } from "./BaseModel";

const eventForwarderConfigAudit = createModelAuditLogger({
  entity: "eventForwarderConfig",
  createEvent: "eventForwarderConfig.create",
  updateEvent: "eventForwarderConfig.update",
  deleteEvent: "eventForwarderConfig.delete",
});

const BaseClass = MakeModelClass({
  schema: eventForwarderConfigValidator,
  collectionName: "eventForwarderConfigs",
  idPrefix: "efc_",
  additionalIndexes: [
    {
      fields: { organization: 1, datasourceId: 1 },
      unique: true,
    },
  ],
  auditLog: {
    entity: "eventForwarderConfig",
    createEvent: "eventForwarderConfig.create",
    updateEvent: "eventForwarderConfig.update",
    deleteEvent: "eventForwarderConfig.delete",
  },
  globallyUniquePrimaryKeys: true,
});

export class EventForwarderConfigModel extends BaseClass {
  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("events-forwarder");
  }

  protected canCreate(doc: EventForwarderConfigInterface): boolean {
    return this.context.permissions.canCreateEventForwarderConfig(doc);
  }

  protected canRead(doc: EventForwarderConfigInterface): boolean {
    return this.context.permissions.canReadMultiProjectResource(doc.projects);
  }

  protected canUpdate(
    existing: EventForwarderConfigInterface,
    _updates: UpdateProps<EventForwarderConfigInterface>,
    newDoc: EventForwarderConfigInterface,
  ): boolean {
    return this.context.permissions.canUpdateEventForwarderConfig(
      existing,
      newDoc,
    );
  }

  protected canDelete(doc: EventForwarderConfigInterface): boolean {
    return (
      this.context.superAdmin ||
      this.context.permissions.canDeleteEventForwarderConfig(doc)
    );
  }

  /** User-facing lookup; respects `canRead` (requires `readData` on the row's projects). */
  public async getByDatasourceId(
    datasourceId: string,
  ): Promise<EventForwarderConfigInterface | null> {
    const rows = await this._find({ datasourceId }, { limit: 1 });
    return rows[0] ?? null;
  }

  /**
   * Internal lookup for datasource-delete cascade only. Skips `canRead` so teardown
   * still runs when the deleter has `createDatasources` but not `readData`, or when
   * the row's `projects` are out of sync with the datasource. Pair with
   * `deleteForDatasourceCascade`. Do not use from user-facing endpoints — use
   * `getByDatasourceId` instead.
   */
  public async getByDatasourceIdForDatasourceCascade(
    datasourceId: string,
  ): Promise<EventForwarderConfigInterface | null> {
    const rows = await this._find(
      { datasourceId },
      { bypassReadPermissionChecks: true, limit: 1 },
    );
    return rows[0] ?? null;
  }

  /**
   * Deletes the Mongo row after datasource removal. Mirrors BaseModel delete
   * persistence/audit without `canDelete` — caller must already authorize
   * (e.g. `canDeleteDataSource`). Pair with `getByDatasourceIdForDatasourceCascade`.
   */
  public async deleteForDatasourceCascade(
    existing: EventForwarderConfigInterface,
  ): Promise<void> {
    if (this.useConfigFile()) {
      throw new Error(
        `Cannot delete - ${this.config.collectionName} are being managed by config.yml`,
      );
    }
    await this.beforeDelete(existing);
    await this._dangerousGetCollection().deleteOne({
      ...this.getPrimaryKeyFilter(existing),
      organization: this.context.org.id,
    });

    await eventForwarderConfigAudit.logDelete(this.context, existing);

    await this.afterDelete(existing);
  }
}
