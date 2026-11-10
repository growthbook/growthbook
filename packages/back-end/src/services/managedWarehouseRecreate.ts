import {
  MANAGED_WAREHOUSE_RECREATABLE_TABLES,
  ManagedWarehouseRecreatableTable,
} from "shared/util";
import type {
  ManagedWarehouseRecreateRequest,
  ManagedWarehouseRecreateStatus,
} from "shared/validators";
import { getCollection } from "back-end/src/util/mongo.util";
import {
  dangerousRecreateClickhouseTables,
  LicenseServerNoResponseError,
} from "back-end/src/services/licenseServerManagedClickhouse";
import { logger } from "back-end/src/util/logger";

// Recreate requests live on each org's Managed Warehouse datasource document
// (see managedWarehouseRecreateRequestValidator). `recreateStatus` is written by
// the license server when a recreate it started finishes. `lockUntil` is the
// license server's lock, which it keeps moving forward while a recreate runs.
type RecreateDatasourceDoc = {
  organization: string;
  type: string;
  settings?: { hasBeenProvisioned?: boolean };
  recreateRequest?: ManagedWarehouseRecreateRequest;
  recreateStatus?: { status: "success" | "error"; at: Date; error?: string };
  // A Date, though the license server also accepts one stored as a string.
  lockUntil?: Date | string | null;
};

/** How many recreates may run at once across all orgs. */
export const MAX_CONCURRENT_RECREATES = 2;

// The license server takes its lock before acking the request; allow time
// before treating a missing lock as a recreate that stopped.
const LOCK_GRACE_MS = 5 * 60 * 1000;

// Backstop for a recreate that's still running but stuck. Each table's
// backfill and refill can each run up to an hour, so a healthy recreate of
// every table can take around 8 hours.
const RECREATE_TIMEOUT_MS = 12 * 60 * 60 * 1000;

const MANAGED_WAREHOUSE_FILTER = { type: "growthbook_clickhouse" } as const;

function datasources() {
  return getCollection<RecreateDatasourceDoc>("datasources");
}

/**
 * Request a recreate of the given tables for each org's Managed Warehouse.
 * Never-provisioned warehouses (no tables yet) and orgs with a recreate already
 * running are skipped. An org with a pending request gets the tables added to
 * it, so queued work is never dropped. Returns how many orgs were queued.
 */
export async function requestManagedWarehouseRecreates({
  organizations,
  tables,
  requestedBy,
}: {
  organizations: string[] | "all";
  tables: ManagedWarehouseRecreatableTable[];
  requestedBy: string;
}): Promise<number> {
  const targets = {
    ...MANAGED_WAREHOUSE_FILTER,
    "settings.hasBeenProvisioned": { $ne: false },
    ...(organizations === "all"
      ? {}
      : { organization: { $in: organizations } }),
  };

  const merged = await datasources().updateMany(
    { ...targets, "recreateRequest.status": "pending" },
    { $addToSet: { "recreateRequest.tables": { $each: tables } } },
  );

  const request: ManagedWarehouseRecreateRequest = {
    tables,
    requestedBy,
    requestedAt: new Date(),
    status: "pending",
  };
  const created = await datasources().updateMany(
    { ...targets, "recreateRequest.status": { $nin: ["pending", "running"] } },
    { $set: { recreateRequest: request } },
  );

  return merged.matchedCount + created.modifiedCount;
}

/**
 * How many Managed Warehouses can be recreated, counts by status, and every
 * request that isn't done.
 */
