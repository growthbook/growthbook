import { sdkConnectionCacheValidator } from "shared/validators";
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

  public async upsert(id: string, contents: string) {
    const existing = await this.getById(id);
    if (existing) {
      return this.update(existing, { contents });
    }
    return this.create({ id, contents });
  }
}
