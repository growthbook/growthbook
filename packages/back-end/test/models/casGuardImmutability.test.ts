import mongoose from "mongoose";
import type { Response } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { postSubmit } from "back-end/src/routers/revision/revision.controller";
import { setupApp } from "../api/api.setup";

/**
 * A CAS guard must describe the document AS READ, and stay that way.
 *
 * `buildCasGuard` used to capture guard values BY REFERENCE. The read path copies
 * only the top level, so `existing.target` is the very object the guard holds — and
 * `RevisionModel.beforeUpdate` runs inside the write and rebuilds
 * `target.snapshot` through the adapter's `buildSnapshot`, which emits keys in its
 * own allowed-keys order. Mongo compares embedded documents by FIELD ORDER, so the
 * guard reaching the filter no longer matched the document it was read from. Every
 * retry re-read and re-mutated identically: `updateWithCas: exhausted 5 attempts`,
 * a 500, on an ordinary revision.
 *
 * Nothing self-heals it — the rebuild is never persisted, because `target` isn't in
 * the `$set`. Any revision whose stored snapshot key order differs from
 * `SNAPSHOT_ALLOWED_KEYS` (an older write order, a migration, a direct import) is
 * permanently un-submittable and un-reviewable across every verb that guards
 * `target`: submitForReview, recallReview, undoReview, addReview, writeContentEdit.
 *
 * The fixture below is a revision whose snapshot carries `environmentValues` LAST,
 * which is where the rebuild visibly reorders it. Remove the clone in
 * `buildCasGuard` and this goes red.
 */

const ORG_ID = "org_cas_guard";
const org = {
  id: ORG_ID,
  name: "CAS Guard",
  ownerEmail: "t@t.co",
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

describe("CAS guards survive a beforeUpdate hook that rewrites the guarded field", () => {
  setupApp();

  const REV_ID = "rev_cas_guard";

  const resSpy = () => {
    const captured: { status?: number; body?: unknown } = {};
    const res = {
      status(code: number) {
        captured.status = code;
        return this;
      },
      json(payload: unknown) {
        captured.body = payload;
        return this;
      },
    } as unknown as Response;
    return { res, captured };
  };

  const seed = async (snapshot: Record<string, unknown>) => {
    for (const c of ["revisions", "constants"]) {
      await mongoose.connection
        .collection(c)
        .deleteMany({ organization: ORG_ID });
    }
    await mongoose.connection.collection("constants").insertOne({
      id: "cst_guard",
      organization: ORG_ID,
      key: "cst_guard",
      name: "cst_guard",
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
        id: "cst_guard",
        snapshot,
        proposedChanges: [],
      },
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
  };

  const submit = async () => {
    const { res, captured } = resSpy();
    await postSubmit(
      {
        params: { id: REV_ID },
        body: {},
        organization: org,
        userId: "u_admin",
        email: "a@t.co",
        name: "A",
        query: {},
        headers: {},
      } as unknown as Parameters<typeof postSubmit>[0],
      res,
    );
    return captured;
  };

  it("submits a revision whose snapshot key order differs from the rebuild's", async () => {
    // `environmentValues` last. `buildSnapshot` emits it before `project`, so the
    // rebuild reorders the object — the exact divergence Mongo's embedded-document
    // equality is sensitive to.
    await seed({
      id: "cst_guard",
      key: "cst_guard",
      project: "",
      environmentValues: { dev: "d" },
    });

    const captured = await submit();
    expect(captured.status).toBe(200);
    expect(
      (
        await mongoose.connection
          .collection("revisions")
          .findOne({ organization: ORG_ID, id: REV_ID })
      )?.status,
    ).toBe("pending-review");
  });

  it("still submits the ordinary snapshot shape", async () => {
    // The control. This one's stored order already matches the rebuild, so it
    // passed even with the bug — which is exactly why the bug went unseen: every
    // fixture in the suite happened to be written in allowed-keys order.
    await seed({ id: "cst_guard", key: "cst_guard", project: "" });

    const captured = await submit();
    expect(captured.status).toBe(200);
  });

  it("submits a snapshot carrying an explicit null the rebuild would drop", async () => {
    // The second divergence class: `buildSnapshot` skips nullish values, so a
    // stored `{owner: null}` becomes an absent key — and in Mongo an absent key
    // does not equal a null one.
    await seed({
      id: "cst_guard",
      key: "cst_guard",
      project: "",
      owner: null,
    });

    const captured = await submit();
    expect(captured.status).toBe(200);
  });
});
