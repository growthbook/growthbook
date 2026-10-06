import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type Agenda from "agenda";
import type { Job } from "agenda";
import {
  deferDueSnapshotAttempts,
  getExperimentsToUpdate,
  getExperimentsToUpdateLegacy,
} from "back-end/src/models/ExperimentModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import registerExperimentUpdateJobs, {
  updateSingleExperiment,
} from "back-end/src/jobs/updateExperimentResults";

jest.mock("back-end/src/models/DataSourceModel", () => ({
  ...jest.requireActual("back-end/src/models/DataSourceModel"),
  getDataSourceById: jest.fn(async () => null),
}));
jest.mock("back-end/src/util/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const ORG_ID = "org_1";
const HOUR = 60 * 60 * 1000;

let mongo: MongoMemoryServer;
const experiments = () => mongoose.connection.collection("experiments");

const running = {
  organization: ORG_ID,
  datasource: "ds_1",
  status: "running",
  autoSnapshots: true,
  phases: [{ dateStarted: new Date(), variationWeights: [0.5, 0.5] }],
  variations: [
    { id: "v0", key: "0", name: "Control" },
    { id: "v1", key: "1", name: "Treatment" },
  ],
};

const jobFor = (experimentId: string) =>
  ({
    attrs: { data: { organization: ORG_ID, experimentId } },
  }) as unknown as Job<{ organization: string; experimentId: string }>;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await mongoose.connection.collection("organizations").insertOne({
    id: ORG_ID,
    name: "Org",
    ownerEmail: "owner@test.com",
    url: "",
    dateCreated: new Date(),
    members: [],
    settings: {},
  });
}, 30000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
beforeEach(async () => {
  await experiments().deleteMany({});
  jest.clearAllMocks();
});

describe("scheduled experiment updates", () => {
  it("does not queue archived experiments on the dynamic schedule", async () => {
    const due = new Date(Date.now() - 1000);
    await experiments().insertMany([
      { ...running, id: "exp_live", nextSnapshotAttempt: due },
      {
        ...running,
        id: "exp_archived",
        archived: true,
        nextSnapshotAttempt: due,
      },
    ]);

    const queued = await getExperimentsToUpdate([]);
    expect(queued.map((e) => e.id)).toEqual(["exp_live"]);
  });

  it("does not queue archived experiments on the legacy schedule", async () => {
    const stale = new Date(Date.now() - 48 * HOUR);
    await experiments().insertMany([
      { ...running, id: "exp_live", lastSnapshotAttempt: stale },
      {
        ...running,
        id: "exp_archived",
        archived: true,
        lastSnapshotAttempt: stale,
      },
    ]);

    const queued = await getExperimentsToUpdateLegacy(new Date());
    expect(queued.map((e) => e.id)).toEqual(["exp_live"]);
  });

  it("skips an update queued before the experiment was archived", async () => {
    await experiments().insertMany([
      { ...running, id: "exp_live", nextSnapshotAttempt: new Date() },
      {
        ...running,
        id: "exp_archived",
        archived: true,
        nextSnapshotAttempt: new Date(),
      },
    ]);

    await updateSingleExperiment(jobFor("exp_archived"));
    expect(getDataSourceById).not.toHaveBeenCalled();

    await updateSingleExperiment(jobFor("exp_live"));
    expect(getDataSourceById).toHaveBeenCalledTimes(1);
  });

  it("skips an update queued before auto-update was turned off", async () => {
    await experiments().insertOne({
      ...running,
      id: "exp_disabled",
      disableAutoSnapshots: true,
      nextSnapshotAttempt: new Date(),
    });

    await updateSingleExperiment(jobFor("exp_disabled"));
    expect(getDataSourceById).not.toHaveBeenCalled();
  });
});

describe("failing scheduled updates", () => {
  const bandit = {
    ...running,
    type: "multi-armed-bandit",
    banditStage: "exploit",
  };

  it("turns off auto-updates for a bandit whose datasource is gone", async () => {
    await experiments().insertOne({
      ...bandit,
      id: "exp_orphan",
      nextSnapshotAttempt: new Date(Date.now() - 1000),
    });

    await updateSingleExperiment(jobFor("exp_orphan"));

    const doc = await experiments().findOne({ id: "exp_orphan" });
    expect(doc?.autoSnapshots).toBe(false);
  });

  it("backs off a bandit after a recoverable failure", async () => {
    jest
      .mocked(getDataSourceById)
      .mockRejectedValueOnce(new Error("warehouse unavailable"));
    await experiments().insertOne({
      ...bandit,
      id: "exp_flaky",
      nextSnapshotAttempt: new Date(Date.now() - 1000),
    });

    await updateSingleExperiment(jobFor("exp_flaky"));

    const doc = await experiments().findOne({ id: "exp_flaky" });
    expect(doc?.autoSnapshots).toBe(true);
    expect(doc?.nextSnapshotAttempt.getTime()).toBeGreaterThan(
      Date.now() + HOUR / 2,
    );
  });

  it("does not let experiments that never reschedule starve the queue", async () => {
    const handlers = new Map<string, () => Promise<void>>();
    const queued: string[] = [];
    const agenda = {
      define: (name: string, fn: () => Promise<void>) => {
        handlers.set(name, fn);
      },
      create: (_name: string, data: { experimentId?: string }) => ({
        unique: jest.fn(),
        repeatEvery: jest.fn(),
        schedule: jest.fn(),
        save: jest.fn(async () => {
          if (data.experimentId) queued.push(data.experimentId);
        }),
      }),
    } as unknown as Agenda;
    await registerExperimentUpdateJobs(agenda);
    const queueTick = handlers.get("queueExperimentUpdates");
    if (!queueTick) throw new Error("queue job not defined");

    const stuck = new Date(Date.now() - 96 * HOUR);
    await experiments().insertMany([
      ...Array.from({ length: 100 }, (_, i) => ({
        ...bandit,
        id: `exp_stuck_${i}`,
        nextSnapshotAttempt: stuck,
      })),
      {
        ...running,
        id: "exp_waiting",
        nextSnapshotAttempt: new Date(Date.now() - HOUR),
      },
    ]);

    await queueTick();
    expect(queued).toHaveLength(100);
    expect(queued).not.toContain("exp_waiting");

    queued.length = 0;
    await queueTick();
    expect(queued).toEqual(["exp_waiting"]);
  });

  it("keeps a next run that was already rescheduled", async () => {
    const scheduled = new Date(Date.now() + 6 * HOUR);
    await experiments().insertOne({
      ...running,
      id: "exp_rescheduled",
      nextSnapshotAttempt: scheduled,
    });

    await deferDueSnapshotAttempts(
      ["exp_rescheduled"],
      new Date(Date.now() + HOUR),
    );

    const doc = await experiments().findOne({ id: "exp_rescheduled" });
    expect(doc?.nextSnapshotAttempt).toEqual(scheduled);
  });
});
