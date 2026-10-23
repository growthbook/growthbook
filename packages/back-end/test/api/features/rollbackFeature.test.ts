import request from "supertest";
import mongoose from "mongoose";
import type { OrganizationInterface } from "shared/types/organization";
import { setupApp } from "../api.setup";
import { buildOrg, makePersonaContext } from "../permission-personas.fixture";

// POST /api/v2/features/:id/rollback and GET /api/v2/rollouts, driven through
// the real handlers against the in-memory database. The percentage-rollout
// path is the simple one; these cover the satellites (safe rollouts, ramp
// schedules, experiments), the publish authority gate, and the review gate.

const ORG_ID = "org_rollback_api";
const now = () => new Date();
type Doc = Record<string, unknown>;

const org = (settings: Doc = {}): OrganizationInterface => {
  const base = buildOrg(ORG_ID);
  return { ...base, settings: { ...base.settings, ...settings } };
};

const ROLLOUT: Doc = {
  type: "rollout",
  id: "fr_roll",
  description: "25% rollout",
  value: "true",
  coverage: 0.25,
  hashAttribute: "id",
  enabled: true,
  allEnvironments: false,
  environments: ["production"],
};

async function insertFeature(id: string, rules: Doc[], extra: Doc = {}) {
  await mongoose.connection.collection("features").insertOne({
    id,
    organization: ORG_ID,
    owner: "",
    description: "",
    valueType: "boolean",
    defaultValue: "false",
    version: 1,
    archived: false,
    tags: [],
    project: "",
    rules,
    environmentSettings: {
      dev: { enabled: true, rules: [] },
      production: { enabled: true, rules: [] },
    },
    prerequisites: [],
    dateCreated: now(),
    dateUpdated: now(),
    ...extra,
  });
  await mongoose.connection.collection("featurerevisions").insertOne({
    id: `frev_${id}_1`,
    organization: ORG_ID,
    featureId: id,
    version: 1,
    baseVersion: 0,
    status: "published",
    createdBy: { type: "api_key", apiKey: "k_admin" },
    comment: "",
    defaultValue: "false",
    rules,
    environmentsEnabled: { dev: true, production: true },
    dateCreated: now(),
    dateUpdated: now(),
    datePublished: now(),
  });
}

async function insertExperiment(id: string, status: string) {
  await mongoose.connection.collection("experiments").insertOne({
    id,
    organization: ORG_ID,
    project: "",
    trackingKey: id,
    name: id,
    type: "standard",
    status,
    archived: false,
    linkedFeatures: [],
    variations: ["v0", "v1"].map((vid, i) => ({
      id: vid,
      key: String(i),
      name: vid,
      description: "",
      screenshots: [],
    })),
    phases: [
      {
        name: "Main",
        dateStarted: now(),
        coverage: 1,
        variationWeights: [0.5, 0.5],
      },
    ],
    dateCreated: now(),
    dateUpdated: now(),
  });
}

async function insertSafeRollout(id: string, featureId: string) {
  await mongoose.connection.collection("saferollout").insertOne({
    id,
    organization: ORG_ID,
    featureId,
    status: "running",
    datasourceId: "ds_1",
    exposureQueryId: "user_id",
    guardrailMetricIds: ["met_1"],
    maxDuration: { amount: 7, unit: "days" },
    autoRollback: true,
    autoSnapshots: false,
    rampUpSchedule: {
      enabled: false,
      step: 0,
      steps: [],
      rampUpCompleted: false,
    },
    startedAt: now(),
    dateCreated: now(),
    dateUpdated: now(),
  });
}

