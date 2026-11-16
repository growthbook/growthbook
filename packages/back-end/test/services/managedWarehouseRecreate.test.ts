import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { ManagedWarehouseRecreateRequest } from "shared/validators";
import { getCollection } from "back-end/src/util/mongo.util";
import {
  dangerousRecreateClickhouseTables,
  LicenseServerNoResponseError,
} from "back-end/src/services/licenseServerManagedClickhouse";
import {
  advanceManagedWarehouseRecreate,
  cancelPendingManagedWarehouseRecreates,
  deleteManagedWarehouseRecreateRequest,
  getManagedWarehouseRecreateSummary,
  requestManagedWarehouseRecreates,
  retryFailedManagedWarehouseRecreates,
} from "back-end/src/services/managedWarehouseRecreate";

jest.mock("back-end/src/services/licenseServerManagedClickhouse", () => ({
  ...jest.requireActual("back-end/src/services/licenseServerManagedClickhouse"),
  dangerousRecreateClickhouseTables: jest.fn(),
}));
const recreate = jest.mocked(dangerousRecreateClickhouseTables);

let mongo: MongoMemoryServer;
const datasources = () => getCollection("datasources");

async function addWarehouse(organization: string, provisioned = true) {
  await datasources().insertOne({
    id: `ds_${organization}`,
    organization,
    type: "growthbook_clickhouse",
    settings: { hasBeenProvisioned: provisioned },
  });
}

async function setLicenseServerResult(
  organization: string,
  status: "success" | "error",
  error?: string,
) {
  await datasources().updateOne(
    { organization },
    {
      $set: {
        recreateStatus: { status, at: new Date(Date.now() + 1000), error },
      },
    },
  );
}

async function getManagedWarehouseRecreateRequest(organization: string) {
  const doc = await getCollection<{
    organization: string;
    recreateRequest?: ManagedWarehouseRecreateRequest;
  }>("datasources").findOne({ organization });
  return doc?.recreateRequest;
}

const statusOf = async (organization: string) =>
  (await getManagedWarehouseRecreateRequest(organization))?.status;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 30000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
beforeEach(async () => {
  await datasources().deleteMany({});
  recreate.mockReset();
  recreate.mockResolvedValue("started");
});

test("requests skip never-provisioned warehouses and running recreates", async () => {
  await addWarehouse("org_a");
  await addWarehouse("org_b", false);
  await addWarehouse("org_c");
  await requestManagedWarehouseRecreates({
    organizations: ["org_c"],
    tables: ["feature_usage"],
    requestedBy: "u_1",
  });
  await advanceManagedWarehouseRecreate("org_c");
  expect(await statusOf("org_c")).toBe("running");

  const created = await requestManagedWarehouseRecreates({
    organizations: "all",
    tables: ["feature_usage"],
    requestedBy: "u_1",
  });

  expect(created).toBe(1);
  expect(await statusOf("org_a")).toBe("pending");
  expect(await statusOf("org_b")).toBeUndefined();
  expect(await statusOf("org_c")).toBe("running");
});

test("a new request adds tables to an org's pending request", async () => {
  await addWarehouse("org_a");
  await requestManagedWarehouseRecreates({
    organizations: ["org_a"],
    tables: ["feature_usage"],
    requestedBy: "u_1",
  });
  const created = await requestManagedWarehouseRecreates({
    organizations: "all",
    tables: ["events"],
    requestedBy: "u_2",
  });

  expect(created).toBe(1);
  const request = await getManagedWarehouseRecreateRequest("org_a");
  expect(request?.tables.sort()).toEqual(["events", "feature_usage"]);
  expect(request?.requestedBy).toBe("u_1");
});

test("a recreate runs, then records the license server's result", async () => {
  await addWarehouse("org_a");
  await requestManagedWarehouseRecreates({
    organizations: ["org_a"],
    tables: ["feature_usage"],
    requestedBy: "u_1",
  });

  await advanceManagedWarehouseRecreate("org_a");
  expect(recreate).toHaveBeenCalledWith("org_a", ["feature_usage"]);
  expect(await statusOf("org_a")).toBe("running");

  // No result yet: still running
  await advanceManagedWarehouseRecreate("org_a");
  expect(await statusOf("org_a")).toBe("running");

  await setLicenseServerResult("org_a", "error", "boom");
  await advanceManagedWarehouseRecreate("org_a");
  const request = await getManagedWarehouseRecreateRequest("org_a");
  expect(request?.status).toBe("failed");
  expect(request?.error).toBe("boom");
});

