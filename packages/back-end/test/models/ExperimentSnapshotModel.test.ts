import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  getLatestSnapshot,
  createExperimentSnapshotModel,
} from "back-end/src/models/ExperimentSnapshotModel";
import type { ExperimentSnapshotDocument } from "back-end/src/models/ExperimentSnapshotModel";
import { snapshotFactory } from "back-end/test/factories/Snapshot.factory";

describe("ExperimentSnapshotModel", () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.close();
    await mongod.stop();
  });

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

  describe("getLatestSnapshot", () => {
    const experiment = "exp_shadow_test";
    const phase = 0;

    it("does not let errored scheduled snapshots shadow in-progress manual refreshes", async () => {
      // Multi-replica scenario: a scheduled job on a broken replica wrote
      // an errored snapshot AFTER the user kicked off a manual refresh on
      // a healthy replica. Without the fix, the UI poll (type=undefined,
      // withResults=false) would return the scheduled error instead of
      // the user's running snapshot.

      // User's manual refresh — started first, still running
      const manual = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "manual",
        status: "running",
        dateCreated: new Date("2024-01-01T12:00:00Z"),
      });
      await createExperimentSnapshotModel({ data: manual });

      // Scheduled refresh on broken replica — newer dateCreated, errored
      const scheduled = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "schedule",
        status: "error",
        dateCreated: new Date("2024-01-01T12:05:00Z"),
      });
      await createExperimentSnapshotModel({ data: scheduled });

      const result = await getLatestSnapshot({
        experiment,
        phase,
        withResults: false,
        // type intentionally omitted — this is what the UI poll sends
      });

      expect(result?.id).toBe(manual.id);
      expect(result?.triggeredBy).toBe("manual");
      expect(result?.status).toBe("running");
    });

    it("prefers an older running snapshot regardless of triggeredBy value", async () => {
      const runningFromSchedule = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "schedule",
        status: "running",
        dateCreated: new Date("2024-01-01T12:00:00Z"),
      });
      await createExperimentSnapshotModel({ data: runningFromSchedule });

      const scheduledError = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "schedule",
        status: "error",
        dateCreated: new Date("2024-01-01T12:05:00Z"),
      });
      await createExperimentSnapshotModel({ data: scheduledError });

      const result = await getLatestSnapshot({
        experiment,
        phase,
        withResults: false,
      });

      expect(result?.id).toBe(runningFromSchedule.id);
      expect(result?.triggeredBy).toBe("schedule");
      expect(result?.status).toBe("running");
    });

    it("returns the latest scheduled error when no older running snapshot exists", async () => {
      const olderSuccess = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "manual",
        status: "success",
        dateCreated: new Date("2024-01-01T12:00:00Z"),
      });
      await createExperimentSnapshotModel({ data: olderSuccess });

      const scheduledError = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "schedule",
        status: "error",
        dateCreated: new Date("2024-01-01T12:05:00Z"),
      });
      await createExperimentSnapshotModel({ data: scheduledError });

      const result = await getLatestSnapshot({
        experiment,
        phase,
        withResults: false,
      });

      expect(result?.id).toBe(scheduledError.id);
      expect(result?.triggeredBy).toBe("schedule");
      expect(result?.status).toBe("error");
    });

    it("does not apply the override when beforeSnapshot is passed", async () => {
      const running = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "manual",
        status: "running",
        dateCreated: new Date("2024-01-01T12:00:00Z"),
      });
      await createExperimentSnapshotModel({ data: running });

      const scheduledError = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "schedule",
        status: "error",
        dateCreated: new Date("2024-01-01T12:05:00Z"),
      });
      await createExperimentSnapshotModel({ data: scheduledError });

      const result = await getLatestSnapshot({
        experiment,
        phase,
        withResults: false,
        beforeSnapshot: {
          dateCreated: new Date("2024-01-01T12:10:00Z"),
        } as unknown as ExperimentSnapshotDocument,
      });

      expect(result?.id).toBe(scheduledError.id);
      expect(result?.status).toBe("error");
    });

    it("still surfaces successful scheduled snapshots", async () => {
      const manual = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "manual",
        status: "running",
        dateCreated: new Date("2024-01-01T12:00:00Z"),
      });
      await createExperimentSnapshotModel({ data: manual });

      // Scheduled refresh that actually worked — should win (newer + success)
      const scheduled = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "schedule",
        status: "success",
        dateCreated: new Date("2024-01-01T12:05:00Z"),
      });
      await createExperimentSnapshotModel({ data: scheduled });

      const result = await getLatestSnapshot({
        experiment,
        phase,
        withResults: false,
      });

      expect(result?.id).toBe(scheduled.id);
      expect(result?.triggeredBy).toBe("schedule");
      expect(result?.status).toBe("success");
    });

    it("still surfaces manual errors", async () => {
      // If the user's own refresh failed, they need to see that error.
      const manualError = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "manual",
        status: "error",
        dateCreated: new Date("2024-01-01T12:05:00Z"),
      });
      await createExperimentSnapshotModel({ data: manualError });

      const result = await getLatestSnapshot({
        experiment,
        phase,
        withResults: false,
      });

      expect(result?.id).toBe(manualError.id);
      expect(result?.triggeredBy).toBe("manual");
      expect(result?.status).toBe("error");
    });

    it("still returns scheduled errors when type is explicitly requested", async () => {
      // If a caller explicitly asks for type="standard", they get
      // everything of that type — including scheduled errors. The
      // override only applies to the generic "latest" poll.
      const scheduled = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "schedule",
        status: "error",
        dateCreated: new Date("2024-01-01T12:05:00Z"),
      });
      await createExperimentSnapshotModel({ data: scheduled });

      const result = await getLatestSnapshot({
        experiment,
        phase,
        withResults: false,
        type: "standard",
      });

      expect(result?.id).toBe(scheduled.id);
      expect(result?.status).toBe("error");
    });

    it("never returns scheduled errors from withResults=true (status filter already excludes them)", async () => {
      // Sanity check: withResults=true already filters to status="success".
      const scheduledError = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "schedule",
        status: "error",
        dateCreated: new Date("2024-01-01T12:05:00Z"),
      });
      await createExperimentSnapshotModel({ data: scheduledError });

      const scheduledSuccess = snapshotFactory.build({
        experiment,
        phase,
        type: "standard",
        triggeredBy: "schedule",
        status: "success",
        dateCreated: new Date("2024-01-01T12:00:00Z"),
      });
      await createExperimentSnapshotModel({ data: scheduledSuccess });

      const result = await getLatestSnapshot({
        experiment,
        phase,
        withResults: true,
      });

      expect(result?.id).toBe(scheduledSuccess.id);
      expect(result?.status).toBe("success");
    });
  });
});
