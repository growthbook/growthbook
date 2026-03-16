/**
 * Exhaustive SDK payload generation test suite.
 * Single source of truth: a fixed list of connection presets (capabilities from
 * JS SDK versions + legacy, optional flags true/false/undefined, project scoping)
 * with every behavior from the original tests asserted per connection.
 */
import cloneDeep from "lodash/cloneDeep";
import { FeatureInterface } from "shared/types/feature";
import { ExperimentInterface } from "shared/types/experiment";
import { HoldoutInterface } from "shared/validators";
import { GroupMap, SavedGroupInterface } from "shared/types/saved-group";
import { SafeRolloutInterface } from "shared/types/safe-rollout";
import { OrganizationInterface } from "shared/types/organization";
import {
  FeatureDefinition,
  FeatureDefinitionWithProject,
} from "shared/types/sdk";
import { SDKCapability, getSDKCapabilities } from "shared/sdk-versioning";
import { ApiReqContext } from "back-end/types/api";
import {
  getFeatureDefinitionsResponse,
  generateFeaturesPayload,
  generateAutoExperimentsPayload,
  type VisualExperiment,
  type URLRedirectExperiment,
} from "back-end/src/services/features";
import { getFeatureDefinition } from "back-end/src/util/features";

// todo: SDKPayloadRawData and ConnectionPayloadOptions are feature-branch types not yet on main;
// these local definitions mirror the feature branch — remove after bryce/single-pass-payload-generation merges
type SDKPayloadRawData = {
  features: FeatureInterface[];
  experimentMap: Map<string, ExperimentInterface>;
  groupMap: GroupMap;
  safeRolloutMap: Map<string, SafeRolloutInterface>;
  savedGroups: SavedGroupInterface[];
  holdoutsMap: Map<
    string,
    { holdout: HoldoutInterface; experiment: ExperimentInterface }
  >;
  visualExperiments?: VisualExperiment[];
  urlRedirectExperiments?: URLRedirectExperiment[];
};
type ConnectionPayloadOptions = {
  capabilities: SDKCapability[];
  environment: string;
  projects: string[] | null;
  includeRuleIds?: boolean;
  includeExperimentNames?: boolean;
  encryptPayload?: boolean;
  encryptionKey?: string;
  savedGroupReferencesEnabled?: boolean;
  hashSecureAttributes?: boolean;
  includeVisualExperiments?: boolean;
  includeDraftExperiments?: boolean;
  includeRedirectExperiments?: boolean;
};

// todo: shim for buildSDKPayloadForConnection — not yet on main; chains generateFeaturesPayload +
// generateAutoExperimentsPayload + getFeatureDefinitionsResponse to produce equivalent output.
// Remove after bryce/single-pass-payload-generation merges.
async function buildSDKPayloadForConnectionShim({
  context,
  connection,
  data,
}: {
  context: ApiReqContext;
  connection: ConnectionPayloadOptions;
  data: SDKPayloadRawData;
}) {
  if (connection.projects === null) {
    return {
      features: {} as Record<string, FeatureDefinition>,
      experiments: [] as unknown[],
      dateUpdated: new Date(),
    };
  }

  const features = generateFeaturesPayload({
    features: data.features,
    environment: connection.environment,
    groupMap: data.groupMap,
    experimentMap: data.experimentMap,
    safeRolloutMap: data.safeRolloutMap,
    holdoutsMap: data.holdoutsMap,
  }) as Record<string, FeatureDefinitionWithProject>;

  const experiments = generateAutoExperimentsPayload({
    visualExperiments: data.visualExperiments ?? [],
    urlRedirectExperiments: data.urlRedirectExperiments ?? [],
    groupMap: data.groupMap,
    features: data.features,
    environment: connection.environment,
  });

  return getFeatureDefinitionsResponse({
    features,
    experiments,
    holdouts: {},
    projects: connection.projects,
    dateUpdated: new Date(),
    encryptionKey: connection.encryptPayload
      ? connection.encryptionKey
      : undefined,
    includeVisualExperiments: connection.includeVisualExperiments,
    includeDraftExperiments: connection.includeDraftExperiments,
    includeExperimentNames: connection.includeExperimentNames,
    includeRedirectExperiments: connection.includeRedirectExperiments,
    includeRuleIds: connection.includeRuleIds,
    savedGroupReferencesEnabled: connection.savedGroupReferencesEnabled,
    capabilities: connection.capabilities,
    usedSavedGroups: data.savedGroups,
    organization: context.org as OrganizationInterface,
  });
}

function minimalContext(
  orgOverrides?: Partial<OrganizationInterface>,
): ApiReqContext {
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

function minimalRawData(
  overrides?: Partial<SDKPayloadRawData>,
): SDKPayloadRawData {
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

// Unique fingerprints for f1 so rule detection is deterministic (no ambiguous structural match).
const EXP1_FINGERPRINT = 0.31337;
const F1_FINGERPRINT = "This is our rollout rule";

// Canonical data: f1 (p1) has experiment-ref rule + force rule with $inGroup; f2 (p2); exp1; saved group sg1
function basicMatrixData(): SDKPayloadRawData {
  const exp: ExperimentInterface = {
    id: "exp1",
    organization: "org-1",
    project: "p1",
    name: "Matrix Exp",
    hypothesis: "",
    status: "running",
    hashVersion: 2,
    phases: [
      {
        phase: "main",
        coverage: 1,
        variationWeights: [EXP1_FINGERPRINT, 1 - EXP1_FINGERPRINT],
        seed: "matrix-exp-seed",
      },
    ],
    variations: [
      { id: "v0", key: "0", name: "Control" },
      { id: "v1", key: "1", name: "Treatment" },
    ],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    trackingKey: "tk",
    archived: false,
    hasVisualChangesets: true, // required so includeExperimentInPayload(exp) is true and experiment-ref rule is included
  } as ExperimentInterface;
  const f1: FeatureInterface = {
    id: "f1",
    project: "p1",
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
            id: "rule-matrix",
            enabled: true,
            experimentId: "exp1",
            variations: [
              { variationId: "v0", value: "v0", key: "0", name: "Control" },
              { variationId: "v1", value: "v1", key: "1", name: "Treatment" },
            ],
          },
          {
            type: "force",
            id: "r1",
            enabled: true,
            value: false,
            condition: `{"browser":"${F1_FINGERPRINT}","id":{"$inGroup":"sg1"}}`,
          },
        ],
      },
    },
  } as FeatureInterface;
  const f2: FeatureInterface = {
    ...cloneDeep(f1),
    id: "f2",
    project: "p2",
    environmentSettings: {
      production: { enabled: true, rules: [] },
    },
  } as FeatureInterface;
  const sg1: SavedGroupInterface = {
    id: "sg1",
    organization: "org-1",
    groupName: "G1",
    type: "list",
    values: ["a", "b"],
    attributeKey: "x",
  } as SavedGroupInterface;
  const groupMap: GroupMap = new Map([
    [
      "sg1",
      {
        id: "sg1",
        type: "list",
        attributeKey: "x",
        useEmptyListGroup: false,
        values: ["a", "b"],
      },
    ],
  ]);
  return minimalRawData({
    features: [f1, f2],
    experimentMap: new Map([["exp1", exp]]),
    savedGroups: [sg1],
    groupMap,
  });
}

