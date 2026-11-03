import { randomUUID } from "crypto";
import mongoose from "mongoose";
import type { AIModel } from "shared/ai";
import type {
  OrganizationInterface,
  OrganizationSettings,
} from "shared/types/organization";
import mongoInit from "back-end/src/init/mongo";
import { ReqContextClass } from "back-end/src/services/context";
import { waitForIndexes } from "back-end/src/models/BaseModel";
import { getAgendaInstance } from "back-end/src/services/queueing";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { disconnectTestMongo, testMongoUri } from "back-end/test/test-helpers";
import type { WorldSnapshot } from "./record";

// One database per eval or test file; every trial gets its own org inside it,
// so concurrent trials never see each other's state.
export async function openWorldDb(): Promise<void> {
  // mongoInit, here and in the eval server's init(), reads MONGO_URL only
  // under NODE_ENV=test and otherwise connects to MONGODB_URI, the database
  // closeWorldDb would then drop.
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      `The evals need NODE_ENV=test, got "${process.env.NODE_ENV}". Unset NODE_ENV and Jest sets it.`,
    );
  }
  process.env.MONGO_URL = testMongoUri();
  await mongoInit();
  // Building a context registers every model, which creates its indexes.
  new ReqContextClass({
    org: {
      id: "org_eval_indexes",
      name: "Indexes",
      ownerEmail: "admin@acme.test",
      url: "",
      dateCreated: new Date(),
      members: [],
      invites: [],
    },
    auditUser: {
      type: "dashboard",
      id: "u_indexes",
      email: "admin@acme.test",
      name: "Indexes",
    },
    user: {
      id: "u_indexes",
      email: "admin@acme.test",
      name: "Indexes",
      superAdmin: true,
    },
    teams: [],
  });
  await waitForIndexes();
}

export async function closeWorldDb(): Promise<void> {
  await getAgendaInstance().stop();
  await disconnectTestMongo();
}

export const ADMIN = {
  id: "u_admin",
  email: "admin@acme.test",
  name: "Avery Admin",
};

export const NAMESPACE = "checkout";

export const VARIATIONS = [
  { id: "var_control", key: "0", name: "Control" },
  { id: "var_treatment", key: "1", name: "Treatment" },
] as const;

// What a scenario points the agent at, and what graders read back.
export interface Seeded {
  experimentId: string;
}

export interface ExperimentSeed {
  name?: string;
  trackingKey?: string;
  status: "draft" | "running" | "stopped";
  type?: "standard" | "multi-armed-bandit";
  coverage?: number;
  weights?: number[];
  condition?: string;
  stickyBucketing?: boolean;
  // How the experiment reaches users. "flag" links a feature with an enabled
  // experiment-ref rule, so the experiment is live in the SDK payload.
  servedBy?: "flag" | "none";
}

export interface World {
  org: OrganizationInterface;
  // An admin member, acting the way a person in the app does.
  context: ReqContextClass;
  experiment(seed: ExperimentSeed): Promise<Seeded>;
  read(target: Seeded): Promise<WorldSnapshot>;
  updateOrgSettings(settings: Partial<OrganizationSettings>): Promise<void>;
  // A real admin secret key for this org, which the eval server's auth
  // accepts. It has no confirm rules: external agents have no confirm cards.
  createApiKey(): Promise<string>;
}

export interface WorldOptions {
  agentModel: AIModel;
}

const daysAgo = (days: number) => new Date(Date.now() - days * 86400000);
const shortId = () => randomUUID().replace(/-/g, "").slice(0, 10);

function collection(name: string) {
  return mongoose.connection.collection(name);
}

export async function createWorld({ agentModel }: WorldOptions) {
  const org: OrganizationInterface = {
    id: `org_eval_${shortId()}`,
    name: "Acme",
    ownerEmail: ADMIN.email,
    url: "",
    dateCreated: daysAgo(400),
    members: [
      {
        id: ADMIN.id,
        role: "admin",
        dateCreated: daysAgo(400),
        limitAccessByEnvironment: false,
        environments: [],
        projectRoles: [],
      },
    ],
    invites: [],
    settings: {
      environments: [
        { id: "dev", description: "" },
        { id: "production", description: "" },
      ],
      namespaces: [
        {
          name: NAMESPACE,
          label: "Checkout",
          description: "Experiments on the checkout flow",
          status: "active",
        },
      ],
      attributeSchema: [
        { property: "id", datatype: "string", hashAttribute: true },
        {
          property: "country",
          datatype: "string",
          format: "isoCountryCode",
        },
        {
          property: "deviceType",
          datatype: "enum",
          enum: "mobile,desktop,tablet",
        },
      ],
      useStickyBucketing: true,
      aiEnabled: true,
      defaultAIModel: agentModel,
    },
  };
  await collection("organizations").insertOne({ ...org });
  // Users are global, so every world's org shares the one admin.
  await collection("users").updateOne(
    { id: ADMIN.id },
    { $setOnInsert: { ...ADMIN, verified: true, dateCreated: daysAgo(400) } },
    { upsert: true },
  );

  const context = new ReqContextClass({
    org,
    auditUser: { type: "dashboard", ...ADMIN },
    user: ADMIN,
    teams: [],
  });

  const world: World = {
    org,
    context,
    experiment: (seed) => insertExperiment(org, seed),
    read: async ({ experimentId }) => {
      const stored = await collection("organizations").findOne({
        id: org.id,
      });
      return {
        experiment: await getExperimentById(context, experimentId),
        orgStickyBucketing: !!stored?.settings?.useStickyBucketing,
      };
    },
    updateOrgSettings: async (settings) => {
      Object.assign(org.settings ?? {}, settings);
      await collection("organizations").updateOne(
        { id: org.id },
        { $set: { settings: org.settings } },
      );
    },
    createApiKey: async () => {
      const { key } = await context.models.apiKeys.createOrganizationApiKey({
        description: "Eval agent",
        roleId: "admin",
      });
      return key;
    },
  };

  // Other experiments a real org would have, so the agent has to find the
  // right one.
  await world.experiment({
    name: "Homepage hero copy",
    trackingKey: "homepage-hero-copy",
    status: "running",
    coverage: 0.5,
  });
  await world.experiment({
    name: "Pricing page layout",
    trackingKey: "pricing-page-layout",
    status: "stopped",
    servedBy: "none",
  });

  return world;
}

