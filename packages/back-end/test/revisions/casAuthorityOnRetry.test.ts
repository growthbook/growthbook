import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api/api.setup";

/**
 * Authority is re-asked on the row every CAS attempt, not once before the loop.
 *
 * A caller checks permission against the row it read. The loop then re-reads on each
 * retry, so a concurrent rebase can move the revision into a project the caller holds
 * nothing in — and the retry writes there. Guarding the moved field does NOT close
 * this: the guard makes the first attempt lose, and the retry proceeds against the
 * new row. That distinction is why five verbs shipped without a check while carrying
 * a comment claiming the guard covered it.
 *
 * These drive the model directly, which is the only layer where the retry is
 * observable — every controller check happens before the loop starts.
 */

const ORG_ID = "org_cas_authority";
const org = {
  id: ORG_ID,
  name: "CAS Authority",
  ownerEmail: "t@t.co",
  url: "",
  dateCreated: new Date(),
  members: [
    {
      id: "u_scoped",
      // Draft rights everywhere EXCEPT `prj_forbidden`, which is downgraded.
      role: "engineer",
      limitAccessByEnvironment: false,
      environments: [],
      projectRoles: [{ project: "prj_forbidden", role: "readonly" }],
    },
  ],
  settings: {},
} as unknown as OrganizationInterface;

const contextAs = (role: string) =>
  new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: "key_test" },
    role,
    req: { query: {}, headers: {} } as unknown as Request,
  });

const REV_ID = "rev_cas_auth";

const seed = async (project: string) => {
  for (const c of ["revisions", "constants"]) {
    await mongoose.connection
      .collection(c)
      .deleteMany({ organization: ORG_ID });
  }
  await mongoose.connection.collection("constants").insertOne({
    id: "cst_auth",
    organization: ORG_ID,
    key: "cst_auth",
    name: "cst_auth",
    type: "string",
    value: "v",
    owner: "",
    project,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
  await mongoose.connection.collection("revisions").insertOne({
    id: REV_ID,
    organization: ORG_ID,
    version: 2,
    status: "draft",
    authorId: "u_someone_else",
    reviews: [],
    activityLog: [],
    contributors: [],
    target: {
      type: "constant",
      id: "cst_auth",
      snapshot: {
        id: "cst_auth",
        organization: ORG_ID,
        key: "cst_auth",
        name: "cst_auth",
        type: "string",
        value: "v",
        owner: "",
        project,
        dateCreated: new Date(),
        dateUpdated: new Date(),
      },
      proposedChanges: [],
    },
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
};

describe("CAS-guarded revision writes re-ask authority on every attempt", () => {
  setupApp();

  it("refuses when the row it writes sits in a project the caller cannot draft in", async () => {
    // The row as a rebase would leave it. The caller's own check passed against the
    // project the revision USED to be in; this is the row the write lands on, and
    // the check inside `compute` is the only one that sees it.
    await seed("prj_any");
    const { draftAuthorityOnRow } = await import(
      "back-end/src/revisions/revisionAuthority"
    );

    // A caller with no draft authority over the row the write lands on. Before this
    // change the model took no authority argument at all, so this write succeeded.
    await expect(
      contextAs("readonly").models.revisions.updateProposedChanges(
        REV_ID,
        [{ op: "replace", path: "/value", value: "mine" }],
        "u_scoped",
        draftAuthorityOnRow(contextAs("readonly")),
      ),
    ).rejects.toThrow(/permission/i);

    const row = await mongoose.connection
      .collection("revisions")
      .findOne({ organization: ORG_ID, id: REV_ID });
    expect(row?.target.proposedChanges).toEqual([]);
  });

  it("still writes for a caller who does hold draft authority", async () => {
    // The control. A guard that refused every retry would pass the case above and
    // break every ordinary concurrent edit.
    await seed("prj_any");
    const model = contextAs("engineer").models.revisions;
    const { draftAuthorityOnRow } = await import(
      "back-end/src/revisions/revisionAuthority"
    );

    await model.updateProposedChanges(
      REV_ID,
      [{ op: "replace", path: "/value", value: "mine" }],
      "u_scoped",
      draftAuthorityOnRow(contextAs("engineer")),
    );

    const row = await mongoose.connection
      .collection("revisions")
      .findOne({ organization: ORG_ID, id: REV_ID });
    expect(row?.target.proposedChanges).toHaveLength(1);
  });
});
