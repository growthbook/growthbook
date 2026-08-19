import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type {
  IncrementalRefreshMetricCovariateSourceInterface,
  IncrementalRefreshMetricSourceInterface,
} from "shared/validators";
import {
  IncrementalRefreshModel,
  COLLECTION_NAME,
} from "back-end/src/models/IncrementalRefreshModel";
import { waitForIndexes } from "back-end/src/models/BaseModel";
import type { Context } from "back-end/src/models/BaseModel";

const context = {
  org: { id: "org_1" },
  populateForeignRefs: jest.fn().mockResolvedValue(undefined),
  models: {},
} as unknown as Context;

const createDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

class TestIncrementalRefreshModel extends IncrementalRefreshModel {
  public getCollection() {
    return this._dangerousGetCollection();
  }
}

describe("IncrementalRefreshModel", () => {
  let mongod: MongoMemoryServer;
  let model: TestIncrementalRefreshModel;

  const collection = () => mongoose.connection.db!.collection(COLLECTION_NAME);

  const legacyUnitsTable = (experimentId: string) => `gb_units_${experimentId}`;
  const acquireLock = (
    experimentId: string,
    phase: number,
    snapshotId: string,
    legacyExperimentSettingsHash = "current_settings_hash",
  ) =>
    model.acquireLock({
      experimentId,
      phase,
      snapshotId,
      legacyExperimentSettingsHash,
    });

  // Simulates a legacy document with no phase and its pre-phase table name.
  async function seedLegacyPhaselessDoc(
    experimentId: string,
    experimentSettingsHash = "legacy_settings_hash",
  ) {
    await acquireLock(
      experimentId,
      0,
      `snap_seed_${experimentId}`,
      experimentSettingsHash,
    );
    await model.releaseLock(experimentId, `snap_seed_${experimentId}`);
    await collection().updateOne(
      { organization: "org_1", experimentId },
      {
        $unset: { phase: "" },
        $set: {
          unitsTableFullName: legacyUnitsTable(experimentId),
          experimentSettingsHash,
        },
      },
    );
  }

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    model = new TestIncrementalRefreshModel(context);
    await waitForIndexes();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await collection().deleteMany({});
  });

  it("keys separate state documents per phase", async () => {
    await acquireLock("exp_1", 0, "snap_0");
    await acquireLock("exp_1", 1, "snap_1");

    const phase0 = await model.getByExperimentIdAndPhase("exp_1", 0);
    const phase1 = await model.getByExperimentIdAndPhase("exp_1", 1);

    expect(phase0?.phase).toBe(0);
    expect(phase1?.phase).toBe(1);
    expect(phase0?.id).not.toBe(phase1?.id);
    expect(await collection().countDocuments({ experimentId: "exp_1" })).toBe(
      2,
    );
  });

  it("creates each phase document without a units table pointer", async () => {
    await acquireLock("exp_1", 0, "snap_0");
    await acquireLock("exp_1", 1, "snap_1");

    expect(
      (await model.getByExperimentIdAndPhase("exp_1", 0))?.unitsTableFullName,
    ).toBeNull();
    expect(
      (await model.getByExperimentIdAndPhase("exp_1", 1))?.unitsTableFullName,
    ).toBeNull();
  });

  it("lets a legacy phase-less document coexist with phase-scoped documents", async () => {
    await seedLegacyPhaselessDoc("exp_1");
    await acquireLock("exp_1", 0, "snap_0");
    await acquireLock("exp_1", 1, "snap_1");

    const legacy = await model.getLegacyByExperimentIdWithoutPhase("exp_1");

    expect(legacy?.phase).toBeUndefined();
    expect(await model.getByExperimentIdAndPhase("exp_1", 0)).not.toBeNull();
    expect(await model.getByExperimentIdAndPhase("exp_1", 1)).not.toBeNull();
    expect(await collection().countDocuments({ experimentId: "exp_1" })).toBe(
      3,
    );
  });

  it("locks each phase independently", async () => {
    expect(await acquireLock("exp_1", 0, "snap_0a")).toBe(true);
    expect(await acquireLock("exp_1", 0, "snap_0b")).toBe(false);
    expect(await acquireLock("exp_1", 1, "snap_1")).toBe(true);
  });

  it("mints and locks a matching legacy document in one write", async () => {
    await seedLegacyPhaselessDoc("exp_1", "matching_settings_hash");

    expect(
      await acquireLock("exp_1", 2, "snap_2", "matching_settings_hash"),
    ).toBe(true);

    expect(await model.getLegacyByExperimentIdWithoutPhase("exp_1")).toBeNull();
    const adopted = await model.getByExperimentIdAndPhase("exp_1", 2);
    expect(adopted?.phase).toBe(2);
    expect(adopted?.unitsTableFullName).toBe(legacyUnitsTable("exp_1"));
    expect(adopted?.currentExecutionSnapshotId).toBe("snap_2");
    expect(
      await acquireLock("exp_1", 2, "snap_competing", "matching_settings_hash"),
    ).toBe(false);
  });

  it("does not mint a legacy document with a different settings hash", async () => {
    await seedLegacyPhaselessDoc("exp_1", "old_settings_hash");

    expect(await acquireLock("exp_1", 0, "snap_0", "new_settings_hash")).toBe(
      true,
    );

    expect(
      await model.getLegacyByExperimentIdWithoutPhase("exp_1"),
    ).not.toBeNull();
    expect(
      (await model.getByExperimentIdAndPhase("exp_1", 0))?.unitsTableFullName,
    ).toBeNull();
  });

  it("deletes a phase and shifts higher phases without touching lower or legacy docs", async () => {
    await seedLegacyPhaselessDoc("exp_1");
    await acquireLock("exp_1", 2, "snap_2");
    await acquireLock("exp_1", 1, "snap_1");
    await acquireLock("exp_1", 0, "snap_0");
    await model.updateByExperimentIdIfCurrentExecution("exp_1", "snap_2", {
      unitsTableFullName: "gb_units_exp_1_phase2rand",
    });

    await model.deleteByExperimentIdAndPhase("exp_1", 1);
    await model.shiftPhasesDownAfterDelete("exp_1", 1);
    const updated = await model.updateByExperimentIdIfCurrentExecution(
      "exp_1",
      "snap_2",
      {
        unitsTableFullName: "gb_units_exp_1_phase2updated",
      },
    );
    await model.releaseLock("exp_1", "snap_2");

    expect(updated).toBe(true);
    expect(await model.getByExperimentIdAndPhase("exp_1", 2)).toBeNull();
    const renumbered = await model.getByExperimentIdAndPhase("exp_1", 1);
    expect(renumbered?.unitsTableFullName).toBe("gb_units_exp_1_phase2updated");
    expect(renumbered?.currentExecutionSnapshotId).toBeNull();
    expect(await model.getByExperimentIdAndPhase("exp_1", 0)).not.toBeNull();
    expect(
      await model.getLegacyByExperimentIdWithoutPhase("exp_1"),
    ).not.toBeNull();
  });

  it("shifts every higher phase down by one", async () => {
    await acquireLock("exp_1", 0, "snap_0");
    await acquireLock("exp_1", 1, "snap_1");
    await acquireLock("exp_1", 2, "snap_2");
    await acquireLock("exp_1", 3, "snap_3");

    await model.deleteByExperimentIdAndPhase("exp_1", 1);
    await model.shiftPhasesDownAfterDelete("exp_1", 1);

    expect((await model.getByExperimentIdAndPhase("exp_1", 0))?.phase).toBe(0);
    expect((await model.getLockedBySnapshotId("exp_1", "snap_2"))?.phase).toBe(
      1,
    );
    expect((await model.getLockedBySnapshotId("exp_1", "snap_3"))?.phase).toBe(
      2,
    );
    expect(await model.getByExperimentIdAndPhase("exp_1", 3)).toBeNull();
  });

  // Phases that never ran on the incremental path have no state document, so
  // the surviving phases are sparse. Closing the gaps instead of shifting by
  // one would hand a document to a phase it does not describe.
  it("keeps sparse phases aligned instead of closing the gap", async () => {
    await acquireLock("exp_1", 0, "snap_0");
    await acquireLock("exp_1", 3, "snap_3");

    await model.deleteByExperimentIdAndPhase("exp_1", 0);
    await model.shiftPhasesDownAfterDelete("exp_1", 0);

    expect((await model.getLockedBySnapshotId("exp_1", "snap_3"))?.phase).toBe(
      2,
    );
    expect(await model.getByExperimentIdAndPhase("exp_1", 1)).toBeNull();
  });

  it("drops a document it cannot relabel rather than misattributing it", async () => {
    await acquireLock("exp_1", 1, "snap_1");
    await acquireLock("exp_1", 2, "snap_2");

    await model.deleteByExperimentIdAndPhase("exp_1", 1);
    // A refresh claims the freed slot before the shift reaches it.
    await acquireLock("exp_1", 1, "snap_racer");
    await model.shiftPhasesDownAfterDelete("exp_1", 1);

    expect(await model.getLockedBySnapshotId("exp_1", "snap_2")).toBeNull();
    expect(
      (await model.getByExperimentIdAndPhase("exp_1", 1))
        ?.currentExecutionSnapshotId,
    ).toBe("snap_racer");
  });

  it("finds a locked document by snapshot id after its phase is renumbered", async () => {
    await acquireLock("exp_1", 0, "snap_0");
    await acquireLock("exp_1", 1, "snap_1");

    await model.deleteByExperimentIdAndPhase("exp_1", 0);
    await model.shiftPhasesDownAfterDelete("exp_1", 0);

    const doc = await model.getLockedBySnapshotId("exp_1", "snap_1");
    expect(doc?.phase).toBe(0);
    expect(doc?.currentExecutionSnapshotId).toBe("snap_1");
  });

  it("renumbers in a single pass with no retry delay", async () => {
    await acquireLock("exp_1", 0, "snap_0");
    await acquireLock("exp_1", 1, "snap_1");
    await acquireLock("exp_1", 2, "snap_2");
    await model.deleteByExperimentIdAndPhase("exp_1", 1);

    const start = Date.now();
    await model.shiftPhasesDownAfterDelete("exp_1", 1);
    const elapsed = Date.now() - start;

    expect((await model.getLockedBySnapshotId("exp_1", "snap_2"))?.phase).toBe(
      1,
    );
    expect(elapsed).toBeLessThan(500);
  });

  it("claims a free phase slot and locks out a concurrent refresh", async () => {
    expect(await model.acquirePhaseSlotForMutation("exp_1", 0, "del_0")).toBe(
      true,
    );

    expect(await acquireLock("exp_1", 0, "snap_racer")).toBe(false);
    expect(await model.getLockedBySnapshotId("exp_1", "snap_racer")).toBeNull();
  });

  it("refuses to claim a phase slot while a refresh holds the lock", async () => {
    await acquireLock("exp_1", 0, "snap_0");

    expect(await model.acquirePhaseSlotForMutation("exp_1", 0, "del_0")).toBe(
      false,
    );
    expect(
      (await model.getLockedBySnapshotId("exp_1", "snap_0"))
        ?.currentExecutionSnapshotId,
    ).toBe("snap_0");

    await model.releaseLock("exp_1", "snap_0");
    expect(await model.acquirePhaseSlotForMutation("exp_1", 0, "del_0")).toBe(
      true,
    );
  });

  it("claims a phase slot without adopting a matching legacy document", async () => {
    await seedLegacyPhaselessDoc("exp_1", "matching_settings_hash");

    expect(await model.acquirePhaseSlotForMutation("exp_1", 0, "del_0")).toBe(
      true,
    );

    const legacy = await model.getLegacyByExperimentIdWithoutPhase("exp_1");
    expect(legacy?.unitsTableFullName).toBe(legacyUnitsTable("exp_1"));
    expect(
      (await model.getByExperimentIdAndPhase("exp_1", 0))?.unitsTableFullName,
    ).toBeNull();
  });

  it("reclaims a phase slot whose holder went stale", async () => {
    await acquireLock("exp_1", 0, "snap_0");
    await collection().updateOne(
      { organization: "org_1", experimentId: "exp_1", phase: 0 },
      { $set: { lockHeartbeatAt: new Date(Date.now() - 11 * 60 * 1000) } },
    );

    expect(await model.acquirePhaseSlotForMutation("exp_1", 0, "del_0")).toBe(
      true,
    );
  });

  it("scopes phase lookups to a single experiment", async () => {
    await acquireLock("exp_1", 0, "snap_a");
    await acquireLock("exp_2", 0, "snap_b");

    const found = await model.getByExperimentIdAndPhase("exp_1", 0);
    expect(found?.experimentId).toBe("exp_1");
  });

  const source = (
    groupId: string,
    tableFullName: string,
  ): IncrementalRefreshMetricSourceInterface => ({
    groupId,
    factTableId: `ft_${groupId}`,
    metrics: [{ id: `m_${groupId}`, settingsHash: `hash_${groupId}` }],
    maxTimestamp: null,
    tableFullName,
  });

  const covariate = (
    groupId: string,
    tableFullName: string,
  ): IncrementalRefreshMetricCovariateSourceInterface => ({
    groupId,
    tableFullName,
    lastSuccessfulMaxTimestamp: null,
  });

  const sourcesByGroup = async (snapshotId: string) => {
    const doc = await model.getLockedBySnapshotId("exp_1", snapshotId);
    return Object.fromEntries(
      (doc?.metricSources ?? []).map((s) => [s.groupId, s.tableFullName]),
    );
  };

  it("appends a new source group and replaces an existing one, keyed by group", async () => {
    await acquireLock("exp_1", 0, "snap_0");

    expect(
      await model.upsertMetricSource("exp_1", "snap_0", source("a", "tbl_a")),
    ).toBe(true);
    await model.upsertMetricSource("exp_1", "snap_0", source("b", "tbl_b"));
    await model.upsertMetricSource("exp_1", "snap_0", source("a", "tbl_a_v2"));

    expect(await sourcesByGroup("snap_0")).toEqual({
      a: "tbl_a_v2",
      b: "tbl_b",
    });
  });

  it("allows only one conditional push after concurrent same-group pulls", async () => {
    await acquireLock("exp_1", 0, "snap_0");
    const mongoCollection = model.getCollection();
    const updateOne = mongoCollection.updateOne.bind(mongoCollection);
    const bothPullsFinished = createDeferred();
    const releasePulls = createDeferred();
    let completedUpdates = 0;
    const updateOneSpy = jest
      .spyOn(mongoCollection, "updateOne")
      .mockImplementation(async (filter, update, options) => {
        const result = await updateOne(filter, update, options);
        completedUpdates += 1;
        if (completedUpdates <= 2) {
          if (completedUpdates === 2) bothPullsFinished.resolve();
          await releasePulls.promise;
        }
        return result;
      });

    try {
      const first = model.upsertMetricSource(
        "exp_1",
        "snap_0",
        source("a", "tbl_a"),
      );
      const second = model.upsertMetricSource(
        "exp_1",
        "snap_0",
        source("a", "tbl_a_v2"),
      );
      await bothPullsFinished.promise;
      releasePulls.resolve();
      expect(await Promise.all([first, second])).toEqual([true, true]);
    } finally {
      releasePulls.resolve();
      updateOneSpy.mockRestore();
    }

    const doc = await model.getLockedBySnapshotId("exp_1", "snap_0");
    expect(doc?.metricSources).toHaveLength(1);
    expect(doc?.metricSources[0]?.groupId).toBe("a");
  });

  it("keeps a pulled source group gone when a sibling is upserted", async () => {
    await acquireLock("exp_1", 0, "snap_0");
    await model.upsertMetricSource("exp_1", "snap_0", source("a", "tbl_a"));
    await model.upsertMetricSource("exp_1", "snap_0", source("b", "tbl_b"));

    await model.invalidateMetricSourceGroup("exp_1", "snap_0", "a");
    await model.upsertMetricSource("exp_1", "snap_0", source("b", "tbl_b_v2"));

    expect(await sourcesByGroup("snap_0")).toEqual({ b: "tbl_b_v2" });
  });

  it("refuses a source upsert from a non-current execution", async () => {
    await acquireLock("exp_1", 0, "snap_0");
    await model.upsertMetricSource("exp_1", "snap_0", source("a", "tbl_a"));

    expect(
      await model.upsertMetricSource(
        "exp_1",
        "snap_stale",
        source("b", "tbl_b"),
      ),
    ).toBe(false);
    expect(await sourcesByGroup("snap_0")).toEqual({ a: "tbl_a" });
  });

  it("appends, replaces, and lock-guards covariate sources keyed by group", async () => {
    await acquireLock("exp_1", 0, "snap_0");

    await model.upsertMetricCovariateSource(
      "exp_1",
      "snap_0",
      covariate("a", "cov_a"),
    );
    await model.upsertMetricCovariateSource(
      "exp_1",
      "snap_0",
      covariate("a", "cov_a_v2"),
    );
    expect(
      await model.upsertMetricCovariateSource(
        "exp_1",
        "snap_stale",
        covariate("b", "cov_b"),
      ),
    ).toBe(false);

    const doc = await model.getLockedBySnapshotId("exp_1", "snap_0");
    expect(
      Object.fromEntries(
        (doc?.metricCovariateSources ?? []).map((s) => [
          s.groupId,
          s.tableFullName,
        ]),
      ),
    ).toEqual({ a: "cov_a_v2" });
  });
});
