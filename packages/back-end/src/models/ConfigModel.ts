import { ConfigInterface, ConfigWithoutValue } from "shared/types/config";
import { configValidator, getCyclicConstantRefs } from "shared/validators";
import { getConfigParentKey, withParentExtends } from "shared/util";
import { UpdateProps } from "shared/types/base-model";
import { BadRequestError } from "back-end/src/util/errors";
import { constantUpdated } from "back-end/src/services/constants";
import { getResolvableConstants } from "back-end/src/services/resolvableConstants";
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
    const effectiveValue = withParentExtends(doc.value, getConfigParentKey(doc));
    const cyclic = getCyclicConstantRefs(
      doc.key,
      effectiveValue,
      doc.environmentValues,
      await getResolvableConstants(this.context),
    );
    if (cyclic.length) {
      throw new BadRequestError(
        `This config references ${cyclic
          .map((k) => `@const:${k}`)
          .join(", ")}, which would create a reference cycle.`,
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

  // Refresh SDK payloads when a change alters the resolved value.
  protected async afterUpdate(
    _existing: ConfigInterface,
    updates: UpdateProps<ConfigInterface>,
  ) {
    if (
      updates.parent !== undefined ||
      updates.value !== undefined ||
      updates.environmentValues !== undefined ||
      updates.project !== undefined ||
      updates.archived !== undefined
    ) {
      constantUpdated(this.context, "updated", "config").catch((e) => {
        this.context.logger.error(
          e,
          "Error refreshing SDK Payload on config update",
        );
      });
    }
  }

  // A delete changes the generated payload too, so refresh on delete.
  protected async afterDelete() {
    constantUpdated(this.context, "deleted", "config").catch((e) => {
      this.context.logger.error(
        e,
        "Error refreshing SDK Payload on config delete",
      );
    });
  }

  public getByKey(key: string) {
    return this._findOne({ key });
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
