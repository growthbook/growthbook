import uniqid from "uniqid";
import { UpdateProps } from "shared/types/base-model";
import {
  AggregatedFactTableInterface,
  aggregatedFactTableValidator,
} from "shared/validators";
import { MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "aggregatedfacttables";

const ID_PREFIX = "aft_";

// Lock is stale once its heartbeat is older than this; the runner refreshes
// periodically, so this only needs to cover slow polls/brief stalls, not a full run.
export const AGGREGATED_FACT_TABLE_LOCK_STALE_MS = 30 * 60 * 1000;

const BaseClass = MakeModelClass({
  schema: aggregatedFactTableValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: ID_PREFIX,
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        datasourceId: 1,
        factTableId: 1,
        idType: 1,
      },
      unique: true,
    },
  ],
});

export type AggregatedFactTableKey = {
  datasourceId: string;
  factTableId: string;
  idType: string;
};

export class AggregatedFactTableModel extends BaseClass {
  public async getByKey(key: AggregatedFactTableKey) {
    return this._findOne(key);
  }

  public async getByFactTableId(factTableId: string) {
    return this._find({ factTableId });
  }

  public async getAllForOrg() {
    return this.getAll();
  }

  public async upsertByKey(
    key: AggregatedFactTableKey,
    data: UpdateProps<AggregatedFactTableInterface>,
  ) {
    const existing = await this._findOne(key);
    if (existing) {
      return this.update(existing, data);
    }
    return this.create({
      ...key,
      tableFullName: null,
      lastMaxTimestamp: null,
      firstEventDate: null,
      lastEventDate: null,
      factTableSettingsHash: null,
      factTableNonSqlSettingsHash: null,
      factTableColumnsFingerprint: null,
      metricState: [],
      currentExecutionId: null,
      inFlightExecutionId: null,
      lastRunId: null,
      ...data,
    });
  }

  public async acquireLock(
    key: AggregatedFactTableKey,
    executionId: string,
  ): Promise<boolean> {
    const staleThreshold = new Date(
      Date.now() - AGGREGATED_FACT_TABLE_LOCK_STALE_MS,
    );
    try {
      const result = await this._dangerousGetCollection().updateOne(
        {
          organization: this.context.org.id,
          ...key,
          $or: [
            // Unlocked
            { currentExecutionId: null },
            // Heartbeat stale → holder crashed or stalled (non-null only)
            { lockHeartbeatAt: { $lt: staleThreshold, $ne: null } },
            // Legacy docs without a heartbeat: fall back to dateUpdated
            { lockHeartbeatAt: null, dateUpdated: { $lt: staleThreshold } },
          ],
        },
        {
          $set: {
            currentExecutionId: executionId,
            lockHeartbeatAt: new Date(),
            dateUpdated: new Date(),
          },
          $setOnInsert: {
            id: uniqid(ID_PREFIX),
            organization: this.context.org.id,
            ...key,
            dateCreated: new Date(),
            tableFullName: null,
            lastMaxTimestamp: null,
            firstEventDate: null,
            lastEventDate: null,
            factTableSettingsHash: null,
            factTableNonSqlSettingsHash: null,
            factTableColumnsFingerprint: null,
            metricState: [],
            inFlightExecutionId: null,
            lastRunId: null,
          },
        },
        { upsert: true },
      );
      // upserted = created a new locked doc; modified = took over an unlocked/stale doc
      return (result.upsertedCount ?? 0) > 0 || (result.modifiedCount ?? 0) > 0;
    } catch (error) {
      // Duplicate key error from concurrent upserts — another process won
      if (
        error &&
        typeof error === "object" &&
        (("code" in error && error.code === 11000) ||
          ("message" in error &&
            typeof error.message === "string" &&
            error.message.includes("11000")))
      ) {
        return false;
      }
      throw error;
    }
  }

  // Idempotency gate for the frequent scheduler poller. Atomically claims the
  // given day's `fireTime` slot for this (org, factTable, idType) by setting
  // `lastScheduledRunAt = fireTime`, but only if it hasn't already been claimed
  // for this slot (or a later one). Returns true if this call won the claim and
  // should enqueue a run; false if the slot was already claimed.
  public async claimScheduledSlot(
    key: AggregatedFactTableKey,
    fireTime: Date,
  ): Promise<boolean> {
    try {
      const result = await this._dangerousGetCollection().updateOne(
        {
          organization: this.context.org.id,
          ...key,
          $or: [
            { lastScheduledRunAt: null },
            { lastScheduledRunAt: { $exists: false } },
            { lastScheduledRunAt: { $lt: fireTime } },
          ],
        },
        {
          $set: {
            lastScheduledRunAt: fireTime,
            dateUpdated: new Date(),
          },
          $setOnInsert: {
            id: uniqid(ID_PREFIX),
            organization: this.context.org.id,
            ...key,
            dateCreated: new Date(),
            tableFullName: null,
            lastMaxTimestamp: null,
            firstEventDate: null,
            lastEventDate: null,
            factTableSettingsHash: null,
            factTableNonSqlSettingsHash: null,
            factTableColumnsFingerprint: null,
            metricState: [],
            currentExecutionId: null,
            inFlightExecutionId: null,
            lastRunId: null,
          },
        },
        { upsert: true },
      );
      return (result.upsertedCount ?? 0) > 0 || (result.modifiedCount ?? 0) > 0;
    } catch (error) {
      // Concurrent upsert from another poller won the race.
      if (
        error &&
        typeof error === "object" &&
        (("code" in error && error.code === 11000) ||
          ("message" in error &&
            typeof error.message === "string" &&
            error.message.includes("11000")))
      ) {
        return false;
      }
      throw error;
    }
  }

  public async releaseLock(key: AggregatedFactTableKey, executionId: string) {
    await this._dangerousGetCollection().updateOne(
      {
        organization: this.context.org.id,
        ...key,
        currentExecutionId: executionId,
      },
      {
        $set: {
          currentExecutionId: null,
          lockHeartbeatAt: null,
          dateUpdated: new Date(),
        },
      },
    );
  }

  public async touchLockHeartbeat(
    key: AggregatedFactTableKey,
    executionId: string,
  ) {
    await this._dangerousGetCollection().updateOne(
      {
        organization: this.context.org.id,
        ...key,
        currentExecutionId: executionId,
      },
      { $set: { lockHeartbeatAt: new Date(), dateUpdated: new Date() } },
    );
  }

  public async updateByKeyIfCurrentExecution(
    key: AggregatedFactTableKey,
    executionId: string,
    data: UpdateProps<AggregatedFactTableInterface>,
  ): Promise<boolean> {
    const result = await this._dangerousGetCollection().updateOne(
      {
        organization: this.context.org.id,
        ...key,
        currentExecutionId: executionId,
      },
      { $set: { ...data, dateUpdated: new Date() } },
    );
    return result.matchedCount > 0;
  }

  protected canRead(_doc: AggregatedFactTableInterface) {
    return true;
  }
  protected canCreate(_doc: AggregatedFactTableInterface) {
    return true;
  }
  protected canUpdate(
    _existing: AggregatedFactTableInterface,
    _updates: UpdateProps<AggregatedFactTableInterface>,
    _newDoc: AggregatedFactTableInterface,
  ) {
    return true;
  }
  protected canDelete(_existing: AggregatedFactTableInterface) {
    return true;
  }
}
