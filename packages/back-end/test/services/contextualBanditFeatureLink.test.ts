import { ContextualBanditInterface } from "shared/validators";
import {
  ContextualBanditRefRule,
  FeatureInterface,
  FeatureRule,
} from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ReqContext } from "back-end/types/api";
import {
  linkFeatureToContextualBandit,
  unlinkFeatureFromContextualBandit,
} from "back-end/src/enterprise/services/contextualBandits";
import { getDraftRevision } from "back-end/src/services/features";
import { updateRevision } from "back-end/src/models/FeatureRevisionModel";

jest.mock("back-end/src/services/features", () => ({
  generateRuleId: jest.fn(() => "fr_new"),
  getDraftRevision: jest.fn(),
  assertCanAutoPublish: jest.fn(),
  getLiveAndBaseRevisionsForFeature: jest.fn(),
  queueSDKPayloadRefresh: jest.fn(),
}));

jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  getRevision: jest.fn(),
  updateRevision: jest.fn(),
}));

jest.mock("back-end/src/models/FeatureModel", () => ({
  publishRevision: jest.fn(),
}));

jest.mock("back-end/src/services/featureRevisionEvents", () => ({
  recordRevisionUpdate: jest.fn(),
}));

jest.mock("back-end/src/services/configValidation", () => ({
  assertConfigBackedFeatureValuesValid: jest.fn(),
}));

jest.mock("back-end/src/services/experiments", () => ({
  getRefLinkedFeatureInfo: jest.fn(),
}));

jest.mock("back-end/src/services/contextualBanditChanges", () => ({
  refreshLinkedFeaturePayloads: jest.fn(),
}));

jest.mock("back-end/src/services/contextualBanditSchedule", () => ({
  computeContextualBanditStageAndSchedule: jest.fn(),
}));

jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
}));

jest.mock("back-end/src/services/datasource", () => ({
  getSourceIntegrationObject: jest.fn(),
}));

jest.mock(
  "back-end/src/enterprise/queryRunners/ContextualBanditResultsQueryRunner",
  () => ({
    ContextualBanditResultsQueryRunner: jest.fn(),
  }),
);

const getDraftRevisionMock = getDraftRevision as jest.MockedFunction<
  typeof getDraftRevision
>;
const updateRevisionMock = updateRevision as jest.MockedFunction<
  typeof updateRevision
>;

const cbModel = {
  addLinkedFeature: jest.fn(),
  addPendingFeatureDraft: jest.fn(),
  removeLinkedFeature: jest.fn(),
  removePendingFeatureDraft: jest.fn(),
};

const audit = jest.fn();

function makeContext(): ReqContext {
  return {
    org: { id: "org_1", settings: {} },
    environments: ["production", "staging"],
    auditUser: { type: "dashboard" },
    permissions: {
      canUpdateFeature: jest.fn().mockReturnValue(true),
      canManageFeatureDrafts: jest.fn().mockReturnValue(true),
      canPublishFeature: jest.fn().mockReturnValue(true),
      canBypassApprovalChecks: jest.fn().mockReturnValue(false),
      throwPermissionError: jest.fn(() => {
        throw new Error("Permission denied");
      }),
    },
    models: { contextualBandits: cbModel },
  } as unknown as ReqContext;
}

function makeCb(
  overrides: Partial<ContextualBanditInterface> = {},
): ContextualBanditInterface {
  return {
    id: "cb_1",
    name: "CB 1",
    organization: "org_1",
    project: "",
    status: "draft",
    linkedFeatures: [],
    variations: [
      { id: "v0", name: "Control", key: "0", screenshots: [] },
      { id: "v1", name: "Treatment", key: "1", screenshots: [] },
    ],
    ...overrides,
  } as unknown as ContextualBanditInterface;
}

function makeFeature(
  overrides: Partial<FeatureInterface> = {},
): FeatureInterface {
  return {
    id: "feat_1",
    organization: "org_1",
    version: 3,
    valueType: "string",
    defaultValue: "off",
    environmentSettings: {
      production: { enabled: false },
      staging: { enabled: true },
    },
    rules: [],
    ...overrides,
  } as unknown as FeatureInterface;
}

function makeRevision(
  overrides: Partial<FeatureRevisionInterface> = {},
): FeatureRevisionInterface {
  return {
    organization: "org_1",
    featureId: "feat_1",
    version: 4,
    baseVersion: 3,
    status: "draft",
    rules: [],
    environmentsEnabled: {},
    ...overrides,
  } as unknown as FeatureRevisionInterface;
}

function makeRule(
  overrides: Partial<ContextualBanditRefRule> = {},
): ContextualBanditRefRule {
  return {
    type: "contextual-bandit-ref",
    id: "",
    contextualBanditId: "cb_1",
    description: "",
    enabled: true,
    condition: "",
    scheduleRules: [],
    allEnvironments: true,
    variations: [
      { variationId: "v0", value: "a" },
      { variationId: "v1", value: "b" },
    ],
    ...overrides,
  } as ContextualBanditRefRule;
}

function cbRefRule(id: string, contextualBanditId: string): FeatureRule {
  return {
    ...makeRule({ contextualBanditId }),
    id,
  } as FeatureRule;
}

/** The changes object handed to `updateRevision` on the single call. */
function changesFromUpdateRevision(): Partial<FeatureRevisionInterface> {
  return updateRevisionMock.mock
    .calls[0][3] as Partial<FeatureRevisionInterface>;
}

beforeEach(() => {
  jest.clearAllMocks();
  updateRevisionMock.mockImplementation(
    async (_context, _feature, revision, changes) =>
      ({ ...revision, ...changes }) as FeatureRevisionInterface,
  );
});

