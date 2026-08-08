import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api/api.setup";

/**
 * A stale `changes-requested` cleanup must not clear a newer approval's schedule.
 *
 * Verdict reconciliation and schedule removal are two writes. The cleanup is
 * authorized by the DECISION the first write made ("this verdict is
 * changes-requested, so disarm") — and that decision read the status and the
 * verdicts. Guarding only the schedule fields let a newer approval land in the
 * window: it moves `status` while leaving `scheduledPublishAt` and
 * `autoPublishOnApproval` untouched, so the older cleanup still matched and cleared
 * the schedule of a revision that is now approved and due to publish.
 *
 * The row below is exactly that interleaving frozen in place: the schedule fields
 * are as the disarming writer left them, and the status is what the newer approval
 * set. Nothing else distinguishes the two situations.
 */

const ORG_ID = "org_stale_disarm";
const org = {
  id: ORG_ID,
  name: "Stale Disarm",
  ownerEmail: "t@t.co",
  url: "",
  dateCreated: new Date(),
  members: [],
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

const seed = async (status: string) => {
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
    status,
    authorId: "u_author",
    reviews: [],
    activityLog: [],
    contributors: [],
    autoPublishOnApproval: true,
    scheduledPublishAt: FIRE_AT,
    target: {
      type: "constant",
      id: "cst_sd",
      snapshot: {
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
      },
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

/** The scrub as the changes-requested path invokes it: observed = the row it decided on. */
const scrubAsDisarmer = async (observedStatus: string) => {
  const model = context().models.revisions as unknown as {
    disarmScheduledPublish: (
      id: string,
      opts: { observed: Record<string, unknown> },
    ) => Promise<unknown>;
  };
  const row = (await stored()) as Record<string, unknown>;
  await model.disarmScheduledPublish(REV_ID, {
    // What the disarming writer's own CAS left: schedule still armed, and the
    // status IT saw.
    observed: { ...row, status: observedStatus },
  });
};

describe("the schedule scrub is guarded on the decision that authorized it", () => {
  setupApp();

  it("leaves the schedule alone when a newer approval has moved the status", async () => {
    // Live is `approved` — reviewer B landed after reviewer A's changes-requested.
    await seed("approved");

    await scrubAsDisarmer("changes-requested");

    const row = await stored();
    expect(row?.status).toBe("approved");
    expect(row?.autoPublishOnApproval).toBe(true);
    expect(row?.scheduledPublishAt).toEqual(FIRE_AT);
  });

  it("still clears the schedule when the row is the one it decided on", async () => {
    // The control. A guard that refused every scrub would pass the case above and
    // leave a stale schedule armed after every changes-requested verdict.
    await seed("changes-requested");

    await scrubAsDisarmer("changes-requested");

    const row = await stored();
    expect(row?.autoPublishOnApproval).toBe(false);
    expect(row?.scheduledPublishAt ?? null).toBeNull();
  });
});