async function insertExperiment(
  org: OrganizationInterface,
  {
    name = "Checkout redesign",
    trackingKey = "checkout-redesign",
    status,
    type = "standard",
    coverage = 1,
    weights = [0.5, 0.5],
    condition = "",
    stickyBucketing = false,
    servedBy = "flag",
  }: ExperimentSeed,
): Promise<Seeded> {
  const id = `exp_${shortId()}`;
  const started = status === "draft" ? new Date() : daysAgo(14);
  const bandit = type === "multi-armed-bandit";
  const featureId = trackingKey;

  await collection("experiments").insertOne({
    id,
    uid: shortId(),
    organization: org.id,
    trackingKey,
    name,
    type,
    owner: ADMIN.id,
    project: "",
    hypothesis: `${name} improves conversion`,
    description: "",
    tags: [],
    dateCreated: daysAgo(20),
    dateUpdated: started,
    archived: false,
    status,
    autoSnapshots: false,
    hashAttribute: "id",
    fallbackAttribute: "",
    hashVersion: 2,
    disableStickyBucketing: !stickyBucketing,
    bucketVersion: 1,
    minBucketVersion: 0,
    variations: VARIATIONS.map((v) => ({
      ...v,
      description: "",
      screenshots: [],
    })),
    phases: [
      {
        name: "Main",
        dateStarted: started,
        ...(status === "stopped" ? { dateEnded: daysAgo(2) } : {}),
        reason: "",
        coverage,
        condition,
        savedGroups: [],
        prerequisites: [],
        namespace: { enabled: false, name: "", range: [0, 1] },
        seed: trackingKey,
        variationWeights: weights,
        variations: VARIATIONS.map((v) => ({ id: v.id, status: "active" })),
        ...(bandit
          ? {
              banditEvents: [
                {
                  date: daysAgo(1),
                  banditResult: {
                    currentWeights: [0.5, 0.5],
                    updatedWeights: weights,
                    bestArmProbabilities: [0.8, 0.2],
                  },
                },
              ],
            }
          : {}),
      },
    ],
    linkedFeatures: servedBy === "flag" ? [featureId] : [],
    hasVisualChangesets: false,
    hasURLRedirects: false,
    datasource: "",
    exposureQueryId: "",
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    implementation: "code",
    autoAssign: false,
    previewURL: "",
    targetURLRegex: "",
    ideaSource: "",
    releasedVariationId: "",
    // Starting or stopping writes the org's analysis defaults onto the
    // experiment, so the seed carries them like an experiment created in the
    // app; otherwise the state grader sees them as unrequested changes.
    statsEngine: "bayesian",
    regressionAdjustmentEnabled: false,
    postStratificationEnabled: true,
    ...(status === "stopped"
      ? { results: "lost", winner: 0, excludeFromPayload: true }
      : {}),
    // Already in the shape a bandit restart scrubs to, so a restart only
    // moves the bandit's own fields.
    ...(bandit
      ? {
          banditStage: "exploit",
          banditStageDateStarted: daysAgo(7),
          banditScheduleValue: 1,
          banditScheduleUnit: "days",
          banditBurnInValue: 1,
          banditBurnInUnit: "days",
          attributionModel: "firstExposure",
        }
      : {}),
  });

  if (servedBy === "flag") {
    await insertExperimentFlag(org, featureId, id);
  }
  return { experimentId: id };
}

async function insertExperimentFlag(
  org: OrganizationInterface,
  featureId: string,
  experimentId: string,
) {
  const rules = [
    {
      id: `fr_${shortId()}`,
      type: "experiment-ref",
      description: "",
      condition: "",
      enabled: true,
      experimentId,
      variations: VARIATIONS.map((v, i) => ({
        variationId: v.id,
        value: String(i === 1),
      })),
      allEnvironments: true,
    },
  ];
  const created = daysAgo(20);
  await collection("features").insertOne({
    id: featureId,
    organization: org.id,
    owner: ADMIN.id,
    project: "",
    description: "",
    valueType: "boolean",
    defaultValue: "false",
    version: 1,
    archived: false,
    tags: [],
    rules,
    environmentSettings: {
      dev: { enabled: true, rules: [] },
      production: { enabled: true, rules: [] },
    },
    prerequisites: [],
    dateCreated: created,
    dateUpdated: created,
  });
  await collection("featurerevisions").insertOne({
    id: `frev_${shortId()}`,
    organization: org.id,
    featureId,
    version: 1,
    baseVersion: 0,
    status: "published",
    createdBy: { type: "dashboard", ...ADMIN },
    comment: "",
    defaultValue: "false",
    rules,
    dateCreated: created,
    dateUpdated: created,
    datePublished: created,
  });
}