export async function getManagedWarehouseRecreateSummary(): Promise<{
  provisioned: number;
  counts: Record<ManagedWarehouseRecreateStatus, number>;
  requests: {
    organization: string;
    request: ManagedWarehouseRecreateRequest;
  }[];
}> {
  const docs = await datasources()
    .find(
      { ...MANAGED_WAREHOUSE_FILTER, recreateRequest: { $exists: true } },
      { projection: { organization: 1, recreateRequest: 1 } },
    )
    .toArray();

  const counts: Record<ManagedWarehouseRecreateStatus, number> = {
    pending: 0,
    running: 0,
    done: 0,
    failed: 0,
  };
  const requests: {
    organization: string;
    request: ManagedWarehouseRecreateRequest;
  }[] = [];
  for (const { organization, recreateRequest } of docs) {
    if (!recreateRequest) continue;
    counts[recreateRequest.status]++;
    if (recreateRequest.status !== "done") {
      requests.push({ organization, request: recreateRequest });
    }
  }
  requests.sort(
    (a, b) => a.request.requestedAt.getTime() - b.request.requestedAt.getTime(),
  );
  const provisioned = await datasources().countDocuments({
    ...MANAGED_WAREHOUSE_FILTER,
    "settings.hasBeenProvisioned": { $ne: false },
  });
  return { provisioned, counts, requests };
}

/** Put every failed request back in the queue. Returns how many. */
export async function retryFailedManagedWarehouseRecreates(
  requestedBy: string,
): Promise<number> {
  const res = await datasources().updateMany(
    { ...MANAGED_WAREHOUSE_FILTER, "recreateRequest.status": "failed" },
    {
      $set: {
        "recreateRequest.status": "pending",
        "recreateRequest.requestedBy": requestedBy,
        "recreateRequest.requestedAt": new Date(),
      },
      $unset: {
        "recreateRequest.startedAt": "",
        "recreateRequest.finishedAt": "",
        "recreateRequest.error": "",
      },
    },
  );
  return res.modifiedCount;
}

/** Drop every request that hasn't started yet. Returns how many. */
export async function cancelPendingManagedWarehouseRecreates(): Promise<number> {
  const res = await datasources().updateMany(
    { ...MANAGED_WAREHOUSE_FILTER, "recreateRequest.status": "pending" },
    { $unset: { recreateRequest: "" } },
  );
  return res.modifiedCount;
}

/**
 * Remove an org's recreate request unless it's running: the license server
 * can't stop a recreate once it has started. Returns whether one was removed.
 */
export async function deleteManagedWarehouseRecreateRequest(
  organization: string,
): Promise<boolean> {
  const res = await datasources().updateOne(
    {
      ...MANAGED_WAREHOUSE_FILTER,
      organization,
      recreateRequest: { $exists: true },
      "recreateRequest.status": { $ne: "running" },
    },
    { $unset: { recreateRequest: "" } },
  );
  return res.modifiedCount > 0;
}

export async function getOrganizationsWithRecreateStatus(
  status: ManagedWarehouseRecreateStatus,
  limit: number,
): Promise<string[]> {
  if (limit <= 0) return [];
  const docs = await datasources()
    .find(
      { ...MANAGED_WAREHOUSE_FILTER, "recreateRequest.status": status },
      {
        projection: { organization: 1 },
        sort: { "recreateRequest.requestedAt": 1 },
        limit,
      },
    )
    .toArray();
  return docs.map((d) => d.organization);
}

export async function countRunningManagedWarehouseRecreates(): Promise<number> {
  return datasources().countDocuments({
    ...MANAGED_WAREHOUSE_FILTER,
    "recreateRequest.status": "running",
  });
}

async function finishRecreate(
  organization: string,
  startedAt: Date,
  status: "done" | "failed",
  error?: string,
) {
  await datasources().updateOne(
    {
      ...MANAGED_WAREHOUSE_FILTER,
      organization,
      "recreateRequest.status": "running",
      "recreateRequest.startedAt": startedAt,
    },
    {
      $set: {
        "recreateRequest.status": status,
        "recreateRequest.finishedAt": new Date(),
        ...(error ? { "recreateRequest.error": error } : {}),
      },
    },
  );
}

async function requeue(organization: string, startedAt: Date) {
  await datasources().updateOne(
    {
      ...MANAGED_WAREHOUSE_FILTER,
      organization,
      "recreateRequest.status": "running",
      "recreateRequest.startedAt": startedAt,
    },
    {
      $set: { "recreateRequest.status": "pending" },
      $unset: { "recreateRequest.startedAt": "" },
    },
  );
}

