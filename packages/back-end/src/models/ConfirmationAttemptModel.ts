import {
  ConfirmationNotice,
  confirmationAttemptValidator,
} from "shared/validators";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: confirmationAttemptValidator,
  collectionName: "confirmationattempts",
  idPrefix: "cna_",
  additionalIndexes: [
    { fields: { organization: 1, apiKeyId: 1, requestHash: 1 } },
    { fields: { deleteAt: 1 }, expireAfterSeconds: 0 },
  ],
});

// Written and read only by the hold machinery, for the key making the request.
export class ConfirmationAttemptModel extends BaseClass {
  protected canCreate() {
    return true;
  }
  protected canRead() {
    return true;
  }
  protected canUpdate() {
    return true;
  }
  protected canDelete() {
    return false;
  }

  public findLatest(apiKeyId: string, requestHash: string) {
    return this._findOne({
      apiKeyId,
      requestHash,
      deleteAt: { $gt: new Date() },
    });
  }

  // One record per request: a newer refusal replaces the older one.
  public async record(
    apiKeyId: string,
    requestHash: string,
    notices: ConfirmationNotice[],
    deleteAt: Date,
  ) {
    const existing = await this._findOne({ apiKeyId, requestHash });
    if (existing) return this.update(existing, { notices, deleteAt });
    return this.create({ apiKeyId, requestHash, notices, deleteAt });
  }
}
