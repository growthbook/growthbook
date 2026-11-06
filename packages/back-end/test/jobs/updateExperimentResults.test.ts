import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { Job } from "agenda";
import type { DataSourceInterface } from "shared/types/datasource";
import type { ExperimentInterface } from "shared/types/experiment";
import {
  getExperimentsToUpdate,
  getExperimentsToUpdateLegacy,
} from "back-end/src/models/ExperimentModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { createSnapshot } from "back-end/src/services/experiments";
import { notifyAutoUpdate } from "back-end/src/services/experimentNotifications";
import {
  ConcurrentIncrementalRefreshError,
  UnrecoverableSnapshotError,
} from "back-end/src/util/errors";
import { updateSingleExperiment } from "back-end/src/jobs/updateExperimentResults";

jest.mock("back-end/src/models/DataSourceModel", () => ({
  ...jest.requireActual("back-end/src/models/DataSourceModel"),
  getDataSourceById: jest.fn(async () => null),
}));
// Lazy proxies, not spreads: an import cycle re-enters these factories while the
// real modules are still evaluating. The mocks live outside the factories so
// every re-entry hands out the same fn.
jest.mock(
  "back-end/src/services/experiments",
  () =>
    new Proxy(jest.requireActual<object>("back-end/src/services/experiments"), {
      get: (target, key) =>
        key === "createSnapshot"
          ? mockCreateSnapshot
          : Reflect.get(target, key),
    }),
);
jest.mock(
  "back-end/src/services/experimentNotifications",
  () =>
    new Proxy(
      jest.requireActual<object>(
        "back-end/src/services/experimentNotifications",
      ),
      {
        get: (target, key) =>
          key === "notifyAutoUpdate"
            ? mockNotifyAutoUpdate
            : Reflect.get(target, key),
      },
    ),
);
jest.mock("back-end/src/util/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockCreateSnapshot = jest.fn();
const mockNotifyAutoUpdate = jest.fn();

const ORG_ID = "org_1";
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

let mongo: MongoMemoryServer;
const experiments = () => mongoose.connection.collection("experiments");

const running = {
  organization: ORG_ID,
  name: "Experiment",
  dateCreated: new Date(),
  dateUpdated: new Date(),
  datasource: "ds_1",
  status: "running",
  autoSnapshots: true,
  phases: [{ dateStarted: new Date(), variationWeights: [0.5, 0.5] }],
  variations: [
    { id: "v0", key: "0", name: "Control", screenshots: [] },
    { id: "v1", key: "1", name: "Treatment", screenshots: [] },
  ],
};

const jobFor = (experimentId: string) =>
  ({
    attrs: { data: { organization: ORG_ID, experimentId } },
  }) as unknown as Job<{ organization: string; experimentId: string }>;

const stored = (id: string) =>
  experiments().findOne<
    Pick<
      ExperimentInterface,
      "autoSnapshots" | "autoUpdateFailures" | "nextSnapshotAttempt"
    >
  >({ id });

const warehouseDown = () =>
  jest
    .mocked(getDataSourceById)
    .mockRejectedValueOnce(new Error("warehouse unavailable"));

const datasourceFound = () =>
  jest
    .mocked(getDataSourceById)
    .mockResolvedValueOnce({ id: "ds_1" } as unknown as DataSourceInterface);

const snapshotFinishes = () => {
  datasourceFound();
  jest.mocked(createSnapshot).mockResolvedValueOnce({
    waitForResults: async () => undefined,
    model: {},
  } as unknown as Awaited<ReturnType<typeof createSnapshot>>);
};

const snapshotFails = (error: Error) => {
  datasourceFound();
  jest.mocked(createSnapshot).mockRejectedValueOnce(error);
};

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
    {
      phase: "an experiment that started an hour ago",
      fields: {},
      phaseFields: { dateStarted: new Date(Date.now() - HOUR) },
    },
    {
      phase: "a holdout whose analysis period started an hour ago",
      fields: { type: "holdout" },
      phaseFields: {
        dateStarted: new Date(Date.now() - 48 * HOUR),
        lookbackStartDate: new Date(Date.now() - HOUR),
      },
    },
  ])(
    "skips and reschedules when the lagged cutoff is before $phase",
    async ({ fields, phaseFields }) => {
      const organizations = mongoose.connection.collection("organizations");
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
      await experiments().insertOne({
        ...running,
        ...fields,
        dateCreated: new Date(),
        dateUpdated: new Date(),
        variations: running.variations.map((v) => ({ ...v, screenshots: [] })),
        phases: [{ ...phaseFields, variationWeights: [0.5, 0.5] }],
        id: "exp_new_phase",
        nextSnapshotAttempt: new Date(),
      });

      try {
        await updateSingleExperiment(jobFor("exp_new_phase"));
        expect(getDataSourceById).not.toHaveBeenCalled();
        const doc = await experiments().findOne({ id: "exp_new_phase" });
        expect(doc?.nextSnapshotAttempt.getTime()).toBeGreaterThan(
          Date.now() + 5 * HOUR,
        );
      } finally {
        await organizations.updateOne(
          { id: ORG_ID },
          { $set: { settings: {} } },
        );
      }
    },
  );

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
});

