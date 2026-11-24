import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { rebaseRevision } from "back-end/src/revisions/revisionActions";
import { setupApp } from "../api/api.setup";

// A draft op that still equals the draft's base proposes nothing. Rebasing must
// drop it, or it would undo whatever live published since.

const ORG_ID = "org_rebase_unchanged";
const org = {
  id: ORG_ID,
  name: "Rebase Unchanged",
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

const context = () =>
  new ReqContextClass({
    org,
    auditUser: { type: "dashboard", id: "u_author", email: "a@a.co", name: "" },
    role: "admin",
    req: { query: {}, headers: {} } as unknown as Request,
  });

const REV_ID = "rev_rebase_unchanged";

const seed = async () => {
  for (const c of ["revisions", "constants"]) {
    await mongoose.connection
      .collection(c)
      .deleteMany({ organization: ORG_ID });
  }
  const constant = {
    id: "cst_ru",
    key: "cst_ru",
    name: "Original",
    type: "string",
    owner: "",
    project: "",
    dateCreated: new Date(),
    dateUpdated: new Date(),
  };
  // Live has moved on to v1 since the draft was taken at v0.
  await mongoose.connection
    .collection("constants")
    .insertOne({ ...constant, organization: ORG_ID, value: "v1" });
  await mongoose.connection.collection("revisions").insertOne({
    id: REV_ID,
    organization: ORG_ID,
    version: 2,
    status: "draft",
    authorId: "u_author",
    reviews: [],
    activityLog: [],
    contributors: [],
    target: {
      type: "constant",
      id: "cst_ru",
      snapshot: { ...constant, value: "v0" },
      // The value was edited, then put back; the rename is the real change.
      proposedChanges: [
        { op: "replace", path: "/value", value: "v0" },
        { op: "replace", path: "/name", value: "Renamed" },
      ],
    },
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
};

describe("rebasing a draft", () => {
  setupApp();

  it("drops an op that equals the draft's base and keeps real changes", async () => {
    await seed();
    const ctx = context();
    const entity = await ctx.models.constants.getById("cst_ru");
    const revision = await ctx.models.revisions.getById(REV_ID);
    if (!entity || !revision) throw new Error("seed failed");

    const rebased = await rebaseRevision({
      context: ctx,
      entityType: "constant",
      entity: entity as unknown as Record<string, unknown>,
      revision,
      strategies: {},
    });

    expect(rebased.target.proposedChanges).toEqual([
      { op: "replace", path: "/name", value: "Renamed" },
    ]);
  });
});