// Connection presets: capabilities from JS SDK versions (everything = undefined = default/latest) + legacy; optional flags true/false/undefined; projects null | [] | ["p1"]
const ENCRYPTION_KEY = "test-key-32-bytes-long!!!!!!!!";

const CONNECTION_PRESETS: Array<{
  name: string;
  connection: ConnectionPayloadOptions;
}> = [];

// Capability sets from javascript.json: everything (undefined), 0.0.0, 0.23.0, 0.34.0, 1.1.0, 0.36.0, 1.6.5, legacy
const CAPABILITY_SETS: Array<{ label: string; capabilities: string[] }> = [
  {
    label: "javascript default (everything)",
    capabilities: getSDKCapabilities("javascript"),
  },
  {
    label: "javascript 0.0.0 (looseUnmarshalling)",
    capabilities: getSDKCapabilities("javascript", "0.0.0"),
  },
  {
    label: "javascript 0.23.0 (+ bucketingV2)",
    capabilities: getSDKCapabilities("javascript", "0.23.0"),
  },
  {
    label: "javascript 0.34.0 (+ prerequisites)",
    capabilities: getSDKCapabilities("javascript", "0.34.0"),
  },
  {
    label: "javascript 1.1.0 (+ savedGroupReferences)",
    capabilities: getSDKCapabilities("javascript", "1.1.0"),
  },
  {
    label: "javascript 0.36.0 (+ redirects)",
    capabilities: getSDKCapabilities("javascript", "0.36.0"),
  },
  {
    label: "javascript 1.6.5 (latest)",
    capabilities: getSDKCapabilities("javascript", "1.6.5"),
  },
  { label: "legacy API key (bucketingV2 only)", capabilities: ["bucketingV2"] },
];

for (const { label, capabilities } of CAPABILITY_SETS) {
  CONNECTION_PRESETS.push({
    name: `${label}, projects [], optional flags false`,
    connection: {
      capabilities: capabilities as ConnectionPayloadOptions["capabilities"],
      environment: "production",
      projects: [],
      encryptPayload: false,
      encryptionKey: "",
      includeVisualExperiments: false,
      includeDraftExperiments: false,
      includeExperimentNames: false,
      includeRedirectExperiments: false,
      includeRuleIds: false,
      hashSecureAttributes: false,
      savedGroupReferencesEnabled: false,
    },
  });
  CONNECTION_PRESETS.push({
    name: `${label}, projects null (empty payload)`,
    connection: {
      capabilities: capabilities as ConnectionPayloadOptions["capabilities"],
      environment: "production",
      projects: null,
    },
  });
  CONNECTION_PRESETS.push({
    name: `${label}, projects ["p1"], includeRuleIds true, includeExperimentNames true`,
    connection: {
      capabilities: capabilities as ConnectionPayloadOptions["capabilities"],
      environment: "production",
      projects: ["p1"],
      encryptPayload: false,
      includeRuleIds: true,
      includeExperimentNames: true,
      includeVisualExperiments: false,
      includeDraftExperiments: false,
      includeRedirectExperiments: false,
      savedGroupReferencesEnabled: capabilities.includes(
        "savedGroupReferences",
      ),
    },
  });
}

// Optional flags: true / false / undefined (omitted) – add a few more presets for full coverage
CONNECTION_PRESETS.push({
  name: "bucketingV2, encryptPayload true, encryptionKey set",
  connection: {
    capabilities: ["bucketingV2"],
    environment: "production",
    projects: [],
    encryptPayload: true,
    encryptionKey: ENCRYPTION_KEY,
    includeRuleIds: false,
    includeExperimentNames: false,
  },
});

CONNECTION_PRESETS.push({
  name: "savedGroupReferences + savedGroupReferencesEnabled true",
  connection: {
    capabilities: ["savedGroupReferences", "bucketingV2"],
    environment: "production",
    projects: ["p1"],
    savedGroupReferencesEnabled: true,
    includeRuleIds: false,
    includeExperimentNames: false,
  },
});

CONNECTION_PRESETS.push({
  name: "savedGroupReferences + savedGroupReferencesEnabled false (expand $inGroup)",
  connection: {
    capabilities: ["looseUnmarshalling", "bucketingV2"],
    environment: "production",
    projects: ["p1"],
    savedGroupReferencesEnabled: false,
  },
});

CONNECTION_PRESETS.push({
  name: "hashSecureAttributes true",
  connection: {
    capabilities: ["bucketingV2"],
    environment: "production",
    projects: [],
    hashSecureAttributes: true,
  },
});

