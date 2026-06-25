import { ConfigInterface, ConfigWithoutValue } from "shared/types/config";
import { configValidator, getCyclicConstantRefs } from "shared/validators";
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
  // `key` is the reference handle (`@const:<key>`); unique per org.
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

  // Reject a value that would close a reference cycle (same guard as constants).
  // The graph spans both collections — a config can extend another config and
  // reference constants — so it's built from the full resolvable universe.
  private async assertNoCycle(
    key: string,
    value: string | undefined,
    environmentValues: Record<string, string> | undefined,
  ): Promise<void> {
    const cyclic = getCyclicConstantRefs(
      key,
      value,
      environmentValues,
      await getResolvableConstants(this.context),
    );
    if (cyclic.length) {
      throw new BadRequestError(
        `This value references ${cyclic
          .map((k) => `@const:${k}`)
          .join(", ")}, which would create a reference cycle.`,
      );
    }
  }

  protected async beforeCreate(doc: ConfigInterface) {
    await this.assertNoCycle(doc.key, doc.value, doc.environmentValues);
  }

  protected async beforeUpdate(
    _existing: ConfigInterface,
    updates: UpdateProps<ConfigInterface>,
    newDoc: ConfigInterface,
  ) {
    if (
      updates.value !== undefined ||
      updates.environmentValues !== undefined
    ) {
      await this.assertNoCycle(
        newDoc.key,
        newDoc.value,
        newDoc.environmentValues,
      );
    }
  }

  // Config values resolve into SDK payloads exactly like json constants, so any
  // change to the resolved value (value / env overrides / project / archived)
  // refreshes the payload cache and fires SDK webhooks for affected connections.
  protected async afterUpdate(
    _existing: ConfigInterface,
    updates: UpdateProps<ConfigInterface>,
  ) {
    if (
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

  // A deleted config leaves its `@const:` references unresolved, changing the
  // generated payload, so refresh on delete too.
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

  // When a project is deleted, unset it on any config scoped to it (becomes
  // global), mirroring features/constants. Routed through the model (bypassing
  // only the per-config update permission, a system cascade) so afterUpdate
  // still fires.
  public async removeProjectIdFromAll(projectId: string) {
    const affected = await this._find({ project: projectId });
    for (const config of affected) {
      await this.dangerousUpdateBypassPermission(config, { project: "" });
    }
  }
}
