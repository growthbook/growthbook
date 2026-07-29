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

  // A pre-phase document as written before phase isolation shipped: no
  // `phase`, and a units table name with no random suffix. Built by seeding a
  // phase-0 doc and rewriting those two fields, so it exercises the same read
  // path as a real legacy row.
  async function seedLegacyPhaselessDoc(experimentId: string) {
    await model.acquireLock(experimentId, 0, `snap_seed_${experimentId}`);
    await model.releaseLock(experimentId, 0, `snap_seed_${experimentId}`);
    await collection().updateOne(
      { organization: "org_1", experimentId },
      {
        $unset: { phase: "" },
        $set: { unitsTableFullName: legacyUnitsTable(experimentId) },
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
    await model.acquireLock("exp_1", 0, "snap_0");
    await model.acquireLock("exp_1", 1, "snap_1");

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
    await model.acquireLock("exp_1", 0, "snap_0");
    await model.acquireLock("exp_1", 1, "snap_1");

    expect(
      (await model.getByExperimentIdAndPhase("exp_1", 0))?.unitsTableFullName,
    ).toBeNull();
    expect(
      (await model.getByExperimentIdAndPhase("exp_1", 1))?.unitsTableFullName,
    ).toBeNull();
  });

  it("lets a legacy phase-less document coexist with phase-scoped documents", async () => {
    await seedLegacyPhaselessDoc("exp_1");
    await model.acquireLock("exp_1", 0, "snap_0");
    await model.acquireLock("exp_1", 1, "snap_1");

    const legacy = await model.getLegacyByExperimentIdWithoutPhase("exp_1");

    expect(legacy?.phase).toBeUndefined();
    expect(await model.getByExperimentIdAndPhase("exp_1", 0)).not.toBeNull();
    expect(await model.getByExperimentIdAndPhase("exp_1", 1)).not.toBeNull();
    expect(await collection().countDocuments({ experimentId: "exp_1" })).toBe(
      3,
    );
  });

  it("locks each phase independently", async () => {
    expect(await model.acquireLock("exp_1", 0, "snap_0a")).toBe(true);
    // Phase 0 is held, so a second executor cannot take it.
    expect(await model.acquireLock("exp_1", 0, "snap_0b")).toBe(false);
    // Phase 1 is a different key and stays free.
    expect(await model.acquireLock("exp_1", 1, "snap_1")).toBe(true);
  });

  it("adopts a legacy phase-less document onto the given phase", async () => {
    await seedLegacyPhaselessDoc("exp_1");

    await model.adoptLegacyDocToPhase("exp_1", 2);

    expect(await model.getLegacyByExperimentIdWithoutPhase("exp_1")).toBeNull();
    const adopted = await model.getByExperimentIdAndPhase("exp_1", 2);
    expect(adopted?.phase).toBe(2);
    expect(adopted?.unitsTableFullName).toBe(legacyUnitsTable("exp_1"));
  });

  it("adoption is a no-op when there is no legacy document", async () => {
    await model.acquireLock("exp_1", 0, "snap_0");
    const before = await model.getByExperimentIdAndPhase("exp_1", 0);

    await model.adoptLegacyDocToPhase("exp_1", 0);

    const after = await model.getByExperimentIdAndPhase("exp_1", 0);
    expect(after?.id).toBe(before?.id);
    expect(await collection().countDocuments({ experimentId: "exp_1" })).toBe(
      1,
    );
  });

  it("deletes a phase and renumbers higher phases without touching lower or legacy docs", async () => {
    await seedLegacyPhaselessDoc("exp_1");
    await model.acquireLock("exp_1", 0, "snap_0");
    await model.acquireLock("exp_1", 1, "snap_1");
    await model.acquireLock("exp_1", 2, "snap_2");
    await model.updateByExperimentIdIfCurrentExecution("exp_1", 2, "snap_2", {
      unitsTableFullName: "gb_units_exp_1_phase2rand",
    });

    await model.deleteByExperimentIdAndPhase("exp_1", 1);
    await model.decrementPhasesAbove("exp_1", 1);

    // Phase 1 is gone, phase 2 slid down into slot 1 keeping its own table.
    expect(await model.getByExperimentIdAndPhase("exp_1", 2)).toBeNull();
    expect(
      (await model.getByExperimentIdAndPhase("exp_1", 1))?.unitsTableFullName,
    ).toBe("gb_units_exp_1_phase2rand");
    // Phase 0 and the not-yet-adopted legacy doc are left alone.
    expect(await model.getByExperimentIdAndPhase("exp_1", 0)).not.toBeNull();
    expect(
      await model.getLegacyByExperimentIdWithoutPhase("exp_1"),
    ).not.toBeNull();
  });

  it("scopes phase lookups to a single experiment", async () => {
    await model.acquireLock("exp_1", 0, "snap_a");
    await model.acquireLock("exp_2", 0, "snap_b");

    const found = await model.getByExperimentIdAndPhase("exp_1", 0);
    expect(found?.experimentId).toBe("exp_1");
  });
});
