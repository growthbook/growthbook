import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api/api.setup";

/**
 * A changes-requested verdict stands the schedule down IN THE WRITE THAT RECORDS IT.
 *
 * This used to be two writes — reconcile the verdict, then scrub the schedule — and
 * the second one could be stale: a newer approval landing in between moves `status`
 * while leaving the schedule fields untouched, so the older cleanup still matched and
 * cleared the schedule of a revision that was now approved and due to publish. The
 * fix at the time was to guard the second write on the decision that authorized it.
 *
 * There is no second write now. `_updateOne` translates an explicitly-undefined field
 * to `$unset`, so the transition clears the schedule itself and the interleaving has
 * nowhere to happen. This pins the property that replaced the guard: after a
 * changes-requested verdict the schedule is gone, and after an approval it is not.
 *
 * If this goes red, the disarm has either stopped happening or started happening to
 * the wrong verdict — both of which the old two-write guard also existed to prevent.
 */

const ORG_ID = "org_stale_disarm";
const org = {
  id: ORG_ID,
  name: "Stale Disarm",
  ownerEmail: "t@t.co",
  url: "",
  dateCreated: new Date(),
  members: [
    {
      id: "u_reviewer",
      role: "admin",
      limitAccessByEnvironment: false,
      environments: [],
    },
  ],
  settings: {},
} as unknown as OrganizationInterface;

const context = () =>
  new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: "key_test" },
    role: "admin",
    req: { query: {}, headers: {} } as unknown as Request,
  });

const REV_ID = "rev_stale_disarm";
const FIRE_AT = new Date("2030-01-01T00:00:00Z");

const seed = async () => {
  for (const c of ["revisions", "constants"]) {
    await mongoose.connection
      .collection(c)
      .deleteMany({ organization: ORG_ID });
  }
  await mongoose.connection.collection("constants").insertOne({
    id: "cst_sd",
    organization: ORG_ID,
    key: "cst_sd",
    name: "cst_sd",
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
    autoPublishOnApproval: true,
    autoPublishEnabledBy: "u_author",
    scheduledPublishAt: FIRE_AT,
    scheduledPublishLockEdits: true,
    target: {
      type: "constant",
      id: "cst_sd",
      snapshot: { id: "cst_sd", key: "cst_sd", project: "" },
      proposedChanges: [],
    },
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
};

const stored = async () =>
  await mongoose.connection
    .collection("revisions")
    .findOne({ organization: ORG_ID, id: REV_ID });

const review = (decision: "approve" | "request-changes") =>
  context().models.revisions.addReview(REV_ID, "u_reviewer", decision, "", {
    authorizedByFlow: "test fixture: authority is not what this pins",
  });

describe("a changes-requested verdict stands the schedule down", () => {
  setupApp();

  it("clears the schedule in the same write that records the verdict", async () => {
    await seed();
    await review("request-changes");

    const row = await stored();
    expect(row?.status).toBe("changes-requested");
    expect(row?.autoPublishOnApproval).toBe(false);
    // Absent, not falsy — a date left on the document is what a later re-arm fires.
    for (const field of [
      "scheduledPublishAt",
      "scheduledPublishLockEdits",
      "autoPublishEnabledBy",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(row, field)).toBe(false);
    }
  });

  it("leaves an approved revision's schedule armed", async () => {
    // The control, and the case the old two-write race got wrong: approval must not
    // disarm. Clearing unconditionally would pass the case above and break every
    // publish-when-approved.
    await seed();
    await review("approve");

    const row = await stored();
    expect(row?.status).toBe("approved");
    expect(row?.autoPublishOnApproval).toBe(true);
    expect((row?.scheduledPublishAt as Date).getTime()).toBe(FIRE_AT.getTime());
  });
});
