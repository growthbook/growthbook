import {
  confirmationValidator,
  type ConfirmationInterface,
} from "shared/validators";
import { getCollection } from "back-end/src/util/mongo.util";
import { MakeModelClass } from "./BaseModel";

const COLLECTION_NAME = "confirmations";

const BaseClass = MakeModelClass({
  schema: confirmationValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "cnf_",
  additionalIndexes: [
    { fields: { organization: 1, apiKeyId: 1, requestHash: 1 } },
    { fields: { deleteAt: 1 }, expireAfterSeconds: 0 },
    { fields: { status: 1, decidedAt: 1 } },
  ],
});

// Callers check access: getConfirmation for the requester, confirmationDecisions
// for the person deciding.
export class ConfirmationModel extends BaseClass {
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

  // Cross-org, for the job that fails runs a server restart cut off.
  static async dangerouslyFindStuckRuns(
    startedBefore: Date,
  ): Promise<{ organization: string; id: string }[]> {
    const docs = await getCollection<ConfirmationInterface>(COLLECTION_NAME)
      .find(
        { status: "running", decidedAt: { $lte: startedBefore } },
        { projection: { organization: 1, id: 1 } },
      )
      .toArray();
    return docs.map(({ organization, id }) => ({ organization, id }));
  }

  public findPending(apiKeyId: string, requestHash: string) {
    return this._findOne({
      apiKeyId,
      requestHash,
      status: "pending",
      expiresAt: { $gt: new Date() },
    });
  }
}
