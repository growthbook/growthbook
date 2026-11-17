import {
  ConfirmationInterface,
  confirmationValidator,
} from "shared/validators";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: confirmationValidator,
  collectionName: "confirmations",
  idPrefix: "cnf_",
  additionalIndexes: [
    { fields: { organization: 1, apiKeyId: 1, requestHash: 1 } },
    { fields: { deleteAt: 1 }, expireAfterSeconds: 0 },
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

  public findByRequester(
    apiKeyId: string | null,
    userId: string | null,
    statuses: ConfirmationInterface["status"][],
  ) {
    const or = [
      ...(apiKeyId ? [{ apiKeyId }] : []),
      ...(userId ? [{ userId }] : []),
    ];
    if (!or.length) return Promise.resolve([]);
    return this._find(
      { $or: or, status: { $in: statuses } },
      {
        sort: { dateCreated: -1 },
        projection: { body: 0, query: 0, links: 0, notices: 0 },
      },
    );
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
