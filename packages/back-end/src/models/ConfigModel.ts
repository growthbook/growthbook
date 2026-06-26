import { ConfigInterface, ConfigWithoutValue } from "shared/types/config";
import { SimpleSchema } from "shared/types/feature";
import {
  ApiConfig,
  configValidator,
  getCyclicConstantRefs,
} from "shared/validators";
import {
  getConfigParentKey,
  withParentExtends,
  getAncestorSchemaKeys,
  stripAncestorOwnedFields,
} from "shared/util";
import { UpdateProps } from "shared/types/base-model";
import { isEqual, omit } from "lodash";
import { BadRequestError } from "back-end/src/util/errors";
import { resolvableValueChanged } from "back-end/src/services/constants";
import { getResolvableValues } from "back-end/src/services/resolvableValues";
import {
  logConfigCreatedEvent,
  logConfigUpdatedEvent,
  logConfigDeletedEvent,
} from "back-end/src/services/configEvents";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: configValidator,
  collectionName: "configs",
  idPrefix: "cfg_",
  auditLog: {
    entity: "config",
    createEvent: "config.created",
    updateEvent: "config.updated",
    deleteEvent: "config.deleted",
  },
  globallyUniquePrimaryKeys: true,
  // `key` is the `@const:<key>` reference handle; unique per org.
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        key: 1,
      },
      unique: true,
    },
  ],
});

export class ConfigModel extends BaseClass {
  protected canRead(doc: ConfigInterface): boolean {
    return this.context.permissions.canReadSingleProjectResource(doc.project);
  }

  protected canCreate(doc: ConfigInterface): boolean {
    return this.context.permissions.canCreateConfig(doc);
  }

  protected canUpdate(
    existing: ConfigInterface,
    _updates: UpdateProps<ConfigInterface>,
    newDoc: ConfigInterface,
  ): boolean {
    return this.context.permissions.canUpdateConfig(existing, newDoc);
  }

  protected canDelete(doc: ConfigInterface): boolean {
    return this.context.permissions.canDeleteConfig(doc);
  }

  // Reject cyclic lineage/values; the graph spans both collections. The parent's
  // `$extends` is synthesized in so a parent→…→self cycle is caught at write time.
  private async assertNoCycle(doc: ConfigInterface): Promise<void> {
    const effectiveValue = withParentExtends(
      doc.value,
      getConfigParentKey(doc),
    );
    const cyclic = getCyclicConstantRefs(
      doc.key,
      effectiveValue,
      doc.environmentValues,
      await getResolvableValues(this.context),
    );
    if (cyclic.length) {
      throw new BadRequestError(
        `This config references ${cyclic.join(", ")}, which would create a reference cycle.`,
      );
    }
  }

  protected async beforeCreate(doc: ConfigInterface) {
    await this.assertNoCycle(doc);
  }

  protected async beforeUpdate(
    _existing: ConfigInterface,
    updates: UpdateProps<ConfigInterface>,
    newDoc: ConfigInterface,
  ) {
    if (
      updates.parent !== undefined ||
      updates.value !== undefined ||
      updates.environmentValues !== undefined
    ) {
      await this.assertNoCycle(newDoc);
    }
  }

  protected async afterCreate(doc: ConfigInterface) {
    await logConfigCreatedEvent(this.context, this.toApiInterface(doc));
  }

  // Refresh SDK payloads when a change alters the resolved value.
  protected async afterUpdate(
    existing: ConfigInterface,
    updates: UpdateProps<ConfigInterface>,
    newDoc: ConfigInterface,
  ) {
    if (
      updates.parent !== undefined ||
      updates.value !== undefined ||
      updates.environmentValues !== undefined ||
      updates.project !== undefined ||
      updates.archived !== undefined
    ) {
      resolvableValueChanged(this.context, "updated", "config").catch((e) => {
        this.context.logger.error(
          e,
          "Error refreshing SDK Payload on config update",
        );
      });
    }

    // Skip the webhook event when only `dateUpdated` changed.
    const previous = this.toApiInterface(existing);
    const current = this.toApiInterface(newDoc);
    if (
      !isEqual(omit(previous, ["dateUpdated"]), omit(current, ["dateUpdated"]))
    ) {
      await logConfigUpdatedEvent(this.context, previous, current);
    }
  }

  protected async afterDelete(doc: ConfigInterface) {
    resolvableValueChanged(this.context, "deleted", "config").catch((e) => {
      this.context.logger.error(
        e,
        "Error refreshing SDK Payload on config delete",
      );
    });
    await logConfigDeletedEvent(this.context, this.toApiInterface(doc));
  }

  public getByKey(key: string) {
    return this._findOne({ key });
  }

  // Every config in the org, ignoring per-config read permissions. Used by the
  // schema-reconciliation pass, which must see the whole lineage (ancestors and
  // descendants may live in projects the acting user can't read) to enforce
  // "base wins" on field collisions.
  public getAllForReconcile(): Promise<ConfigInterface[]> {
    return this._find({}, { bypassReadPermissionChecks: true });
  }

  // Strip from a config's appended schema any field key already owned by a
  // published ancestor (closest base wins). Returns the reconciled schema, or
  // the input unchanged when there are no collisions. Call before every schema
  // write so a child can never re-declare an inherited field.
  public async normalizeSchemaAgainstAncestors(
    config: { key?: string; parent?: string; value?: string },
    schema: SimpleSchema | undefined,
  ): Promise<SimpleSchema | undefined> {
    if (!schema?.fields?.length) return schema;
    const parentKey = config.parent || getConfigParentKey(config);
    if (!parentKey) return schema;
    const all = await this.getAllForReconcile();
    const byKey = new Map(all.map((c) => [c.key, c]));
    const ancestorKeys = getAncestorSchemaKeys({ parent: parentKey }, byKey);
    const kept = stripAncestorOwnedFields(schema, ancestorKeys);
    return kept ? { ...schema, fields: kept } : schema;
  }

  // Project a config into its external REST shape. `ownerEmail` is left blank
  // here and filled in by `resolveOwnerEmail(s)` in the handler (a batched user
  // lookup), mirroring the constant serializer. `$extends` never appears in the
  // stored `value`, so it's safe to surface verbatim.
  public toApiInterface(config: ConfigInterface): ApiConfig {
    return {
      id: config.id,
      key: config.key,
      name: config.name,
      owner: config.owner,
      ownerEmail: "",
      parent: config.parent,
      value: config.value,
      environmentValues: config.environmentValues,
      description: config.description,
      project: config.project,
      archived: config.archived,
      schema: config.schema,
      extensible: config.extensible,
      dateCreated: config.dateCreated.toISOString(),
      dateUpdated: config.dateUpdated.toISOString(),
    };
  }

  // Value-omitted projection for the definitions context (values can be large).
  public async getAllWithoutValues(): Promise<ConfigWithoutValue[]> {
    const configs = await this._find(
      {},
      { projection: { value: 0, environmentValues: 0 } },
    );
    return configs as ConfigWithoutValue[];
  }

  // On project delete, unset it on scoped configs (becomes global). Bypasses the
  // per-config update permission (system cascade) but still fires afterUpdate.
  public async removeProjectIdFromAll(projectId: string) {
    const affected = await this._find({ project: projectId });
    for (const config of affected) {
      await this.dangerousUpdateBypassPermission(config, { project: "" });
    }
  }
}
