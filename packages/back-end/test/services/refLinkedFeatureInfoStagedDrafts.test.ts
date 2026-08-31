import {
  ContextualBanditRefRule,
  FeatureInterface,
  FeatureRule,
} from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ReqContext } from "back-end/types/organization";
import { getRefLinkedFeatureInfo } from "back-end/src/services/experiments";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import { getFeatureRevisionsByFeatureIds } from "back-end/src/models/FeatureRevisionModel";
import { getLiveAndBaseRevisionsForFeature } from "back-end/src/services/features";

jest.mock("kerberos", () => ({}));

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeaturesByIds: jest.fn(),
}));

jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  getFeatureRevisionsByFeatureIds: jest.fn(),
  getActiveDraftMetadataByFeatureIds: jest.fn().mockResolvedValue({}),
}));

jest.mock("back-end/src/services/features", () => ({
  getLiveAndBaseRevisionsForFeature: jest.fn(),
}));

const getFeaturesByIdsMock = getFeaturesByIds as jest.Mock;
const getFeatureRevisionsByFeatureIdsMock =
  getFeatureRevisionsByFeatureIds as jest.Mock;
const getLiveAndBaseRevisionsMock =
  getLiveAndBaseRevisionsForFeature as jest.Mock;

const matchRule = (rule: FeatureRule) =>
  rule.type === "contextual-bandit-ref" &&
  (rule as ContextualBanditRefRule).contextualBanditId === "cb_1";

function cbRule(
  variations: { variationId: string; value: string }[],
  id = "fr_1",
): FeatureRule {
  return {
    id,
    type: "contextual-bandit-ref",
    contextualBanditId: "cb_1",
    description: "",
    enabled: true,
    condition: "",
    scheduleRules: [],
    allEnvironments: true,
    variations,
  } as unknown as FeatureRule;
}

const liveVariations = [
  { variationId: "v0", value: "control" },
  { variationId: "v1", value: "treatment" },
];

function makeFeature(): FeatureInterface {
  return {
    id: "feature",
    organization: "org_1",
    version: 3,
    valueType: "string",
    defaultValue: "control",
    environmentSettings: { production: { enabled: true } },
    rules: [cbRule(liveVariations)],
  } as unknown as FeatureInterface;
}

function makeRevision(
  version: number,
  rules: FeatureRule[],
  status = "draft",
): FeatureRevisionInterface {
  return {
    organization: "org_1",
    featureId: "feature",
    version,
    baseVersion: 3,
    status,
    defaultValue: "control",
    rules,
    environmentsEnabled: { production: true },
  } as unknown as FeatureRevisionInterface;
}

const context = {
  org: {
    id: "org_1",
    settings: { environments: [{ id: "production" }] },
  },
  hasPremiumFeature: () => false,
} as unknown as ReqContext;

describe("getRefLinkedFeatureInfo staged drafts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getFeaturesByIdsMock.mockResolvedValue([makeFeature()]);
    const live = makeRevision(3, [cbRule(liveVariations)], "published");
    getLiveAndBaseRevisionsMock.mockResolvedValue({ live, base: live });
  });

  it("reports every open draft that changes the rule, newest first", async () => {
    const draft5 = makeRevision(5, [
      cbRule([...liveVariations, { variationId: "v2", value: "extra" }]),
    ]);
    const draft7 = makeRevision(7, [
      cbRule([...liveVariations, { variationId: "v3", value: "later" }]),
    ]);
    getFeatureRevisionsByFeatureIdsMock.mockResolvedValue({
      feature: [draft5, draft7],
    });

    const [info] = await getRefLinkedFeatureInfo({
      context,
      linkedFeatureIds: ["feature"],
      refIsDraft: false,
      matchRule,
    });

    expect(info.state).toBe("live");
    expect(info.values).toEqual(liveVariations);
    expect(info.stagedDrafts?.map((d) => d.version)).toEqual([7, 5]);
    expect(info.stagedDraft?.version).toBe(7);
    expect(info.stagedDrafts?.[1].values).toContainEqual({
      variationId: "v2",
      value: "extra",
    });
  });

  it("flags a staged draft carrying unrelated changes so write paths leave it alone", async () => {
    const draft = makeRevision(5, [
      cbRule([...liveVariations, { variationId: "v2", value: "extra" }]),
    ]);
    draft.defaultValue = "something-else";
    getFeatureRevisionsByFeatureIdsMock.mockResolvedValue({ feature: [draft] });

    const [info] = await getRefLinkedFeatureInfo({
      context,
      linkedFeatureIds: ["feature"],
      refIsDraft: false,
      matchRule,
    });

    expect(info.stagedDraft?.version).toBe(5);
    expect(info.stagedDraft?.hasUnrelatedDraftChanges).toBe(true);
  });

  it("leaves stagedDrafts unset when no draft changes the rule", async () => {
    getFeatureRevisionsByFeatureIdsMock.mockResolvedValue({
      feature: [makeRevision(5, [cbRule(liveVariations)])],
    });

    const [info] = await getRefLinkedFeatureInfo({
      context,
      linkedFeatureIds: ["feature"],
      refIsDraft: false,
      matchRule,
    });

    expect(info.state).toBe("live");
    expect(info.stagedDrafts).toBeUndefined();
    expect(info.stagedDraft).toBeUndefined();
  });
});
