import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import type { FeatureRule } from "shared/validators";
import { ruleFootprint } from "shared/util";
import { ReqContextClass } from "back-end/src/services/context";
import {
  getStartActionsFromRules,
  rollbackSchedule,
  startSchedule,
} from "back-end/src/services/rampSchedule";
import { setupApp } from "../api/api.setup";

// A rule with neither scope key serves everywhere. A ramp on it must keep it
// that way and never leave a null list behind, which broke the flag's payloads.

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
  setupApp();
  const envs = ["production", "dev"];
  const TARGET_ID = "target_legacy";
  let ctx: ReqContextClass;

  // The stored rule, as the payload builder reads it.
  async function expectLegacyRuleServesEverywhere() {
    const feature = await mongoose.connection
      .collection("features")
      .findOne({ id: FLAG });
    const rule = (feature?.rules as FeatureRule[]).find(
      (r) => r.id === LEGACY_RULE.id,
    )!;
    expect(rule.environments).not.toBeNull();
    expect(ruleFootprint(rule, envs)).toEqual(envs);
    return rule;
  }

  beforeEach(async () => {
    ctx = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_admin" },
      role: "admin",
      req: { query: {}, headers: {}, body: {} } as unknown as Request,
    });
    ctx.hasPremiumFeature = () => true;
    await seed();
  });

  it("keeps serving everywhere through a coverage step and a rollback", async () => {
    const schedule = await ctx.models.rampSchedules.create({
      name: "legacy",
      status: "ready",
      entityType: "feature",
      entityId: FLAG,
      targets: [
        {
          id: TARGET_ID,
          entityType: "feature",
          entityId: FLAG,
          ruleId: LEGACY_RULE.id,
          status: "active",
        },
      ],
      startActions: getStartActionsFromRules({
        rules: [LEGACY_RULE, SCOPED_SIBLING] as FeatureRule[],
        targetId: TARGET_ID,
        ruleId: LEGACY_RULE.id,
      }),
      steps: [
        {
          interval: 3600,
          actions: [
            {
              targetType: "feature-rule",
              targetId: TARGET_ID,
              patch: { ruleId: LEGACY_RULE.id, coverage: 0.5 },
            },
          ],
        },
      ],
      endActions: [],
    });

    // Starting applies the first step at once.
    const started = await startSchedule(ctx, schedule);
    expect(started.status).toBe("running");
    const stepped = await expectLegacyRuleServesEverywhere();
    expect((stepped as { coverage?: number }).coverage).toBe(0.5);

    const rolledBack = await rollbackSchedule(ctx, started, "test");
    expect(rolledBack.status).toBe("rolled-back");
    const restored = await expectLegacyRuleServesEverywhere();
    expect((restored as { coverage?: number }).coverage).toBe(1);
  });
});
