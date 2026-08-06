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

  /**
   * A reader with access to exactly one project. An admin reads every project, so
   * it cannot tell the two bases apart — only a caller who can read the live
   * project but not the snapshot's, or the reverse, makes the basis observable.
   */
  function readerLimitedTo(project: string) {
    const context = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "k" },
      role: "noaccess",
      apiKeyData: {
        role: "noaccess",
        limitAccessByEnvironment: false,
        environments: [],
        projectRoles: [
          {
            project,
            role: "readonly",
            limitAccessByEnvironment: false,
            environments: [],
          },
        ],
      } as unknown as Parameters<
        typeof ReqContextClass.prototype.constructor
      >[0]["apiKeyData"],
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

  async function seedRevision(targetId: string, version = 1) {
    await mongoose.connection.collection("revisions").insertOne({
      id: `rev_${targetId}_v${version}`,
      organization: ORG_ID,
      version,
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

  // The move, in both directions. The revision's snapshot says `prj_stale` and the
  // live constant says `prj_live`, so these two readers disagree under a snapshot
  // basis and agree with the live entity under this one.
  it("shows history to a reader of the entity's CURRENT project", async () => {
    await seedConstant("const_moved");
    await seedRevision("const_moved");

    const context = readerLimitedTo("prj_live");
    const { revisions, total } =
      await context.models.revisions.getByTargetTypePaginated("constant", {});
    expect({ total, count: revisions.length }).toEqual({ total: 1, count: 1 });
    expect(
      await context.models.revisions.getOpenRevisionCount("constant"),
    ).toBe(1);
  });

  it("hides it from a reader of only the project the snapshot names", async () => {
    await seedConstant("const_moved");
    await seedRevision("const_moved");

    const context = readerLimitedTo("prj_stale");
    const { revisions, total } =
      await context.models.revisions.getByTargetTypePaginated("constant", {});
    expect({ total, count: revisions.length }).toEqual({ total: 0, count: 0 });
    expect(
      await context.models.revisions.getOpenRevisionCount("constant"),
    ).toBe(0);
  });

  // Detail and history are the same rule in two more places. They read through
  // different model methods, and only the listing was converted at first — so the
  // destination could list a moved entity's revisions and then 404 on opening one.
  it("opens a single revision on the live basis, not the snapshot's", async () => {
    await seedConstant("const_moved");
    await seedRevision("const_moved");

    const destination = readerLimitedTo("prj_live");
    const source = readerLimitedTo("prj_stale");
    expect(
      await destination.models.revisions.getByIdReadable("rev_const_moved_v1"),
    ).not.toBeNull();
    expect(
      await source.models.revisions.getByIdReadable("rev_const_moved_v1"),
    ).toBeNull();
  });

  it("lists one entity's revisions on the live basis", async () => {
    await seedConstant("const_moved");
    await seedRevision("const_moved");

    const destination = readerLimitedTo("prj_live");
    const source = readerLimitedTo("prj_stale");
    expect(
      await destination.models.revisions.getByTargetReadable(
        "constant",
        "const_moved",
      ),
    ).toHaveLength(1);
    expect(
      await source.models.revisions.getByTargetReadable(
        "constant",
        "const_moved",
      ),
    ).toHaveLength(0);
  });

  it("returns merged history on the live basis", async () => {
    await seedConstant("const_moved");
    await mongoose.connection.collection("revisions").insertOne({
      id: "rev_merged",
      organization: ORG_ID,
      version: 1,
      status: "merged",
      authorId: "u_admin",
      reviews: [],
      activityLog: [],
      contributors: [],
      target: {
        type: "constant",
        id: "const_moved",
        snapshot: { id: "const_moved", key: "k", project: "prj_stale" },
        proposedChanges: [],
      },
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });

    const destination = readerLimitedTo("prj_live");
    const source = readerLimitedTo("prj_stale");
    expect(
      await destination.models.revisions.getEntityRevisionHistory(
        "constant",
        "const_moved",
      ),
    ).toHaveLength(1);
    expect(
      await source.models.revisions.getEntityRevisionHistory(
        "constant",
        "const_moved",
      ),
    ).toHaveLength(0);
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
  // An entity-scoped listing pages in the DATABASE: readability is one decision, so
  // it needs neither the projected scan nor the in-memory slice the org-wide inbox
  // does. These pin the two properties that path could silently lose — the total
  // still counts every matching row rather than the page, and an unreadable or
  // deleted target still yields nothing at all.
  it("pages one entity's revisions without over-reporting the total", async () => {
    await seedConstant("const_paged");
    for (const version of [1, 2, 3]) {
      await seedRevision("const_paged", version);
    }

    const context = adminContext();
    const first = await context.models.revisions.getByTargetPaginated(
      "constant",
      "const_paged",
      { limit: 2 },
    );
    expect(first.revisions).toHaveLength(2);
    expect(first.total).toBe(3);

    const second = await context.models.revisions.getByTargetPaginated(
      "constant",
      "const_paged",
      { limit: 2, skip: 2 },
    );
    expect(second.revisions).toHaveLength(1);
    expect(second.total).toBe(3);
    // Disjoint pages: a skip applied to the wrong side of the query repeats rows.
    expect(first.revisions.some((r) => r.id === second.revisions[0]?.id)).toBe(
      false,
    );
  });

  it("pages nothing for an entity the caller cannot read", async () => {
    await seedConstant("const_moved");
    await seedRevision("const_moved");

    const source = readerLimitedTo("prj_stale");
    const { revisions, total } =
      await source.models.revisions.getByTargetPaginated(
        "constant",
        "const_moved",
        { limit: 10 },
      );
    expect(revisions).toHaveLength(0);
    // Zero, not 1: a total counted before the readability decision leaks how much
    // history exists for an entity outside the caller's projects.
    expect(total).toBe(0);
  });

  it("pages nothing when the target entity is gone", async () => {
    await seedRevision("const_deleted");

    const context = adminContext();
    const { revisions, total } =
      await context.models.revisions.getByTargetPaginated(
        "constant",
        "const_deleted",
        { limit: 10 },
      );
    expect(revisions).toHaveLength(0);
    expect(total).toBe(0);
  });
});
