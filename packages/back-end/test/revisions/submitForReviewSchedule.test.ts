import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api/api.setup";

const ORG_ID = "org_submit_schedule";
const org = {
  id: ORG_ID,
  name: "Submit Schedule",
  ownerEmail: "t@t.com",
  url: "",
  dateCreated: new Date(),
  members: [
    {
      id: "u_admin",
      role: "admin",
      limitAccessByEnvironment: false,
      environments: [],
    },
  ],
  settings: {},
} as unknown as OrganizationInterface;

describe("submitForReview arming a dated publish", () => {
  setupApp();

  function adminContext() {
    const context = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "k" },
      user: {
        id: "u_admin",
        email: "a@t.co",
        name: "A",
        superAdmin: false,
      },
      role: "admin",
      req: { query: {}, headers: {}, body: {} } as unknown as Request,
    });
    context.hasPremiumFeature = () => true;
    return context;
  }

  const REV_ID = "rev_submit_sched";

  beforeEach(async () => {
    for (const c of ["revisions", "constants"]) {
      await mongoose.connection
        .collection(c)
        .deleteMany({ organization: ORG_ID });
    }
    await mongoose.connection.collection("constants").insertOne({
      id: "cst_sched",
      organization: ORG_ID,
      key: "cst_sched",
      name: "cst_sched",
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
      status: "draft",
      authorId: "u_admin",
      reviews: [],
      activityLog: [],
      contributors: [],
      target: {
        type: "constant",
        id: "cst_sched",
        snapshot: { id: "cst_sched", key: "cst_sched", project: "" },
        proposedChanges: [],
      },
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
  });

  const stored = async () =>
    mongoose.connection
      .collection("revisions")
      .findOne({ organization: ORG_ID, id: REV_ID });

  it("writes the date, the locks and the armed flag in the transition", async () => {
    const context = adminContext();
    const when = new Date(Date.now() + 86_400_000);

    await context.models.revisions.submitForReview(REV_ID, "u_admin", {
      scheduledPublishAt: when,
      lockEdits: true,
      lockOthers: true,
    });

    const doc = await stored();
    expect({
      status: doc?.status,
      armed: doc?.autoPublishOnApproval,
      at: doc?.scheduledPublishAt?.toISOString?.(),
      lockEdits: doc?.scheduledPublishLockEdits,
      lockOthers: doc?.scheduledPublishLockOthers,
      enabledBy: doc?.autoPublishEnabledBy,
    }).toEqual({
      status: "pending-review",
      armed: true,
      at: when.toISOString(),
      lockEdits: true,
      lockOthers: true,
      enabledBy: "u_admin",
    });
  });

  it("leaves the schedule alone when no date is sent", async () => {
    const context = adminContext();
    await context.models.revisions.submitForReview(REV_ID, "u_admin", {});

    const doc = await stored();
    expect({
      status: doc?.status,
      armed: doc?.autoPublishOnApproval,
      at: doc?.scheduledPublishAt ?? null,
      lockEdits: doc?.scheduledPublishLockEdits ?? null,
      lockOthers: doc?.scheduledPublishLockOthers ?? null,
    }).toEqual({
      status: "pending-review",
      armed: false,
      at: null,
      lockEdits: null,
      lockOthers: null,
    });
  });

  it("refuses lock-others when a sibling already holds the publish lock", async () => {
    await mongoose.connection.collection("revisions").insertOne({
      id: "rev_sibling_lock",
      organization: ORG_ID,
      version: 3,
      status: "approved",
      authorId: "u_admin",
      reviews: [],
      activityLog: [],
      contributors: [],
      autoPublishOnApproval: true,
      scheduledPublishLockOthers: true,
      scheduledPublishAt: new Date(Date.now() + 172_800_000),
      target: {
        type: "constant",
        id: "cst_sched",
        snapshot: { id: "cst_sched", key: "cst_sched", project: "" },
        proposedChanges: [],
      },
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });

    const context = adminContext();
    await expect(
      context.models.revisions.submitForReview(REV_ID, "u_admin", {
        scheduledPublishAt: new Date(Date.now() + 86_400_000),
        lockOthers: true,
      }),
    ).rejects.toThrow(
      /already has a scheduled publish that locks other drafts/i,
    );

    expect((await stored())?.status).toBe("draft");
  });

  it("allows lock-others when the sibling holds no lock", async () => {
    await mongoose.connection.collection("revisions").insertOne({
      id: "rev_sibling_unlocked",
      organization: ORG_ID,
      version: 3,
      status: "approved",
      authorId: "u_admin",
      reviews: [],
      activityLog: [],
      contributors: [],
      autoPublishOnApproval: true,
      scheduledPublishAt: new Date(Date.now() + 172_800_000),
      target: {
        type: "constant",
        id: "cst_sched",
        snapshot: { id: "cst_sched", key: "cst_sched", project: "" },
        proposedChanges: [],
      },
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });

    const context = adminContext();
    await context.models.revisions.submitForReview(REV_ID, "u_admin", {
      scheduledPublishAt: new Date(Date.now() + 86_400_000),
      lockOthers: true,
    });
    expect((await stored())?.scheduledPublishLockOthers).toBe(true);
  });

  it("arms the no-date variant without inventing a schedule", async () => {
    const context = adminContext();
    await context.models.revisions.submitForReview(REV_ID, "u_admin", {
      autoPublishOnApproval: true,
    });

    const doc = await stored();
    expect({
      armed: doc?.autoPublishOnApproval,
      at: doc?.scheduledPublishAt ?? null,
    }).toEqual({ armed: true, at: null });
  });
});
