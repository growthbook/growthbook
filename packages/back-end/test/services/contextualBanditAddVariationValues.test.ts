import { ContextualBanditInterface } from "shared/validators";
import {
  ContextualBanditRefRule,
  FeatureInterface,
  FeatureRule,
} from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ApiReqContext } from "back-end/types/api";
import { reconcileLinkedFeatureVariations } from "back-end/src/enterprise/services/contextualBandits";
import {
  getDraftRevision,
  getLiveAndBaseRevisionsForFeature,
} from "back-end/src/services/features";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { publishRevision } from "back-end/src/models/FeatureModel";

jest.mock("back-end/src/services/features", () => ({
  queueSDKPayloadRefresh: jest.fn(),
  generateRuleId: jest.fn(() => "fr_new"),
  getDraftRevision: jest.fn(),
  assertCanAutoPublish: jest.fn(),
  getLiveAndBaseRevisionsForFeature: jest.fn(),
}));
jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  getRevision: jest.fn(),
  updateRevision: jest.fn(),
  getLinkageSyncRevisionSummaries: jest
    .fn()
    .mockResolvedValue({ openDrafts: [], liveRevision: null }),
}));
jest.mock("back-end/src/models/FeatureModel", () => ({
  publishRevision: jest.fn(),
}));
jest.mock("back-end/src/util/featureContextualBanditSync", () => ({
  syncFeatureContextualBanditLinkages: jest.fn(),
}));
jest.mock("back-end/src/services/featureRevisionEvents", () => ({
  recordRevisionUpdate: jest.fn(),
}));
jest.mock("back-end/src/services/configValidation", () => ({
  assertConfigBackedFeatureValuesValid: jest.fn(),
}));
jest.mock("back-end/src/services/contextualBanditChanges", () => ({
  refreshLinkedFeaturePayloads: jest.fn(),
}));
jest.mock("back-end/src/services/experiments", () => ({
  getRefLinkedFeatureInfo: jest.fn().mockResolvedValue([]),
}));
jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
}));
jest.mock("back-end/src/services/datasource", () => ({
  getSourceIntegrationObject: jest.fn(),
}));
jest.mock(
  "back-end/src/enterprise/queryRunners/ContextualBanditResultsQueryRunner",
  () => ({ ContextualBanditResultsQueryRunner: jest.fn() }),
);

const getDraftRevisionMock = getDraftRevision as jest.Mock;
const getRevisionMock = getRevision as jest.Mock;
const updateRevisionMock = updateRevision as jest.Mock;
const publishRevisionMock = publishRevision as jest.Mock;
const getLiveAndBaseRevisionsMock =
  getLiveAndBaseRevisionsForFeature as jest.Mock;

function cbRefRule(
  overrides: Partial<ContextualBanditRefRule> = {},
): FeatureRule {
  return {
    id: "rule_1",
    type: "contextual-bandit-ref",
    contextualBanditId: "cb_1",
    description: "",
    enabled: true,
    condition: "",
    scheduleRules: [],
    allEnvironments: true,
    variations: [
      { variationId: "v0", value: "control" },
      { variationId: "v1", value: "treatment" },
    ],
    ...overrides,
  } as FeatureRule;
}

function makeFeature(
  overrides: Partial<FeatureInterface> = {},
): FeatureInterface {
  return {
    id: "feature",
    organization: "org_1",
    version: 4,
    valueType: "string",
    defaultValue: "control",
    environmentSettings: { production: { enabled: true } },
    rules: [cbRefRule()],
    ...overrides,
  } as unknown as FeatureInterface;
}

function makeRevision(
  overrides: Partial<FeatureRevisionInterface> = {},
): FeatureRevisionInterface {
  return {
    organization: "org_1",
    featureId: "feature",
    version: 5,
    baseVersion: 4,
    status: "draft",
    rules: [cbRefRule()],
    environmentsEnabled: {},
    ...overrides,
  } as unknown as FeatureRevisionInterface;
}

function linkedInfo(
  feature: FeatureInterface,
  overrides: Record<string, unknown> = {},
) {
  const rule = ((feature.rules ?? []) as FeatureRule[]).find(
    (r) => r.type === "contextual-bandit-ref",
  ) as ContextualBanditRefRule | undefined;
  return {
    feature,
    state: "live",
    values: rule?.variations ?? [],
    environmentStates: { production: "active" },
    ...overrides,
  };
}

function makeCb(
  overrides: Partial<ContextualBanditInterface> = {},
): ContextualBanditInterface {
  return {
    id: "cb_1",
    name: "CB 1",
    status: "draft",
    linkedFeatures: ["feature"],
    ...overrides,
  } as unknown as ContextualBanditInterface;
}

