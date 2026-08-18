import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "./api.setup";

/**
 * Characterization tests for the `union` conflict strategy, which only the
 * list-valued entities have. Saved Groups are the case that matters: two people
 * adding different IDs to the same list is the conflict users actually hit, and
 * "union" is the resolution that keeps both sets of intent.
 *
 * Pins the current behaviour ahead of folding the three rebase implementations
 * together — this is the resolution logic that had no coverage.
 */

const ORG_ID = "org_sg_rebase_union";
const GROUP_ID = "grp_rebase_union";

const org = {
  id: ORG_ID,
  name: "SG Rebase Union",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  // An ID list validates its attributeKey against the org's attribute schema.
  settings: {
    attributeSchema: [{ property: "id", datatype: "string" }],
  },
} as unknown as OrganizationInterface;

describe("POST /api/v1/saved-groups-revisions/:id/:version/rebase (union)", () => {
  const { app, setReqContext } = setupApp();
  const auth = { Authorization: "Bearer foo" };

  function useAdmin() {
    setReqContext(
      new ReqContextClass({
        org,
        auditUser: { type: "api_key", apiKey: "key_test" },
        role: "admin",
        req: { query: {}, headers: {} } as unknown as Request,
      }),
    );
  }

  async function seedGroup(values: string[]) {
    await mongoose.connection
      .collection("savedgroups")
      .deleteMany({ organization: ORG_ID });
    await mongoose.connection
      .collection("revisions")
      .deleteMany({ organization: ORG_ID });
    await mongoose.connection.collection("savedgroups").insertOne({
      id: GROUP_ID,
      organization: ORG_ID,
      groupName: "Rebase union",
      owner: "",
      type: "list",
      attributeKey: "id",
      values,
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
  }

  /** A draft that adds `add` to the list. */
  async function draftAdding(add: string[]): Promise<number> {
    const created = await request(app)
      .post(`/api/v1/saved-groups-revisions/${GROUP_ID}`)
      .send({})
      .set(auth);
    expect(created.status).toBe(200);
    const version = created.body.revision.version;
    const edited = await request(app)
      .post(`/api/v1/saved-groups-revisions/${GROUP_ID}/${version}/items/add`)
      .send({ items: add })
      .set(auth);
    expect(edited.status).toBe(200);
    return version;
  }

  async function moveLiveTo(values: string[]) {
    await mongoose.connection
      .collection("savedgroups")
      .updateOne({ id: GROUP_ID }, { $set: { values } });
  }

  async function draftValuesAfter(version: number) {
    const revision = await mongoose.connection.collection("revisions").findOne({
      organization: ORG_ID,
      "target.id": GROUP_ID,
      version,
    });
    const ops = (revision?.target?.proposedChanges ?? []) as {
      path: string;
      value: unknown;
    }[];
    return ops.find((o) => o.path === "/values")?.value as string[] | undefined;
  }

  it("keeps both sides' additions, deduped, under `union`", async () => {
    useAdmin();
    await seedGroup(["a"]);
    const version = await draftAdding(["b"]); // draft wants a, b
    await moveLiveTo(["a", "c"]); // someone else added c

    const res = await request(app)
      .post(`/api/v1/saved-groups-revisions/${GROUP_ID}/${version}/rebase`)
      .send({ conflictResolutions: { values: "union" } })
      .set(auth);
    expect(res.status).toBe(200);

    const values = await draftValuesAfter(version);
    // Live first, then the draft's own additions; no duplicate "a".
    expect(values).toEqual(["a", "c", "b"]);
  });

  it("lets an explicit customValues resolution override the union", async () => {
    useAdmin();
    await seedGroup(["a"]);
    const version = await draftAdding(["b"]);
    await moveLiveTo(["a", "c"]);

    const res = await request(app)
      .post(`/api/v1/saved-groups-revisions/${GROUP_ID}/${version}/rebase`)
      .send({
        conflictResolutions: { values: "union" },
        customValues: { values: ["only", "these"] },
      })
      .set(auth);
    expect(res.status).toBe(200);

    expect(await draftValuesAfter(version)).toEqual(["only", "these"]);
  });

  it("takes the draft's list under `overwrite`, dropping the other addition", async () => {
    useAdmin();
    await seedGroup(["a"]);
    const version = await draftAdding(["b"]);
    await moveLiveTo(["a", "c"]);

    const res = await request(app)
      .post(`/api/v1/saved-groups-revisions/${GROUP_ID}/${version}/rebase`)
      .send({ conflictResolutions: { values: "overwrite" } })
      .set(auth);
    expect(res.status).toBe(200);

    // "c" is lost — which is what overwrite means, and why union exists.
    expect(await draftValuesAfter(version)).toEqual(["a", "b"]);
  });

  it("drops the draft's list entirely under `discard`", async () => {
    useAdmin();
    await seedGroup(["a"]);
    const version = await draftAdding(["b"]);
    await moveLiveTo(["a", "c"]);

    const res = await request(app)
      .post(`/api/v1/saved-groups-revisions/${GROUP_ID}/${version}/rebase`)
      .send({ conflictResolutions: { values: "discard" } })
      .set(auth);
    expect(res.status).toBe(200);

    expect(await draftValuesAfter(version)).toBeUndefined();
  });
});
