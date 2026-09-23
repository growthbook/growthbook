import { vi } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { assertFeatureArchiveDependentsGuard } from "back-end/src/services/archiveDependentsGuard";
import { SoftWarningError } from "back-end/src/util/errors";
import { setupApp } from "../api.setup";

vi.mock("back-end/src/services/archiveDependentsGuard", () => ({
  assertFeatureArchiveDependentsGuard: vi.fn(),
}));

// POST /features/{id}/revisions/{version}/revert restores the target's
// archived state like the other revert routes: a revision that predates
// archived snapshots restores an active flag, re-archiving runs the
// dependents guard, and restored values that fail validation are a 422.

const ORG_ID = "org_revision_revert";
const FLAG = "flag_revert";
const org = {
  id: ORG_ID,
  name: "Revision Revert",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: { environments: [{ id: "production" }] },
} as unknown as OrganizationInterface;

const now = () => new Date();

async function insertFeature(archived: boolean) {
  await mongoose.connection.collection("features").insertOne({
    id: FLAG,
    organization: ORG_ID,
    owner: "",
    description: "",
    valueType: "boolean",
    defaultValue: "false",
    version: 2,
    archived,
    tags: [],
    rules: [],
    environmentSettings: { production: { enabled: true, rules: [] } },
    prerequisites: [],
    dateCreated: now(),
    dateUpdated: now(),
  });
}

// v1 predates archived snapshots (no `archived` key); v2 is the live revision.
async function insertRevisions(
  live: { archived: boolean },
  legacy: Record<string, unknown> = {},
) {
  const base = (version: number) => ({
    id: `frev_${FLAG}_${version}`,
    organization: ORG_ID,
    featureId: FLAG,
    version,
    baseVersion: version - 1,
    status: "published",
    createdBy: { type: "api_key", apiKey: "key_admin" },
    comment: "",
    defaultValue: "false",
    rules: [],
    dateCreated: now(),
    dateUpdated: now(),
    datePublished: now(),
  });
  await mongoose.connection.collection("featurerevisions").insertMany([
    { ...base(1), ...legacy },
    { ...base(2), ...live },
  ]);
}

const feature = () =>
  mongoose.connection.collection("features").findOne({ id: FLAG });

describe("POST /api/v1/features/:id/revisions/:version/revert", () => {
  const { app, setReqContext } = setupApp();
  const revert = (body: Record<string, unknown>) =>
    request(app)
      .post(`/api/v1/features/${FLAG}/revisions/1/revert`)
      .send(body)
      .set("Authorization", "Bearer foo");

  beforeEach(() => {
    vi.mocked(assertFeatureArchiveDependentsGuard).mockReset();
    setReqContext(
      new ReqContextClass({
        org,
        auditUser: { type: "api_key", apiKey: "key_admin" },
        role: "admin",
        req: { query: {}, headers: {}, body: {} } as unknown as Request,
      }),
    );
  });

  it("unarchives when publishing a revision that predates archived snapshots", async () => {
    await insertFeature(true);
    await insertRevisions({ archived: true });
    const res = await revert({ strategy: "publish" });
    expect(res.body.message).toBeUndefined();
    expect(res.status).toBe(200);
    expect((await feature())?.archived).toBe(false);
  });

  it("stages the unarchive on a revert draft", async () => {
    await insertFeature(true);
    await insertRevisions({ archived: true });
    const res = await revert({ strategy: "draft" });
    expect(res.body.message).toBeUndefined();
    expect(res.status).toBe(200);
    const draft = await mongoose.connection
      .collection("featurerevisions")
      .findOne({ featureId: FLAG, status: "draft" });
    expect(draft?.archived).toBe(false);
    expect((await feature())?.archived).toBe(true);
  });

  it("runs the archive-dependents guard when the restore re-archives", async () => {
    await insertFeature(false);
    await insertRevisions({ archived: false }, { archived: true });
    vi.mocked(assertFeatureArchiveDependentsGuard).mockRejectedValueOnce(
      new SoftWarningError("dependents", ["1 feature flag(s)"]),
    );
    const warned = await revert({ strategy: "publish" });
    expect(warned.status).toBe(422);
    expect(warned.body.warnings).toEqual(["1 feature flag(s)"]);
    expect((await feature())?.archived).toBe(false);

    const archived = await revert({ strategy: "publish" });
    expect(archived.body.message).toBeUndefined();
    expect(archived.status).toBe(200);
    expect((await feature())?.archived).toBe(true);
  });

  it("warns instead of publishing a restored value the flag's type rejects", async () => {
    await insertFeature(false);
    await insertRevisions({ archived: false }, { defaultValue: "maybe" });
    const res = await revert({ strategy: "publish" });
    expect(res.body.message).toMatch(/no longer pass validation/);
    expect(res.status).toBe(422);
    expect((await feature())?.defaultValue).toBe("false");
  });
});
