import { UpdateProps } from "shared/types/base-model";
import {
  QueryRunnerRunInterface,
  QueryRunnerRunTargetType,
  queryRunnerRunValidator,
} from "shared/validators";
import { getCollection } from "back-end/src/util/mongo.util";
import { MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "queryrunnerruns";

/**
 * A held lock is considered stale when its heartbeat is older than this threshold.
 */
export const QUERY_RUNNER_LOCK_STALE_MS = 5 * 60 * 1000;

const BaseClass = MakeModelClass({
  schema: queryRunnerRunValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "qrr_",
  globallyUniquePrimaryKeys: true,
  defaultValues: {
    queryIds: [],
  },
  readonlyFields: ["queryIds"],
  additionalIndexes: [
    { fields: { organization: 1, targetType: 1, targetId: 1 } }, // Get run by target
    { fields: { lockHeartbeatAt: 1, lockToken: 1 } }, // Find stale held runs across orgs
  ],
});

export class QueryRunnerRunModel extends BaseClass {
  public async createForRun(params: {
    targetType: QueryRunnerRunTargetType;
    targetId: string;
    datasourceId: string;
    token: string;
  }): Promise<QueryRunnerRunInterface> {
    return this.create({
      targetType: params.targetType,
      targetId: params.targetId,
      datasourceId: params.datasourceId,
      queryIds: [],
      lockToken: params.token,
      lockHeartbeatAt: new Date(),
    });
  }

  public async acquireLock(id: string, token: string): Promise<boolean> {
    const staleThreshold = new Date(Date.now() - QUERY_RUNNER_LOCK_STALE_MS);
    const result = await this._dangerousGetCollection().updateOne(
      {
        organization: this.context.org.id,
        id,
        $or: [
          { lockToken: null }, // free
          {
            lockHeartbeatAt: { $lt: staleThreshold, $ne: null },
          }, // lock is stale
          { lockToken: token }, // lock is held by this token
        ],
      },
      { $set: { lockToken: token, lockHeartbeatAt: new Date() } },
    );
    return result.matchedCount > 0;
  }

  public async setQueryIds(
    id: string,
    token: string,
    queryIds: string[],
  ): Promise<boolean> {
    const roster = [...new Set(queryIds)];
    const result = await this._dangerousGetCollection().updateOne(
      {
        organization: this.context.org.id,
        id,
        lockToken: token,
        $or: [{ queryIds: [] }, { queryIds: roster }],
      },
      { $set: { queryIds: roster } },
    );
    return result.matchedCount > 0;
  }

  /**
   * Returns false when the token no longer holds the lock so we can stop the run
   */
  public async touchLockHeartbeat(id: string, token: string): Promise<boolean> {
    const result = await this._dangerousGetCollection().updateOne(
      { organization: this.context.org.id, id, lockToken: token },
      { $set: { lockHeartbeatAt: new Date() } },
    );
    return result.matchedCount > 0;
  }

  public async releaseLock(id: string, token: string): Promise<void> {
    await this._dangerousGetCollection().updateOne(
      { organization: this.context.org.id, id, lockToken: token },
      { $set: { lockToken: null, lockHeartbeatAt: null } },
    );
  }

  /** Live run for this product document, if one exists. */
  public async getActiveByTarget(
    targetType: QueryRunnerRunTargetType,
    targetId: string,
  ): Promise<QueryRunnerRunInterface | null> {
    const freshThreshold = new Date(Date.now() - QUERY_RUNNER_LOCK_STALE_MS);
    return this._findOne({
      targetType,
      targetId,
      lockToken: { $ne: null },
      lockHeartbeatAt: { $gte: freshThreshold },
    });
  }

  public static async dangerouslyFindActiveRuns(
    targetType: QueryRunnerRunTargetType,
    documents: Array<{ organization: string; id: string }>,
  ): Promise<QueryRunnerRunInterface[]> {
    if (documents.length === 0) return [];

    const freshThreshold = new Date(Date.now() - QUERY_RUNNER_LOCK_STALE_MS);
    return getCollection<QueryRunnerRunInterface>(COLLECTION_NAME)
      .find({
        targetType,
        lockToken: { $ne: null },
        lockHeartbeatAt: { $gte: freshThreshold },
        $or: documents.map(({ organization, id }) => ({
          organization,
          targetId: id,
        })),
      })
      .toArray();
  }

  public static async dangerouslyFindStaleQueryRunnerRuns(
    limit: number,
  ): Promise<QueryRunnerRunInterface[]> {
    const staleThreshold = new Date(Date.now() - QUERY_RUNNER_LOCK_STALE_MS);
    return getCollection<QueryRunnerRunInterface>(COLLECTION_NAME)
      .find({
        lockToken: { $ne: null },
        lockHeartbeatAt: { $lt: staleThreshold },
      })
      .limit(limit)
      .toArray();
  }

  // Runs are managed by the system
  protected canRead(_doc: QueryRunnerRunInterface) {
    return true;
  }
  protected canCreate(_doc: QueryRunnerRunInterface) {
    return true;
  }
  protected canUpdate(
    _existing: QueryRunnerRunInterface,
    _updates: UpdateProps<QueryRunnerRunInterface>,
    _newDoc: QueryRunnerRunInterface,
  ) {
    return true;
  }
  // Runs are a permanent audit trail.
  protected canDelete(_existing: QueryRunnerRunInterface) {
    return false;
  }
}
