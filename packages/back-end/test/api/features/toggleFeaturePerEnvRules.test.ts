import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { getFeature, updateFeature } from "back-end/src/models/FeatureModel";
import {
  createInitialRevision,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { repairFeatureDriftIfNeeded } from "back-end/src/services/featureDriftRepair";
import { setupApp } from "../api.setup";

// An environment toggle (POST /api/v1/features/:id/toggle) writes
// `environmentSettings` without `rules`. Whatever shape the document stores
// its rules in, a read after that write must return the rules a read returned
// before it.

const FEATURE_ID = "feat_env_rules_toggle";
const ORG_ID = "org_env_rules_toggle";

const makeOrg = (
  environments: Array<{ id: string; parent?: string }>,
): OrganizationInterface =>
  ({
    id: ORG_ID,
    name: "Env Rules Toggle Test",
    ownerEmail: "test@test.com",
    url: "",
    dateCreated: new Date(),
    members: [],
    settings: {
      environments: environments.map((e) => ({
        description: "",
        ...e,
      })),
    },
  }) as unknown as OrganizationInterface;

function makeContext(org: OrganizationInterface) {
  return new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: "key_test" },
    role: "admin",
    req: { query: {}, headers: {} } as unknown as Request,
  });
}

const rule = (id: string, value: string) => ({
  id,
  type: "force",
  description: "",
  value,
  condition: "{}",
  savedGroups: [],
  enabled: true,
});

async function seedFeature({
  rules,
  environmentSettings,
}: {
  rules?: Array<Record<string, unknown>>;
  environmentSettings: Record<string, Record<string, unknown>>;
}) {
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
    ...(rules ? { rules } : {}),
    environmentSettings,
    archived: false,
  });
}

async function seedPublishedRevisionFromFeature(context: ReqContextClass) {
  const feature = await getFeature(context, FEATURE_ID);
  if (!feature) throw new Error("seed feature missing");
  await createInitialRevision(
    context,
    feature,
    context.auditUser,
    Object.keys(feature.environmentSettings ?? {}),
  );
}

async function getFeatureDoc() {
  const doc = await mongoose.connection
    .collection("features")
    .findOne({ id: FEATURE_ID });
  if (!doc) throw new Error("feature doc missing");
  return doc;
}

async function readRules(context: ReqContextClass) {
  const feature = await getFeature(context, FEATURE_ID);
  if (!feature) throw new Error("feature missing");
  return feature.rules;
}

async function toggleStagingOff(app: Parameters<typeof request>[0]) {
  return request(app)
    .post(`/api/v1/features/${FEATURE_ID}/toggle`)
    .set("Authorization", "Bearer foo")
    .send({ environments: { staging: false } });
}

const { app, setReqContext } = setupApp();
const org = makeOrg([{ id: "production" }, { id: "staging" }]);

