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
  updateContextualBanditFeatureRule,
} from "back-end/src/enterprise/services/contextualBandits";
import {
  getDraftRevision,
  getLiveAndBaseRevisionsForFeature,
} from "back-end/src/services/features";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { publishRevision } from "back-end/src/models/FeatureModel";
import { syncFeatureContextualBanditLinkages } from "back-end/src/util/featureContextualBanditSync";

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
  getLinkageSyncRevisionSummaries: jest
    .fn()
    .mockResolvedValue({ openDrafts: [], liveRevision: null }),
}));

jest.mock("back-end/src/util/featureContextualBanditSync", () => ({
  syncFeatureContextualBanditLinkages: jest.fn(),
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
const getRevisionMock = getRevision as jest.MockedFunction<typeof getRevision>;
const publishRevisionMock = publishRevision as jest.MockedFunction<
  typeof publishRevision
>;
const getLiveAndBaseRevisionsMock =
  getLiveAndBaseRevisionsForFeature as jest.MockedFunction<
    typeof getLiveAndBaseRevisionsForFeature
  >;

const syncLinkagesMock =
  syncFeatureContextualBanditLinkages as jest.MockedFunction<
    typeof syncFeatureContextualBanditLinkages
  >;

// Linkage is derived from the rules by the revision write and the publish, so
// these services should never reach for the model themselves — a bare mock
// makes any attempt to do so a failure rather than a silent no-op.
const cbModel = {
  applyLinkageDelta: jest.fn(),
  setLinkageState: jest.fn(),
  removePendingFeatureDraft: jest.fn(),
};

/** No linkage write may originate here, whichever method it would have used. */
function expectNoDirectLinkageWrites() {
  expect(cbModel.applyLinkageDelta).not.toHaveBeenCalled();
  expect(cbModel.setLinkageState).not.toHaveBeenCalled();
  expect(cbModel.removePendingFeatureDraft).not.toHaveBeenCalled();
}

const audit = jest.fn();

function makeContext(): ReqContext {
  return {
    org: { id: "org_1", settings: {} },
    environments: ["production", "staging"],
    auditUser: { type: "dashboard" },
    permissions: {
      canEditFeatureDrafts: jest.fn().mockReturnValue(true),
      canPublishFeature: jest.fn().mockReturnValue(true),
      canBypassFlagApprovalChecks: jest.fn().mockReturnValue(false),
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
  // Publishing merges the draft against an unchanged live/base pair, which
  // `autoMerge` (not mocked) resolves without conflicts.
  const liveRevision = makeRevision({ version: 3, status: "published" });
  getLiveAndBaseRevisionsMock.mockResolvedValue({
    live: liveRevision,
    base: liveRevision,
  });
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

    // The revision write is what queues the draft against the bandit.
    expectNoDirectLinkageWrites();
    expect(result).toEqual({ version: 4, published: false, ruleId: "fr_new" });
  });

  it("publishes instead of queueing a draft, leaving the linkage to the publish", async () => {
    getDraftRevisionMock.mockResolvedValue(makeRevision());

    const result = await linkFeatureToContextualBandit({
      context: makeContext(),
      contextualBandit: makeCb(),
      feature: makeFeature(),
      rule: makeRule(),
      eventAudit: { type: "dashboard" },
      audit,
      autoPublish: true,
    });

    // `publishRevision` plans the linkage off the rules going live, so the
    // service deliberately writes neither array here.
    expect(publishRevisionMock).toHaveBeenCalled();
    expectNoDirectLinkageWrites();
    expect(result.published).toBe(true);
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
    // Staging into a draft publishes nothing, so no publish authority is asked
    // for — the environment-scoped check belongs to the landing call below.
    expect(context.permissions.canPublishFeature).not.toHaveBeenCalled();
  });

  it("scopes the publish check to the rule's environments when the call lands", async () => {
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
      autoPublish: true,
    });

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

describe("updateContextualBanditFeatureRule", () => {
  const newVariations = [
    { variationId: "v0", value: "updated-a" },
    { variationId: "v1", value: "updated-b" },
  ];

  it("replaces every rule for this bandit in place and leaves the rest alone", async () => {
    const banditRule = cbRefRule("fr_1", "cb_1");
    const otherBanditRule = cbRefRule("fr_3", "cb_2");
    getDraftRevisionMock.mockResolvedValue(
      makeRevision({ rules: [banditRule, otherBanditRule] }),
    );

    const result = await updateContextualBanditFeatureRule({
      context: makeContext(),
      contextualBandit: makeCb({ linkedFeatures: ["feat_1"] }),
      feature: makeFeature({ rules: [banditRule, otherBanditRule] }),
      rule: makeRule({ variations: newVariations }),
      eventAudit: { type: "dashboard" },
      audit,
    });

    const changes = changesFromUpdateRevision();
    expect(changes.rules?.map((r) => r.id)).toEqual(["fr_1", "fr_3"]);
    expect(changes.rules?.[0]).toMatchObject({
      id: "fr_1",
      contextualBanditId: "cb_1",
      variations: newVariations,
    });
    expect(changes.rules?.[1]).toEqual(otherBanditRule);

    expect(result).toEqual({ version: 4, published: false, ruleIds: ["fr_1"] });
    expectNoDirectLinkageWrites();
  });

  it("replaces all of the bandit's rules when they are identical", async () => {
    const rules = [cbRefRule("fr_1", "cb_1"), cbRefRule("fr_2", "cb_1")];
    getDraftRevisionMock.mockResolvedValue(makeRevision({ rules }));

    const result = await updateContextualBanditFeatureRule({
      context: makeContext(),
      contextualBandit: makeCb({ linkedFeatures: ["feat_1"] }),
      feature: makeFeature({ rules }),
      rule: makeRule({ variations: newVariations }),
      eventAudit: { type: "dashboard" },
      audit,
    });

    expect(result.ruleIds).toEqual(["fr_1", "fr_2"]);
    expect(
      changesFromUpdateRevision().rules?.map((r) => ({
        id: r.id,
        variations: (r as ContextualBanditRefRule).variations,
      })),
    ).toEqual([
      { id: "fr_1", variations: newVariations },
      { id: "fr_2", variations: newVariations },
    ]);
  });

  it("rejects when the bandit's rules have drifted apart", async () => {
    const rules = [
      cbRefRule("fr_1", "cb_1"),
      { ...cbRefRule("fr_2", "cb_1"), enabled: false } as FeatureRule,
    ];

    await expect(
      updateContextualBanditFeatureRule({
        context: makeContext(),
        contextualBandit: makeCb({ linkedFeatures: ["feat_1"] }),
        feature: makeFeature({ rules }),
        rule: makeRule({ variations: newVariations }),
        eventAudit: { type: "dashboard" },
        audit,
      }),
    ).rejects.toThrow(/not identical/);

    // Nothing is staged, so no draft is opened off live.
    expect(getDraftRevisionMock).not.toHaveBeenCalled();
    expect(updateRevisionMock).not.toHaveBeenCalled();
  });

  it("rejects when the feature has no rule for this bandit", async () => {
    await expect(
      updateContextualBanditFeatureRule({
        context: makeContext(),
        contextualBandit: makeCb({ linkedFeatures: ["feat_1"] }),
        feature: makeFeature({ rules: [cbRefRule("fr_3", "cb_2")] }),
        rule: makeRule({ variations: newVariations }),
        eventAudit: { type: "dashboard" },
        audit,
      }),
    ).rejects.toThrow(/has no rule for this contextual bandit/);

    expect(getDraftRevisionMock).not.toHaveBeenCalled();
  });
});

describe("unlinkFeatureFromContextualBandit", () => {
  it("removes only the rules pointing at this bandit", async () => {
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

    // The live revision still serves the rule, so the feature stays linked. What
    // happens to the queued draft follows from the draft's rules, which the
    // revision write reconciles.
    expectNoDirectLinkageWrites();
    expect(result).toEqual({
      removedRuleIds: ["fr_1"],
      revisionVersion: 4,
      published: false,
    });
  });

  it("reconciles the linkage directly when the feature has no rule for this bandit", async () => {
    const result = await unlinkFeatureFromContextualBandit({
      context: makeContext(),
      contextualBandit: makeCb({ linkedFeatures: ["feat_1"] }),
      featureId: "feat_1",
      feature: makeFeature({ rules: [cbRefRule("fr_3", "cb_2")] }),
      eventAudit: { type: "dashboard" },
      audit,
    });

    // No draft is opened for a link whose rule is already gone — and with no
    // revision write to reconcile off, the service syncs the linkage itself.
    expect(getDraftRevisionMock).not.toHaveBeenCalled();
    expect(updateRevisionMock).not.toHaveBeenCalled();

    expect(syncLinkagesMock).toHaveBeenCalledWith(
      expect.anything(),
      "feat_1",
      [],
      null,
    );
    expect(result).toEqual({
      removedRuleIds: [],
      revisionVersion: null,
      published: false,
    });
  });

  it("keeps the linkage when the targeted draft has no rule but live still does", async () => {
    const liveRule = cbRefRule("fr_1", "cb_1");
    getDraftRevisionMock.mockResolvedValue(makeRevision());
    getRevisionMock.mockResolvedValue(makeRevision({ rules: [] }));

    await unlinkFeatureFromContextualBandit({
      context: makeContext(),
      contextualBandit: makeCb({ linkedFeatures: ["feat_1"] }),
      featureId: "feat_1",
      feature: makeFeature({ rules: [liveRule] }),
      eventAudit: { type: "dashboard" },
      audit,
      draftVersion: 4,
    });

    expect(updateRevisionMock).not.toHaveBeenCalled();
    // Live still has the rule, so the sync it delegates to keeps the feature
    // linked and only retires this draft's queue entry.
    expect(syncLinkagesMock).toHaveBeenCalled();
    expectNoDirectLinkageWrites();
  });

  it("leaves the unlink to the publish", async () => {
    const liveRule = cbRefRule("fr_1", "cb_1");
    getDraftRevisionMock.mockResolvedValue(makeRevision({ rules: [liveRule] }));

    await unlinkFeatureFromContextualBandit({
      context: makeContext(),
      contextualBandit: makeCb({ linkedFeatures: ["feat_1"] }),
      featureId: "feat_1",
      feature: makeFeature({ rules: [liveRule] }),
      eventAudit: { type: "dashboard" },
      audit,
      autoPublish: true,
    });

    // Removing the rule from live is what drops the linkage, and that happens
    // inside the publish.
    expect(publishRevisionMock).toHaveBeenCalled();
    expectNoDirectLinkageWrites();
  });
});