describe("linkFeatureToContextualBandit", () => {
  it("appends an all-environments rule and enables the environments it reaches", async () => {
    getDraftRevisionMock.mockResolvedValue(makeRevision());

    const result = await linkFeatureToContextualBandit({
      context: makeContext(),
      contextualBandit: makeCb(),
      feature: makeFeature(),
      rule: makeRule(),
      eventAudit: { type: "dashboard" },
      audit,
    });

    const changes = changesFromUpdateRevision();
    expect(changes.rules).toHaveLength(1);
    expect(changes.rules?.[0]).toMatchObject({
      type: "contextual-bandit-ref",
      contextualBanditId: "cb_1",
      allEnvironments: true,
      id: "fr_new",
    });
    expect(changes.rules?.[0]).not.toHaveProperty("environments");

    // staging is already enabled on the feature, so only production flips.
    expect(changes.environmentsEnabled).toEqual({ production: true });

    expect(cbModel.addPendingFeatureDraft).toHaveBeenCalledWith(
      "cb_1",
      "feat_1",
      4,
    );
    expect(cbModel.addLinkedFeature).toHaveBeenCalledWith("cb_1", "feat_1");
    expect(result).toEqual({ version: 4, published: false, ruleId: "fr_new" });
  });

  it("scopes the rule and the publish check to an explicit environment list", async () => {
    getDraftRevisionMock.mockResolvedValue(makeRevision());
    const context = makeContext();

    await linkFeatureToContextualBandit({
      context,
      contextualBandit: makeCb(),
      feature: makeFeature(),
      rule: makeRule({
        allEnvironments: false,
        environments: ["production"],
      }),
      eventAudit: { type: "dashboard" },
      audit,
    });

    const changes = changesFromUpdateRevision();
    expect(changes.rules?.[0]).toMatchObject({
      allEnvironments: false,
      environments: ["production"],
    });
    expect(changes.environmentsEnabled).toEqual({ production: true });
    expect(context.permissions.canPublishFeature).toHaveBeenCalledWith(
      expect.objectContaining({ id: "feat_1" }),
      ["production"],
    );
  });

  it("skips the environment toggles when every environment is already enabled", async () => {
    getDraftRevisionMock.mockResolvedValue(
      makeRevision({ environmentsEnabled: { production: true } }),
    );

    await linkFeatureToContextualBandit({
      context: makeContext(),
      contextualBandit: makeCb(),
      feature: makeFeature(),
      rule: makeRule(),
      eventAudit: { type: "dashboard" },
      audit,
    });

    expect(changesFromUpdateRevision()).not.toHaveProperty(
      "environmentsEnabled",
    );
  });
});

describe("unlinkFeatureFromContextualBandit", () => {
  it("removes only the rules pointing at this bandit and drops the linkage", async () => {
    const liveRule = cbRefRule("fr_1", "cb_1");
    const otherBanditRule = cbRefRule("fr_3", "cb_2");
    const forceRule = {
      id: "fr_2",
      type: "force",
      value: "on",
      allEnvironments: true,
      description: "",
      enabled: true,
    } as FeatureRule;

    getDraftRevisionMock.mockResolvedValue(
      makeRevision({ rules: [liveRule, forceRule, otherBanditRule] }),
    );

    const result = await unlinkFeatureFromContextualBandit({
      context: makeContext(),
      contextualBandit: makeCb({ linkedFeatures: ["feat_1"] }),
      featureId: "feat_1",
      feature: makeFeature({ rules: [liveRule] }),
      eventAudit: { type: "dashboard" },
      audit,
    });

    const changes = changesFromUpdateRevision();
    expect(changes.rules?.map((r) => r.id)).toEqual(["fr_2", "fr_3"]);

    expect(cbModel.removeLinkedFeature).toHaveBeenCalledWith("cb_1", "feat_1");
    expect(cbModel.removePendingFeatureDraft).toHaveBeenCalledWith(
      "cb_1",
      "feat_1",
    );
    expect(result).toEqual({
      removedRuleIds: ["fr_1"],
      revisionVersion: 4,
      published: false,
    });
  });

  it("only detaches the linkage when the feature has no rule for this bandit", async () => {
    const result = await unlinkFeatureFromContextualBandit({
      context: makeContext(),
      contextualBandit: makeCb({ linkedFeatures: ["feat_1"] }),
      featureId: "feat_1",
      feature: makeFeature({ rules: [cbRefRule("fr_3", "cb_2")] }),
      eventAudit: { type: "dashboard" },
      audit,
    });

    // No draft is opened for a link whose rule is already gone.
    expect(getDraftRevisionMock).not.toHaveBeenCalled();
    expect(updateRevisionMock).not.toHaveBeenCalled();

    expect(cbModel.removeLinkedFeature).toHaveBeenCalledWith("cb_1", "feat_1");
    expect(result).toEqual({
      removedRuleIds: [],
      revisionVersion: null,
      published: false,
    });
  });

  it("detaches the linkage when the feature no longer exists", async () => {
    const result = await unlinkFeatureFromContextualBandit({
      context: makeContext(),
      contextualBandit: makeCb({ linkedFeatures: ["feat_1"] }),
      featureId: "feat_1",
      feature: null,
      eventAudit: { type: "dashboard" },
      audit,
    });

    expect(getDraftRevisionMock).not.toHaveBeenCalled();
    expect(cbModel.removeLinkedFeature).toHaveBeenCalledWith("cb_1", "feat_1");
    expect(result.revisionVersion).toBeNull();
  });
});
