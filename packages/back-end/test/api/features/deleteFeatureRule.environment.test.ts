import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import type { AuthRequest } from "back-end/src/types/AuthRequest";
import * as featuresController from "back-end/src/controllers/features";
import { setupApp } from "../api.setup";

const { deleteFeatureRule } = featuresController;

// Regression for #6663: "Deleting a rule from one environment deletes it in all
// environments". The UI's per-environment delete sends `{ ruleId, environment }`
// to `deleteFeatureRule` (the controller behind `DELETE /feature/:id/:version/rule`).
// A shared rule (production + staging) must be narrowed to its remaining
// applicable envs, not removed from every environment at once.
//
// This drives the actual controller against real in-memory Mongo with real model
// functions (getFeature / getDraftRevision / updateRevision). The request carries
// real auth fields (organization/userId/email) so `getContextFromReq` builds a
// real ReqContextClass, keeping the whole rule-mutation decision path real. The
// test fails against the old implementation that used `removeRuleById` (global
// delete) and passes with the env-scoped narrowing.

const FEATURE_ID = "feat_rule_del_env";
const RULE_ID = "fr_shared";
const ORG_ID = "org_rule_del_env";
const USER_ID = "u_ruledel";

const ORG = {
  id: ORG_ID,
  name: "Rule Delete Env",
  ownerEmail: "ruledel@test.com",
  url: "",
  dateCreated: new Date(),
  members: [
    {
      id: USER_ID,
      role: "admin",
      limitAccessByEnvironment: false,
      environments: [],
    },
  ],
  settings: {
    environments: [
      { id: "production", description: "" },
      { id: "staging", description: "" },
    ],
  },
} as unknown as OrganizationInterface;

const sharedRule = {
  id: RULE_ID,
  allEnvironments: false,
  environments: ["production", "staging"],
  type: "force",
  description: "",
  value: "on",
  condition: "{}",
  enabled: true,
};

// A pending ramp create action targeting the shared rule by id. Ramp actions
// are keyed to a rule (environment is deprecated), so they apply to every env
// the rule serves. It must survive an env-scoped delete as long as the rule
// does, and be stripped when the rule's last env is removed.
const pendingRampAction = {
  mode: "create",
  ruleId: RULE_ID,
  name: "ramp shared",
  startActions: [],
  steps: [{ interval: 86400, actions: [] }],
  endActions: [],
};

function makeReq(environment: string): AuthRequest {
  const req = {
    params: { id: FEATURE_ID, version: "2" },
    body: { ruleId: RULE_ID, environment },
    organization: ORG,
    userId: USER_ID,
    email: "ruledel@test.com",
    name: "Test",
    superAdmin: false,
    teams: [],
    headers: {},
    query: {},
    log: { child: () => ({}) },
    currentUser: { id: USER_ID, email: "ruledel@test.com", superAdmin: false },
  } as unknown as Request;
  return req as AuthRequest;
}

function makeRes() {
  return {
    locals: {
      eventAudit: {
        type: "dashboard",
        id: USER_ID,
        email: "ruledel@test.com",
        name: "Test",
      },
    },
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as never;
}

async function seedFeatureAndDraft(
  rules: Array<Record<string, unknown>>,
  rampActions?: Array<Record<string, unknown>>,
) {
  await mongoose.connection.collection("features").insertOne({
    id: FEATURE_ID,
    organization: ORG_ID,
    version: 1,
    defaultValue: "off",
    valueType: "string",
    owner: "",
    description: "",
    project: "",
    tags: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    rules: [],
    environmentSettings: {
      production: { enabled: true },
      staging: { enabled: true },
    },
    archived: false,
  });

  const now = new Date();
  await mongoose.connection.collection("featurerevisions").insertOne({
    organization: ORG_ID,
    featureId: FEATURE_ID,
    version: 2,
    dateCreated: now,
    dateUpdated: now,
    createdBy: {
      type: "dashboard",
      id: USER_ID,
      email: "ruledel@test.com",
      name: "T",
    },
    baseVersion: 1,
    status: "draft",
    comment: "",
    defaultValue: "off",
    valueType: "string",
    rules,
    ...(rampActions !== undefined && { rampActions }),
    environmentsEnabled: { production: true, staging: true },
    log: [],
  });
}

async function getDraftRules() {
  const doc = await mongoose.connection
    .collection("featurerevisions")
    .findOne({ organization: ORG_ID, featureId: FEATURE_ID, version: 2 });
  return (doc?.rules as Array<{ id: string; environments?: string[] }>) ?? [];
}

async function getDraftRampActions() {
  const doc = await mongoose.connection
    .collection("featurerevisions")
    .findOne({ organization: ORG_ID, featureId: FEATURE_ID, version: 2 });
  return (doc?.rampActions as Array<{ ruleId?: string }>) ?? [];
}

describe("deleteFeatureRule env-scoped delete (#6663)", () => {
  const { isReady } = setupApp();

  beforeAll(async () => {
    await isReady;
    await mongoose.connection.collection("organizations").insertOne(ORG);
  });

  it("narrows a shared rule to remaining envs instead of deleting it globally", async () => {
    await seedFeatureAndDraft([sharedRule]);

    await deleteFeatureRule(makeReq("production"), makeRes());

    // The shared rule must survive narrowed to staging: removed only from
    // production, not from every environment at once.
    const rules = await getDraftRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe(RULE_ID);
    expect(rules[0].environments).toEqual(["staging"]);
  });

  it("removes the rule entirely when deleting its last applicable env", async () => {
    await seedFeatureAndDraft([
      { ...sharedRule, environments: ["production"] },
    ]);

    await deleteFeatureRule(makeReq("production"), makeRes());

    const rules = await getDraftRules();
    expect(rules).toEqual([]);
  });

  it("preserves the pending ramp action when a shared rule is narrowed to a surviving env", async () => {
    await seedFeatureAndDraft([sharedRule], [pendingRampAction]);

    // Delete the shared rule only from production; it survives for staging.
    await deleteFeatureRule(makeReq("production"), makeRes());

    const rules = await getDraftRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe(RULE_ID);
    expect(rules[0].environments).toEqual(["staging"]);

    // The ramp targets the rule by id and applies wherever it serves — it must
    // NOT be stripped, or staging would silently lose its pending schedule.
    const rampActions = await getDraftRampActions();
    expect(rampActions).toHaveLength(1);
    expect(rampActions[0].ruleId).toBe(RULE_ID);
  });

  it("strips the pending ramp action when the rule's last applicable env is deleted", async () => {
    await seedFeatureAndDraft(
      [{ ...sharedRule, environments: ["production"] }],
      [pendingRampAction],
    );

    // Deleting the only env fully removes the rule — its ramp must go too,
    // otherwise publish would create a schedule for a rule that no longer
    // exists.
    await deleteFeatureRule(makeReq("production"), makeRes());

    const rules = await getDraftRules();
    expect(rules).toEqual([]);

    const rampActions = await getDraftRampActions();
    expect(rampActions).toEqual([]);
  });
});
