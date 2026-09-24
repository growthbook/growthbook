import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import type { FeatureRule } from "shared/validators";
import { getRulesForEnvironment, ruleFootprint } from "shared/util";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api.setup";

// A rule written before rules carried environment scope has neither
// `allEnvironments` nor `environments` and serves everywhere. A ramp on it must
// keep serving everywhere at every step and after rollback, and never leave a
// null list behind: that shape serves nowhere and used to break payload
// generation for the whole flag.

const ORG_ID = "org_ramp_legacy_scope";
const FLAG = "flag_legacy_scope";
const LEGACY_RULE = {
  type: "rollout",
  id: "fr_legacy",
  description: "",
  value: "true",
  coverage: 1,
  hashAttribute: "id",
  enabled: true,
};
const SCOPED_SIBLING = {
  type: "force",
  id: "fr_scoped",
  description: "",
  value: "false",
  enabled: true,
  allEnvironments: false,
  environments: ["production"],
};
const org = {
  id: ORG_ID,
  name: "Ramp Legacy Scope",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: { environments: [{ id: "production" }, { id: "dev" }] },
} as unknown as OrganizationInterface;

async function seed() {
  const now = new Date();
  const rules = [LEGACY_RULE, SCOPED_SIBLING];
  await mongoose.connection.collection("features").insertOne({
    id: FLAG,
    organization: ORG_ID,
    owner: "",
    description: "",
    valueType: "boolean",
    defaultValue: "false",
    version: 1,
    archived: false,
    tags: [],
    rules,
    environmentSettings: {
      production: { enabled: true, rules: [] },
      dev: { enabled: true, rules: [] },
    },
    prerequisites: [],
    dateCreated: now,
    dateUpdated: now,
  });
  await mongoose.connection.collection("featurerevisions").insertOne({
    id: `frev_${FLAG}_1`,
    organization: ORG_ID,
    featureId: FLAG,
    version: 1,
    baseVersion: 1,
    status: "published",
    createdBy: { type: "api_key", apiKey: "key_admin" },
    comment: "",
    defaultValue: "false",
    rules,
    dateCreated: now,
    dateUpdated: now,
    datePublished: now,
  });
}

describe("a ramp on a rule with no environment scope", () => {
  const { app, setReqContext } = setupApp();
  const auth = (req: request.Test) => req.set("Authorization", "Bearer foo");
  const envs = ["production", "dev"];

  // The live rule as the payload builder will see it: no null list, and it
  // still reaches every environment.
  async function expectLegacyRuleServesEverywhere() {
    const feature = await mongoose.connection
      .collection("features")
      .findOne({ id: FLAG });
    const rule = (feature?.rules as FeatureRule[]).find(
      (r) => r.id === LEGACY_RULE.id,
    )!;
    expect(rule.environments).not.toBeNull();
    expect(ruleFootprint(rule, envs)).toEqual(envs);
    for (const env of envs) {
      expect(
        getRulesForEnvironment(feature?.rules as FeatureRule[], env),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: LEGACY_RULE.id }),
        ]),
      );
    }
    return rule;
  }

  beforeEach(async () => {
    const context = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_admin" },
      role: "admin",
      req: { query: {}, headers: {}, body: {} } as unknown as Request,
    });
    context.hasPremiumFeature = () => true;
    setReqContext(context);
    await seed();
  });

  it("keeps serving everywhere through a coverage step and a rollback", async () => {
    const created = await auth(
      request(app)
        .post("/api/v1/ramp-schedules")
        .send({
          name: "legacy",
          featureId: FLAG,
          ruleId: LEGACY_RULE.id,
          steps: [{ interval: 3600, actions: [{ patch: { coverage: 0.5 } }] }],
        }),
    );
    expect(created.body.message).toBeUndefined();
    expect(created.status).toBe(200);
    const id = created.body.rampSchedule.id;

    const started = await auth(
      request(app).post(`/api/v1/ramp-schedules/${id}/actions/start`).send(),
    );
    expect(started.body.message).toBeUndefined();
    expect(started.status).toBe(200);
    const stepped = await expectLegacyRuleServesEverywhere();
    expect((stepped as { coverage?: number }).coverage).toBe(0.5);

    const rolledBack = await auth(
      request(app)
        .post(`/api/v1/ramp-schedules/${id}/actions/rollback`)
        .send({ reason: "test" }),
    );
    expect(rolledBack.body.message).toBeUndefined();
    expect(rolledBack.status).toBe(200);
    const restored = await expectLegacyRuleServesEverywhere();
    expect((restored as { coverage?: number }).coverage).toBe(1);
  });
});