async function startRecreate(organization: string, minutesAgo: number) {
  await requestManagedWarehouseRecreates({
    organizations: [organization],
    tables: ["feature_usage"],
    requestedBy: "u_1",
  });
  await advanceManagedWarehouseRecreate(organization);
  await datasources().updateOne(
    { organization },
    {
      $set: {
        "recreateRequest.startedAt": new Date(
          Date.now() - minutesAgo * 60 * 1000,
        ),
      },
    },
  );
}

const setLockUntil = (organization: string, minutesFromNow: number | null) =>
  datasources().updateOne(
    { organization },
    {
      $set: {
        lockUntil:
          minutesFromNow === null
            ? null
            : new Date(Date.now() + minutesFromNow * 60 * 1000),
      },
    },
  );

test("a recreate fails once the license server's lock expires", async () => {
  await addWarehouse("org_a");
  await startRecreate("org_a", 30);
  await setLockUntil("org_a", 5);
  await advanceManagedWarehouseRecreate("org_a");
  expect(await statusOf("org_a")).toBe("running");

  await setLockUntil("org_a", -1);
  await advanceManagedWarehouseRecreate("org_a");
  const request = await getManagedWarehouseRecreateRequest("org_a");
  expect(request?.status).toBe("failed");
  expect(request?.error).toBe(
    "The license server didn't report a result. It may have stopped during a deploy. Retry to run it again.",
  );
});

test("a recreate fails if the lock is gone after the grace period", async () => {
  await addWarehouse("org_a");
  await startRecreate("org_a", 10);
  await setLockUntil("org_a", null);
  await advanceManagedWarehouseRecreate("org_a");
  expect(await statusOf("org_a")).toBe("failed");
});

test("an unexpired lock stored as a string keeps the recreate running", async () => {
  await addWarehouse("org_a");
  await startRecreate("org_a", 30);
  await datasources().updateOne(
    { organization: "org_a" },
    { $set: { lockUntil: new Date(Date.now() + 60_000).toISOString() } },
  );
  await advanceManagedWarehouseRecreate("org_a");
  expect(await statusOf("org_a")).toBe("running");
});

test("an expired lock stored as a string counts as expired", async () => {
  await addWarehouse("org_a");
  await startRecreate("org_a", 30);
  await datasources().updateOne(
    { organization: "org_a" },
    { $set: { lockUntil: new Date(Date.now() - 60_000).toISOString() } },
  );
  await advanceManagedWarehouseRecreate("org_a");
  expect(await statusOf("org_a")).toBe("failed");
});

test("a recreate with no response stays running for the lock check", async () => {
  await addWarehouse("org_a");
  await requestManagedWarehouseRecreates({
    organizations: ["org_a"],
    tables: ["feature_usage"],
    requestedBy: "u_1",
  });
  recreate.mockRejectedValue(new LicenseServerNoResponseError("timed out"));

  await advanceManagedWarehouseRecreate("org_a");
  expect(await statusOf("org_a")).toBe("running");
});

test("a result counts even after the lock expires", async () => {
  await addWarehouse("org_a");
  await startRecreate("org_a", 30);
  await setLockUntil("org_a", -1);
  await setLicenseServerResult("org_a", "success");
  await advanceManagedWarehouseRecreate("org_a");
  expect(await statusOf("org_a")).toBe("done");
});

test("a just-started recreate keeps running before the lock shows up", async () => {
  await addWarehouse("org_a");
  await startRecreate("org_a", 1);
  await setLockUntil("org_a", null);
  await advanceManagedWarehouseRecreate("org_a");
  expect(await statusOf("org_a")).toBe("running");
});

