import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "./api.setup";

// Scenario QA for POST /api/v1/releases/publish-revisions: a realistic
// multi-entity world built through the REST creation endpoints, then a saga
// walking a matrix of failure modes — approvals, schema breaks, permission-
// gated overrides, merge conflicts + rebase, scheduled siblings, closed
// revisions, unresolvable items, duplicates — asserting how the endpoint
// fares at each step. One test: the world evolves phase to phase (the
// harness wipes collections between tests).

const ORG_ID = "org_release_scenario";

const org = {
  id: ORG_ID,
  name: "Release Scenario",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [
    {
      id: "u_key_admin",
      role: "admin",
      limitAccessByEnvironment: false,
      environments: [],
    },
    {
      id: "u_key_engineer",
      role: "engineer",
      limitAccessByEnvironment: false,
      environments: [],
    },
  ],
  settings: {},
} as unknown as OrganizationInterface;

function makeContext(role: "admin" | "engineer", apiKey: string) {
  const context = new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey },
    // A resolvable user: scheduled publishes need someone to run as.
    user: {
      id: `u_${apiKey}`,
      email: `${apiKey}@test.com`,
      name: apiKey,
      superAdmin: false,
    },
    role,
    req: { query: {}, headers: {}, body: {} } as unknown as Request,
  });
  context.hasPremiumFeature = () => true;
  return context;
}

const { app, setReqContext } = setupApp();

const api = {
  post: (path: string, body: Record<string, unknown>) =>
    request(app).post(path).send(body).set("Authorization", "Bearer foo"),
  put: (path: string, body: Record<string, unknown>) =>
    request(app).put(path).send(body).set("Authorization", "Bearer foo"),
};

const publish = (body: Record<string, unknown>) =>
  api.post("/api/v1/releases/publish-revisions", body);

const gateTypes = (body: { gates?: { type: string }[] }) =>
  (body.gates ?? []).map((g) => g.type).sort();

