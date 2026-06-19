import { ConstantInterface, ConstantWithoutValue } from "shared/types/constant";
import { constantValidator } from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import { UpdateFilter } from "mongodb";
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
    return this.context.permissions.canReadMultiProjectResource(doc.projects);
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

  public getByKey(key: string) {
    return this._findOne({ key });
  }

  // Value-omitted projection for the definitions context (see
  // ConstantWithoutValue). Full values are fetched per-constant on demand.
  public async getAllWithoutValues(): Promise<ConstantWithoutValue[]> {
    const constants = await this._find(
      {},
      { projection: { defaultValue: 0, environmentValues: 0 } },
    );
    return constants as ConstantWithoutValue[];
  }

  public async removeProjectIdFromAll(projectId: string) {
    const pull: UpdateFilter<ConstantInterface> = { projects: projectId };
    await this._dangerousGetCollection().updateMany(
      { organization: this.context.org.id, projects: projectId },
      { $pull: pull },
    );
  }
}