describe("failed scheduled updates", () => {
  const due = () => new Date(Date.now() - 1000);
  const bandit = { type: "multi-armed-bandit", banditStage: "exploit" };
  const kinds = [
    { kind: "a regular experiment", fields: {} },
    { kind: "a bandit", fields: bandit },
  ];

  it.each(kinds)(
    "keeps auto-updates on for $kind through two recoverable failures, retrying after 10 then 30 minutes",
    async ({ fields }) => {
      await experiments().insertOne({
        ...running,
        ...fields,
        id: "exp_1",
        nextSnapshotAttempt: due(),
      });

      for (const { count, delay } of [
        { count: 1, delay: 10 * MINUTE },
        { count: 2, delay: 30 * MINUTE },
      ]) {
        warehouseDown();
        const start = Date.now();
        await updateSingleExperiment(jobFor("exp_1"));
        const end = Date.now();

        const doc = await stored("exp_1");
        expect(doc).toMatchObject({
          autoSnapshots: true,
          autoUpdateFailures: count,
        });
        const retryAt = doc?.nextSnapshotAttempt?.getTime() ?? 0;
        expect(retryAt).toBeGreaterThanOrEqual(start + delay);
        expect(retryAt).toBeLessThanOrEqual(end + delay);
      }
      expect(notifyAutoUpdate).not.toHaveBeenCalled();
    },
  );

  it.each(kinds)(
    "turns auto-updates off on the third consecutive failure of $kind",
    async ({ fields }) => {
      await experiments().insertOne({
        ...running,
        ...fields,
        id: "exp_1",
        autoUpdateFailures: 2,
        nextSnapshotAttempt: due(),
      });

      warehouseDown();
      await updateSingleExperiment(jobFor("exp_1"));

      expect(await stored("exp_1")).toMatchObject({
        autoSnapshots: false,
        autoUpdateFailures: 0,
      });
      expect(notifyAutoUpdate).toHaveBeenCalledTimes(1);
      expect(notifyAutoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ success: true }),
      );
    },
  );

  it("retries a failed update in 10 minutes even when the next scheduled run is 6 hours out", async () => {
    await experiments().insertOne({
      ...running,
      id: "exp_1",
      nextSnapshotAttempt: new Date(Date.now() + 6 * HOUR),
    });

    warehouseDown();
    const start = Date.now();
    await updateSingleExperiment(jobFor("exp_1"));
    const end = Date.now();

    const doc = await stored("exp_1");
    expect(doc).toMatchObject({ autoUpdateFailures: 1 });
    const retryAt = doc?.nextSnapshotAttempt?.getTime() ?? 0;
    expect(retryAt).toBeGreaterThanOrEqual(start + 10 * MINUTE);
    expect(retryAt).toBeLessThanOrEqual(end + 10 * MINUTE);
  });

  it("resets the count after a finished update so the next failure counts as the first", async () => {
    await experiments().insertOne({
      ...running,
      id: "exp_1",
      autoUpdateFailures: 2,
      nextSnapshotAttempt: due(),
    });

    snapshotFinishes();
    await updateSingleExperiment(jobFor("exp_1"));
    expect(createSnapshot).toHaveBeenCalledTimes(1);
    expect(await stored("exp_1")).toMatchObject({
      autoSnapshots: true,
      autoUpdateFailures: 0,
    });

    warehouseDown();
    await updateSingleExperiment(jobFor("exp_1"));
    expect(await stored("exp_1")).toMatchObject({
      autoSnapshots: true,
      autoUpdateFailures: 1,
    });
  });

  it("does not count an update skipped because an incremental refresh is already running", async () => {
    await experiments().insertOne({
      ...running,
      id: "exp_1",
      autoUpdateFailures: 1,
      nextSnapshotAttempt: due(),
    });

    snapshotFails(
      new ConcurrentIncrementalRefreshError("incremental refresh in progress"),
    );
    await updateSingleExperiment(jobFor("exp_1"));

    expect(createSnapshot).toHaveBeenCalledTimes(1);
    expect(await stored("exp_1")).toMatchObject({
      autoSnapshots: true,
      autoUpdateFailures: 1,
    });
  });

  it("turns auto-updates off at once for a bandit whose datasource is gone", async () => {
    await experiments().insertOne({
      ...running,
      ...bandit,
      id: "exp_1",
      autoUpdateFailures: 1,
      nextSnapshotAttempt: due(),
    });

    await updateSingleExperiment(jobFor("exp_1"));

    expect(await stored("exp_1")).toMatchObject({
      autoSnapshots: false,
      autoUpdateFailures: 0,
    });
  });

  it("turns auto-updates off at once when the failure repeats on every retry", async () => {
    await experiments().insertOne({
      ...running,
      id: "exp_1",
      autoUpdateFailures: 1,
      nextSnapshotAttempt: due(),
    });

    snapshotFails(
      new UnrecoverableSnapshotError(
        "Experiment must have at least 1 metric selected.",
      ),
    );
    await updateSingleExperiment(jobFor("exp_1"));

    expect(await stored("exp_1")).toMatchObject({
      autoSnapshots: false,
      autoUpdateFailures: 0,
    });
    expect(notifyAutoUpdate).toHaveBeenCalledTimes(1);
    expect(notifyAutoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });
});
