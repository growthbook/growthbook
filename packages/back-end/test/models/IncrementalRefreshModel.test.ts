import mongoose from "mongoose";
import {
  connectTestMongo,
  disconnectTestMongo,
} from "back-end/test/test-helpers";
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
    await connectTestMongo();
  }, 60000);

  afterAll(async () => {
    await disconnectTestMongo();
  });

  beforeEach(async () => {
    model = new IncrementalRefreshModel(context);
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

  describe("releaseLockAfterInterruptedRun", () => {
    const source = (groupId: string) => ({
      groupId,
      factTableId: "ft_1",
      metrics: [],
      maxTimestamp: null,
      tableFullName: `gb_metrics_${groupId}`,
    });
    const covariateSource = (groupId: string) => ({
      groupId,
      tableFullName: `gb_metrics_${groupId}_covariate`,
      lastSuccessfulMaxTimestamp: null,
    });

    async function seedLockedRun() {
      await acquireLock("exp_1", 0, "snap_0");
      await collection().updateOne(
        { organization: "org_1", experimentId: "exp_1" },
        {
          $set: {
            unitsTableFullName: "gb_units_exp_1",
            metricSources: [source("g1"), source("g2")],
            metricCovariateSources: [
              covariateSource("g1"),
              covariateSource("g2"),
            ],
          },
        },
      );
    }

    it("drops the listed groups and releases the lock in one write", async () => {
      await seedLockedRun();

      expect(
        await model.releaseLockAfterInterruptedRun("exp_1", "snap_0", {
          metricGroupIdsToRebuild: ["g1"],
          forceFullRefresh: false,
        }),
      ).toBe(true);

      const doc = await model.getByExperimentIdAndPhase("exp_1", 0);
      expect(doc?.currentExecutionSnapshotId).toBeNull();
      expect(doc?.lockHeartbeatAt).toBeNull();
      expect(doc?.unitsTableFullName).toBe("gb_units_exp_1");
      expect(doc?.metricSources.map((s) => s.groupId)).toEqual(["g2"]);
      expect(doc?.metricCovariateSources.map((s) => s.groupId)).toEqual(["g2"]);
    });

    it("forgets the units table to force a full refresh", async () => {
      await seedLockedRun();

      await model.releaseLockAfterInterruptedRun("exp_1", "snap_0", {
        metricGroupIdsToRebuild: [],
        forceFullRefresh: true,
      });

      const doc = await model.getByExperimentIdAndPhase("exp_1", 0);
      expect(doc?.unitsTableFullName).toBeNull();
      expect(doc?.metricSources).toHaveLength(2);
      expect(doc?.currentExecutionSnapshotId).toBeNull();
    });

    it("changes nothing once another run holds the lock", async () => {
      await seedLockedRun();
      await model.releaseLock("exp_1", "snap_0");
      await acquireLock("exp_1", 0, "snap_1");

      expect(
        await model.releaseLockAfterInterruptedRun("exp_1", "snap_0", {
          metricGroupIdsToRebuild: ["g1"],
          forceFullRefresh: true,
        }),
      ).toBe(false);

      const doc = await model.getByExperimentIdAndPhase("exp_1", 0);
      expect(doc?.currentExecutionSnapshotId).toBe("snap_1");
      expect(doc?.unitsTableFullName).toBe("gb_units_exp_1");
      expect(doc?.metricSources).toHaveLength(2);
    });
  });

  describe("fullRefreshRequired", () => {
    const flag = { reason: "Interrupted", snapshotId: "snap_0" };
    const before = (date: Date) => new Date(date.getTime() - 1);
    const after = (date: Date) => new Date(date.getTime() + 1);
    const flaggedAt = async () => {
      const doc = await model.getByExperimentIdAndPhase("exp_1", 0);
      if (!doc?.fullRefreshRequired) throw new Error("Not flagged");
      return doc.fullRefreshRequired.date;
    };

    it("flags every phase of the experiment whoever holds the lock", async () => {
      await acquireLock("exp_1", 0, "snap_1");
      await acquireLock("exp_1", 1, "snap_2");
      await acquireLock("exp_2", 0, "snap_3");

      await model.requireFullRefresh("exp_1", flag);

      for (const phase of [0, 1]) {
        const doc = await model.getByExperimentIdAndPhase("exp_1", phase);
        expect(doc?.fullRefreshRequired).toEqual({
          ...flag,
          date: expect.any(Date),
        });
      }
      expect(
        (await model.getByExperimentIdAndPhase("exp_2", 0))
          ?.fullRefreshRequired ?? null,
      ).toBeNull();
    });

    it("is cleared by a full refresh started after it was set", async () => {
      await acquireLock("exp_1", 0, "snap_1");
      await model.requireFullRefresh("exp_1", flag);

      expect(
        await model.clearFullRefreshRequired(
          "exp_1",
          "snap_1",
          after(await flaggedAt()),
        ),
      ).toBe(true);
      expect(
        (await model.getByExperimentIdAndPhase("exp_1", 0))
          ?.fullRefreshRequired,
      ).toBeNull();
    });

    it("is kept by a full refresh started before it was set", async () => {
      await acquireLock("exp_1", 0, "snap_1");
      await model.requireFullRefresh("exp_1", flag);
      const date = await flaggedAt();

      expect(
        await model.clearFullRefreshRequired("exp_1", "snap_1", before(date)),
      ).toBe(false);
      expect(await flaggedAt()).toEqual(date);
    });

    it("is kept by a full refresh that no longer holds the lock", async () => {
      await acquireLock("exp_1", 0, "snap_1");
      await model.requireFullRefresh("exp_1", flag);
      await model.releaseLock("exp_1", "snap_1");

      expect(
        await model.clearFullRefreshRequired(
          "exp_1",
          "snap_1",
          after(await flaggedAt()),
        ),
      ).toBe(false);
      await flaggedAt();
    });
  });
});