describe("feature rollback API", () => {
  const { app, setReqContext } = setupApp();
  const api = {
    get: (path: string) =>
      request(app).get(path).set("Authorization", "Bearer x"),
    post: (path: string, body: Doc = {}) =>
      request(app).post(path).send(body).set("Authorization", "Bearer x"),
  };
  const as = (role: string, settings: Doc = {}) =>
    setReqContext(makePersonaContext(org(settings), role, `u_${role}`));
  const rollback = (id: string, body: Doc = {}) =>
    api.post(`/api/v2/features/${id}/rollback`, body);
  const liveRules = async (id: string) =>
    (await api.get(`/api/v2/features/${id}`)).body.feature.rules as Doc[];

  beforeEach(() => as("admin"));

  it("disables a percentage rollout and publishes one revision", async () => {
    await insertFeature("flag_a", [ROLLOUT]);
    const res = await rollback("flag_a", { comment: "alert 1" });
    expect(res.status).toBe(200);
    expect(res.body.rolledBack).toEqual([
      expect.objectContaining({
        ruleId: "fr_roll",
        type: "rollout",
        coverage: 0.25,
      }),
    ]);
    expect(res.body.feature.revision).toMatchObject({
      version: 2,
      comment: "alert 1",
    });
    expect(await liveRules("flag_a")).toEqual([
      expect.objectContaining({ enabled: false }),
    ]);

    // Nothing left: unchanged, no new revision, still 200.
    const again = await rollback("flag_a");
    expect(again.status).toBe(200);
    expect(again.body.rolledBack).toEqual([]);
    expect(again.body.feature.revision.version).toBe(2);
  });

  it("marks a running safe rollout rolled back on the rule and its document", async () => {
    await insertSafeRollout("sr_1", "flag_sr");
    await insertFeature("flag_sr", [
      {
        type: "safe-rollout",
        id: "fr_sr",
        description: "",
        controlValue: "false",
        variationValue: "true",
        safeRolloutId: "sr_1",
        status: "running",
        hashAttribute: "id",
        seed: "seed",
        trackingKey: "flag_sr",
        enabled: true,
        allEnvironments: false,
        environments: ["production"],
      },
    ]);
    const res = await rollback("flag_sr");
    expect(res.status).toBe(200);
    expect(res.body.rolledBack).toEqual([
      expect.objectContaining({ type: "safe-rollout", safeRolloutId: "sr_1" }),
    ]);
    expect(await liveRules("flag_sr")).toEqual([
      expect.objectContaining({ status: "rolled-back" }),
    ]);
    const doc = await mongoose.connection
      .collection("saferollout")
      .findOne({ id: "sr_1" });
    expect(doc?.status).toBe("rolled-back");
  });

  it("disables an experiment-ref rule without stopping the experiment", async () => {
    await insertExperiment("exp_run", "running");
    await insertExperiment("exp_stopped", "stopped");
    const ref = (id: string, experimentId: string) => ({
      type: "experiment-ref",
      id,
      description: "",
      experimentId,
      variations: [
        { variationId: "v0", value: "false" },
        { variationId: "v1", value: "true" },
      ],
      enabled: true,
      allEnvironments: true,
    });
    await insertFeature("flag_exp", [
      ref("fr_run", "exp_run"),
      ref("fr_stopped", "exp_stopped"),
    ]);
    const res = await rollback("flag_exp");
    expect(res.status).toBe(200);
    // One entry per environment the rule serves in.
    expect(res.body.rolledBack.map((r: Doc) => r.ruleId)).toEqual([
      "fr_run",
      "fr_run",
    ]);
    expect(new Set(res.body.rolledBack.map((r: Doc) => r.environment))).toEqual(
      new Set(["dev", "production"]),
    );
    const rules = await liveRules("flag_exp");
    expect(rules.find((r) => r.id === "fr_run")?.enabled).toBe(false);
    expect(rules.find((r) => r.id === "fr_stopped")?.enabled).toBe(true);
    const exp = await mongoose.connection
      .collection("experiments")
      .findOne({ id: "exp_run" });
    expect(exp?.status).toBe("running");
  });

  it("rolls a serving ramp schedule back to its start and leaves its rule to the schedule", async () => {
    const RULE: Doc = { ...ROLLOUT, id: "fr_ramp", allEnvironments: true };
    delete RULE.environments;
    await insertFeature("flag_ramp", [RULE]);
    const created = await api.post("/api/v1/ramp-schedules", {
      name: "ramp",
      featureId: "flag_ramp",
      ruleId: "fr_ramp",
      startActions: [{ patch: { coverage: 0 } }],
      steps: [
        { interval: 3600, actions: [{ patch: { coverage: 0.25 } }] },
        { interval: 3600, actions: [{ patch: { coverage: 1 } }] },
      ],
    });
    expect(created.status).toBe(200);
    const scheduleId = created.body.rampSchedule.id;
    await mongoose.connection.collection("rampschedules").updateOne(
      { id: scheduleId },
      {
        $set: {
          status: "running",
          currentStepIndex: 0,
          targets: created.body.rampSchedule.targets.map((t: Doc) => ({
            ...t,
            status: "active",
          })),
        },
      },
    );

    const res = await rollback("flag_ramp", { environments: ["production"] });
    expect(res.status).toBe(200);
    expect(res.body.rolledBack).toEqual([
      expect.objectContaining({
        type: "ramp-schedule",
        rampScheduleId: scheduleId,
        ruleId: "fr_ramp",
      }),
    ]);
    const schedule = await mongoose.connection
      .collection("rampschedules")
      .findOne({ id: scheduleId });
    expect(schedule?.status).toBe("rolled-back");
    // The schedule's own rollback put the rule at its start (0%); it is not disabled on top.
    expect(await liveRules("flag_ramp")).toEqual([
      expect.objectContaining({ id: "fr_ramp", coverage: 0, enabled: true }),
    ]);
  });

  it("refuses a caller without publish access to the affected environment", async () => {
    await insertFeature("flag_perm", [ROLLOUT]);
    for (const role of ["publisher_dev", "drafter"]) {
      as(role);
      const res = await rollback("flag_perm");
      expect(res.status).toBe(403);
    }
    as("admin");
    expect(await liveRules("flag_perm")).toEqual([
      expect.objectContaining({ enabled: true }),
    ]);
    // A publisher with production access lands it.
    as("publisher");
    expect((await rollback("flag_perm")).status).toBe(200);
  });

  it("honours the review gate and reports the bypass", async () => {
    await insertFeature("flag_review", [ROLLOUT]);
    const requireReviews = {
      requireReviews: [
        {
          requireReviewOn: true,
          resetReviewOnChange: false,
          environments: ["production"],
          projects: [],
        },
      ],
    };
    as("publisher", { ...requireReviews, restApiBypassesReviews: false });
    const refused = await rollback("flag_review");
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/requires a review/);

    as("publisher", { ...requireReviews, restApiBypassesReviews: true });
    const allowed = await rollback("flag_review");
    expect(allowed.status).toBe(200);
    expect(allowed.body.bypassedGates).toEqual([
      {
        type: "approval-required",
        outcome: "bypassed",
        via: "restApiBypassesReviews",
      },
    ]);
    expect(await liveRules("flag_review")).toEqual([
      expect.objectContaining({ enabled: false }),
    ]);
  });

  it("rejects unknown environments and missing features", async () => {
    await insertFeature("flag_x", [ROLLOUT]);
    expect((await rollback("flag_x", { environments: ["nope"] })).status).toBe(
      400,
    );
    expect((await rollback("flag_missing")).status).toBe(404);
  });

  describe("GET /api/v2/rollouts", () => {
    beforeEach(async () => {
      await insertFeature("flag_prod", [ROLLOUT], { project: "prj_a" });
      await insertFeature("flag_both", [
        { ...ROLLOUT, id: "fr_both", allEnvironments: true, environments: [] },
      ]);
      await insertFeature("flag_none", [
        { ...ROLLOUT, id: "fr_full", coverage: 1 },
      ]);
    });

    const ids = (body: { rollouts: Doc[] }) =>
      body.rollouts.map((r) => `${r.featureId}/${r.environment}`);

    it("lists one entry per rule and environment, filtered and paginated", async () => {
      const all = await api.get("/api/v2/rollouts");
      expect(all.status).toBe(200);
      expect(ids(all.body)).toEqual([
        "flag_both/dev",
        "flag_both/production",
        "flag_prod/production",
      ]);
      expect(all.body).toMatchObject({
        total: 3,
        count: 3,
        hasMore: false,
        nextOffset: null,
      });

      const prod = await api.get("/api/v2/rollouts?environment=production");
      expect(ids(prod.body)).toEqual([
        "flag_both/production",
        "flag_prod/production",
      ]);

      const one = await api.get("/api/v2/rollouts?featureId=flag_prod");
      expect(ids(one.body)).toEqual(["flag_prod/production"]);

      const project = await api.get("/api/v2/rollouts?projectId=prj_a");
      expect(ids(project.body)).toEqual(["flag_prod/production"]);

      const page = await api.get("/api/v2/rollouts?limit=2");
      expect(ids(page.body)).toEqual(["flag_both/dev", "flag_both/production"]);
      expect(page.body).toMatchObject({
        total: 3,
        count: 2,
        hasMore: true,
        nextOffset: 2,
      });
      const next = await api.get("/api/v2/rollouts?limit=2&offset=2");
      expect(ids(next.body)).toEqual(["flag_prod/production"]);
      expect(next.body).toMatchObject({ hasMore: false, nextOffset: null });

      expect((await api.get("/api/v2/rollouts?environment=nope")).status).toBe(
        400,
      );
    });
  });
});
