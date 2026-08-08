/**
 * Runs a REAL Agenda instance (not mocked) against mongodb-memory-server,
 * for the same reason as coalescedSdkPayloadRefresh.test.ts: Agenda's own
 * job.run() freezes nextRunAt before calling the handler and unconditionally
 * re-persists that frozen value afterward, which would silently clobber a
 * reschedule attempted from inside the handler. Only a real Agenda instance
 * proves the complete-event-based reschedule actually works.
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let testAgenda: any;

const hasAnyStaleSdkConnectionMock = hasAnyStaleSdkConnection as jest.Mock;

describe("refreshStaleSdkConnections (real Agenda lifecycle)", () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    testAgenda = new Agenda({
      mongo: mongoose.connection.db!,
      processEvery: "300 milliseconds",
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
    refreshStaleSdkConnectionsForOrgMock.mockClear();
    hasAnyStaleSdkConnectionMock.mockReset();
    await mongoose.connection.db!.collection("agendaJobs").deleteMany({});
  });

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

    expect(refreshStaleSdkConnectionsForOrgMock).toHaveBeenCalledTimes(2);
  }, 20000);

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
