import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  autoMerge,
  fillRevisionFromFeature,
  liveRevisionFromFeature,
} from "shared/util";
import { FeatureRule } from "shared/types/feature";
import { EventUser } from "shared/types/events/event-types";
import { OrganizationInterface } from "shared/types/organization";
import { ReqContext } from "back-end/types/request";
import {
  createRevision,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { getFeature, publishRevision } from "back-end/src/models/FeatureModel";

// ---------------------------------------------------------------------------
// Regression test for the stale-base publish race:
//
//   1. A draft is created at live version 1 (snapshotting its content).
//   2. A concurrent publish (e.g. a ramp step advancing a rollout) lands a
//      NEWER revision and moves feature.version forward.
//   3. The draft is published.
//
// Before the fix, step 3 moved feature.version BACKWARDS to the draft's
// stale version number, and the published revision document kept its
// pre-merge snapshot — so the "live" revision disagreed with the feature and
// drift repair would silently revert the concurrent rollout change.
//
// The model functions run against a real in-memory Mongo; heavyweight
// side-effect services (SDK payload refresh, events, ramp schedules, sandbox
// hooks) are mocked, mirroring SafeRolloutSnapshotModel.ramp-integration.
// ---------------------------------------------------------------------------

jest.mock("back-end/src/services/features", () => ({
  generateRuleId: jest.fn(() => "rule_generated"),
  addIdsToFlatRules: jest.fn(),
  getApiFeatureObj: jest.fn(),
  getNextScheduledUpdate: jest.fn(() => null),
  getSavedGroupMap: jest.fn(),
  queueSDKPayloadRefresh: jest.fn(),
  synthesizeRuleId: jest.fn(() => "rule_synthesized"),
}));

jest.mock("back-end/src/services/rampSchedule", () => ({
  appendRampEvent: jest.fn(),
  assertFeatureNotLockedByRamp: jest.fn(async () => undefined),
  computeNextProcessAt: jest.fn(),
  ensureSafeRolloutForMonitoredRamp: jest.fn(),
  getStartActionsFromRules: jest.fn(() => []),
  mergeStepsForRunningSchedule: jest.fn(),
  remapTemplateActions: jest.fn(),
  startReadyScheduleNow: jest.fn(),
  syncLinkedSafeRolloutForRampState: jest.fn(),
}));

jest.mock("back-end/src/enterprise/sandbox/sandbox-eval", () => ({
  runValidateFeatureHooks: jest.fn(async () => undefined),
  runValidateFeatureRevisionHooks: jest.fn(async () => undefined),
}));

jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgId: jest.fn(),
  getEnvironmentIdsFromOrg: jest.fn(
    (org: { settings?: { environments?: { id: string }[] } }) =>
      (org?.settings?.environments ?? []).map((e) => e.id),
  ),
}));

jest.mock("back-end/src/services/vercel-native-integration.service", () => ({
  createVercelExperimentationItemFromFeature: jest.fn(),
  updateVercelExperimentationItemFromFeature: jest.fn(),
  deleteVercelExperimentationItemFromFeature: jest.fn(),
}));

jest.mock("back-end/src/enterprise/saferollouts/safeRolloutUtils", () => ({
  determineNextSafeRolloutSnapshotAttempt: jest.fn(),
}));

jest.mock("back-end/src/events/handlers/utils", () => ({
  getChangedApiFeatureEnvironments: jest.fn(() => []),
}));

jest.mock("back-end/src/events/handlers/webhooks/event-webhooks-utils", () => ({
  getObjectDiff: jest.fn(() => ({})),
}));

jest.mock("back-end/src/models/EventModel", () => ({
  createEvent: jest.fn(),
  hasPreviousObject: jest.fn(() => false),
}));

jest.mock("back-end/src/models/ExperimentModel", () => ({
  addLinkedFeatureToExperiment: jest.fn(),
  clearPendingFeatureDraftsForRevision: jest.fn(),
  getExperimentById: jest.fn(),
  getExperimentMapForFeature: jest.fn(async () => new Map()),
  removeLinkedFeatureFromExperiment: jest.fn(),
  updateExperiment: jest.fn(),
}));

const ORG_ID = "org_race";
const FEATURE_ID = "feat_race";
const ENVIRONMENTS = ["production", "dev"];