CONNECTION_PRESETS.push({
  name: "hashSecureAttributes false",
  connection: {
    capabilities: ["bucketingV2"],
    environment: "production",
    projects: [],
    hashSecureAttributes: false,
  },
});

CONNECTION_PRESETS.push({
  name: "includeVisualExperiments true",
  connection: {
    capabilities: ["bucketingV2"],
    environment: "production",
    projects: [],
    includeVisualExperiments: true,
  },
});

CONNECTION_PRESETS.push({
  name: "includeDraftExperiments true",
  connection: {
    capabilities: ["bucketingV2"],
    environment: "production",
    projects: [],
    includeDraftExperiments: true,
  },
});

CONNECTION_PRESETS.push({
  name: "includeDraftExperiments false",
  connection: {
    capabilities: ["bucketingV2"],
    environment: "production",
    projects: [],
    includeDraftExperiments: false,
  },
});

CONNECTION_PRESETS.push({
  name: "includeRedirectExperiments true with redirects capability",
  connection: {
    capabilities: ["bucketingV2", "redirects"],
    environment: "production",
    projects: [],
    includeRedirectExperiments: true,
  },
});

describe("SDK payload generation (exhaustive connection matrix)", () => {
  it.each(CONNECTION_PRESETS)(
    "builds valid payload and asserts shape/rule/savedGroup: $name",
    async ({ connection }) => {
      const ctx = minimalContext();
      const data = basicMatrixData();
      // todo: using shim for buildSDKPayloadForConnection — remove after bryce/single-pass-payload-generation merges
      const out = await buildSDKPayloadForConnectionShim({
        context: ctx,
        connection,
        data,
      });

      expect(out.dateUpdated).toBeInstanceOf(Date);

      if (connection.projects === null) {
        expect(out.features).toEqual({});
        expect(out.experiments).toEqual([]);
        return;
      }

      if (connection.encryptPayload && connection.encryptionKey) {
        expect(out.encryptedFeatures).toBeDefined();
        expect(Object.keys(out.features)).toHaveLength(0);
        return;
      }

      const hasBucketingV2 = connection.capabilities.includes("bucketingV2");
      // When looseUnmarshalling is present, payload generation does not strip keys (allowedKeys = null), so we get full rule shape.
      const hasFullRuleShape =
        hasBucketingV2 ||
        connection.capabilities.includes("looseUnmarshalling");
      const hasSavedGroupRefs =
        connection.capabilities.includes("savedGroupReferences") &&
        connection.savedGroupReferencesEnabled === true;

      if (
        connection.projects &&
        connection.projects.length > 0 &&
        connection.projects[0] === "p1"
      ) {
        expect(Object.keys(out.features)).toContain("f1");
        expect(Object.keys(out.features)).not.toContain("f2");
      } else {
        expect(Object.keys(out.features)).toContain("f1");
        expect(Object.keys(out.features)).toContain("f2");
      }

      const f1Def = out.features.f1;
      if (!f1Def?.rules?.length) return;

      const rules = f1Def.rules as Record<string, unknown>[];
      // Deterministic lookup: by id when present, else by unique fingerprint only (so holdout/other rules cannot be mistaken).
      const expRefRule = rules.find(
        (r) =>
          r.id === "rule-matrix" ||
          (Array.isArray(r.weights) && r.weights[0] === EXP1_FINGERPRINT),
      );
      const forceRule = rules.find(
        (r) =>
          r.id === "r1" ||
          (r.condition as Record<string, unknown>)?.browser === F1_FINGERPRINT,
      );

      if (!expRefRule) {
        throw new Error(
          `Canonical data has one experiment-ref rule; payload should include it. Got ${rules.length} rule(s): ${JSON.stringify(rules.map((r) => Object.keys(r)))}`,
        );
      }
      if (!forceRule) {
        throw new Error(
          `Canonical data has one force rule ($inGroup sg1); payload should include it. Got ${rules.length} rule(s): ${JSON.stringify(rules.map((r) => Object.keys(r)))}`,
        );
      }

      {
        if (hasFullRuleShape) {
          expect(expRefRule).toHaveProperty("hashVersion");
          expect(expRefRule).toHaveProperty("seed");
          expect(expRefRule).toHaveProperty("meta");
          expect(expRefRule).toHaveProperty("phase");
        } else {
          expect(expRefRule).toHaveProperty("hashAttribute");
          expect(expRefRule).toHaveProperty("namespace");
          expect(expRefRule).not.toHaveProperty("hashVersion");
          expect(expRefRule).not.toHaveProperty("seed");
          expect(expRefRule).not.toHaveProperty("meta");
          expect(expRefRule).not.toHaveProperty("name");
        }

        // todo: on main, scrubFeatures strips rule id via pick() for non-looseUnmarshalling; the feature
        // branch adds id to allowedFeatureRuleKeys when includeRuleIds: true for all capabilities.
        // This gate still fires for every real SDK connection preset: all getSDKCapabilities() results
        // include looseUnmarshalling. The only excluded case is the hand-crafted "legacy API key
        // (bucketingV2 only)" preset (capabilities: ["bucketingV2"]), which wouldn't have
        // includeRuleIds set in practice. Remove looseUnmarshalling check after
        // bryce/single-pass-payload-generation merges.
        if (
          connection.includeRuleIds === true &&
          connection.capabilities.includes("looseUnmarshalling")
        ) {
          expect(expRefRule.id).toBe("rule-matrix");
        }
        if (connection.includeExperimentNames === true && hasFullRuleShape) {
          expect(expRefRule.name).toBe("Matrix Exp");
        }
        if (
          connection.includeRuleIds === false ||
          connection.includeExperimentNames === false
        ) {
          if (connection.includeRuleIds === false)
            expect(expRefRule.id).toBeUndefined();
          if (connection.includeExperimentNames === false)
            expect(expRefRule.name).toBeUndefined();
        }
      }

      const cond = forceRule.condition as Record<string, unknown>;
      if (hasSavedGroupRefs) {
        expect(cond).toHaveProperty("id");
        expect((cond.id as Record<string, unknown>).$inGroup).toBe("sg1");
        expect(out.savedGroups).toHaveProperty("sg1");
      } else {
        expect(cond).toHaveProperty("id");
        expect((cond.id as Record<string, unknown>).$in).toEqual(["a", "b"]);
      }
    },
  );
});

