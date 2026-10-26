import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { Job } from "agenda";
import {
  getExperimentsToUpdate,
  getExperimentsToUpdateLegacy,
} from "back-end/src/models/ExperimentModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { updateSingleExperiment } from "back-end/src/jobs/updateExperimentResults";

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

  it("skips when the latest snapshot already covers the lagged cutoff", async () => {
    const organizations = mongoose.connection.collection("organizations");
    const snapshots = mongoose.connection.collection("experimentsnapshots");
    await organizations.updateOne(
      { id: ORG_ID },
      {
        $set: {
          settings: {
            updateSchedule: {
              type: "stale",
              hours: 6,
              analysisEndDateMode: "lag",
              analysisEndDateLagHours: 3,
            },
          },
        },
      },
    );
    const phases = [
      {
        dateStarted: new Date(Date.now() - 48 * HOUR),
        variationWeights: [0.5, 0.5],
      },
    ];
    const dates = {
      dateCreated: new Date(),
      dateUpdated: new Date(),
      variations: running.variations.map((v) => ({ ...v, screenshots: [] })),
    };
    await experiments().insertMany([
      {
        ...running,
        ...dates,
        phases,
        id: "exp_fresh",
        nextSnapshotAttempt: new Date(),
      },
      {
        ...running,
        ...dates,
        phases,
        id: "exp_stale",
        nextSnapshotAttempt: new Date(),
      },
    ]);
    const snapshot = {
      organization: ORG_ID,
      phase: 0,
      dimension: null,
      type: "standard",
      status: "success",
      dateCreated: new Date(),
    };
    await snapshots.insertMany([
      {
        ...snapshot,
        id: "snp_fresh",
        experiment: "exp_fresh",
        settings: { metricSettings: [], endDate: new Date(Date.now() - HOUR) },
      },
      {
        ...snapshot,
        id: "snp_stale",
        experiment: "exp_stale",
        settings: {
          metricSettings: [],
          endDate: new Date(Date.now() - 5 * HOUR),
        },
      },
    ]);

    try {
      await updateSingleExperiment(jobFor("exp_fresh"));
      expect(getDataSourceById).not.toHaveBeenCalled();
      const fresh = await experiments().findOne({ id: "exp_fresh" });
      expect(fresh?.nextSnapshotAttempt.getTime()).toBeGreaterThan(
        Date.now() + 5 * HOUR,
      );

      await updateSingleExperiment(jobFor("exp_stale"));
      expect(getDataSourceById).toHaveBeenCalledTimes(1);
    } finally {
      await snapshots.deleteMany({});
      await organizations.updateOne({ id: ORG_ID }, { $set: { settings: {} } });
    }
  });

  it.each([
    { through: "the run time", updateSchedule: { type: "stale", hours: 6 } },
    {
      through: "a lagged cutoff",
      updateSchedule: {
        type: "stale",
        hours: 6,
        analysisEndDateMode: "lag",
        analysisEndDateLagHours: 3,
      },
    },
  ])(
    "runs when analyzing through $through and the latest snapshot ends in the future",
    async ({ updateSchedule }) => {
      const organizations = mongoose.connection.collection("organizations");
      const snapshots = mongoose.connection.collection("experimentsnapshots");
      await organizations.updateOne(
        { id: ORG_ID },
        { $set: { settings: { updateSchedule } } },
      );
      await experiments().insertOne({
        ...running,
        dateCreated: new Date(),
        dateUpdated: new Date(),
        variations: running.variations.map((v) => ({ ...v, screenshots: [] })),
        phases: [
          {
            dateStarted: new Date(Date.now() - 48 * HOUR),
            variationWeights: [0.5, 0.5],
          },
        ],
        id: "exp_future",
        nextSnapshotAttempt: new Date(),
      });
      await snapshots.insertOne({
        organization: ORG_ID,
        experiment: "exp_future",
        phase: 0,
        dimension: null,
        type: "standard",
        status: "success",
        dateCreated: new Date(),
        id: "snp_future",
        settings: {
          metricSettings: [],
          endDate: new Date(Date.now() + 24 * HOUR),
        },
      });

      try {
        await updateSingleExperiment(jobFor("exp_future"));
        expect(getDataSourceById).toHaveBeenCalledTimes(1);
      } finally {
        await snapshots.deleteMany({});
        await organizations.updateOne(
          { id: ORG_ID },
          { $set: { settings: {} } },
        );
      }
    },
  );

  it("skips when the incremental tables hold data past the lagged cutoff", async () => {
    const organizations = mongoose.connection.collection("organizations");
    const snapshots = mongoose.connection.collection("experimentsnapshots");
    const incrementalRefresh =
      mongoose.connection.collection("incrementalrefresh");
    await organizations.updateOne(
      { id: ORG_ID },
      {
        $set: {
          settings: {
            updateSchedule: {
              type: "stale",
              hours: 6,
              analysisEndDateMode: "lag",
              analysisEndDateLagHours: 3,
            },
          },
        },
      },
    );
    const dates = {
      dateCreated: new Date(),
      dateUpdated: new Date(),
      variations: running.variations.map((v) => ({ ...v, screenshots: [] })),
      phases: [
        {
          dateStarted: new Date(Date.now() - 48 * HOUR),
          variationWeights: [0.5, 0.5],
        },
      ],
    };
    await experiments().insertMany([
      {
        ...running,
        ...dates,
        id: "exp_ahead",
        nextSnapshotAttempt: new Date(),
      },
      {
        ...running,
        ...dates,
        id: "exp_behind",
        nextSnapshotAttempt: new Date(),
      },
    ]);
    // Both last succeeded before the cutoff; a newer refresh that loaded
    // exp_ahead's tables then failed left no snapshot behind.
    await snapshots.insertMany(
      ["exp_ahead", "exp_behind"].map((experiment) => ({
        organization: ORG_ID,
        experiment,
        phase: 0,
        dimension: null,
        type: "standard",
        status: "success",
        dateCreated: new Date(Date.now() - 5 * HOUR),
        id: `snp_${experiment}`,
        settings: {
          metricSettings: [],
          endDate: new Date(Date.now() - 5 * HOUR),
        },
      })),
    );
    const tables = (experimentId: string, maxTimestamp: Date) => ({
      id: `ir_${experimentId}`,
      organization: ORG_ID,
      dateCreated: new Date(),
      dateUpdated: new Date(),
      experimentId,
      phase: 0,
      unitsTableFullName: "units",
      unitsMaxTimestamp: new Date(Date.now() - 5 * HOUR),
      unitsDimensions: [],
      experimentSettingsHash: null,
      metricSources: [
        {
          groupId: "g1",
          factTableId: "ftb_1",
          metrics: [],
          maxTimestamp,
          tableFullName: "metrics",
        },
      ],
      metricCovariateSources: [],
      currentExecutionSnapshotId: null,
    });
    await incrementalRefresh.insertMany([
      tables("exp_ahead", new Date(Date.now() - HOUR)),
      tables("exp_behind", new Date(Date.now() - 4 * HOUR)),
    ]);

    try {
      await updateSingleExperiment(jobFor("exp_ahead"));
      expect(getDataSourceById).not.toHaveBeenCalled();
      const ahead = await experiments().findOne({ id: "exp_ahead" });
      expect(ahead?.nextSnapshotAttempt.getTime()).toBeGreaterThan(
        Date.now() + 5 * HOUR,
      );

      await updateSingleExperiment(jobFor("exp_behind"));
      expect(getDataSourceById).toHaveBeenCalledTimes(1);
    } finally {
      await snapshots.deleteMany({});
      await incrementalRefresh.deleteMany({});
      await organizations.updateOne({ id: ORG_ID }, { $set: { settings: {} } });
    }
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

  it("keeps auto-updates on for a bandit after a recoverable failure", async () => {
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
  });
});
