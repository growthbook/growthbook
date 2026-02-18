import {
  SdkConnectionCacheAuditContext,
  sdkConnectionCacheValidator,
} from "shared/validators";
import { MakeModelClass } from "./BaseModel";

// Increment this if we change the payload contents in a backwards-incompatible way
export const LATEST_SDK_PAYLOAD_SCHEMA_VERSION = 1;

const BaseClass = MakeModelClass({
  schema: sdkConnectionCacheValidator,
  collectionName: "sdkcache",
  idPrefix: "sdk-",
  globallyUniqueIds: true,
  additionalIndexes: [{ fields: { id: 1, schemaVersion: 1 }, unique: true }],
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

  public async getById(id: string) {
    return await this._findOne({
      id,
      schemaVersion: LATEST_SDK_PAYLOAD_SCHEMA_VERSION,
    });
  }

  public async upsert(
    id: string,
    contents: string,
    auditContext?: SdkConnectionCacheAuditContext,
  ) {
    const existing = await this.getById(id);
    const updateData: {
      contents: string;
      schemaVersion: number;
      audit?: SdkConnectionCacheAuditContext;
    } = {
      contents,
      schemaVersion: LATEST_SDK_PAYLOAD_SCHEMA_VERSION,
    };
    if (auditContext) {
      updateData.audit = auditContext;
    }
    if (existing) {
      return this.update(existing, updateData);
    }
    return this.create({ id, ...updateData });
  }

  // Delete all cache entries for legacy API keys
  public async deleteAllLegacyCacheEntries() {
    return await this._dangerousGetCollection().deleteMany({
      organization: this.context.org.id,
      id: /^legacy:/,
      schemaVersion: LATEST_SDK_PAYLOAD_SCHEMA_VERSION,
    });
  }
}

const LEGACY_KEY_PREFIX = "legacy:";

export function formatLegacyCacheKey({
  apiKey,
  environment,
  project,
}: {
  apiKey: string;
  environment?: string;
  project: string;
}): string {
  const env = environment || "production";
  const parts = [LEGACY_KEY_PREFIX + apiKey, env, project];
  return parts.join(":");
}

// TODO: add support for S3 and GCS storage backends
export function getSDKPayloadCacheLocation(): "mongo" | "none" {
  const loc = process.env.SDK_PAYLOAD_CACHE;
  if (loc === "none") return "none";
  // Default to mongo
  return "mongo";
}
