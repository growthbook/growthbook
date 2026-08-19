/**
 * Real Agenda against mongodb-memory-server — mocks can't catch Agenda
 * clobbering in-handler reschedules of nextRunAt on job completion.
 */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Agenda from "agenda";
import addRefreshStaleSdkConnectionsJob, {
  scheduleOrgRefreshJob,
} from "back-end/src/jobs/refreshStaleSdkConnections";
import { hasAnyStaleSdkConnection } from "back-end/src/models/SdkConnectionModel";

jest.mock("back-end/src/models/SdkConnectionModel", () => ({
  hasAnyStaleSdkConnection: jest.fn(),
  findOrganizationsWithStaleSdkConnections: jest.fn().mockResolvedValue([]),
}));

jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgId: jest.fn().mockResolvedValue({
    org: { id: "org_1" },
  }),
}));

const refreshStaleSdkConnectionsForOrgMock = jest
  .fn()
  .mockResolvedValue(undefined);
jest.mock("back-end/src/services/features", () => ({
  refreshStaleSdkConnectionsForOrg: (...args: unknown[]) =>
    refreshStaleSdkConnectionsForOrgMock(...args),
}));

jest.mock("back-end/src/services/queueing", () => ({
  getAgendaInstance: () => testAgenda,
}));

// Assigned in beforeAll once the real Agenda instance exists — the module
// mock above needs a reference it can close over.
let testAgenda: Agenda;

const hasAnyStaleSdkConnectionMock = hasAnyStaleSdkConnection as jest.Mock;

describe("refreshStaleSdkConnections (real Agenda lifecycle)", () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    testAgenda = new Agenda({
      mongo: mongoose.connection.db!,
      // Numeric ms — human-interval has no ms unit ("300 milliseconds" = 300s, "300ms" = NaN)
      processEvery: 300,
    });
    addRefreshStaleSdkConnectionsJob(testAgenda);
    await testAgenda.start();
  }, 60000);

  afterAll(async () => {
    await testAgenda.stop();
    await mongoose.connection.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    refreshStaleSdkConnectionsForOrgMock.mockReset();
    refreshStaleSdkConnectionsForOrgMock.mockResolvedValue(undefined);
    hasAnyStaleSdkConnectionMock.mockReset();
    // Default (after any mockResolvedValueOnce chains) so a straggler
    // success-listener from a previous test can't crash on a bare mock.
    hasAnyStaleSdkConnectionMock.mockResolvedValue(false);
    await mongoose.connection.db!.collection("agendaJobs").deleteMany({});
  });

  // Let in-flight success/fail listeners finish before the next test resets mocks.
  const settle = () => new Promise((r) => setTimeout(r, 400));

  it("runs once and does not reschedule when nothing new arrived", async () => {
    hasAnyStaleSdkConnectionMock.mockResolvedValue(false);

    await scheduleOrgRefreshJob("org_1");

    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(refreshStaleSdkConnectionsForOrgMock).toHaveBeenCalledTimes(1);
  });

  it("reschedules itself via the complete event when more staleness exists when it finishes — a write landing mid-run isn't dropped", async () => {
    // First check (after the first run) says "yes, more arrived"; second
    // check (after the resulting second run) says "no more, stop".
    hasAnyStaleSdkConnectionMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await scheduleOrgRefreshJob("org_1");

    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (refreshStaleSdkConnectionsForOrgMock.mock.calls.length >= 2) {
          clearInterval(check);
          resolve(undefined);
        }
      }, 100);
    });
    await settle();

    expect(refreshStaleSdkConnectionsForOrgMock).toHaveBeenCalledTimes(2);
  }, 20000);

  it("reschedules anyway when the completion-time recheck itself errors, so a real stale mark isn't stranded", async () => {
    // The recheck fails transiently after the first run; we can't tell if the
    // org is actually stale, so it should reschedule as a safe fallback. The
    // second run's recheck succeeds and reports no more staleness, so it stops.
    hasAnyStaleSdkConnectionMock
      .mockRejectedValueOnce(new Error("mongo blip"))
      .mockResolvedValueOnce(false);

    await scheduleOrgRefreshJob("org_1");

    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (refreshStaleSdkConnectionsForOrgMock.mock.calls.length >= 2) {
          clearInterval(check);
          resolve(undefined);
        }
      }, 100);
    });
    await settle();

    expect(refreshStaleSdkConnectionsForOrgMock).toHaveBeenCalledTimes(2);
  }, 20000);

  it("retries a failed run with a backoff delay instead of hot-looping", async () => {
    refreshStaleSdkConnectionsForOrgMock.mockRejectedValueOnce(
      new Error("rebuild blew up"),
    );

    const enqueuedAt = Date.now();
    await scheduleOrgRefreshJob("org_fail");

    // Wait for the failing run to happen.
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (refreshStaleSdkConnectionsForOrgMock.mock.calls.length >= 1) {
          clearInterval(check);
          resolve(undefined);
        }
      }, 100);
    });
    await settle();

    // The fail listener rescheduled the same unique doc into the future
    // (first failure → 10s backoff), so no immediate second run happened.
    expect(refreshStaleSdkConnectionsForOrgMock).toHaveBeenCalledTimes(1);
    const doc = await mongoose.connection
      .db!.collection("agendaJobs")
      .findOne({ "data.organization": "org_fail" });
    expect(doc?.nextRunAt).toBeTruthy();
    expect(new Date(doc!.nextRunAt).getTime()).toBeGreaterThan(
      enqueuedAt + 5000,
    );
  }, 20000);

  it("keeps per-org jobs separate — the unique index must not collide across orgs", async () => {
    await scheduleOrgRefreshJob("org_a");
    await scheduleOrgRefreshJob("org_b");

    const jobs = await mongoose.connection
      .db!.collection("agendaJobs")
      .find({ "data.organization": { $in: ["org_a", "org_b"] } })
      .toArray();
    expect(jobs).toHaveLength(2);
    await settle();
  });

  it("backs job.unique() with a real unique index scoped to this job name only", async () => {
    // Fire-and-forget at registration time, so poll briefly for it.
    let spec: { unique?: boolean; partialFilterExpression?: unknown } | null =
      null;
    for (let i = 0; i < 20 && !spec; i++) {
      const indexes = await mongoose.connection
        .db!.collection("agendaJobs")
        .listIndexes()
        .toArray();
      spec =
        indexes.find(
          (ix) =>
            ix.unique &&
            JSON.stringify(ix.key) ===
              JSON.stringify({ name: 1, "data.organization": 1 }),
        ) ?? null;
      if (!spec) await new Promise((r) => setTimeout(r, 100));
    }
    expect(spec).toBeTruthy();
    // Partial: other Agenda jobs (data.organization: null) must not collide.
    expect(spec?.partialFilterExpression).toEqual({
      name: "refreshStaleSdkConnections",
    });
  });

  it("collapses concurrent enqueues for the same org onto a single job", async () => {
    hasAnyStaleSdkConnectionMock.mockResolvedValue(false);

    // A handful of concurrent calls isn't enough to reliably trigger the
    // duplicate-upsert race this guards against (job.unique() alone isn't
    // atomic without a backing index) — use enough that this test would
    // reliably fail again if the index were ever removed.
    await Promise.all(
      Array.from({ length: 20 }, () => scheduleOrgRefreshJob("org_2")),
    );

    const jobs = await mongoose.connection
      .db!.collection("agendaJobs")
      .find({ "data.organization": "org_2" })
      .toArray();
    expect(jobs).toHaveLength(1);
  });
});