// Assert a status, surfacing the response body on mismatch so scenario
// failures are diagnosable without re-running.
function expectStatus(
  res: { status: number; body: unknown },
  status: number,
): void {
  if (res.status !== status) {
    throw new Error(
      `Expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
}

describe("publish-revisions scenario matrix", () => {
  it("survives a realistic release lifecycle across failure modes", async () => {
    const admin = makeContext("admin", "key_admin");
    const engineer = makeContext("engineer", "key_engineer");
    setReqContext(admin);

    // ---- Phase 0: build the world through the REST creation endpoints ----
    expectStatus(
      await api.post("/api/v1/constants", {
        key: "qp-limits",
        name: "Pricing limits",
        type: "json",
        value: JSON.stringify({ maxItems: 50 }),
      }),
      200,
    );

    expectStatus(
      await api.post("/api/v1/configs", {
        key: "checkout",
        name: "Checkout",
        value: { $extends: ["@const:qp-limits"], currency: "usd" },
        schema: {
          type: "json-schema",
          value: {
            type: "object",
            properties: {
              maxItems: { type: "integer" },
              currency: { type: "string" },
            },
          },
        },
      }),
      200,
    );

    // The JSON-schema envelope must have converted into stored fields —
    // without them the schema-break phases below would silently no-op.
    const storedCheckout = await mongoose.connection
      .collection("configs")
      .findOne({ organization: ORG_ID, key: "checkout" });
    if ((storedCheckout?.schema?.fields?.length ?? 0) < 2) {
      throw new Error(
        `Schema conversion failed: ${JSON.stringify(storedCheckout?.schema)}`,
      );
    }

    expectStatus(
      await api.post("/api/v1/configs", {
        key: "checkout-eu",
        name: "Checkout EU",
        parent: "checkout",
        value: { currency: "eur" },
      }),
      200,
    );

    expectStatus(
      await api.post("/api/v1/saved-groups", {
        name: "Beta testers",
        type: "condition",
        condition: '{"id": {"$in": ["u1"]}}',
      }),
      200,
    );
    const savedGroupId = (
      await mongoose.connection
        .collection("savedgroups")
        .findOne({ organization: ORG_ID })
    )?.id as string;

    // ---- Phase 1: happy path — a four-entity coordinated release ----
    const stage = async (path: string, body: Record<string, unknown>) => {
      const res = await api.put(path, body);
      expect(res.status).toBe(200);
      return res.body.revision.version as number;
    };
    const constV = await stage(
      `/api/v1/constants-revisions/qp-limits/new/value`,
      {
        value: JSON.stringify({ maxItems: 60 }),
      },
    );
    const cfgV = await stage(`/api/v1/configs-revisions/checkout/new/value`, {
      value: { $extends: ["@const:qp-limits"], currency: "usd-v2" },
    });
    const euV = await stage(`/api/v1/configs-revisions/checkout-eu/new/value`, {
      value: { currency: "eur-v2" },
    });
    const sgCreate = await api.post(
      `/api/v1/saved-groups-revisions/${savedGroupId}`,
      {},
    );
    expect(sgCreate.status).toBe(200);
    const sgV = sgCreate.body.revision.version as number;
    expectStatus(
      await api.put(
        `/api/v1/saved-groups-revisions/${savedGroupId}/${sgV}/condition`,
        { condition: '{"id": {"$in": ["u1", "u2"]}}' },
      ),
      200,
    );

    const happy = await publish({
      revisions: [
        { entityType: "constant", key: "qp-limits", version: constV },
        { entityType: "config", key: "checkout", version: cfgV },
        { entityType: "config", key: "checkout-eu", version: euV },
        { entityType: "saved-group", id: savedGroupId, version: sgV },
      ],
      comment: "wave 1",
    });
    expect(happy.status).toBe(200);
    expect(happy.body.bulkPublishId).toMatch(/^pub_/);
    expect(happy.body.results).toHaveLength(4);
    const liveConstant = await mongoose.connection
      .collection("constants")
      .findOne({ organization: ORG_ID, key: "qp-limits" });
    expect(JSON.parse(liveConstant?.value ?? "{}")).toEqual({ maxItems: 60 });

    // ---- Phase 2: approvals — engineer blocked, admin authority bypasses ----
    org.settings = {
      ...org.settings,
      requireReviews: [
        {
          requireReviewOn: true,
          resetReviewOnChange: false,
          environments: [],
          projects: [],
        },
      ],
    } as OrganizationInterface["settings"];

    setReqContext(engineer);
    const wave2ConstV = await stage(
      `/api/v1/constants-revisions/qp-limits/new/value`,
      { value: JSON.stringify({ maxItems: 70 }) },
    );
    const blockedByApproval = await publish({
      revisions: [
        { entityType: "constant", key: "qp-limits", version: wave2ConstV },
      ],
    });
    expect(blockedByApproval.status).toBe(422);
    expect(gateTypes(blockedByApproval.body)).toContain("approval-required");

    setReqContext(admin);
    const approvedByAuthority = await publish({
      revisions: [
        { entityType: "constant", key: "qp-limits", version: wave2ConstV },
      ],
    });
    expect(approvedByAuthority.status).toBe(200);
    expect(
      approvedByAuthority.body.bypassedGates.map(
        (g: { type: string }) => g.type,
      ),
    ).toContain("approval-required");
    org.settings = { ...org.settings, requireReviews: [] };

    // ---- Phase 3: schema break — permission-gated skipSchemaValidation ----
    setReqContext(engineer);
    const breakV = await stage(
      `/api/v1/constants-revisions/qp-limits/new/value`,
      { value: JSON.stringify({ maxItems: "many" }) },
    );
    const blockedBySchema = await publish({
      revisions: [
        { entityType: "constant", key: "qp-limits", version: breakV },
      ],
    });
    expect(blockedBySchema.status).toBe(422);
    expect(gateTypes(blockedBySchema.body)).toContain("schema-validation");

    // The flag without the permission must fail loudly, not silently pass.
    const engineerSkip = await publish({
      revisions: [
        { entityType: "constant", key: "qp-limits", version: breakV },
      ],
      skipSchemaValidation: true,
    });
    expect(engineerSkip.status).toBe(422);

    setReqContext(admin);
    const adminSkip = await publish({
      revisions: [
        { entityType: "constant", key: "qp-limits", version: breakV },
      ],
      skipSchemaValidation: true,
    });
    expect(adminSkip.status).toBe(200);
    expect(
      adminSkip.body.bypassedGates.map((g: { via: string }) => g.via),
    ).toContain("skipSchemaValidation");

    // Corrective release: fixing the break introduces no NEW violations, so
    // it publishes clean without any override.
    const fixV = await stage(
      `/api/v1/constants-revisions/qp-limits/new/value`,
      {
        value: JSON.stringify({ maxItems: 80 }),
      },
    );
    const corrective = await publish({
      revisions: [{ entityType: "constant", key: "qp-limits", version: fixV }],
    });
    expect(corrective.status).toBe(200);

    // ---- Phase 4: merge conflict → rebase → publish ----
    const conflictV = await stage(
      `/api/v1/configs-revisions/checkout/new/value`,
      { value: { $extends: ["@const:qp-limits"], currency: "cad" } },
    );
    // A direct update lands on the live config underneath the open draft.
    expectStatus(
      await api.post(`/api/v1/configs/checkout`, {
        value: { $extends: ["@const:qp-limits"], currency: "gbp" },
      }),
      200,
    );
    const conflicted = await publish({
      revisions: [
        { entityType: "config", key: "checkout", version: conflictV },
      ],
    });
    expect(conflicted.status).toBe(422);
    expect(gateTypes(conflicted.body)).toContain("merge-conflict");

    expectStatus(
      await api.post(`/api/v1/configs-revisions/checkout/${conflictV}/rebase`, {
        conflictResolutions: { value: "overwrite" },
      }),
      200,
    );
    const rebased = await publish({
      revisions: [
        { entityType: "config", key: "checkout", version: conflictV },
      ],
    });
    expect(rebased.status).toBe(200);

    // ---- Phase 5: armed scheduled sibling → disarm flag ----
    // (Configs are the entity with a REST schedule-publish endpoint.)
    const armedV = await stage(
      `/api/v1/configs-revisions/checkout-eu/new/value`,
      { value: { currency: "eur-armed" } },
    );
    expectStatus(
      await api.post(
        `/api/v1/configs-revisions/checkout-eu/${armedV}/schedule-publish`,
        { scheduledPublishAt: "2030-01-01T00:00:00Z", bypassApproval: true },
      ),
      200,
    );

    // An armed NON-LOCKING sibling does not block — same as sequential manual
    // publishing; fire-time governance (merge conflicts, fingerprint
    // re-checks, publishFailed) owns that collision. The sibling stays armed.
    // (Engineer stages the rival: staging reuses the author's open draft, and
    // the admin's open draft on this config is the armed one.)
    setReqContext(engineer);
    const rivalV = await stage(
      `/api/v1/configs-revisions/checkout-eu/new/value`,
      { value: { currency: "eur-rival" } },
    );
    const alongsideArmedSibling = await publish({
      revisions: [
        { entityType: "config", key: "checkout-eu", version: rivalV },
      ],
    });
    expect(alongsideArmedSibling.status).toBe(200);
    const armedDoc = await mongoose.connection.collection("revisions").findOne({
      organization: ORG_ID,
      "target.type": "config",
      version: armedV,
    });
    expect(armedDoc?.scheduledPublishAt).toBeTruthy();
    setReqContext(admin);

    // ---- Phase 6: replaying an already-published revision ----
    const replay = await publish({
      revisions: [
        { entityType: "config", key: "checkout-eu", version: rivalV },
      ],
    });
    expect(replay.status).toBe(422);
    expect(gateTypes(replay.body)).toContain("revision-closed");

    // ---- Phase 7: one unresolvable item blocks the whole set ----
    const orphanV = await stage(
      `/api/v1/configs-revisions/checkout-eu/new/value`,
      { value: { currency: "eur", maxItems: 61 } },
    );
    const withMissing = await publish({
      revisions: [
        { entityType: "config", key: "checkout-eu", version: orphanV },
        { entityType: "constant", key: "does-not-exist", version: 1 },
      ],
    });
    expect(withMissing.status).toBe(422);
    expect(gateTypes(withMissing.body)).toContain("not-found");
    const euStill = await mongoose.connection
      .collection("configs")
      .findOne({ organization: ORG_ID, key: "checkout-eu" });
    expect(JSON.parse(euStill?.value ?? "{}").currency).toBe("eur-rival");

    // ---- Phase 8: duplicate entity refs are a 400 ----
    const dupe = await publish({
      revisions: [
        { entityType: "config", key: "checkout-eu", version: orphanV },
        { entityType: "config", key: "checkout-eu", version: orphanV + 1 },
      ],
    });
    expect(dupe.status).toBe(400);

    // The orphaned draft still publishes cleanly once its batch is valid.
    const finale = await publish({
      revisions: [
        { entityType: "config", key: "checkout-eu", version: orphanV },
      ],
    });
    expect(finale.status).toBe(200);
  }, 120000);
});
