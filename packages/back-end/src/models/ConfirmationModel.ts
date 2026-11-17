import type { FilterQuery } from "mongoose";
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

  public async findByRequester(
    apiKeyId: string | null,
    userId: string | null,
    statusQuery: FilterQuery<ConfirmationInterface>,
    { limit, offset }: { limit: number; offset: number },
  ) {
    const or = [
      ...(apiKeyId ? [{ apiKeyId }] : []),
      ...(userId ? [{ userId }] : []),
    ];
    if (!or.length) return { docs: [], total: 0 };
    const query = { $and: [{ $or: or }, statusQuery] };
    const [docs, total] = await Promise.all([
      this._find(query, {
        sort: { dateCreated: -1, id: -1 },
        projection: { body: 0, query: 0, links: 0, notices: 0 },
        limit,
        skip: offset,
        // canRead allows every row, and bypassing it lets the database do the paging.
        bypassReadPermissionChecks: true,
      }),
      this._countDocuments(query),
    ]);
    return { docs, total };
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
