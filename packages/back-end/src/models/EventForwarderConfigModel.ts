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
    return this.context.permissions.canDeleteEventForwarderConfig(doc);
  }

  /**
   * Loads the forwarder row for a datasource regardless of project visibility on the row.
   * Caller must enforce higher-level authorization (e.g. datasource delete).
   */
  public async dangerousGetByDatasourceIdBypassPermission(
    datasourceId: string,
  ): Promise<EventForwarderConfigInterface | null> {
    const rows = await this._find(
      { datasourceId },
      { bypassReadPermissionChecks: true, limit: 1 },
    );
    return rows[0] ?? null;
  }

  /**
   * Deletes after last BigQuery datasource removal. Mirrors BaseModel delete persistence/audit
   * without `canDelete` — caller must already authorize (e.g. datasource delete).
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
