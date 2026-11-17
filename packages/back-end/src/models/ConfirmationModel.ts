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
    // findByRequester: one per $or branch, so each is merged in dateCreated order.
    {
      fields: {
        organization: 1,
        userId: 1,
        status: 1,
        dateCreated: -1,
        id: -1,
      },
    },
    {
      fields: {
        organization: 1,
        apiKeyId: 1,
        status: 1,
        dateCreated: -1,
        id: -1,
      },
    },
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
    statusQuery: FilterQuery<ConfirmationInterface>[],
    { limit, offset }: { limit: number; offset: number },
  ) {
    const requesters = [
      ...(apiKeyId ? [{ apiKeyId }] : []),
      ...(userId ? [{ userId }] : []),
    ];
    if (!requesters.length) return { docs: [], total: 0 };
    // One flat $or of requester × status branches: each matches an index through
    // status, so Mongo merges them in sort order. Nesting the $ors forces an in-memory sort.
    const query = {
      $or: requesters.flatMap((r) => statusQuery.map((s) => ({ ...r, ...s }))),
    };
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
