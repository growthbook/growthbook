import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "./api.setup";

/**
 * Characterization tests for how a rebase RESOLVES a conflict.
 *
 * Rebase is the one revision action whose per-entity implementations still differ,
 * and unlike the others it decides data rather than authority: which value the
 * draft carries forward when the live entity moved underneath it. That logic had
 * essentially no coverage — one assertion in the whole back-end suite mentioned
 * `conflictResolutions` — so these pin the current behaviour first, to be the
 * safety net when the three implementations are folded into one.
 *
 * Constants take `overwrite` and `discard` only: their content is a scalar `value`
 * plus an `environmentValues` map, with no list to merge.
 */

const ORG_ID = "org_const_rebase";
const KEY = "rebase-target";

const org = {
  id: ORG_ID,
  name: "Constant Rebase",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {},
} as unknown as OrganizationInterface;

describe("POST /api/v1/constants-revisions/:key/:version/rebase", () => {
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

  async function seedConstant(value: string) {
    await mongoose.connection.collection("constants").deleteMany({
      organization: ORG_ID,
    });
    await mongoose.connection.collection("revisions").deleteMany({
      organization: ORG_ID,
    });
    await mongoose.connection.collection("constants").insertOne({
      id: `const_${KEY}`,
      organization: ORG_ID,
      key: KEY,
      name: "Rebase target",
      type: "string",
      value,
      owner: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
  }

  /** Open a draft and set its value, so the draft carries one `value` op. */
  async function draftWithValue(value: string): Promise<number> {
    const created = await request(app)
      .post(`/api/v1/constants-revisions/${KEY}`)
      .send({})
      .set(auth);
    expect(created.status).toBe(200);
    const version = created.body.revision.version;

    const edited = await request(app)
      .put(`/api/v1/constants-revisions/${KEY}/${version}/value`)
      .send({ value })
      .set(auth);
    expect(edited.status).toBe(200);
    return version;
  }

  /** Move the live constant out from under the draft, without a revision. */
  async function moveLiveTo(value: string) {
    await mongoose.connection
      .collection("constants")
      .updateOne({ id: `const_${KEY}` }, { $set: { value } });
  }

  async function rebase(
    version: number,
    conflictResolutions?: Record<string, string>,
  ) {
    return request(app)
      .post(`/api/v1/constants-revisions/${KEY}/${version}/rebase`)
      .send(conflictResolutions ? { conflictResolutions } : {})
      .set(auth);
  }

  async function draftValueAfter(version: number) {
    const revision = await mongoose.connection.collection("revisions").findOne({
      organization: ORG_ID,
      "target.id": `const_${KEY}`,
      version,
    });
    const ops = (revision?.target?.proposedChanges ?? []) as {
      path: string;
      value: unknown;
    }[];
    return {
      ops,
      value: ops.find((o) => o.path === "/value")?.value,
      baseValue: (revision?.target?.snapshot as { value?: string } | undefined)
        ?.value,
    };
  }

  it("refuses a conflicting rebase with no strategy for the field", async () => {
    useAdmin();
    await seedConstant("live-1");
    const version = await draftWithValue("draft-1");
    await moveLiveTo("live-2");

    // 409, not 400: an unresolved conflict is a conflict, and the response names
    // the fields so the caller knows what to send strategies for.
    const res = await rebase(version);
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/value/);
  });

  it("keeps the draft's value under `overwrite`, and rebases onto live", async () => {
    useAdmin();
    await seedConstant("live-1");
    const version = await draftWithValue("draft-1");
    await moveLiveTo("live-2");

    const res = await rebase(version, { value: "overwrite" });
    expect(res.status).toBe(200);

    const after = await draftValueAfter(version);
    // The draft still intends its own value, now on top of the newer base.
    expect(after.value).toBe("draft-1");
    expect(after.baseValue).toBe("live-2");
  });

  it("drops the draft's value under `discard`, keeping the live one", async () => {
    useAdmin();
    await seedConstant("live-1");
    const version = await draftWithValue("draft-1");
    await moveLiveTo("live-2");

    const res = await rebase(version, { value: "discard" });
    expect(res.status).toBe(200);

    const after = await draftValueAfter(version);
    // No `value` op survives, so publishing this draft leaves live untouched.
    expect(after.value).toBeUndefined();
    expect(after.baseValue).toBe("live-2");
  });

  it("drops an op that the live state has already caught up to", async () => {
    useAdmin();
    await seedConstant("live-1");
    const version = await draftWithValue("draft-1");
    // Live independently arrives at the value the draft was proposing.
    await moveLiveTo("draft-1");

    const res = await rebase(version, { value: "overwrite" });
    expect(res.status).toBe(200);

    const after = await draftValueAfter(version);
    // Nothing left to say: the op is a no-op against the new base.
    expect(after.value).toBeUndefined();
    expect(after.baseValue).toBe("draft-1");
  });

  it("rebases a non-conflicting draft without asking for a strategy", async () => {
    useAdmin();
    await seedConstant("live-1");
    const created = await request(app)
      .post(`/api/v1/constants-revisions/${KEY}`)
      .send({})
      .set(auth);
    const version = created.body.revision.version;
    // Draft touches only metadata; live moves `value`. No overlap, no conflict.
    const edited = await request(app)
      .put(`/api/v1/constants-revisions/${KEY}/${version}/metadata`)
      .send({ description: "drafted description" })
      .set(auth);
    expect(edited.status).toBe(200);
    await moveLiveTo("live-2");

    const res = await rebase(version);
    expect(res.status).toBe(200);

    const after = await draftValueAfter(version);
    expect(after.baseValue).toBe("live-2");
    // The draft's own field is untouched by someone else's change.
    expect(after.ops.find((o) => o.path === "/description")?.value).toBe(
      "drafted description",
    );
  });
});
