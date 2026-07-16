import { isEqual, omit } from "lodash";
import { ConstantInterface, ConstantWithoutValue } from "shared/types/constant";
import {
  ApiConstant,
  constantValidator,
  getCyclicConstantRefs,
} from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import { BadRequestError } from "back-end/src/util/errors";
import {
  resolvableValueChanged,
  assertConstantArchivable,
} from "back-end/src/services/constants";
import { getResolvableValues } from "back-end/src/services/resolvableValues";
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
  // Request-scoped memoized load: reference/cycle scans (getResolvableValues)
  // read the whole collection several times per write. Loads once and hands the
  // same promise to every caller until a write invalidates it; a rejected load
  // isn't cached, so a later call retries. Mirrors ConfigModel.reconcileSnapshot.
  private allSnapshot: Promise<ConstantInterface[]> | null = null;

  public getAll(): Promise<ConstantInterface[]> {
    if (this.allSnapshot === null) {
      this.allSnapshot = super.getAll().catch((err) => {
        this.allSnapshot = null;
        throw err;
      });
    }
    return this.allSnapshot;
  }

  private invalidateAllSnapshot(): void {
    this.allSnapshot = null;
  }

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

  // Reject cyclic values at the model layer so every write is covered, including
  // the publish path (closing the TOCTOU between two concurrently-created drafts).
  // Reads via the permission-filtered getAll(); a cross-project cycle the writer
  // can't see degrades gracefully at resolution, so an unfiltered read isn't worth it.
  private async assertNoCycle(
    key: string,
    value: string | undefined,
    environmentValues: Record<string, string> | undefined,
  ): Promise<void> {
    const cyclic = getCyclicConstantRefs(
      key,
      value,
      environmentValues,
      // Constants reference only constants (`@const:`), so a constant cycle is
      // confined to the constant namespace — scope to it.
      (await getResolvableValues(this.context)).filter(
        (c) => c.source === "constant",
      ),
      "constant",
    );
    if (cyclic.length) {
      throw new BadRequestError(
        `This value references ${cyclic
          .map((k) => `@const:${k}`)
          .join(", ")}, which would create a reference cycle.`,
      );
    }
  }

  protected async beforeCreate(doc: ConstantInterface) {
    await this.assertNoCycle(doc.key, doc.value, doc.environmentValues);
  }

  protected async beforeUpdate(
    existing: ConstantInterface,
    updates: UpdateProps<ConstantInterface>,
    newDoc: ConstantInterface,
  ) {
    // Model-level backstop (handlers also check, for earlier/friendlier errors):
    // block archiving a still-referenced constant on ANY write path, so a revert-
    // to-publish or a publish-after-staging can't slip an archive past the
    // handler-level guards and leave its `@const:` refs resolving verbatim.
    // Mirrors ConfigModel.beforeUpdate.
    if (updates.archived === true && !existing.archived) {
      await assertConstantArchivable(this.context, existing.id);
    }
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

  protected async afterCreate(doc: ConstantInterface) {
    this.invalidateAllSnapshot();
    await logConstantCreatedEvent(this.context, this.toApiInterface(doc));
  }

  // Refresh SDK payloads when a change alters the resolved value.
  protected async afterUpdate(
    existing: ConstantInterface,
    updates: UpdateProps<ConstantInterface>,
    newDoc: ConstantInterface,
  ) {
    this.invalidateAllSnapshot();
    if (
      updates.value !== undefined ||
      updates.environmentValues !== undefined ||
      updates.project !== undefined ||
      updates.archived !== undefined
    ) {
      resolvableValueChanged(
        this.context,
        "updated",
        "constant",
        newDoc.key,
      ).catch((e) => {
        this.context.logger.error(
          e,
          "Error refreshing SDK Payload on constant update",
        );
      });
    }

    // Skip the webhook event when only `dateUpdated` changed.
    const previous = this.toApiInterface(existing);
    const current = this.toApiInterface(newDoc);
    if (
      !isEqual(omit(previous, ["dateUpdated"]), omit(current, ["dateUpdated"]))
    ) {
      await logConstantUpdatedEvent(this.context, previous, current);
    }
  }

  // A delete leaves references unresolved, changing the payload.
  protected async afterDelete(doc: ConstantInterface) {
    this.invalidateAllSnapshot();
    resolvableValueChanged(this.context, "deleted", "constant", doc.key).catch(
      (e) => {
        this.context.logger.error(
          e,
          "Error refreshing SDK Payload on constant delete",
        );
      },
    );
    await logConstantDeletedEvent(this.context, this.toApiInterface(doc));
  }

  public getByKey(key: string) {
    return this._findOne({ key });
  }

  // Value-omitted projection for the definitions context.
  public async getAllWithoutValues(): Promise<ConstantWithoutValue[]> {
    const constants = await this._find(
      {},
      { projection: { value: 0, environmentValues: 0 } },
    );
    return constants as ConstantWithoutValue[];
  }

  // Owner email is resolved separately by the handler (async user lookup).
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

  // On project delete, unset it on scoped constants (becomes global). Goes through
  // the model (bypassing only the update permission) so afterUpdate hooks fire.
  public async removeProjectIdFromAll(projectId: string) {
    const affected = await this._find({ project: projectId });
    for (const constant of affected) {
      await this.dangerousUpdateBypassPermission(constant, { project: "" });
    }
  }
}
