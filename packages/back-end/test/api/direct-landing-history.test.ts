import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { CasConflictError } from "back-end/src/models/BaseModel";
import { setupApp } from "./api.setup";

/**
 * Direct REST landings are RECORDED and GUARDED for every org — not only those
 * with approval requirements.
 *
 * These endpoints used to fork: with approvals, an update or archive was
 * recorded as a merged revision and rolled back on failure; without them it was
 * a plain model write — last-write-wins, invisible in history, no webhook. The
 * org here has NO approval requirements, so every assertion below is pinning
 * the previously-missing half of the fork.
 */

const ORG_ID = "org_direct_landing";

const org = {
  id: ORG_ID,
  name: "Direct Landing",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {
    attributeSchema: [{ property: "id", datatype: "string" }],
  },
} as unknown as OrganizationInterface;

describe("direct REST landings without approval requirements", () => {
  const { app, setReqContext } = setupApp();
  const auth = { Authorization: "Bearer foo" };
  let context: ReqContextClass;

  beforeEach(() => {
    context = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_test" },
      role: "admin",
      req: { query: {}, headers: {} } as unknown as Request,
    });
    // Configs are commercial; the suite tests landing mechanics, not licensing.
    context.hasPremiumFeature = () => true;
    setReqContext(context);
  });

  async function mergedRevisionsFor(entityType: string, id: string) {
    return mongoose.connection
      .collection("revisions")
      .find({
        organization: ORG_ID,
        "target.type": entityType,
        "target.id": id,
        status: "merged",
      })
      .sort({ version: 1 })
      .toArray();
  }

  describe.each([
    {
      label: "Constants",
      base: "constants",
      entityType: "constant",
      create: () => ({
        key: "landing-const",
        name: "Landing",
        type: "string",
        value: "v1",
      }),
      update: { value: "v2" },
      updatedPath: "/value",
      pathId: "landing-const",
    },
    {
      label: "Configs",
      base: "configs",
      entityType: "config",
      create: () => ({
        key: "landing-config",
        name: "Landing",
        value: { timeout: 1 },
      }),
      update: { value: { timeout: 2 } },
      updatedPath: "/value",
      pathId: "landing-config",
    },
  ])("$label", ({ base, entityType, create, update, updatedPath, pathId }) => {
    it("records an update as a merged revision, then archives as another", async () => {
      await mongoose.connection
        .collection("revisions")
        .deleteMany({ organization: ORG_ID });

      const created = await request(app)
        .post(`/api/v1/${base}`)
        .send(create())
        .set(auth);
      expect(created.status).toBe(200);
      const id = (Object.values(created.body)[0] as { id: string }).id;

      const updated = await request(app)
        .post(`/api/v1/${base}/${pathId}`)
        .send(update)
        .set(auth);
      expect(updated.status).toBe(200);

      // The backfilled live revision plus the update's own record.
      let merged = await mergedRevisionsFor(entityType, id);
      expect(merged).toHaveLength(2);
      const record = merged[1];
      // No approval requirement existed, so none was bypassed.
      expect(record.bypass ?? false).toBe(false);
      expect(
        (record.target.proposedChanges as { path: string }[]).map(
          (op) => op.path,
        ),
      ).toContain(updatedPath);

      const archived = await request(app)
        .post(`/api/v1/${base}/${pathId}/archive`)
        .send({})
        .set(auth);
      expect(archived.status).toBe(200);

      merged = await mergedRevisionsFor(entityType, id);
      expect(merged).toHaveLength(3);
      expect(
        (merged[2].target.proposedChanges as { path: string }[]).map(
          (op) => op.path,
        ),
      ).toEqual(["/archived"]);
    });
  });

  it("records a Saved Group update the same way", async () => {
    await mongoose.connection
      .collection("revisions")
      .deleteMany({ organization: ORG_ID });
    await mongoose.connection
      .collection("savedgroups")
      .deleteMany({ organization: ORG_ID });

    const created = await request(app)
      .post(`/api/v1/saved-groups`)
      .send({
        name: "landing-group",
        values: ["a"],
        attributeKey: "id",
        owner: "",
      })
      .set(auth);
    expect(created.status).toBe(200);
    const id = created.body.savedGroup.id as string;

    const updated = await request(app)
      .post(`/api/v1/saved-groups/${id}`)
      .send({ values: ["a", "b"] })
      .set(auth);
    expect(updated.status).toBe(200);

    const merged = await mongoose.connection
      .collection("revisions")
      .find({
        organization: ORG_ID,
        "target.type": "saved-group",
        "target.id": id,
        status: "merged",
      })
      .sort({ version: 1 })
      .toArray();
    expect(merged).toHaveLength(2);
    expect(merged[1].bypass ?? false).toBe(false);
  });

  // The primitive every landing's write now rests on: a stale pre-image must
  // refuse rather than overwrite. Exercised directly because two HTTP requests
  // cannot be made to interleave deterministically.
  it("updateIfUnchanged refuses a write computed from a stale read", async () => {
    await mongoose.connection
      .collection("constants")
      .deleteMany({ organization: ORG_ID });
    await mongoose.connection.collection("constants").insertOne({
      id: "const_stale",
      organization: ORG_ID,
      key: "stale-check",
      name: "Stale",
      type: "string",
      value: "v1",
      owner: "",
      dateCreated: new Date(Date.now() - 60_000),
      // Backdated: the guard compares dateUpdated at millisecond precision, and
      // a same-millisecond seed + write would make the stale stamp equal the
      // fresh one. Real landings never hit this — a pre-image is read before the
      // work that precedes a write, not in the same millisecond as the rival's.
      dateUpdated: new Date(Date.now() - 60_000),
    });

    const preImage = await context.models.constants.getById("const_stale");
    if (!preImage) throw new Error("seed missing");

    // Another writer lands first.
    await context.models.constants.update(preImage, { value: "theirs" });

    // A write computed from the stale read must refuse...
    await expect(
      context.models.constants.updateIfUnchanged(preImage, { value: "ours" }),
    ).rejects.toBeInstanceOf(CasConflictError);
    // ...leaving the winner's value in place.
    const after = await context.models.constants.getById("const_stale");
    expect(after?.value).toBe("theirs");

    // And a fresh read writes normally.
    const fresh = await context.models.constants.getById("const_stale");
    if (!fresh) throw new Error("row missing");
    await context.models.constants.updateIfUnchanged(fresh, { value: "ours" });
    expect((await context.models.constants.getById("const_stale"))?.value).toBe(
      "ours",
    );
  });
});
