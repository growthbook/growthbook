import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "./api.setup";

// Coverage for the publish-gate collector on the config revision-publish
// endpoint (POST /api/v1/configs-revisions/:key/:version/publish):
//  1. Body-canonical `ignoreWarnings` (and the deprecated `?ignoreWarnings=true`
//     query alias) are accepted by the strict schema.
//  2. A locked config surfaces a structured 422 `config-locked` gate that names
//     the lock, has no override, and is NOT cleared by `ignoreWarnings: true`.
//  3. The beta `mergeNow` flag was removed from the config publish surface and
//     is rejected (400) by the strict body schema.

const ORG_ID = "org_config_publish_gate";

const org = {
  id: ORG_ID,
  name: "Config Publish Gate",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {},
} as unknown as OrganizationInterface;

// Admin grants manageConfigs (edit) + bypassApprovalChecks, so a clean publish
// isn't blocked by an approval/stale-base gate — isolating the gates under test.
function makeContext(): ReqContextClass {
  return new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: "key_test" },
    role: "admin",
    req: { query: {}, headers: {}, body: {} } as unknown as Request,
  });
}

async function insertRawConfig(key: string): Promise<void> {
  const now = new Date();
  await mongoose.connection.collection("configs").insertOne({
    id: `cfg_${key}`,
    organization: ORG_ID,
    key,
    name: key,
    owner: "",
    value: JSON.stringify({ hello: "world" }),
    dateCreated: now,
    dateUpdated: now,
  });
}

// Insert a raw config and open a fresh draft revision through the real API so
// its snapshot is captured by the config adapter. Returns the draft version.
async function setupConfigDraft(key: string): Promise<number> {
  await insertRawConfig(key);
  const createRes = await request(app)
    .post(`/api/v1/configs-revisions/${key}`)
    .send({})
    .set("Authorization", "Bearer foo");
  expect(createRes.status).toBe(200);
  return createRes.body.revision.version;
}

const { app, setReqContext } = setupApp();

describe("POST /api/v1/configs-revisions/:key/:version/publish", () => {
  it("accepts body-canonical `ignoreWarnings` and the deprecated query alias", async () => {
    setReqContext(makeContext());

    // Body form: the strict body schema must accept `ignoreWarnings` /
    // `skipSchemaValidation` (a rejected key would 400) and the publish succeeds.
    const bodyKey = "cfg_body_flags";
    const bodyVersion = await setupConfigDraft(bodyKey);
    const bodyRes = await request(app)
      .post(`/api/v1/configs-revisions/${bodyKey}/${bodyVersion}/publish`)
      .send({ ignoreWarnings: true, skipSchemaValidation: true })
      .set("Authorization", "Bearer foo");
    expect(bodyRes.status).toBe(200);

    // Deprecated query form: `?ignoreWarnings=true` is still an accepted alias
    // (the strict query schema declares it) and does not 400.
    const queryKey = "cfg_query_flag";
    const queryVersion = await setupConfigDraft(queryKey);
    const queryRes = await request(app)
      .post(
        `/api/v1/configs-revisions/${queryKey}/${queryVersion}/publish?ignoreWarnings=true`,
      )
      .send({})
      .set("Authorization", "Bearer foo");
    expect(queryRes.status).toBe(200);
  });

  it("blocks publishing a locked config with a config-locked gate that ignoreWarnings cannot clear", async () => {
    setReqContext(makeContext());

    const key = "cfg_locked";
    const version = await setupConfigDraft(key);

    // Lock the live config AFTER the draft exists (locking blocks publishes, not
    // draft creation). isConfigLocked only needs `lock.version` present.
    await mongoose.connection.collection("configs").updateOne(
      { key, organization: ORG_ID },
      {
        $set: {
          lock: {
            revisionId: "rev_locked_pin",
            version: 1,
            lockedBy: "u_admin",
            dateLocked: new Date(),
          },
        },
      },
    );

    const blockedRes = await request(app)
      .post(`/api/v1/configs-revisions/${key}/${version}/publish`)
      .send({})
      .set("Authorization", "Bearer foo");

    // PublishBlockedError → 422 with a typed `gates[]` and a flattened
    // `warnings[]` (only ignoreWarnings-clearable gates land in `warnings`).
    expect(blockedRes.status).toBe(422);
    expect(Array.isArray(blockedRes.body.gates)).toBe(true);
    const lockGate = blockedRes.body.gates.find(
      (g: { type: string }) => g.type === "config-locked",
    );
    expect(lockGate).toBeDefined();
    expect(lockGate.severity).toBe("blocker");
    // The gate carries no override flag — nothing clears it inline. The uniform
    // fields are explicit: override is null and the escape is a callable unlock
    // route in `resolution`, not inline prose.
    expect(lockGate.override).toBeNull();
    expect(lockGate.requiresPermission).toBe("bypassApprovalChecks");
    expect(lockGate.messages[0]).toMatch(/locked/i);
    expect(lockGate.resolution).toEqual({
      action: "unlock",
      method: "POST",
      path: `/configs/${key}/unlock`,
    });
    // config-locked is not ignoreWarnings-clearable, so it never appears in the
    // acknowledge-and-retry `warnings` channel.
    expect(blockedRes.body.warnings).not.toContain(lockGate.messages[0]);

    // Retrying with `ignoreWarnings: true` in the body must NOT clear a lock.
    const retryRes = await request(app)
      .post(`/api/v1/configs-revisions/${key}/${version}/publish`)
      .send({ ignoreWarnings: true })
      .set("Authorization", "Bearer foo");
    expect(retryRes.status).toBe(422);
    expect(
      retryRes.body.gates.some(
        (g: { type: string }) => g.type === "config-locked",
      ),
    ).toBe(true);
  });

  it("rejects the removed beta `mergeNow` flag with a 400 from the strict body schema", async () => {
    setReqContext(makeContext());

    const key = "cfg_merge_now";
    const version = await setupConfigDraft(key);

    const res = await request(app)
      .post(`/api/v1/configs-revisions/${key}/${version}/publish`)
      .send({ mergeNow: true })
      .set("Authorization", "Bearer foo");

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/mergeNow/);
  });
});
