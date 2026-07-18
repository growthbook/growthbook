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
//  4. Under `requireRebaseBeforePublish`, a bypass-authority caller publishing a
//     DIVERGED draft is blocked by a stale-base gate unless it force-merges with
//     `ignoreWarnings` — the bypass permission alone no longer skips the rebase.

const ORG_ID = "org_config_publish_gate";
// Second org used only for the stale-base scenario: it enables
// requireRebaseBeforePublish so a diverged draft trips the stale-base gate.
const REBASE_ORG_ID = "org_config_rebase_publish";

const org = {
  id: ORG_ID,
  name: "Config Publish Gate",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {},
} as unknown as OrganizationInterface;

const rebaseOrg = {
  id: REBASE_ORG_ID,
  name: "Config Rebase Publish",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: { requireRebaseBeforePublish: true },
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

// Engineer context: ConfigsFullAccess (edit) but NOT FeaturesBypassApprovals,
// so it can publish a config revision yet cannot silently bypass a soft
// schema-break gate — isolating the gate so it actually blocks (an admin would
// bypass it via bypassApprovalChecks). `ignoreWarnings` is baked onto the
// context's own request (context.ignoreWarnings reads context.req, not the HTTP
// body the mock middleware discards).
function makeEngineerContext(
  opts: { ignoreWarnings?: boolean } = {},
): ReqContextClass {
  return new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: "key_engineer" },
    role: "engineer",
    req: {
      query: {},
      headers: {},
      body: opts.ignoreWarnings ? { ignoreWarnings: true } : {},
    } as unknown as Request,
  });
}

// A `port: integer` (optional) schema — a dependent whose resolved value must
// carry an integer port when present.
const portIntegerSchema = {
  type: "object" as const,
  fields: [
    {
      key: "port",
      type: "integer" as const,
      required: false,
      default: "",
      description: "",
      enum: [],
    },
  ],
};

// Admin context on the rebase org. `ignoreWarnings` is carried on the context's
// own request (context.ignoreWarnings reads context.req, not the HTTP body the
// mock middleware discards), so it must be baked in here to force-merge.
function makeRebaseContext(
  opts: { ignoreWarnings?: boolean } = {},
): ReqContextClass {
  return new ReqContextClass({
    org: rebaseOrg,
    auditUser: { type: "api_key", apiKey: "key_test" },
    role: "admin",
    req: {
      query: {},
      headers: {},
      body: opts.ignoreWarnings ? { ignoreWarnings: true } : {},
    } as unknown as Request,
  });
}

