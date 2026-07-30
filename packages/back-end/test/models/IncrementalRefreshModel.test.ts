import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
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

describe("IncrementalRefreshModel", () => {
  let mongod: MongoMemoryServer;
  let model: IncrementalRefreshModel;

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

  // A pre-phase document as written before phase isolation shipped: no
  // `phase`, and a units table name with no random suffix. Built by seeding a
  // phase-0 doc and rewriting those two fields, so it exercises the same read
  // path as a real legacy row.
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
    model = new IncrementalRefreshModel(context);
    await waitForIndexes();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    // The model writes via the native driver, so the collection is not in
    // mongoose.connection.collections; clear it directly.
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
    // Phase 0 is held, so a second executor cannot take it.
    expect(await acquireLock("exp_1", 0, "snap_0b")).toBe(false);
    // Phase 1 is a different key and stays free.
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

  it("deletes a phase and compacts higher phases without touching lower or legacy docs", async () => {
    await seedLegacyPhaselessDoc("exp_1");
    await acquireLock("exp_1", 2, "snap_2");
    await acquireLock("exp_1", 1, "snap_1");
    await acquireLock("exp_1", 0, "snap_0");
    await model.updateByExperimentIdIfCurrentExecution("exp_1", "snap_2", {
      unitsTableFullName: "gb_units_exp_1_phase2rand",
    });

    await model.deleteByExperimentIdAndPhase("exp_1", 1);
    await model.compactPhases("exp_1");
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

  it("compacts a multi-phase gap back to a contiguous sequence and is idempotent", async () => {
    await acquireLock("exp_1", 0, "snap_0");
    await acquireLock("exp_1", 1, "snap_1");
    await acquireLock("exp_1", 2, "snap_2");
    await acquireLock("exp_1", 3, "snap_3");

    await model.deleteByExperimentIdAndPhase("exp_1", 1);
    await model.compactPhases("exp_1");

    // 0 stays, 2 -> 1, 3 -> 2, keyed by the snapshot that locked each doc.
    expect((await model.getByExperimentIdAndPhase("exp_1", 0))?.phase).toBe(0);
    expect((await model.getLockedBySnapshotId("exp_1", "snap_2"))?.phase).toBe(
      1,
    );
    expect((await model.getLockedBySnapshotId("exp_1", "snap_3"))?.phase).toBe(
      2,
    );
    expect(await model.getByExperimentIdAndPhase("exp_1", 3)).toBeNull();

    // Running it again on an already-contiguous set changes nothing.
    await model.compactPhases("exp_1");
    expect((await model.getLockedBySnapshotId("exp_1", "snap_3"))?.phase).toBe(
      2,
    );
  });

  it("finds a locked document by snapshot id after its phase is renumbered", async () => {
    await acquireLock("exp_1", 0, "snap_0");
    await acquireLock("exp_1", 1, "snap_1");

    await model.deleteByExperimentIdAndPhase("exp_1", 0);
    await model.compactPhases("exp_1");

    const doc = await model.getLockedBySnapshotId("exp_1", "snap_1");
    expect(doc?.phase).toBe(0);
    expect(doc?.currentExecutionSnapshotId).toBe("snap_1");
  });

  it("reports whether a phase lock is live", async () => {
    await acquireLock("exp_1", 0, "snap_0");
    expect(await model.isPhaseLockActive("exp_1", 0)).toBe(true);
    // A phase with no document is not locked.
    expect(await model.isPhaseLockActive("exp_1", 1)).toBe(false);

    await model.releaseLock("exp_1", "snap_0");
    expect(await model.isPhaseLockActive("exp_1", 0)).toBe(false);

    await acquireLock("exp_1", 0, "snap_0b");
    // A heartbeat older than the stale window is not a live lock.
    await collection().updateOne(
      { organization: "org_1", experimentId: "exp_1", phase: 0 },
      { $set: { lockHeartbeatAt: new Date(Date.now() - 11 * 60 * 1000) } },
    );
    expect(await model.isPhaseLockActive("exp_1", 0)).toBe(false);
  });

  it("scopes phase lookups to a single experiment", async () => {
    await acquireLock("exp_1", 0, "snap_a");
    await acquireLock("exp_2", 0, "snap_b");

    const found = await model.getByExperimentIdAndPhase("exp_1", 0);
    expect(found?.experimentId).toBe("exp_1");
  });
});
