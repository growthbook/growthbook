import {
  SdkConnectionCacheAuditContext,
  sdkConnectionCacheValidator,
} from "shared/validators";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: sdkConnectionCacheValidator,
  collectionName: "sdkcache",
  idPrefix: "sdk-",
  globallyUniqueIds: true,
});

export class SdkConnectionCacheModel extends BaseClass {
  protected canRead() {
    return true;
  }

  protected canCreate() {
    return true;
  }

  protected canUpdate() {
    return true;
  }

  protected canDelete() {
    return true;
  }

  public async upsert(
    id: string,
    contents: string,
    auditContext?: SdkConnectionCacheAuditContext,
  ) {
    const existing = await this.getById(id);
    const updateData: {
      contents: string;
      audit?: SdkConnectionCacheAuditContext;
    } = {
      contents,
    };
    if (auditContext) {
      updateData.audit = auditContext;
    }
    if (existing) {
      return this.update(existing, updateData);
    }
    return this.create({ id, ...updateData });
  }
}
