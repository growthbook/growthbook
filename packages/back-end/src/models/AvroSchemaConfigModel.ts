import {
  AvroSchemaConfigInterface,
  avroSchemaConfigValidator,
} from "shared/validators";
// import { UpdateProps } from "shared/types/base-model";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: avroSchemaConfigValidator,
  collectionName: "avroschemaconfigs",
  idPrefix: "avsc_",
  globallyUniquePrimaryKeys: false,
});

export class AvroSchemaConfigModel extends BaseClass {
  protected canCreate(): boolean {
    return this.context.permissions.canManageOrgSettings();
  }
  protected canRead(): boolean {
    return this.context.permissions.canManageOrgSettings();
  }
  protected canUpdate(): boolean {
    return this.context.permissions.canManageOrgSettings();
  }
  protected canDelete(): boolean {
    return this.context.permissions.canManageOrgSettings();
  }

  async getForOrg(): Promise<AvroSchemaConfigInterface | null> {
    const docs = await this._find({});
    return docs[0] ?? null;
  }
}