describe("POST /api/v1/features/:id/toggle", () => {
  it("keeps the rules of a document that stores them per environment", async () => {
    const context = makeContext(org);
    setReqContext(context);
    await seedFeature({
      environmentSettings: {
        production: {
          enabled: true,
          rules: [rule("fr_a", "a"), rule("fr_b", "b")],
        },
        staging: { enabled: true, rules: [rule("fr_a", "a")] },
      },
    });
    await seedPublishedRevisionFromFeature(context);
    const rulesBefore = await readRules(context);
    expect(rulesBefore).toEqual([
      expect.objectContaining({ id: "fr_a", allEnvironments: true }),
      expect.objectContaining({
        id: "fr_b",
        allEnvironments: false,
        environments: ["production"],
      }),
    ]);

    const response = await toggleStagingOff(app);
    expect(response.status).toBe(200);

    const doc = await getFeatureDoc();
    expect(doc.version).toBe(2);
    expect(doc.environmentSettings).toEqual({
      production: { enabled: true },
      staging: { enabled: false },
    });
    // The rules now live in the top-level array, and only there.
    expect(doc.rules).toEqual(rulesBefore);
    expect(await readRules(context)).toEqual(rulesBefore);
  });

  it("keeps a parent environment's rule in a child that inherits it", async () => {
    const context = makeContext(
      makeOrg([
        { id: "production" },
        { id: "staging" },
        { id: "canary", parent: "production" },
      ]),
    );
    setReqContext(context);
    // `canary` has no settings of its own, so it inherits production's.
    await seedFeature({
      rules: [
        {
          ...rule("fr_a", "a"),
          allEnvironments: false,
          environments: ["production"],
        },
      ],
      environmentSettings: {
        production: { enabled: true },
        staging: { enabled: true },
      },
    });
    await seedPublishedRevisionFromFeature(context);
    const rulesBefore = await readRules(context);
    expect(rulesBefore[0].environments).toEqual(["production", "canary"]);

    const response = await toggleStagingOff(app);
    expect(response.status).toBe(200);

    // The toggle stores settings for `canary`, which ends the inheritance, so
    // the stored rule has to name it.
    const doc = await getFeatureDoc();
    expect(doc.environmentSettings.canary).toEqual({ enabled: true });
    expect(doc.rules[0].environments).toEqual(["production", "canary"]);
    expect(await readRules(context)).toEqual(rulesBefore);
  });

  it("drops a deleted project from the rules it carries", async () => {
    const context = makeContext(org);
    setReqContext(context);
    await mongoose.connection.collection("projects").insertOne({
      id: "prj_kept",
      organization: ORG_ID,
      name: "Kept",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    await seedFeature({
      rules: [
        {
          ...rule("fr_a", "a"),
          allEnvironments: true,
          allProjects: false,
          projects: ["prj_kept", "prj_gone"],
        },
      ],
      environmentSettings: {
        production: { enabled: true },
        staging: { enabled: true },
      },
    });
    await seedPublishedRevisionFromFeature(context);

    const response = await toggleStagingOff(app);
    expect(response.status).toBe(200);

    const doc = await getFeatureDoc();
    expect(doc.rules[0].projects).toEqual(["prj_kept"]);

    // The live revision still names the deleted project; a flag page load's
    // drift repair must not copy it back.
    const feature = await getFeature(context, FEATURE_ID);
    if (!feature) throw new Error("feature missing");
    const live = await getRevision({
      context,
      organization: ORG_ID,
      featureId: FEATURE_ID,
      feature,
      version: feature.version,
    });
    expect(live?.rules[0].projects).toEqual(["prj_kept", "prj_gone"]);
    await repairFeatureDriftIfNeeded(context, feature, live ?? undefined, [
      "production",
      "staging",
    ]);
    expect((await getFeatureDoc()).rules[0].projects).toEqual(["prj_kept"]);
  });

  it("leaves the rules of a document on top-level rules as they were", async () => {
    const context = makeContext(org);
    setReqContext(context);
    const storedRules = [
      { ...rule("fr_a", "a"), allEnvironments: true },
      {
        ...rule("fr_b", "b"),
        allEnvironments: false,
        environments: ["production"],
      },
    ];
    await seedFeature({
      rules: storedRules,
      environmentSettings: {
        production: { enabled: true },
        staging: { enabled: true },
      },
    });
    await seedPublishedRevisionFromFeature(context);
    const rulesBefore = await readRules(context);

    const response = await toggleStagingOff(app);
    expect(response.status).toBe(200);

    const doc = await getFeatureDoc();
    expect(doc.environmentSettings.staging.enabled).toBe(false);
    expect(doc.rules).toEqual(storedRules);
    expect(await readRules(context)).toEqual(rulesBefore);
  });
});

describe("updateFeature with environment settings and explicit rules", () => {
  it("writes the rules it was given rather than the ones it read", async () => {
    const context = makeContext(org);
    await seedFeature({
      environmentSettings: {
        production: { enabled: true, rules: [rule("fr_a", "a")] },
        staging: { enabled: true, rules: [rule("fr_a", "a")] },
      },
    });
    const feature = await getFeature(context, FEATURE_ID);
    if (!feature) throw new Error("feature missing");
    expect(feature.rules).toHaveLength(1);

    await updateFeature(
      context,
      feature,
      {
        environmentSettings: {
          ...feature.environmentSettings,
          staging: { enabled: false },
        },
        rules: [],
      },
      { casOnDateUpdated: feature.dateUpdated },
    );

    const doc = await getFeatureDoc();
    expect(doc.rules).toEqual([]);
    expect(await readRules(context)).toEqual([]);
  });
});
