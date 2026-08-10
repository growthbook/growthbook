import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api/api.setup";

/**
 * Recall clears the whole schedule, in the SAME write that returns the revision to
 * draft.
 *
 * Recall restarts the lifecycle, so a schedule armed against the retracted round must
 * not survive it — otherwise a later "publish when approved" re-arm fires a date
 * nobody re-confirmed, carrying the arm-time acknowledgment fingerprint of content
 * that has since changed.
 *
 * One write, not two: a separate clear is a second race, needing its own guard
 * against erasing a schedule armed between the writes.
 *
 * These pin the OUTCOME (fields gone from the stored document), not the
 * mechanism, so the test survives another change of approach.
 */

const ORG_ID = "org_recall_schedule";
const org = {
  id: ORG_ID,
  name: "Recall Schedule",
  ownerEmail: "t@t.co",
  url: "",
  dateCreated: new Date(),
  members: [
    {
      id: "u_author",
      role: "admin",
      limitAccessByEnvironment: false,
      environments: [],
    },
  ],
  settings: {},
} as unknown as OrganizationInterface;

describe("recall clears the schedule it retracts", () => {
  setupApp();

  const REV_ID = "rev_recall_sched";

  const context = () =>
    new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_test" },
      role: "admin",
      req: { query: {}, headers: {} } as unknown as Request,
    });

  const seed = async (extra: Record<string, unknown>) => {
    for (const c of ["revisions", "constants"]) {
      await mongoose.connection
        .collection(c)
        .deleteMany({ organization: ORG_ID });
    }
    await mongoose.connection.collection("constants").insertOne({
      id: "cst_rs",
      organization: ORG_ID,
      key: "cst_rs",
      name: "cst_rs",
      type: "string",
      value: "v",
      owner: "",
      project: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    await mongoose.connection.collection("revisions").insertOne({
      id: REV_ID,
      organization: ORG_ID,
      version: 2,
      status: "pending-review",
      authorId: "u_author",
      reviews: [],
      activityLog: [],
      contributors: [],
      target: {
        type: "constant",
        id: "cst_rs",
        snapshot: { id: "cst_rs", key: "cst_rs", project: "" },
        proposedChanges: [],
      },
      dateCreated: new Date(),
      dateUpdated: new Date(),
      ...extra,
    });
  };

  const stored = async () =>
    await mongoose.connection
      .collection("revisions")
      .findOne({ organization: ORG_ID, id: REV_ID });

  it("removes every schedule field, not just the armed flag", async () => {
    await seed({
      autoPublishOnApproval: true,
      autoPublishEnabledBy: "u_author",
      scheduledPublishAt: new Date(Date.now() + 3_600_000),
      scheduledPublishLockEdits: true,
      scheduledPublishLockOthers: true,
      scheduledPublishBypassApproval: true,
      armAcknowledgments: { dependents: "ack" },
    });

    await context().models.revisions.recallReview(REV_ID, "u_author", {
      authorizedByFlow: "test fixture: the author recalls their own request",
    });

    const row = await stored();
    expect(row?.status).toBe("draft");
    expect(row?.autoPublishOnApproval).toBe(false);
    // ABSENT, not merely falsy: a stale date left on the document is what a later
    // re-arm would fire, and `undefined !== null` to Mongo.
    for (const field of [
      "autoPublishEnabledBy",
      "scheduledPublishAt",
      "scheduledPublishLockEdits",
      "scheduledPublishLockOthers",
      "scheduledPublishBypassApproval",
      "armAcknowledgments",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(row, field)).toBe(false);
    }
  });

  it("also clears the poller's failure state", async () => {
    // A parked schedule carries retry bookkeeping. Left behind, a re-arm inherits an
    // attempt count and a "gave up" stamp from a round that no longer exists.
    await seed({
      autoPublishOnApproval: true,
      scheduledPublishAt: new Date(Date.now() + 3_600_000),
      scheduledPublishAttempts: 3,
      scheduledPublishLastError: "boom",
      scheduledPublishGaveUpAt: new Date(),
    });

    await context().models.revisions.recallReview(REV_ID, "u_author", {
      authorizedByFlow: "test fixture: the author recalls their own request",
    });

    const row = await stored();
    for (const field of [
      "scheduledPublishAttempts",
      "scheduledPublishLastError",
      "scheduledPublishGaveUpAt",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(row, field)).toBe(false);
    }
  });

  it("leaves an unscheduled revision alone", async () => {
    // The control: recall on a revision that was never armed must not invent fields
    // or fail. Passing this while the two above fail would mean the clear is a no-op.
    await seed({});

    await context().models.revisions.recallReview(REV_ID, "u_author", {
      authorizedByFlow: "test fixture: the author recalls their own request",
    });

    const row = await stored();
    expect(row?.status).toBe("draft");
    expect(row?.autoPublishOnApproval).toBe(false);
  });
});
