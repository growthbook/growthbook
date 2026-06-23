import { isEqual, omit } from "lodash";
import { ConstantInterface, ConstantWithoutValue } from "shared/types/constant";
import { ApiConstant, constantValidator } from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import { constantUpdated } from "back-end/src/services/constants";
import {
  logConstantCreatedEvent,
  logConstantUpdatedEvent,
  logConstantDeletedEvent,
} from "back-end/src/services/constantEvents";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: constantValidator,
  collectionName: "constants",
  idPrefix: "const_",
  auditLog: {
    entity: "constant",
    createEvent: "constant.created",
    updateEvent: "constant.updated",
    deleteEvent: "constant.deleted",
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

export class ConstantModel extends BaseClass {
  protected canRead(doc: ConstantInterface): boolean {
    return this.context.permissions.canReadSingleProjectResource(doc.project);
  }

  protected canCreate(doc: ConstantInterface): boolean {
    return this.context.permissions.canCreateConstant(doc);
  }

  protected canUpdate(
    existing: ConstantInterface,
    _updates: UpdateProps<ConstantInterface>,
    newDoc: ConstantInterface,
  ): boolean {
    return this.context.permissions.canUpdateConstant(existing, newDoc);
  }

  protected canDelete(doc: ConstantInterface): boolean {
    return this.context.permissions.canDeleteConstant(doc);
  }

  protected async afterCreate(doc: ConstantInterface) {
    await logConstantCreatedEvent(this.context, this.toApiInterface(doc));
  }

  // Refresh SDK payloads (and fire SDK webhooks) when a published change alters
  // the resolved value. Runs on the live update — for the approval flow that's
  // at merge time (the adapter calls `update`), for direct edits it's immediate.
  protected async afterUpdate(
    existing: ConstantInterface,
    updates: UpdateProps<ConstantInterface>,
    newDoc: ConstantInterface,
  ) {
    if (
      updates.value !== undefined ||
      updates.environmentValues !== undefined ||
      updates.project !== undefined ||
      updates.archived !== undefined
    ) {
      constantUpdated(this.context).catch((e) => {
        this.context.logger.error(
          e,
          "Error refreshing SDK Payload on constant update",
        );
      });
    }

    // Skip the webhook event when nothing meaningful changed (e.g. only
    // `dateUpdated` was bumped) — mirrors the saved-group/feature behavior.
    const previous = this.toApiInterface(existing);
    const current = this.toApiInterface(newDoc);
    if (
      !isEqual(omit(previous, ["dateUpdated"]), omit(current, ["dateUpdated"]))
    ) {
      await logConstantUpdatedEvent(this.context, previous, current);
    }
  }

  // A deleted constant leaves its `@const:` references unresolved, which changes
  // the generated payload, so refresh on delete too.
  protected async afterDelete(doc: ConstantInterface) {
    constantUpdated(this.context, "deleted").catch((e) => {
      this.context.logger.error(
        e,
        "Error refreshing SDK Payload on constant delete",
      );
    });
    await logConstantDeletedEvent(this.context, this.toApiInterface(doc));
  }

  public getByKey(key: string) {
    return this._findOne({ key });
  }

  // Value-omitted projection for the definitions context (see
  // ConstantWithoutValue). Full values are fetched per-constant on demand.
  public async getAllWithoutValues(): Promise<ConstantWithoutValue[]> {
    const constants = await this._find(
      {},
      { projection: { value: 0, environmentValues: 0 } },
    );
    return constants as ConstantWithoutValue[];
  }

  // External REST API shape. Owner email is resolved separately by the handler
  // (via resolveOwnerEmail) since it requires an async user lookup.
  public toApiInterface(constant: ConstantInterface): ApiConstant {
    return {
      id: constant.id,
      key: constant.key,
      name: constant.name,
      type: constant.type,
      owner: constant.owner,
      ownerEmail: "",
      value: constant.value,
      environmentValues: constant.environmentValues,
      description: constant.description,
      project: constant.project,
      archived: constant.archived,
      dateCreated: constant.dateCreated.toISOString(),
      dateUpdated: constant.dateUpdated.toISOString(),
    };
  }

  // When a project is deleted, unset it on any constant scoped to it (becomes
  // global), mirroring how features clear a deleted project.
  public async removeProjectIdFromAll(projectId: string) {
    await this._dangerousGetCollection().updateMany(
      { organization: this.context.org.id, project: projectId },
      { $set: { project: "" } },
    );
  }
}
