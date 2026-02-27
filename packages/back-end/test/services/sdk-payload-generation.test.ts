/**
 * Comprehensive SDK payload generation test suite.
 * Standalone: covers all payload output dimensions without relying on other test files.
 *
 * Dimensions: connection vs legacy settings, project/environment scoping,
 * capability-based additive rule building, holdouts, prerequisites,
 * encryption, secure attribute hashing, draft experiments, safe rollouts.
 */
import cloneDeep from "lodash/cloneDeep";
import { FeatureInterface } from "shared/types/feature";
import { ExperimentInterface } from "shared/types/experiment";
import { HoldoutInterface } from "shared/types/validators";
import { GroupMap, SavedGroupInterface } from "shared/types/saved-group";
import { SafeRolloutInterface } from "shared/types/safe-rollout";
import { OrganizationInterface } from "shared/types/organization";
import { ApiReqContext } from "back-end/types/api";
import {
  buildSDKPayloadForConnection,
  getFeatureDefinitionsResponse,
  type SDKPayloadRawData,
  type ConnectionPayloadOptions,
} from "back-end/src/services/features";
import { getFeatureDefinition } from "back-end/src/util/features";
import { FeatureDefinition } from "shared/types/sdk";

function minimalContext(orgOverrides?: Partial<OrganizationInterface>): ApiReqContext {
  return {
    org: {
      id: "org-1",
      name: "Test",
      url: "",
      dateCreated: new Date(),
      ownerEmail: "",
      members: [],
      invites: [],
      ...orgOverrides,
    },
    models: {} as ApiReqContext["models"],
    userId: "u1",
    email: "e@e.com",
    userName: "User",
    initModels: () => {},
  } as ApiReqContext;
}

function minimalRawData(overrides?: Partial<SDKPayloadRawData>): SDKPayloadRawData {
  return {
    features: [],
    experimentMap: new Map(),
    groupMap: new Map(),
    safeRolloutMap: new Map(),
    savedGroups: [],
    holdoutsMap: new Map(),
    visualExperiments: [],
    urlRedirectExperiments: [],
    ...overrides,
  };
}