function makeContext() {
  const warn = jest.fn();
  const context = {
    environments: ["production"],
    org: { id: "org_1", settings: {} },
    auditUser: { type: "dashboard", id: "u1", email: "u@x.co", name: "U" },
    auditLog: jest.fn(),
    logger: { warn },
    permissions: {
      canUpdateFeature: jest.fn().mockReturnValue(true),
      canEditFeatureDrafts: jest.fn().mockReturnValue(true),
      canPublishFeature: jest.fn().mockReturnValue(true),
      canBypassFlagApprovalChecks: jest.fn().mockReturnValue(false),
      throwPermissionError: jest.fn(() => {
        throw new Error("permission error");
      }),
    },
    models: { contextualBandits: {} },
  } as unknown as ApiReqContext;
  return { context, warn };
}

function cbRefVariationsFromUpdateRevision(n = 0) {
  const changes = updateRevisionMock.mock.calls[n][3] as {
    rules: FeatureRule[];
  };
  return (
    changes.rules.find(
      (r) => r.type === "contextual-bandit-ref",
    ) as ContextualBanditRefRule
  ).variations;
}

describe("reconcileLinkedFeatureVariations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getDraftRevisionMock.mockResolvedValue(makeRevision());
    updateRevisionMock.mockImplementation(async (_c, _f, rev, changes) => ({
      ...rev,
      ...changes,
    }));
    const liveRevision = makeRevision({ version: 4, status: "published" });
    getLiveAndBaseRevisionsMock.mockResolvedValue({
      live: liveRevision,
      base: liveRevision,
    });
  });

  it("leaves an arm it has no value for off the rule instead of cloning control", async () => {
    const cb = makeCb();
    const { context } = makeContext();

    await reconcileLinkedFeatureVariations(context, cb, {
      addedIds: ["v2"],
      removedIds: [],
      linkedInfo: [linkedInfo(makeFeature())],
    });

    expect(updateRevisionMock).not.toHaveBeenCalled();
    expect(publishRevisionMock).not.toHaveBeenCalled();
  });

  it("still applies a removal when an added arm has no value", async () => {
    const feature = makeFeature({
      rules: [
        cbRefRule({
          variations: [
            { variationId: "v0", value: "control" },
            { variationId: "v1", value: "treatment" },
          ],
        }),
      ],
    } as Partial<FeatureInterface>);
    getDraftRevisionMock.mockResolvedValue(
      makeRevision({ rules: feature.rules as FeatureRule[] }),
    );
    const cb = makeCb();
    const { context } = makeContext();

    await reconcileLinkedFeatureVariations(context, cb, {
      addedIds: ["v2"],
      removedIds: ["v1"],
      linkedInfo: [linkedInfo(feature)],
    });

    expect(cbRefVariationsFromUpdateRevision()).toEqual([
      { variationId: "v0", value: "control" },
    ]);
  });

  it("uses a caller-supplied value when provided", async () => {
    const cb = makeCb();
    const { context } = makeContext();

    await reconcileLinkedFeatureVariations(context, cb, {
      addedIds: ["v2"],
      removedIds: [],
      providedValues: { feature: { v2: "added" } },
      linkedInfo: [linkedInfo(makeFeature())],
    });

    expect(cbRefVariationsFromUpdateRevision()).toContainEqual({
      variationId: "v2",
      value: "added",
    });
  });

  it("drops a removed arm from the rule", async () => {
    const feature = makeFeature({
      rules: [
        cbRefRule({
          variations: [
            { variationId: "v0", value: "control" },
            { variationId: "v1", value: "treatment" },
            { variationId: "v2", value: "extra" },
          ],
        }),
      ],
    } as Partial<FeatureInterface>);
    getDraftRevisionMock.mockResolvedValue(
      makeRevision({ rules: feature.rules as FeatureRule[] }),
    );
    const cb = makeCb();
    const { context } = makeContext();

    await reconcileLinkedFeatureVariations(context, cb, {
      addedIds: [],
      removedIds: ["v2"],
      linkedInfo: [linkedInfo(feature)],
    });

    expect(cbRefVariationsFromUpdateRevision()).toEqual([
      { variationId: "v0", value: "control" },
      { variationId: "v1", value: "treatment" },
    ]);
  });

  it("applies a combined add + remove as one rule replacement", async () => {
    const cb = makeCb();
    const { context } = makeContext();

    await reconcileLinkedFeatureVariations(context, cb, {
      addedIds: ["v2"],
      providedValues: { feature: { v2: "added-value" } },
      removedIds: ["v1"],
      linkedInfo: [linkedInfo(makeFeature())],
    });

    expect(updateRevisionMock).toHaveBeenCalledTimes(1);
    expect(cbRefVariationsFromUpdateRevision()).toEqual([
      { variationId: "v0", value: "control" },
      { variationId: "v2", value: "added-value" },
    ]);
  });

  it("publishes the rule change immediately for a running CB", async () => {
    const cb = makeCb({ status: "running" });
    const { context } = makeContext();

    const { failures } = await reconcileLinkedFeatureVariations(context, cb, {
      addedIds: ["v2"],
      providedValues: { feature: { v2: "added-value" } },
      removedIds: [],
      linkedInfo: [linkedInfo(makeFeature())],
    });

    expect(publishRevisionMock).toHaveBeenCalledTimes(1);
    expect(failures).toEqual([]);
  });

  it("downgrades a failed publish to a staged draft and reports the failure", async () => {
    publishRevisionMock.mockRejectedValueOnce(
      new Error(
        "Unable to auto-publish: please resolve conflicts on draft #5 before publishing.",
      ),
    );
    const cb = makeCb({ status: "running" });
    const { context, warn } = makeContext();

    const { failures } = await reconcileLinkedFeatureVariations(context, cb, {
      addedIds: ["v2"],
      providedValues: { feature: { v2: "added-value" } },
      removedIds: [],
      linkedInfo: [linkedInfo(makeFeature())],
    });

    expect(updateRevisionMock).toHaveBeenCalledTimes(2);
    expect(failures).toEqual([
      { featureId: "feature", revisionVersion: 5, reason: "merge-conflict" },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("targets the pending draft that already carries the bandit's rule", async () => {
    const feature = makeFeature({ rules: [] } as Partial<FeatureInterface>);
    const draftRules = [cbRefRule()];
    getRevisionMock.mockResolvedValue(
      makeRevision({ version: 6, rules: draftRules }),
    );
    getDraftRevisionMock.mockResolvedValue(
      makeRevision({ version: 6, rules: draftRules }),
    );
    const cb = makeCb();
    const { context } = makeContext();

    await reconcileLinkedFeatureVariations(context, cb, {
      addedIds: ["v2"],
      providedValues: { feature: { v2: "added-value" } },
      removedIds: [],
      linkedInfo: [
        linkedInfo(feature, {
          state: "draft",
          draftRevisionVersion: 6,
          values: (draftRules[0] as ContextualBanditRefRule).variations,
        }),
      ],
    });

    expect(getDraftRevisionMock).toHaveBeenCalledWith(context, feature, 6);
    expect(cbRefVariationsFromUpdateRevision()).toContainEqual({
      variationId: "v2",
      value: "added-value",
    });
  });

  it("records a failure (not a throw) on a value that fails the feature's type validation", async () => {
    const feature = makeFeature({
      valueType: "number",
      defaultValue: "1",
      rules: [
        cbRefRule({
          variations: [
            { variationId: "v0", value: "1" },
            { variationId: "v1", value: "2" },
          ],
        }),
      ],
    } as Partial<FeatureInterface>);
    const cb = makeCb();
    const { context } = makeContext();

    const { failures } = await reconcileLinkedFeatureVariations(context, cb, {
      addedIds: ["v2"],
      removedIds: [],
      providedValues: { feature: { v2: "not-a-number" } },
      linkedInfo: [linkedInfo(feature)],
    });
    expect(failures).toEqual([
      expect.objectContaining({
        featureId: "feature",
        reason: "publish-error",
      }),
    ]);
    expect(updateRevisionMock).not.toHaveBeenCalled();
  });

  it("no-ops when the arm set change doesn't alter the rule", async () => {
    const cb = makeCb();
    const { context } = makeContext();

    await reconcileLinkedFeatureVariations(context, cb, {
      addedIds: ["v1"],
      removedIds: ["v9"],
      linkedInfo: [linkedInfo(makeFeature())],
    });

    expect(updateRevisionMock).not.toHaveBeenCalled();
  });

  it("skips features without an editable rule state", async () => {
    const cb = makeCb();
    const { context } = makeContext();

    await reconcileLinkedFeatureVariations(context, cb, {
      addedIds: ["v2"],
      removedIds: [],
      linkedInfo: [linkedInfo(makeFeature(), { state: "archived" })],
    });

    expect(updateRevisionMock).not.toHaveBeenCalled();
  });

  it("no-ops when there is nothing to reconcile", async () => {
    const cb = makeCb();
    const { context } = makeContext();

    await reconcileLinkedFeatureVariations(context, cb, {
      addedIds: [],
      removedIds: [],
      linkedInfo: [linkedInfo(makeFeature())],
    });

    expect(updateRevisionMock).not.toHaveBeenCalled();
  });
});