/**
 * Move an org's recreate request forward one step: start it if it's pending
 * and there's room, or record the result if the license server has finished it.
 */
export async function advanceManagedWarehouseRecreate(
  organization: string,
): Promise<void> {
  const doc = await datasources().findOne(
    { ...MANAGED_WAREHOUSE_FILTER, organization },
    { projection: { recreateRequest: 1, recreateStatus: 1, lockUntil: 1 } },
  );
  const request = doc?.recreateRequest;
  if (!request) return;

  if (request.status === "running" && request.startedAt) {
    const result = doc.recreateStatus;
    if (result && result.at > request.startedAt) {
      await finishRecreate(
        organization,
        request.startedAt,
        result.status === "success" ? "done" : "failed",
        result.error,
      );
      return;
    }
    const elapsed = Date.now() - request.startedAt.getTime();
    // The license server writes its result before releasing the lock, so an
    // expired lock with no result usually means the recreate stopped (e.g. a
    // deploy). It can also mean the result failed to save.
    const lockUntil = doc.lockUntil ? new Date(doc.lockUntil).getTime() : NaN;
    // NaN (missing or unparseable) fails the comparison, so counts as expired.
    const lockExpired = !(lockUntil > Date.now());
    if (elapsed > LOCK_GRACE_MS && lockExpired) {
      await finishRecreate(
        organization,
        request.startedAt,
        "failed",
        "The license server stopped or never started without reporting a result",
      );
    } else if (elapsed > RECREATE_TIMEOUT_MS) {
      await finishRecreate(
        organization,
        request.startedAt,
        "failed",
        "The license server didn't report a result within 12 hours",
      );
    }
    return;
  }

  if (request.status !== "pending") return;
  if (
    (await countRunningManagedWarehouseRecreates()) >= MAX_CONCURRENT_RECREATES
  ) {
    return;
  }

  // Claim the request before calling the license server, so a second job
  // can't start the same recreate. Use the tables as claimed: a new request
  // can add tables while the request is pending, but not once it's running.
  const startedAt = new Date();
  const claimed = await datasources().findOneAndUpdate(
    {
      ...MANAGED_WAREHOUSE_FILTER,
      organization,
      "recreateRequest.status": "pending",
      "recreateRequest.requestedAt": request.requestedAt,
    },
    {
      $set: {
        "recreateRequest.status": "running",
        "recreateRequest.startedAt": startedAt,
      },
    },
    { returnDocument: "after", projection: { recreateRequest: 1 } },
  );
  const tables = claimed.value?.recreateRequest?.tables;
  if (!tables) return;

  // Several job workers can pass the count check above at the same time. Each
  // re-counts after claiming and backs out if that put us over the limit, so a
  // worker only starts a recreate once its claim is counted within the limit.
  if (
    (await countRunningManagedWarehouseRecreates()) > MAX_CONCURRENT_RECREATES
  ) {
    await requeue(organization, startedAt);
    return;
  }

  try {
    const allTables = MANAGED_WAREHOUSE_RECREATABLE_TABLES.every((t) =>
      tables.includes(t),
    );
    const result = await dangerousRecreateClickhouseTables(
      organization,
      allTables ? undefined : tables,
    );
    if (result === "already-running") {
      // Another recreate holds the org's lock. Requeue so the sweep retries.
      await requeue(organization, startedAt);
    }
  } catch (e) {
    logger.error(
      e,
      `Failed to start Managed Warehouse recreate for ${organization}`,
    );
    // With no response, the license server may have started the recreate.
    // Leave it running and let the lock check above decide.
    if (e instanceof LicenseServerNoResponseError) return;
    await finishRecreate(
      organization,
      startedAt,
      "failed",
      e instanceof Error ? e.message : String(e),
    );
  }
}