const user: EventUser = {
  type: "dashboard",
  id: "u_1",
  email: "u@example.com",
  name: "Test User",
};

const org = {
  id: ORG_ID,
  settings: {
    environments: [
      { id: "production", description: "" },
      { id: "dev", description: "" },
    ],
  },
} as unknown as OrganizationInterface;

const reassignVersionMock = jest.fn(async () => undefined);
const revisionLogCreateMock = jest.fn(async () => undefined);

const context = {
  org,
  auditUser: user,
  hasPremiumFeature: jest.fn(() => false),
  permissions: {
    canReadSingleProjectResource: jest.fn(() => true),
  },
  models: {
    featureRevisionLogs: {
      create: revisionLogCreateMock,
      reassignVersion: reassignVersionMock,
    },
    safeRollout: {
      getByIds: jest.fn(async () => []),
      getAllPayloadSafeRollouts: jest.fn(async () => new Map()),
    },
    rampSchedules: {
      getAllByFeatureId: jest.fn(async () => []),
      findByActivatingRevision: jest.fn(async () => []),
    },
  },
} as unknown as ReqContext;

function rolloutRule(coverage: number): FeatureRule {
  return {
    id: "r_rollout",
    type: "rollout",
    description: "",
    value: "true",
    coverage,
    hashAttribute: "id",
    enabled: true,
    condition: "",
    allEnvironments: false,
    environments: ["production"],
  } as FeatureRule;
}

const FORCE_RULE: FeatureRule = {
  id: "r_force",
  type: "force",
  description: "",
  value: "true",
  enabled: true,
  condition: "",
  allEnvironments: true,
} as FeatureRule;

async function insertFixtures() {
  const now = new Date();
  await mongoose.connection.db!.collection("features").insertOne({
    id: FEATURE_ID,
    organization: ORG_ID,
    version: 1,
    dateCreated: now,
    dateUpdated: now,
    archived: false,
    description: "",
    owner: "",
    project: "",
    tags: [],
    valueType: "boolean",
    defaultValue: "false",
    rules: [rolloutRule(0.2)],
    environmentSettings: {
      production: { enabled: true },
      dev: { enabled: true },
    },
    prerequisites: [],
  });
  await mongoose.connection.db!.collection("featurerevisions").insertOne({
    organization: ORG_ID,
    featureId: FEATURE_ID,
    version: 1,
    baseVersion: 0,
    dateCreated: now,
    dateUpdated: now,
    datePublished: now,
    status: "published",
    createdBy: user,
    publishedBy: user,
    comment: "",
    defaultValue: "false",
    rules: [rolloutRule(0.2)],
    environmentsEnabled: { production: true, dev: true },
    prerequisites: [],
    archived: false,
    metadata: {},
    holdout: null,
  });
}

