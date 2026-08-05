import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api/api.setup";

/**
 * Revision listings and counts decide visibility from the LIVE entity, not the
 * revision's snapshot.
 *
 * The snapshot records where the entity was when the draft was opened, so
 * snapshot-basis readability breaks both ways after a project move: the source
 * keeps seeing history for an entity it no longer owns, and the destination sees
 * none for one it does. A target with no live entity at all (deletion does not
 * cascade to revisions) is excluded — fail-closed, since falling back to the
 * snapshot would reinstate the leak.
 */

const ORG_ID = "org_read_basis";
const org = {
  id: ORG_ID,
  name: "Read Basis",
  ownerEmail: "t@t.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {},
} as unknown as OrganizationInterface;

describe("revision read basis", () => {
  setupApp();

  function adminContext() {
    const context = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "k" },
      role: "admin",
      req: { query: {}, headers: {} } as unknown as Request,
    });
    context.hasPremiumFeature = () => true;
    return context;
  }

  beforeEach(async () => {
    for (const c of ["revisions", "constants"]) {
      await mongoose.connection
        .collection(c)
        .deleteMany({ organization: ORG_ID });
    }
  });

  async function seedRevision(targetId: string) {
    await mongoose.connection.collection("revisions").insertOne({
      id: `rev_${targetId}`,
      organization: ORG_ID,
      version: 1,
      status: "draft",
      authorId: "u_admin",
      reviews: [],
      activityLog: [],
      contributors: [],
      target: {
        type: "constant",
        id: targetId,
        // Deliberately a DIFFERENT project from the live entity below, so a
        // snapshot-basis implementation and a live-basis one disagree.
        snapshot: { id: targetId, key: targetId, project: "prj_stale" },
        proposedChanges: [],
      },
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
  }

  async function seedConstant(id: string) {
    await mongoose.connection.collection("constants").insertOne({
      id,
      organization: ORG_ID,
      key: id,
      name: id,
      type: "string",
      value: "v",
      owner: "",
      project: "prj_live",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
  }

  it("counts a revision whose live entity resolves", async () => {
    await seedConstant("const_live");
    await seedRevision("const_live");

    const context = adminContext();
    expect(
      await context.models.revisions.getOpenRevisionCount("constant"),
    ).toBe(1);
    const { revisions, total } =
      await context.models.revisions.getByTargetTypePaginated("constant", {});
    expect(total).toBe(1);
    expect(revisions).toHaveLength(1);
  });

  it("excludes a revision whose entity no longer exists", async () => {
    // No constant seeded: deletion does not cascade to revisions, so this is the
    // orphan case. Snapshot-basis counted it (its snapshot names a project the
    // admin can read); live-basis does not, because there is no live entity to
    // judge and guessing from the snapshot is what leaks after a move.
    await seedRevision("const_gone");

    const context = adminContext();
    expect(
      await context.models.revisions.getOpenRevisionCount("constant"),
    ).toBe(0);
    const { revisions, total } =
      await context.models.revisions.getByTargetTypePaginated("constant", {});
    expect(total).toBe(0);
    expect(revisions).toHaveLength(0);
  });

  it("pages and totals agree, both measured on live entities", async () => {
    for (const id of ["const_1", "const_2", "const_3"]) {
      await seedConstant(id);
      await seedRevision(id);
    }
    // One target's entity disappears — the page and the total must BOTH drop it,
    // which is the property a raw count broke (pages under-filled while the
    // total overstated).
    await mongoose.connection
      .collection("constants")
      .deleteOne({ id: "const_2", organization: ORG_ID });

    const context = adminContext();
    const { revisions, total } =
      await context.models.revisions.getByTargetTypePaginated("constant", {
        limit: 10,
      });
    expect(total).toBe(2);
    expect(revisions).toHaveLength(2);
    expect(revisions.map((r) => r.target.id).sort()).toEqual([
      "const_1",
      "const_3",
    ]);
  });
});