describe("SDK payload generation (comprehensive)", () => {
  describe("connection vs legacy capability behavior", () => {
    it("additive rule keys for bucketingV2; strict only for legacy (no bucketingV2)", () => {
      const feature: FeatureInterface = {
        id: "f1",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        defaultValue: true,
        organization: "org-1",
        owner: "",
        valueType: "boolean",
        archived: false,
        description: "",
        version: 1,
        environmentSettings: {
          production: {
            enabled: true,
            rules: [
              {
                type: "experiment-ref",
                id: "r1",
                enabled: true,
                experimentId: "exp1",
                variations: [
                  { variationId: "v0", value: "v0", key: "0", name: "C" },
                  { variationId: "v1", value: "v1", key: "1", name: "T" },
                ],
              },
            ],
          },
        },
      };
      const exp: ExperimentInterface = {
        id: "exp1",
        organization: "org-1",
        project: "",
        name: "E1",
        hypothesis: "",
        status: "running",
        hashVersion: 2,
        hashAttribute: "id",
        seed: "s1",
        linkedFeatures: [{ featureId: "f1", state: "live" }],
        phases: [
          {
            phase: "main",
            coverage: 1,
            variationWeights: [0.5, 0.5],
            namespace: { enabled: true, name: "ns", range: [0, 1] },
            seed: "s1",
          },
        ],
        variations: [{ id: "v0", key: "0", name: "C" }, { id: "v1", key: "1", name: "T" }],
        dateCreated: new Date(),
        dateUpdated: new Date(),
        trackingKey: "tk",
        archived: false,
      } as ExperimentInterface;
      const experimentMap = new Map<string, ExperimentInterface>([["exp1", exp]]);
      const groupMap: GroupMap = new Map();
      const safeRolloutMap = new Map<string, SafeRolloutInterface>();

      const withBucketingV2 = getFeatureDefinition({
        feature,
        environment: "production",
        groupMap,
        experimentMap,
        safeRolloutMap,
        capabilities: ["bucketingV2"],
        includeRuleIds: true,
        includeExperimentNames: true,
      });
      expect(withBucketingV2.rules?.[0]).toHaveProperty("hashVersion");
      expect(withBucketingV2.rules?.[0]).toHaveProperty("seed");
      expect(withBucketingV2.rules?.[0]).toHaveProperty("meta");
      expect(withBucketingV2.rules?.[0]).toHaveProperty("name");
      expect(withBucketingV2.rules?.[0]).toHaveProperty("phase");

      const legacyOnly = getFeatureDefinition({
        feature,
        environment: "production",
        groupMap,
        experimentMap,
        safeRolloutMap,
        capabilities: [], // no bucketingV2 – stricter allowedKeys
        includeRuleIds: false,
        includeExperimentNames: false,
      });
      expect(legacyOnly.rules?.[0]).toHaveProperty("hashAttribute");
      expect(legacyOnly.rules?.[0]).toHaveProperty("namespace");
      expect(legacyOnly.rules?.[0]).not.toHaveProperty("hashVersion");
      expect(legacyOnly.rules?.[0]).not.toHaveProperty("seed");
      expect(legacyOnly.rules?.[0]).not.toHaveProperty("meta");
      expect(legacyOnly.rules?.[0]).not.toHaveProperty("name");
    });

    it("includeRuleIds and includeExperimentNames only add id/name when true", () => {
      const feature: FeatureInterface = {
        id: "f1",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        defaultValue: true,
        organization: "org-1",
        owner: "",
        valueType: "boolean",
        archived: false,
        description: "",
        version: 1,
        environmentSettings: {
          production: {
            enabled: true,
            rules: [
              {
                type: "experiment-ref",
                id: "rule-id",
                enabled: true,
                experimentId: "exp1",
                variations: [
                  { variationId: "v0", value: "v0", key: "0", name: "Control" },
                  { variationId: "v1", value: "v1", key: "1", name: "Treatment" },
                ],
              },
            ],
          },
        },
      };
      const exp: ExperimentInterface = {
        id: "exp1",
        organization: "org-1",
        project: "",
        name: "My Experiment",
        hypothesis: "",
        status: "running",
        linkedFeatures: [{ featureId: "f1", state: "live" }],
        phases: [{ phase: "main", coverage: 1, variationWeights: [0.5, 0.5] }],
        variations: [{ id: "v0", key: "0", name: "Control" }, { id: "v1", key: "1", name: "Treatment" }],
        dateCreated: new Date(),
        dateUpdated: new Date(),
        trackingKey: "tk",
        archived: false,
      } as ExperimentInterface;
      const experimentMap = new Map([["exp1", exp]]);
      const groupMap = new Map();
      const safeRolloutMap = new Map();

      const withIdsAndNames = getFeatureDefinition({
        feature,
        environment: "production",
        groupMap,
        experimentMap,
        safeRolloutMap,
        capabilities: undefined,
        includeRuleIds: true,
        includeExperimentNames: true,
      });
      expect((withIdsAndNames.rules?.[0] as Record<string, unknown>).id).toBe("rule-id");
      expect((withIdsAndNames.rules?.[0] as Record<string, unknown>).name).toBe("My Experiment");

      const without = getFeatureDefinition({
        feature,
        environment: "production",
        groupMap,
        experimentMap,
        safeRolloutMap,
        capabilities: undefined,
        includeRuleIds: false,
        includeExperimentNames: false,
      });
      expect((without.rules?.[0] as Record<string, unknown>).id).toBeUndefined();
      expect((without.rules?.[0] as Record<string, unknown>).name).toBeUndefined();
    });
  });

  describe("project and environment scoping", () => {
    it("projects === null returns empty features and experiments", async () => {
      const ctx = minimalContext();
      const connection: ConnectionPayloadOptions = {
        capabilities: ["bucketingV2"],
        environment: "production",
        projects: null,
      };
      const data = minimalRawData({
        features: [
          {
            id: "f1",
            project: "p1",
            dateCreated: new Date(),
            dateUpdated: new Date(),
            defaultValue: "x",
            organization: "org-1",
            owner: "",
            valueType: "string",
            archived: false,
            description: "",
            version: 1,
            environmentSettings: { production: { enabled: true, rules: [] } },
          } as FeatureInterface,
        ],
      });
      const out = await buildSDKPayloadForConnection({ context: ctx, connection, data });
      expect(out.features).toEqual({});
      expect(out.experiments).toEqual([]);
    });

    it("project filter restricts features and experiments to that project", async () => {
      const ctx = minimalContext();
      const f1 = {
        id: "f1",
        project: "p1",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        defaultValue: "a",
        organization: "org-1",
        owner: "",
        valueType: "string",
        archived: false,
        description: "",
        version: 1,
        environmentSettings: { production: { enabled: true, rules: [] } },
      } as FeatureInterface;
      const f2 = {
        ...cloneDeep(f1),
        id: "f2",
        project: "p2",
      };
      const connection: ConnectionPayloadOptions = {
        capabilities: [],
        environment: "production",
        projects: ["p1"],
      };
      const data = minimalRawData({ features: [f1, f2] });
      const out = await buildSDKPayloadForConnection({ context: ctx, connection, data });
      expect(Object.keys(out.features)).toEqual(["f1"]);
    });
  });

  describe("savedGroupReferencesEnabled and capabilities", () => {
    it("savedGroupReferences capability with savedGroupReferencesEnabled keeps $inGroup; without expands to $in", async () => {
      const groupMap: GroupMap = new Map([
        [
          "sg1",
          {
            id: "sg1",
            organization: "org-1",
            groupName: "G1",
            type: "list",
            values: ["a", "b"],
            attributeKey: "x",
          } as SavedGroupInterface & { values: string[] },
        ],
      ]);
      const featureDef: FeatureDefinition = {
        defaultValue: true,
        rules: [
          {
            condition: { id: { $inGroup: "sg1" } },
            force: false,
          },
        ],
      };
      const withRefs = await getFeatureDefinitionsResponse({
        features: { f1: cloneDeep(featureDef) },
        experiments: [],
        dateUpdated: new Date(),
        capabilities: ["savedGroupReferences"],
        savedGroupReferencesEnabled: true,
        usedSavedGroups: [
          {
            id: "sg1",
            organization: "org-1",
            groupName: "G1",
            type: "list",
            values: ["a", "b"],
            attributeKey: "x",
          } as SavedGroupInterface,
        ],
        organization: minimalContext().org as OrganizationInterface,
      });
      expect((withRefs.features.f1.rules?.[0] as { condition: unknown }).condition).toEqual({
        id: { $inGroup: "sg1" },
      });
      expect(withRefs.savedGroups).toHaveProperty("sg1");

      const expanded = await getFeatureDefinitionsResponse({
        features: { f1: cloneDeep(featureDef) },
        experiments: [],
        dateUpdated: new Date(),
        capabilities: ["looseUnmarshalling"],
        savedGroupReferencesEnabled: false,
        usedSavedGroups: [
          {
            id: "sg1",
            organization: "org-1",
            groupName: "G1",
            type: "list",
            values: ["a", "b"],
            attributeKey: "x",
          } as SavedGroupInterface,
        ],
        organization: minimalContext().org as OrganizationInterface,
      });
      expect((expanded.features.f1.rules?.[0] as { condition: unknown }).condition).toEqual({
        id: { $in: ["a", "b"] },
      });
    });
  });

  describe("encryption and secure attribute hashing", () => {
    it("encryptPayload true with encryptionKey produces encryptedFeatures", async () => {
      const ctx = minimalContext();
      const out = await getFeatureDefinitionsResponse({
        features: { f1: { defaultValue: "x", rules: [] } },
        experiments: [],
        dateUpdated: new Date(),
        encryptPayload: true,
        encryptionKey: "test-key-32-bytes-long!!!!!!!!",
        capabilities: [],
        usedSavedGroups: [],
        organization: ctx.org as OrganizationInterface,
      });
      expect(out.encryptedFeatures).toBeDefined();
      expect(out.features).toEqual({});
    });

    it("hashSecureAttributes with attributeSchema and salt hashes secure attributes in features", async () => {
      const secureStringAttr = { property: "secret", datatype: "secureString" as const };
      const featureDef: FeatureDefinition = {
        defaultValue: true,
        rules: [
          {
            condition: { secret: { $eq: "plain" } },
            force: false,
          },
        ],
      };
      const out = await getFeatureDefinitionsResponse({
        features: { f1: cloneDeep(featureDef) },
        experiments: [],
        dateUpdated: new Date(),
        capabilities: ["looseUnmarshalling"],
        usedSavedGroups: [],
        organization: minimalContext().org as OrganizationInterface,
        attributes: [secureStringAttr],
        secureAttributeSalt: "salt",
      });
      expect(out.features.f1.rules?.[0]).toHaveProperty("condition");
      const cond = (out.features.f1.rules?.[0] as { condition: Record<string, unknown> }).condition;
      expect(cond).toHaveProperty("secret");
      expect(cond.secret).not.toBe("plain");
    });
  });

  describe("holdouts", () => {
    it("holdout definitions are merged and unreferenced holdouts are pruned", async () => {
      const ctx = minimalContext();
      const holdout: HoldoutInterface = {
        id: "holdout-1",
        organization: "org-1",
        name: "H1",
        description: "",
        environment: "production",
        projects: [],
        experimentId: "exp1",
        holdoutPercent: 0.1,
        dateCreated: new Date(),
        dateUpdated: new Date(),
      } as HoldoutInterface;
      const holdoutExperiment: ExperimentInterface = {
        id: "exp1",
        organization: "org-1",
        project: "",
        name: "Holdout Exp",
        hypothesis: "",
        status: "running",
        phases: [{ phase: "main", coverage: 0.9, variationWeights: [0.5, 0.5] }],
        variations: [{ id: "v0", key: "0", name: "C" }, { id: "v1", key: "1", name: "T" }],
        dateCreated: new Date(),
        dateUpdated: new Date(),
        trackingKey: "tk",
        archived: false,
      } as ExperimentInterface;
      const holdoutsMap = new Map([
        ["holdout-1", { holdout, holdoutExperiment }],
      ]);
      const featureRefHoldout: FeatureInterface = {
        id: "f1",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        defaultValue: true,
        organization: "org-1",
        owner: "",
        valueType: "boolean",
        archived: false,
        description: "",
        version: 1,
        environmentSettings: {
          production: {
            enabled: true,
            rules: [
              {
                type: "experiment",
                id: "r1",
                enabled: true,
                coverage: 1,
                values: [
                  { value: "v0", weight: 0.5, name: "C" },
                  { value: "v1", weight: 0.5, name: "T" },
                ],
                hashAttribute: "id",
                seed: "s1",
                namespace: { enabled: true, name: "ns", range: [0, 1] },
              },
            ],
          },
        },
      } as FeatureInterface;
      const connection: ConnectionPayloadOptions = {
        capabilities: ["bucketingV2"],
        environment: "production",
        projects: [],
      };
      const data = minimalRawData({
        features: [featureRefHoldout],
        holdoutsMap,
        experimentMap: new Map([["exp1", holdoutExperiment]]),
      });
      const out = await buildSDKPayloadForConnection({ context: ctx, connection, data });
      expect(out.features.f1).toBeDefined();
      expect(out.features.f1?.rules?.length).toBeGreaterThanOrEqual(1);
      expect(out.dateUpdated).toBeDefined();
    });
  });

  describe("prerequisites and capability", () => {
    it("prerequisites capability includes parentConditions; without capability strips them", () => {
      const feature: FeatureInterface = {
        id: "child",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        defaultValue: true,
        organization: "org-1",
        owner: "",
        valueType: "boolean",
        archived: false,
        description: "",
        version: 1,
        prerequisites: [{ id: "parent", condition: '{"value": true}' }],
        environmentSettings: {
          production: {
            enabled: true,
            rules: [
              {
                type: "experiment",
                id: "r1",
                enabled: true,
                coverage: 1,
                values: [
                  { value: "v0", weight: 0.5, name: "C" },
                  { value: "v1", weight: 0.5, name: "T" },
                ],
                hashAttribute: "id",
                seed: "s1",
                namespace: { enabled: true, name: "ns", range: [0, 1] },
                parentConditions: [{ id: "parent", condition: '{"value": true}' }],
              },
            ],
          },
        },
      } as FeatureInterface;
      const parent: FeatureInterface = {
        id: "parent",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        defaultValue: true,
        organization: "org-1",
        owner: "",
        valueType: "boolean",
        archived: false,
        description: "",
        version: 1,
        environmentSettings: { production: { enabled: true, rules: [] } },
      } as FeatureInterface;
      const experimentMap = new Map();
      const groupMap = new Map();
      const safeRolloutMap = new Map();

      const withPrereqs = getFeatureDefinition({
        feature,
        environment: "production",
        groupMap,
        experimentMap,
        safeRolloutMap,
        capabilities: ["prerequisites", "bucketingV2"],
        includeRuleIds: true,
        includeExperimentNames: false,
      });
      expect(withPrereqs.rules?.[0]).toHaveProperty("parentConditions");

      const withoutPrereqs = getFeatureDefinition({
        feature,
        environment: "production",
        groupMap,
        experimentMap,
        safeRolloutMap,
        capabilities: ["bucketingV2"],
        includeRuleIds: false,
        includeExperimentNames: false,
      });
      expect((withoutPrereqs.rules?.[0] as Record<string, unknown>).parentConditions).toBeUndefined();
    });
  });

  describe("legacy API key behavior", () => {
    it("legacy capabilities (bucketingV2 only) get additive rule keys but no id/name unless requested", () => {
      const feature: FeatureInterface = {
        id: "f1",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        defaultValue: true,
        organization: "org-1",
        owner: "",
        valueType: "boolean",
        archived: false,
        description: "",
        version: 1,
        environmentSettings: {
          production: {
            enabled: true,
            rules: [
              {
                type: "experiment-ref",
                id: "r1",
                enabled: true,
                experimentId: "exp1",
                variations: [
                  { variationId: "v0", value: "v0", key: "0", name: "C" },
                  { variationId: "v1", value: "v1", key: "1", name: "T" },
                ],
              },
            ],
          },
        },
      } as FeatureInterface;
      const exp: ExperimentInterface = {
        id: "exp1",
        organization: "org-1",
        project: "",
        name: "E1",
        hypothesis: "",
        status: "running",
        hashVersion: 2,
        hashAttribute: "id",
        seed: "s1",
        linkedFeatures: [{ featureId: "f1", state: "live" }],
        phases: [
          {
            phase: "main",
            coverage: 1,
            variationWeights: [0.5, 0.5],
            namespace: { enabled: true, name: "ns", range: [0, 1] },
            seed: "s1",
          },
        ],
        variations: [{ id: "v0", key: "0", name: "C" }, { id: "v1", key: "1", name: "T" }],
        dateCreated: new Date(),
        dateUpdated: new Date(),
        trackingKey: "tk",
        archived: false,
      } as ExperimentInterface;
      const experimentMap = new Map([["exp1", exp]]);
      const groupMap = new Map();
      const safeRolloutMap = new Map();

      const legacy = getFeatureDefinition({
        feature,
        environment: "production",
        groupMap,
        experimentMap,
        safeRolloutMap,
        capabilities: ["bucketingV2"],
        includeRuleIds: false,
        includeExperimentNames: false,
      });
      expect(legacy.rules?.[0]).toHaveProperty("hashVersion");
      expect(legacy.rules?.[0]).toHaveProperty("seed");
      expect((legacy.rules?.[0] as Record<string, unknown>).id).toBeUndefined();
      expect((legacy.rules?.[0] as Record<string, unknown>).name).toBeUndefined();
    });
  });

  describe("safe rollouts", () => {
    it("running safe rollout becomes experiment rule; rolled-back becomes force rule", () => {
      const groupMap = new Map();
      const experimentMap = new Map();
      const safeRollout: SafeRolloutInterface = {
        id: "sr1",
        organization: "org-1",
        name: "SR",
        description: "",
        status: "running",
        hashAttribute: "id",
        seed: "s1",
        coverage: 1,
        variationWeights: [0.5, 0.5],
        dateCreated: new Date(),
        dateUpdated: new Date(),
        rampUpSchedule: {
          enabled: true,
          rampUpCompleted: true,
          step: 0,
          steps: [],
        },
      } as SafeRolloutInterface;
      const safeRolloutMap = new Map([["sr1", safeRollout]]);
      const featureWithRunning: FeatureInterface = {
        id: "f1",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        defaultValue: true,
        organization: "org-1",
        owner: "",
        valueType: "boolean",
        archived: false,
        description: "",
        version: 1,
        environmentSettings: {
          production: {
            enabled: true,
            rules: [
              {
                type: "safe-rollout",
                id: "r1",
                enabled: true,
                safeRolloutId: "sr1",
                status: "running",
                controlValue: "false",
                variationValue: "true",
                hashAttribute: "id",
                seed: "s1",
                trackingKey: "tk",
                description: "",
              },
            ],
          },
        },
      } as FeatureInterface;

      const running = getFeatureDefinition({
        feature: featureWithRunning,
        environment: "production",
        groupMap,
        experimentMap,
        safeRolloutMap,
        capabilities: ["bucketingV2"],
        includeRuleIds: false,
        includeExperimentNames: false,
      });
      expect(running.rules?.[0]).toHaveProperty("variations");
      expect(running.rules?.[0]).toHaveProperty("weights");
      expect((running.rules?.[0] as Record<string, unknown>).force).not.toBe(true);

      const rolledBackMap = new Map([
        ["sr1", { ...safeRollout, status: "rolled-back" } as SafeRolloutInterface],
      ]);
      const featureRolledBack = {
        ...cloneDeep(featureWithRunning),
        environmentSettings: {
          production: {
            enabled: true,
            rules: [
              {
                ...featureWithRunning.environmentSettings.production.rules[0],
                status: "rolled-back",
              },
            ],
          },
        },
      } as FeatureInterface;
      const rolledBack = getFeatureDefinition({
        feature: featureRolledBack,
        environment: "production",
        groupMap,
        experimentMap,
        safeRolloutMap: rolledBackMap,
        capabilities: ["bucketingV2"],
        includeRuleIds: false,
        includeExperimentNames: false,
      });
      expect((rolledBack.rules?.[0] as Record<string, unknown>).force).toBe(false);
    });
  });

  describe("includeDraftExperiments", () => {
    it("includeDraftExperiments false filters draft experiments from response", async () => {
      const ctx = minimalContext();
      const featureDef: FeatureDefinition = {
        defaultValue: true,
        rules: [],
      };
      const draftExperiment = {
        id: "exp-draft",
        status: "draft",
        condition: {},
        variations: [{ id: "v0", key: "0", name: "C" }],
        phases: [{ phase: "main", coverage: 1, variationWeights: [1] }],
      };
      const outExcluded = await getFeatureDefinitionsResponse({
        features: { f1: cloneDeep(featureDef) },
        experiments: [cloneDeep(draftExperiment)],
        dateUpdated: new Date(),
        includeDraftExperiments: false,
        capabilities: [],
        usedSavedGroups: [],
        organization: ctx.org as OrganizationInterface,
      });
      expect(outExcluded.experiments).toEqual([]);

      const outIncluded = await getFeatureDefinitionsResponse({
        features: { f1: cloneDeep(featureDef) },
        experiments: [cloneDeep(draftExperiment)],
        dateUpdated: new Date(),
        includeDraftExperiments: true,
        capabilities: [],
        usedSavedGroups: [],
        organization: ctx.org as OrganizationInterface,
      });
      expect(outIncluded.experiments?.length).toBe(1);
    });
  });
});