describe("publishing a draft built on a stale base", () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
    await insertFixtures();
  });

  it("preserves a concurrently published rollout change and keeps the live revision consistent", async () => {
    const feature = await getFeature(context, FEATURE_ID);
    if (!feature) throw new Error("fixture feature missing");

    // 1. A user opens a draft that adds a force rule (rollout untouched).
    const draft = await createRevision({
      context,
      feature,
      user,
      environments: ENVIRONMENTS,
      changes: { rules: [rolloutRule(0.2), FORCE_RULE] },
      org,
    });
    expect(draft.version).toBe(2);
    expect(draft.baseVersion).toBe(1);

    // 2. A concurrent publish (e.g. ramp step) advances the rollout to 50%
    //    and lands as a NEWER revision, mirroring featureEntityHandler.
    const concurrent = await createRevision({
      context,
      feature,
      user,
      environments: ENVIRONMENTS,
      changes: { rules: [rolloutRule(0.5)] },
      org,
    });
    await publishRevision({
      context,
      feature,
      revision: concurrent,
      result: { rules: [rolloutRule(0.5)] },
      bypassLockdown: true,
    });

    const featureAfterConcurrent = await getFeature(context, FEATURE_ID);
    if (!featureAfterConcurrent) throw new Error("feature missing");
    expect(featureAfterConcurrent.version).toBe(concurrent.version);

    // 3. The user publishes the draft. The merge is computed the same way the
    //    publish endpoints do.
    const liveRevision = await getRevision({
      context,
      organization: ORG_ID,
      featureId: FEATURE_ID,
      feature: featureAfterConcurrent,
      version: featureAfterConcurrent.version,
    });
    const baseRevision = await getRevision({
      context,
      organization: ORG_ID,
      featureId: FEATURE_ID,
      feature: featureAfterConcurrent,
      version: draft.baseVersion,
    });
    if (!liveRevision || !baseRevision) throw new Error("revisions missing");

    const mergeResult = autoMerge(
      liveRevisionFromFeature(liveRevision, featureAfterConcurrent),
      fillRevisionFromFeature(baseRevision, featureAfterConcurrent),
      draft,
      ENVIRONMENTS,
      {},
    );
    expect(mergeResult.success).toBe(true);
    if (!mergeResult.success) return;

    const staleDraftVersion = draft.version;
    const updatedFeature = await publishRevision({
      context,
      feature: featureAfterConcurrent,
      revision: draft,
      result: mergeResult.result,
    });

    // The draft was re-versioned to the head of the history instead of
    // moving feature.version backwards past the concurrent publish.
    expect(draft.version).toBeGreaterThan(concurrent.version);
    expect(updatedFeature.version).toBe(draft.version);
    expect(reassignVersionMock).toHaveBeenCalledWith({
      featureId: FEATURE_ID,
      fromVersion: staleDraftVersion,
      toVersion: draft.version,
    });

    // The concurrent rollout change survived the draft publish.
    const liveRolloutRule = updatedFeature.rules?.find(
      (r) => r.id === "r_rollout",
    );
    expect(liveRolloutRule).toMatchObject({ coverage: 0.5 });
    expect(updatedFeature.rules?.find((r) => r.id === "r_force")).toBeTruthy();

    // The published revision document holds the post-merge live content —
    // the invariant that makes drift repair safe. Before the fix it kept the
    // draft's stale snapshot (rollout at 0.2).
    const publishedRevision = await getRevision({
      context,
      organization: ORG_ID,
      featureId: FEATURE_ID,
      feature: updatedFeature,
      version: updatedFeature.version,
    });
    expect(publishedRevision?.status).toBe("published");
    expect(
      publishedRevision?.rules?.find((r) => r.id === "r_rollout"),
    ).toMatchObject({ coverage: 0.5 });
    expect(
      publishedRevision?.rules?.find((r) => r.id === "r_force"),
    ).toBeTruthy();

    // No revision is left behind under the stale number.
    const staleDoc = await mongoose.connection
      .db!.collection("featurerevisions")
      .findOne({
        organization: ORG_ID,
        featureId: FEATURE_ID,
        version: staleDraftVersion,
      });
    expect(staleDoc).toBeNull();
  });

  it("publishes a fresh draft without re-versioning", async () => {
    const feature = await getFeature(context, FEATURE_ID);
    if (!feature) throw new Error("fixture feature missing");

    const draft = await createRevision({
      context,
      feature,
      user,
      environments: ENVIRONMENTS,
      changes: { rules: [rolloutRule(0.2), FORCE_RULE] },
      org,
    });
    expect(draft.version).toBe(2);

    const updatedFeature = await publishRevision({
      context,
      feature,
      revision: draft,
      result: { rules: [rolloutRule(0.2), FORCE_RULE] },
    });

    expect(draft.version).toBe(2);
    expect(updatedFeature.version).toBe(2);
    expect(reassignVersionMock).not.toHaveBeenCalled();
  });

  it("rejects the publish write when the feature changed after it was read", async () => {
    const feature = await getFeature(context, FEATURE_ID);
    if (!feature) throw new Error("fixture feature missing");

    const draft = await createRevision({
      context,
      feature,
      user,
      environments: ENVIRONMENTS,
      changes: { rules: [rolloutRule(0.2), FORCE_RULE] },
      org,
    });

    // Simulate a publish landing between this request reading the feature
    // and writing it.
    await mongoose.connection
      .db!.collection("features")
      .updateOne(
        { organization: ORG_ID, id: FEATURE_ID },
        { $set: { version: 99 } },
      );

    await expect(
      publishRevision({
        context,
        feature, // stale in-memory copy still at version 1
        revision: draft,
        result: { rules: [rolloutRule(0.2), FORCE_RULE] },
      }),
    ).rejects.toThrow(/changed by someone else/);
  });
});