test("a recreate still holding the lock fails after 12 hours", async () => {
  await addWarehouse("org_a");
  await startRecreate("org_a", 13 * 60);
  await setLockUntil("org_a", 5);
  await advanceManagedWarehouseRecreate("org_a");
  const request = await getManagedWarehouseRecreateRequest("org_a");
  expect(request?.status).toBe("failed");
  expect(request?.error).toBe(
    "The license server didn't report a result within 12 hours. Retry to run it again.",
  );
});

test("selecting every table sends no table list", async () => {
  await addWarehouse("org_a");
  await requestManagedWarehouseRecreates({
    organizations: ["org_a"],
    tables: ["events", "experiment_views", "feature_usage", "session_replay"],
    requestedBy: "u_1",
  });
  await advanceManagedWarehouseRecreate("org_a");
  expect(recreate).toHaveBeenCalledWith("org_a", undefined);
});

test("at most two recreates run at once", async () => {
  for (const org of ["org_a", "org_b", "org_c"]) await addWarehouse(org);
  await requestManagedWarehouseRecreates({
    organizations: "all",
    tables: ["feature_usage"],
    requestedBy: "u_1",
  });

  for (const org of ["org_a", "org_b", "org_c"]) {
    await advanceManagedWarehouseRecreate(org);
  }
  expect(await statusOf("org_c")).toBe("pending");

  await setLicenseServerResult("org_a", "success");
  await advanceManagedWarehouseRecreate("org_a");
  await advanceManagedWarehouseRecreate("org_c");
  expect(await statusOf("org_a")).toBe("done");
  expect(await statusOf("org_c")).toBe("running");
});

test("a recreate already holding the license server's lock goes back to pending", async () => {
  await addWarehouse("org_a");
  await requestManagedWarehouseRecreates({
    organizations: ["org_a"],
    tables: ["feature_usage"],
    requestedBy: "u_1",
  });
  recreate.mockResolvedValue("already-running");

  await advanceManagedWarehouseRecreate("org_a");

  const request = await getManagedWarehouseRecreateRequest("org_a");
  expect(request?.status).toBe("pending");
  expect(request?.startedAt).toBeUndefined();
});

test("retry requeues failed recreates; cancel drops pending ones", async () => {
  await addWarehouse("org_a");
  await addWarehouse("org_b");
  await requestManagedWarehouseRecreates({
    organizations: ["org_a"],
    tables: ["feature_usage"],
    requestedBy: "u_1",
  });
  recreate.mockRejectedValue(new Error("license server down"));
  await advanceManagedWarehouseRecreate("org_a");
  await requestManagedWarehouseRecreates({
    organizations: ["org_b"],
    tables: ["feature_usage"],
    requestedBy: "u_1",
  });

  const summary = await getManagedWarehouseRecreateSummary();
  expect(summary.provisioned).toBe(2);
  expect(summary.counts).toEqual({
    pending: 1,
    running: 0,
    done: 0,
    failed: 1,
  });

  expect(await retryFailedManagedWarehouseRecreates("u_2")).toBe(1);
  const retried = await getManagedWarehouseRecreateRequest("org_a");
  expect(retried?.status).toBe("pending");
  expect(retried?.requestedBy).toBe("u_2");
  expect(retried?.error).toBeUndefined();

  expect(await cancelPendingManagedWarehouseRecreates()).toBe(2);
  expect(await statusOf("org_a")).toBeUndefined();
  expect(await statusOf("org_b")).toBeUndefined();
});

test("a request can be removed unless it's running", async () => {
  await addWarehouse("org_a");
  await addWarehouse("org_b");
  await requestManagedWarehouseRecreates({
    organizations: "all",
    tables: ["feature_usage"],
    requestedBy: "u_1",
  });
  await advanceManagedWarehouseRecreate("org_a");
  expect(await statusOf("org_a")).toBe("running");

  expect(await deleteManagedWarehouseRecreateRequest("org_a")).toBe(false);
  expect(await statusOf("org_a")).toBe("running");

  expect(await deleteManagedWarehouseRecreateRequest("org_b")).toBe(true);
  expect(await statusOf("org_b")).toBeUndefined();
  expect(await deleteManagedWarehouseRecreateRequest("org_b")).toBe(false);
});