async function insertRawConfig(
  key: string,
  organization: string = ORG_ID,
): Promise<void> {
  const now = new Date();
  await mongoose.connection.collection("configs").insertOne({
    id: `cfg_${key}`,
    organization,
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
async function setupConfigDraft(
  key: string,
  organization: string = ORG_ID,
): Promise<number> {
  await insertRawConfig(key, organization);
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

describe("POST /api/v1/configs-revisions/:key/:version/publish (archive schema-break gate)", () => {
  // Regression: the revision-publish path must model an archive/unarchive
  // transition in the schema-break guard, the same way the dedicated archive
  // endpoints do. `archived` is value-affecting — flipping it scrubs (archive)
  // or restores (unarchive) this config's contribution to every dependent's
  // resolved value — so publishing a revision that flips it must surface the
  // breaks the transition introduces in dependents.
  it("surfaces a schema-break gate when unarchiving a config breaks a dependent, and ignoreWarnings clears it", async () => {
    setReqContext(makeEngineerContext());

    const now = new Date();
    // `svc` is archived and stores a string port; while archived its refs are
    // scrubbed, so the dependent resolves without a port (schema-valid). `dep`
    // pulls its value from svc via `extends` and requires an integer port when
    // present. Unarchiving svc restores the string port into dep → violation.
    await mongoose.connection.collection("configs").insertMany([
      {
        id: "cfg_svc_arch",
        organization: ORG_ID,
        key: "svc_arch",
        name: "svc_arch",
        owner: "",
        value: '{"port":"bad"}',
        archived: true,
        dateCreated: now,
        dateUpdated: now,
      },
      {
        id: "cfg_dep_arch",
        organization: ORG_ID,
        key: "dep_arch",
        name: "dep_arch",
        owner: "",
        value: "{}",
        extends: ["svc_arch"],
        schema: portIntegerSchema,
        dateCreated: now,
        dateUpdated: now,
      },
    ]);

    // Open a draft on svc and stage the unarchive (archived: false).
    const createRes = await request(app)
      .post(`/api/v1/configs-revisions/svc_arch`)
      .send({})
      .set("Authorization", "Bearer foo");
    expect(createRes.status).toBe(200);
    const version = createRes.body.revision.version;

    const stageRes = await request(app)
      .put(`/api/v1/configs-revisions/svc_arch/${version}/archive`)
      .send({ archived: false })
      .set("Authorization", "Bearer foo");
    expect(stageRes.status).toBe(200);

    // Publish WITHOUT ignoreWarnings → the archive schema-break gate blocks the
    // publish (engineer can't bypass a soft guard).
    const blockedRes = await request(app)
      .post(`/api/v1/configs-revisions/svc_arch/${version}/publish`)
      .send({})
      .set("Authorization", "Bearer foo");

    expect(blockedRes.status).toBe(422);
    const gate = blockedRes.body.gates.find(
      (g: { type: string }) => g.type === "schema-break",
    );
    expect(gate).toBeDefined();
    expect(gate.severity).toBe("warning");
    expect(gate.override).toBe("ignoreWarnings");
    const gateText = gate.messages.join("\n");
    // The gate names the transition (not the config's own resolved value) and
    // the dependent it breaks.
    expect(gateText).toMatch(/Unarchiving/i);
    expect(gateText).toContain("dep_arch");

    // Retry WITH ignoreWarnings → the soft gate is bypassed (200) and reported.
    setReqContext(makeEngineerContext({ ignoreWarnings: true }));
    const okRes = await request(app)
      .post(`/api/v1/configs-revisions/svc_arch/${version}/publish`)
      .send({ ignoreWarnings: true })
      .set("Authorization", "Bearer foo");

    expect(okRes.status).toBe(200);
    expect(okRes.body.bypassedGates).toContainEqual({
      type: "schema-break",
      outcome: "bypassed",
      via: "ignoreWarnings",
    });
  });
});

describe("POST /api/v1/configs-revisions/:key/:version/publish (requireRebaseBeforePublish)", () => {
  it("blocks a diverged draft with a stale-base gate that only ignoreWarnings force-merges past", async () => {
    // Rebase org, admin (bypassApprovalChecks) but NO ignoreWarnings on the
    // context yet — the bypass permission alone must not skip the rebase.
    setReqContext(makeRebaseContext());

    const key = "cfg_stale_base";
    // Draft on `value`: snapshot is captured now, before live advances.
    const version = await setupConfigDraft(key, REBASE_ORG_ID);
    const valueRes = await request(app)
      .put(`/api/v1/configs-revisions/${key}/${version}/value`)
      .send({ value: { hello: "changed" } })
      .set("Authorization", "Bearer foo");
    expect(valueRes.status).toBe(200);

    // Advance live on a DIFFERENT field (description) so the draft's base
    // diverges without a merge conflict on the field the draft touches.
    await mongoose.connection
      .collection("configs")
      .updateOne(
        { key, organization: REBASE_ORG_ID },
        { $set: { description: "advanced out of band" } },
      );

    // Publish WITHOUT ignoreWarnings → the stale-base gate blocks (422).
    const blockedRes = await request(app)
      .post(`/api/v1/configs-revisions/${key}/${version}/publish`)
      .send({})
      .set("Authorization", "Bearer foo");

    expect(blockedRes.status).toBe(422);
    expect(Array.isArray(blockedRes.body.gates)).toBe(true);
    const staleGate = blockedRes.body.gates.find(
      (g: { type: string }) => g.type === "stale-base",
    );
    expect(staleGate).toBeDefined();
    expect(staleGate.severity).toBe("blocker");
    expect(staleGate.override).toBe("ignoreWarnings");
    expect(staleGate.requiresPermission).toBe("bypassApprovalChecks");
    expect(staleGate.resolution.action).toBe("rebase");
    expect(staleGate.resolution).toEqual({
      action: "rebase",
      method: "POST",
      path: `/configs-revisions/${key}/${version}/rebase`,
    });

    // Publish again WITH ignoreWarnings (baked into the context; also sent in
    // the body for schema realism) → force-merges (200) and reports the
    // stale-base gate it bypassed.
    setReqContext(makeRebaseContext({ ignoreWarnings: true }));
    const forcedRes = await request(app)
      .post(`/api/v1/configs-revisions/${key}/${version}/publish`)
      .send({ ignoreWarnings: true })
      .set("Authorization", "Bearer foo");

    expect(forcedRes.status).toBe(200);
    expect(forcedRes.body.bypassedGates).toContainEqual({
      type: "stale-base",
      outcome: "bypassed",
      via: "ignoreWarnings",
    });
  });
});