describe("SDK payload generation (scenario-specific)", () => {
  // todo: buildSDKPayloadForConnection not yet on main; unskip after bryce/single-pass-payload-generation merges
  it.skip("holdout definitions merged when prerequisites capability", async () => {
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
      environmentSettings: {
        production: { enabled: true, rules: [] },
      },
    } as HoldoutInterface;
    const holdoutExperiment: ExperimentInterface = {
      id: "exp1",
      organization: "org-1",
      project: "",
      name: "Holdout Exp",
      hypothesis: "",
      status: "running",
      phases: [{ phase: "main", coverage: 0.9, variationWeights: [0.5, 0.5] }],
      variations: [
        { id: "v0", key: "0", name: "C" },
        { id: "v1", key: "1", name: "T" },
      ],
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
      capabilities: ["bucketingV2", "prerequisites"],
      environment: "production",
      projects: [],
    };
    const data = minimalRawData({
      features: [featureRefHoldout],
      holdoutsMap,
      experimentMap: new Map([["exp1", holdoutExperiment]]),
    });
    const out = await buildSDKPayloadForConnection({
      context: ctx,
      connection,
      data,
    });
    expect(out.features.f1).toBeDefined();
    expect(out.features.f1?.rules?.length).toBeGreaterThanOrEqual(1);
    expect(out.dateUpdated).toBeDefined();
  });

  // todo: parentConditions stripping in getFeatureDefinition not yet on main; unskip after bryce/single-pass-payload-generation merges
  it.skip("prerequisites capability includes parentConditions; without strips them", () => {
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
              parentConditions: [
                { id: "parent", condition: '{"value": true}' },
              ],
            },
          ],
        },
      },
    } as FeatureInterface;
    const withPrereqs = getFeatureDefinition({
      feature,
      environment: "production",
      groupMap: new Map(),
      experimentMap: new Map(),
      safeRolloutMap: new Map(),
      capabilities: ["prerequisites", "bucketingV2"],
      includeRuleIds: true,
      includeExperimentNames: false,
    });
    expect(withPrereqs.rules?.[0]).toHaveProperty("parentConditions");

    const withoutPrereqs = getFeatureDefinition({
      feature,
      environment: "production",
      groupMap: new Map(),
      experimentMap: new Map(),
      safeRolloutMap: new Map(),
      capabilities: ["bucketingV2"],
      includeRuleIds: false,
      includeExperimentNames: false,
    });
    expect(
      (withoutPrereqs.rules?.[0] as Record<string, unknown>).parentConditions,
    ).toBeUndefined();
  });

  // todo: includeRuleIds id-stripping in getFeatureDefinition not yet on main; unskip after bryce/single-pass-payload-generation merges
  it.skip("includeRuleIds controls holdout rule id", () => {
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
      environmentSettings: {
        production: { enabled: true, rules: [] },
      },
    } as HoldoutInterface;
    const holdoutExperiment: ExperimentInterface = {
      id: "exp1",
      organization: "org-1",
      project: "",
      name: "Holdout Exp",
      hypothesis: "",
      status: "running",
      phases: [{ phase: "main", coverage: 0.9, variationWeights: [0.5, 0.5] }],
      variations: [
        { id: "v0", key: "0", name: "C" },
        { id: "v1", key: "1", name: "T" },
      ],
      dateCreated: new Date(),
      dateUpdated: new Date(),
      trackingKey: "tk",
      archived: false,
    } as ExperimentInterface;
    const holdoutsMap = new Map([
      ["holdout-1", { holdout, holdoutExperiment }],
    ]);
    const featureWithHoldout: FeatureInterface = {
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
      holdout: { id: "holdout-1" } as HoldoutInterface,
      environmentSettings: {
        production: { enabled: true, rules: [] },
      },
    } as FeatureInterface;
    const withId = getFeatureDefinition({
      feature: featureWithHoldout,
      environment: "production",
      groupMap: new Map(),
      experimentMap: new Map(),
      safeRolloutMap: new Map(),
      holdoutsMap,
      capabilities: ["prerequisites"],
      includeRuleIds: true,
    });
    const withoutId = getFeatureDefinition({
      feature: featureWithHoldout,
      environment: "production",
      groupMap: new Map(),
      experimentMap: new Map(),
      safeRolloutMap: new Map(),
      holdoutsMap,
      capabilities: ["prerequisites"],
      includeRuleIds: false,
    });
    expect(withId?.rules?.[0]).toBeDefined();
    expect((withId?.rules?.[0] as Record<string, unknown>).id).toMatch(
      /^holdout_/,
    );
    expect(withoutId?.rules?.[0]).toBeDefined();
    expect(
      (withoutId?.rules?.[0] as Record<string, unknown>).id,
    ).toBeUndefined();
  });

  // todo: includeRuleIds id-stripping in getFeatureDefinition not yet on main; unskip after bryce/single-pass-payload-generation merges
  it.skip("includeRuleIds controls inline experiment rule id", () => {
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
              type: "experiment",
              id: "inline-rule-id",
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
    const withId = getFeatureDefinition({
      feature,
      environment: "production",
      groupMap: new Map(),
      experimentMap: new Map(),
      safeRolloutMap: new Map(),
      capabilities: undefined,
      includeRuleIds: true,
    });
    const withoutId = getFeatureDefinition({
      feature,
      environment: "production",
      groupMap: new Map(),
      experimentMap: new Map(),
      safeRolloutMap: new Map(),
      capabilities: undefined,
      includeRuleIds: false,
    });
    expect((withId?.rules?.[0] as Record<string, unknown>).id).toBe(
      "inline-rule-id",
    );
    expect(
      (withoutId?.rules?.[0] as Record<string, unknown>).id,
    ).toBeUndefined();
  });

  it("encryptPayload true with encryptionKey produces encryptedFeatures", async () => {
    const ctx = minimalContext();
    const out = await getFeatureDefinitionsResponse({
      features: { f1: { defaultValue: "x", rules: [] } },
      experiments: [],
      holdouts: {},
      dateUpdated: new Date(),
      encryptPayload: true,
      encryptionKey: ENCRYPTION_KEY,
      capabilities: [],
      usedSavedGroups: [],
      organization: ctx.org as OrganizationInterface,
    });
    expect(out.encryptedFeatures).toBeDefined();
    expect(out.features).toEqual({});
  });

  // todo: encryptPayload boolean param not on main (encryption is key-presence-driven); unskip after bryce/single-pass-payload-generation merges
  it("encryptPayload false returns plain features", async () => {
    const ctx = minimalContext();
    // todo: encryptPayload param doesn't exist on main; on main, omitting encryptionKey is equivalent
    // to encryptPayload: false — remove comment after bryce/single-pass-payload-generation merges
    const out = await getFeatureDefinitionsResponse({
      features: { f1: { defaultValue: "x", rules: [] } },
      experiments: [],
      holdouts: {},
      dateUpdated: new Date(),
      capabilities: [],
      projects: [],
      usedSavedGroups: [],
      organization: ctx.org as OrganizationInterface,
    });
    expect(out.encryptedFeatures).toBeUndefined();
    expect(out.features).toEqual({ f1: { defaultValue: "x", rules: [] } });
  });

  it("hashSecureAttributes with attributeSchema and salt hashes secure attributes", async () => {
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
      holdouts: {},
      dateUpdated: new Date(),
      capabilities: ["looseUnmarshalling"],
      usedSavedGroups: [],
      organization: minimalContext().org as OrganizationInterface,
      attributes: [{ property: "secret", datatype: "secureString" as const }],
      secureAttributeSalt: "salt",
    });
    const cond = (
      out.features.f1.rules?.[0] as { condition: Record<string, unknown> }
    ).condition;
    expect(cond).toHaveProperty("secret");
    expect(cond.secret).not.toBe("plain");
  });

  it("safe rollout running becomes experiment rule; rolled-back becomes force rule", () => {
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
      groupMap: new Map(),
      experimentMap: new Map(),
      safeRolloutMap,
      capabilities: ["bucketingV2"],
      includeRuleIds: false,
      includeExperimentNames: false,
    });
    expect(running.rules?.[0]).toHaveProperty("variations");
    expect((running.rules?.[0] as Record<string, unknown>).force).not.toBe(
      true,
    );

    const rolledBackMap = new Map([
      [
        "sr1",
        { ...safeRollout, status: "rolled-back" } as SafeRolloutInterface,
      ],
    ]);
    const rule0 = featureWithRunning.environmentSettings?.production
      ?.rules?.[0] as Record<string, unknown> | undefined;
    const featureRolledBack = {
      ...cloneDeep(featureWithRunning),
      environmentSettings: {
        production: {
          enabled: true,
          rules: [
            rule0
              ? { ...rule0, status: "rolled-back" }
              : { type: "safe-rollout", status: "rolled-back" },
          ],
        },
      },
    } as FeatureInterface;
    const rolledBack = getFeatureDefinition({
      feature: featureRolledBack,
      environment: "production",
      groupMap: new Map(),
      experimentMap: new Map(),
      safeRolloutMap: rolledBackMap,
      capabilities: ["bucketingV2"],
      includeRuleIds: false,
      includeExperimentNames: false,
    });
    expect((rolledBack.rules?.[0] as Record<string, unknown>).force).toBe(
      false,
    );
  });

  describe("prerequisites, holdouts, and experiments permutations", () => {
    // 2×2 matrix: (prerequisites capability: yes/no) × (deterministic parent: yes/no)
    // Each case covers both top-level (feature.prerequisites → gating force rule) and
    // rule-based (rule.prerequisites → parentConditions on rule) prerequisite types.
    //
    // Deterministic parent: always-true (no rules, defaultValue: true). Server-side
    // reduceFeaturesWithPrerequisites strips these before getFeatureDefinition runs,
    // so parentConditions are never set regardless of SDK capabilities.
    //
    // Non-deterministic (Schrödinger) parent: has an active experiment rule, so its
    // value is uncertain at eval time. Server keeps these; scrubFeatures then acts on them
    // based on the prerequisites capability:
    //   - With prerequisites: parentConditions preserved for SDK to evaluate
    //   - Without prerequisites: top-level gating rules → feature deleted; rule-level → rules filtered out
    //
    // todo: using shim for buildSDKPayloadForConnection — remove after bryce/single-pass-payload-generation merges

    // Shared feature factories for the 4 prerequisite permutation tests
    function makeParentDeterministic(): FeatureInterface {
      return {
        id: "parent-det",
        project: "p1",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        defaultValue: "true",
        organization: "org-1",
        owner: "",
        valueType: "boolean",
        archived: false,
        description: "",
        version: 1,
        environmentSettings: { production: { enabled: true, rules: [] } },
      } as FeatureInterface;
    }

    function makeParentConditional(): FeatureInterface {
      return {
        id: "parent-cond",
        project: "p1",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        defaultValue: "true",
        organization: "org-1",
        owner: "",
        valueType: "boolean",
        archived: false,
        description: "",
        version: 1,
        environmentSettings: {
          production: {
            enabled: true,
            // Experiment rule makes this non-deterministic: value varies across users
            rules: [
              {
                type: "experiment",
                id: "parent-exp",
                enabled: true,
                coverage: 1,
                values: [
                  { value: "false", weight: 0.5 },
                  { value: "true", weight: 0.5 },
                ],
                hashAttribute: "id",
              },
            ],
          },
        },
      } as FeatureInterface;
    }

    // child-top: only has feature-level prerequisites (tests gating force rule creation)
    function makeChildTopLevel(parentId: string): FeatureInterface {
      return {
        id: "child-top",
        project: "p1",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        defaultValue: "false",
        organization: "org-1",
        owner: "",
        valueType: "boolean",
        archived: false,
        description: "",
        version: 1,
        prerequisites: [{ id: parentId, condition: '{"value": true}' }],
        environmentSettings: { production: { enabled: true, rules: [] } },
      } as FeatureInterface;
    }

    // child-rule: only has rule-level prerequisites (tests parentConditions on existing rule)
    function makeChildRuleLevel(parentId: string): FeatureInterface {
      return {
        id: "child-rule",
        project: "p1",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        defaultValue: "false",
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
                  { value: "false", weight: 0.5, name: "C" },
                  { value: "true", weight: 0.5, name: "T" },
                ],
                hashAttribute: "id",
                seed: "s1",
                prerequisites: [{ id: parentId, condition: '{"value": true}' }],
              },
            ],
          },
        },
      } as FeatureInterface;
    }

    it("deterministic prereqs + prerequisites capability: server reduces always-true prereqs, no parentConditions in payload", async () => {
      const parent = makeParentDeterministic();
      const childTop = makeChildTopLevel("parent-det");
      const childRule = makeChildRuleLevel("parent-det");
      const data = minimalRawData({
        features: [parent, childTop, childRule],
        experimentMap: new Map(),
      });

      const result = await buildSDKPayloadForConnectionShim({
        context: minimalContext(),
        connection: {
          capabilities: ["prerequisites", "bucketingV2"],
          environment: "production",
          projects: [],
        },
        data,
      });

      // Server stripped the always-true prerequisite; getFeatureDefinition never created a gating force rule.
      // getFeatureDefinition deletes the rules key when the array is empty, so rules is undefined.
      expect(result.features["child-top"]).toBeDefined();
      expect(result.features["child-top"]?.rules).toBeUndefined();

      // Rule-level prereq was also stripped server-side; no parentConditions on the experiment rule
      expect(result.features["child-rule"]).toBeDefined();
      expect(result.features["child-rule"]?.rules).toHaveLength(1);
      expect(
        (result.features["child-rule"]?.rules?.[0] as Record<string, unknown>)
          ?.parentConditions,
      ).toBeUndefined();
    });

    it("deterministic prereqs + no prerequisites capability: server reduces always-true prereqs, same result as with capability", async () => {
      const parent = makeParentDeterministic();
      const childTop = makeChildTopLevel("parent-det");
      const childRule = makeChildRuleLevel("parent-det");
      const data = minimalRawData({
        features: [parent, childTop, childRule],
        experimentMap: new Map(),
      });

      const result = await buildSDKPayloadForConnectionShim({
        context: minimalContext(),
        connection: {
          capabilities: ["bucketingV2"],
          environment: "production",
          projects: [],
        },
        data,
      });

      // Server-side reduction runs before scrubFeatures; capability setting is irrelevant for deterministic prereqs
      expect(result.features["child-top"]).toBeDefined();
      expect(result.features["child-top"]?.rules).toBeUndefined();

      expect(result.features["child-rule"]).toBeDefined();
      expect(result.features["child-rule"]?.rules).toHaveLength(1);
      expect(
        (result.features["child-rule"]?.rules?.[0] as Record<string, unknown>)
          ?.parentConditions,
      ).toBeUndefined();
    });

    it("non-deterministic prereqs + prerequisites capability: parentConditions preserved for SDK evaluation", async () => {
      const parent = makeParentConditional();
      const childTop = makeChildTopLevel("parent-cond");
      const childRule = makeChildRuleLevel("parent-cond");
      const data = minimalRawData({
        features: [parent, childTop, childRule],
        experimentMap: new Map(),
      });

      const result = await buildSDKPayloadForConnectionShim({
        context: minimalContext(),
        connection: {
          capabilities: ["prerequisites", "bucketingV2"],
          environment: "production",
          projects: [],
        },
        data,
      });

      // Top-level: feature.prerequisites → gating force rule with parentConditions.gate = true
      expect(result.features["child-top"]).toBeDefined();
      expect(result.features["child-top"]?.rules).toHaveLength(1);
      const topLevelRule = result.features["child-top"]?.rules?.[0] as Record<
        string,
        unknown
      >;
      expect(topLevelRule?.parentConditions).toBeDefined();
      expect(
        (topLevelRule?.parentConditions as Record<string, unknown>[])?.[0]
          ?.gate,
      ).toBe(true);

      // Rule-level: experiment rule has parentConditions (no gate flag)
      expect(result.features["child-rule"]).toBeDefined();
      expect(result.features["child-rule"]?.rules).toHaveLength(1);
      const ruleBasedRule = result.features["child-rule"]?.rules?.[0] as Record<
        string,
        unknown
      >;
      expect(ruleBasedRule?.parentConditions).toBeDefined();
      expect(
        (ruleBasedRule?.parentConditions as Record<string, unknown>[])?.[0]
          ?.gate,
      ).toBeUndefined();
    });

    it("non-deterministic prereqs + no prerequisites capability: top-level feature deleted, rule-level rules filtered out", async () => {
      const parent = makeParentConditional();
      const childTop = makeChildTopLevel("parent-cond");
      const childRule = makeChildRuleLevel("parent-cond");
      const data = minimalRawData({
        features: [parent, childTop, childRule],
        experimentMap: new Map(),
      });

      const withoutPrereqs = await buildSDKPayloadForConnectionShim({
        context: minimalContext(),
        connection: {
          capabilities: ["bucketingV2"],
          environment: "production",
          projects: [],
        },
        data,
      });

      // Top-level: gating force rule (gate: true) → scrubFeatures deletes the entire feature
      expect(withoutPrereqs.features["child-top"]).toBeUndefined();

      // Rule-level: parentConditions on rule (no gate) → scrubFeatures filters out the rule; feature stays
      expect(withoutPrereqs.features["child-rule"]).toBeDefined();
      expect(withoutPrereqs.features["child-rule"]?.rules).toHaveLength(0);

      // looseUnmarshalling does NOT preserve parentConditions when prerequisites capability is absent:
      // scrubFeatures strips/deletes at lines 103-119, before the looseUnmarshalling early-return at 121-123
      const withLooseUnmarshalling = await buildSDKPayloadForConnectionShim({
        context: minimalContext(),
        connection: {
          capabilities: ["bucketingV2", "looseUnmarshalling"],
          environment: "production",
          projects: [],
        },
        data,
      });
      expect(withLooseUnmarshalling.features["child-top"]).toBeUndefined();
      expect(withLooseUnmarshalling.features["child-rule"]?.rules).toHaveLength(
        0,
      );
    });

    it("prerequisites + project scoping: child in p1, parent in p2; connection [p1] only excludes parent feature", async () => {
      const parent: FeatureInterface = {
        id: "parent",
        project: "p2",
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
          production: { enabled: true, rules: [] },
        },
      } as FeatureInterface;
      const child: FeatureInterface = {
        ...cloneDeep(parent),
        id: "child",
        project: "p1",
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
                prerequisites: [{ id: "parent", condition: '{"value": true}' }],
              },
            ],
          },
        },
      } as FeatureInterface;
      const data = minimalRawData({
        features: [parent, child],
        experimentMap: new Map(),
      });
      // todo: using shim for buildSDKPayloadForConnection — remove after bryce/single-pass-payload-generation merges
      const outP1Only = await buildSDKPayloadForConnectionShim({
        context: minimalContext(),
        connection: {
          capabilities: ["prerequisites", "bucketingV2"],
          environment: "production",
          projects: ["p1"],
        },
        data,
      });
      expect(Object.keys(outP1Only.features)).toContain("child");
      expect(Object.keys(outP1Only.features)).not.toContain("parent");
      const outBoth = await buildSDKPayloadForConnectionShim({
        context: minimalContext(),
        connection: {
          capabilities: ["prerequisites", "bucketingV2"],
          environment: "production",
          projects: [],
        },
        data,
      });
      expect(Object.keys(outBoth.features)).toContain("child");
      expect(Object.keys(outBoth.features)).toContain("parent");
    });

    // todo: holdout injection into features map is new in feature branch; unskip after bryce/single-pass-payload-generation merges
    it.skip("holdouts + capabilities: holdout rule on feature only when prerequisites capability", async () => {
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
        environmentSettings: {
          production: { enabled: true, rules: [] },
        },
      } as HoldoutInterface;
      const holdoutExperiment: ExperimentInterface = {
        id: "exp1",
        organization: "org-1",
        project: "p1",
        name: "Holdout Exp",
        hypothesis: "",
        status: "running",
        phases: [
          { phase: "main", coverage: 0.9, variationWeights: [0.5, 0.5] },
        ],
        variations: [
          { id: "v0", key: "0", name: "C" },
          { id: "v1", key: "1", name: "T" },
        ],
        dateCreated: new Date(),
        dateUpdated: new Date(),
        trackingKey: "tk",
        archived: false,
      } as ExperimentInterface;
      const holdoutsMap = new Map([
        ["holdout-1", { holdout, holdoutExperiment }],
      ]);
      const featureWithHoldout: FeatureInterface = {
        id: "f1",
        project: "p1",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        defaultValue: true,
        organization: "org-1",
        owner: "",
        valueType: "boolean",
        archived: false,
        description: "",
        version: 1,
        holdout: { id: "holdout-1" } as HoldoutInterface,
        environmentSettings: {
          production: { enabled: true, rules: [] },
        },
      } as FeatureInterface;
      const data = minimalRawData({
        features: [featureWithHoldout],
        holdoutsMap,
        experimentMap: new Map([["exp1", holdoutExperiment]]),
      });
      const withPrereqs = await buildSDKPayloadForConnection({
        context: minimalContext(),
        connection: {
          capabilities: ["prerequisites", "bucketingV2"],
          environment: "production",
          projects: ["p1"],
        },
        data,
      });
      expect(withPrereqs.features.f1?.rules?.length).toBeGreaterThanOrEqual(1);
      expect(
        (withPrereqs.features.f1?.rules?.[0] as Record<string, unknown>)
          ?.parentConditions,
      ).toBeDefined();

      const withoutPrereqs = await buildSDKPayloadForConnection({
        context: minimalContext(),
        connection: {
          capabilities: ["bucketingV2"],
          environment: "production",
          projects: ["p1"],
        },
        data,
      });
      expect(withoutPrereqs.features.f1?.rules?.length).toBe(0);
    });

    // todo: holdout injection into features map is new in feature branch; unskip after bryce/single-pass-payload-generation merges
    it.skip("holdouts + project scoping: holdout with projects [p1] included for connection [p1], excluded for [p2]", async () => {
      const holdout: HoldoutInterface = {
        id: "holdout-1",
        organization: "org-1",
        name: "H1",
        description: "",
        environment: "production",
        projects: ["p1"],
        experimentId: "exp1",
        holdoutPercent: 0.1,
        dateCreated: new Date(),
        dateUpdated: new Date(),
        environmentSettings: {
          production: { enabled: true, rules: [] },
        },
      } as HoldoutInterface;
      const holdoutExperiment: ExperimentInterface = {
        id: "exp1",
        organization: "org-1",
        project: "p1",
        name: "Holdout Exp",
        hypothesis: "",
        status: "running",
        phases: [
          { phase: "main", coverage: 0.9, variationWeights: [0.5, 0.5] },
        ],
        variations: [
          { id: "v0", key: "0", name: "C" },
          { id: "v1", key: "1", name: "T" },
        ],
        dateCreated: new Date(),
        dateUpdated: new Date(),
        trackingKey: "tk",
        archived: false,
      } as ExperimentInterface;
      const holdoutsMap = new Map([
        ["holdout-1", { holdout, holdoutExperiment }],
      ]);
      const featureWithHoldout: FeatureInterface = {
        id: "f1",
        project: "p1",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        defaultValue: true,
        organization: "org-1",
        owner: "",
        valueType: "boolean",
        archived: false,
        description: "",
        version: 1,
        holdout: { id: "holdout-1" } as HoldoutInterface,
        environmentSettings: {
          production: { enabled: true, rules: [] },
        },
      } as FeatureInterface;
      const data = minimalRawData({
        features: [featureWithHoldout],
        holdoutsMap,
        experimentMap: new Map([["exp1", holdoutExperiment]]),
      });
      const outP1 = await buildSDKPayloadForConnection({
        context: minimalContext(),
        connection: {
          capabilities: ["prerequisites", "bucketingV2"],
          environment: "production",
          projects: ["p1"],
        },
        data,
      });
      const holdoutDefId = "$holdout:holdout-1";
      expect(outP1.features[holdoutDefId]).toBeDefined();
      expect(outP1.features.f1?.rules?.length).toBeGreaterThanOrEqual(1);

      const outP2 = await buildSDKPayloadForConnection({
        context: minimalContext(),
        connection: {
          capabilities: ["prerequisites", "bucketingV2"],
          environment: "production",
          projects: ["p2"],
        },
        data,
      });
      expect(outP2.features[holdoutDefId]).toBeUndefined();
      expect(Object.keys(outP2.features)).not.toContain(holdoutDefId);
    });

    it("experiments payload: only included when includeVisualExperiments or includeRedirectExperiments", async () => {
      const data = basicMatrixData();
      // todo: using shim for buildSDKPayloadForConnection — remove after bryce/single-pass-payload-generation merges
      const withVisual = await buildSDKPayloadForConnectionShim({
        context: minimalContext(),
        connection: {
          capabilities: getSDKCapabilities("javascript", "1.6.5"),
          environment: "production",
          projects: [],
          includeVisualExperiments: true,
          includeRedirectExperiments: false,
        },
        data,
      });
      const withoutEither = await buildSDKPayloadForConnectionShim({
        context: minimalContext(),
        connection: {
          capabilities: getSDKCapabilities("javascript", "1.6.5"),
          environment: "production",
          projects: [],
          includeVisualExperiments: false,
          includeRedirectExperiments: false,
        },
        data,
      });
      expect(withVisual.experiments).toBeDefined();
      expect(withoutEither.experiments).toBeUndefined();
    });

    it("experiments payload: project scoping filters which experiments are in payload", async () => {
      const expP1: ExperimentInterface = {
        id: "exp-p1",
        organization: "org-1",
        project: "p1",
        name: "Exp P1",
        hypothesis: "",
        status: "running",
        phases: [{ phase: "main", coverage: 1, variationWeights: [1] }],
        variations: [{ id: "v0", key: "0", name: "C" }],
        dateCreated: new Date(),
        dateUpdated: new Date(),
        trackingKey: "tk",
        archived: false,
        hasVisualChangesets: true,
      } as ExperimentInterface;
      const visualChangeset = {
        id: "vc1",
        organization: "org-1",
        experiment: "exp-p1",
        urlPatterns: [{ include: true, type: "simple" as const, pattern: "*" }],
        editorUrl: "",
        visualChanges: [
          {
            id: "vc1",
            description: "",
            css: "",
            variation: "v0",
            domMutations: [],
          },
        ],
      };
      const data = minimalRawData({
        features: [],
        experimentMap: new Map([["exp-p1", expP1]]),
        visualExperiments: [
          { type: "visual" as const, experiment: expP1, visualChangeset },
        ],
      });
      // todo: using shim for buildSDKPayloadForConnection — remove after bryce/single-pass-payload-generation merges
      const outP1 = await buildSDKPayloadForConnectionShim({
        context: minimalContext(),
        connection: {
          capabilities: ["bucketingV2"],
          environment: "production",
          projects: ["p1"],
          includeVisualExperiments: true,
        },
        data,
      });
      expect(outP1.experiments?.length).toBe(1);
      expect(outP1.experiments?.[0].key).toBe("tk");

      const outP2 = await buildSDKPayloadForConnectionShim({
        context: minimalContext(),
        connection: {
          capabilities: ["bucketingV2"],
          environment: "production",
          projects: ["p2"],
          includeVisualExperiments: true,
        },
        data,
      });
      expect(outP2.experiments?.length).toBe(0);
    });
  });

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
    // todo: on main, experiments are only included in the response when includeVisualExperiments or
    // includeRedirectExperiments is set; draftExperiment has no visual/redirect markers so it passes
    // through as "unknown" type — remove includeVisualExperiments after bryce/single-pass-payload-generation merges
    const outExcluded = await getFeatureDefinitionsResponse({
      features: { f1: cloneDeep(featureDef) },
      experiments: [cloneDeep(draftExperiment)],
      holdouts: {},
      dateUpdated: new Date(),
      includeDraftExperiments: false,
      includeVisualExperiments: true,
      capabilities: [],
      projects: [],
      usedSavedGroups: [],
      organization: ctx.org as OrganizationInterface,
    });
    expect(outExcluded.experiments).toEqual([]);

    const outIncluded = await getFeatureDefinitionsResponse({
      features: { f1: cloneDeep(featureDef) },
      experiments: [cloneDeep(draftExperiment)],
      holdouts: {},
      dateUpdated: new Date(),
      includeDraftExperiments: true,
      includeVisualExperiments: true,
      capabilities: [],
      projects: [],
      usedSavedGroups: [],
      organization: ctx.org as OrganizationInterface,
    });
    expect(outIncluded.experiments?.length).toBe(1);
  });
});
