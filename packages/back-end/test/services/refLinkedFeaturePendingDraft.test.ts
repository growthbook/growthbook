import type { FeatureInterface, FeatureRule } from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import { getRefLinkedFeatureInfo } from "back-end/src/services/experiments";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import { getFeatureRevisionsByFeatureIds } from "back-end/src/models/FeatureRevisionModel";
import { getLiveAndBaseRevisionsForFeature } from "back-end/src/services/features";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeaturesByIds: jest.fn(),
}));
jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  getFeatureRevisionsByFeatureIds: jest.fn(),
  // Feeds attributeScopeProjects, which these cases do not exercise.
  getActiveDraftMetadataByFeatureIds: jest.fn(async () => ({})),
}));
jest.mock("back-end/src/services/features", () => ({
  getLiveAndBaseRevisionsForFeature: jest.fn(),
}));

const mockGetFeatures = getFeaturesByIds as jest.Mock;
const mockGetRevisions = getFeatureRevisionsByFeatureIds as jest.Mock;
const mockLiveAndBase = getLiveAndBaseRevisionsForFeature as jest.Mock;

const EXPERIMENT_ID = "exp_1";

const refRule = (value: string, id = "fr_1"): FeatureRule =>
  ({
    id,
    type: "experiment-ref",
    experimentId: EXPERIMENT_ID,
    description: "",
    enabled: true,
    allEnvironments: true,
    condition: "",
    scheduleRules: [],
    variations: [
      { variationId: "var_0", value: "control" },
      { variationId: "var_1", value },
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

const makeFeature = (liveRules: FeatureRule[]): FeatureInterface =>
  ({
    id: "flag",
    organization: "org_1",
    version: 3,
    valueType: "string",
    defaultValue: "control",
    archived: false,
    project: "",
    owner: "",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    environmentSettings: { production: { enabled: true, rules: [] } },
    rules: liveRules,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

const makeDraft = (
  version: number,
  rules: FeatureRule[],
): FeatureRevisionInterface =>
  ({
    featureId: "flag",
    organization: "org_1",
    version,
    status: "pending-review",
    baseVersion: 3,
    rules,
    defaultValue: "control",
    environmentsEnabled: { production: true },
    dateCreated: new Date(),
    dateUpdated: new Date(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

const context = {
  org: { id: "org_1", settings: { environments: [{ id: "production" }] } },
  hasPremiumFeature: () => true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const run = (refIsDraft: boolean) =>
  getRefLinkedFeatureInfo({
    context,
    linkedFeatureIds: ["flag"],
    refIsDraft,
    matchRule: (rule) =>
      rule.type === "experiment-ref" && rule.experimentId === EXPERIMENT_ID,
  });

beforeEach(() => {
  jest.clearAllMocks();
  context.org.settings.requireReviews = true;
  mockLiveAndBase.mockImplementation(async ({ feature }) => ({
    live: { ...makeDraft(3, feature.rules), status: "published" },
    base: { ...makeDraft(3, feature.rules), status: "published" },
  }));
});

describe("getRefLinkedFeatureInfo pendingDraft", () => {
  it("reports a running experiment's unpublished edit even though state stays live", async () => {
    mockGetFeatures.mockResolvedValue([makeFeature([refRule("live-value")])]);
    mockGetRevisions.mockResolvedValue({
      flag: [makeDraft(4, [refRule("draft-value")])],
    });

    const [info] = await run(false);

    // `state` stays live-first so every existing consumer is unaffected...
    expect(info.state).toBe("live");
    expect(info.values).toEqual([
      { variationId: "var_0", value: "control" },
      { variationId: "var_1", value: "live-value" },
    ]);
    // ...and the pending edit is only visible through pendingDraft.
    expect(info.pendingDraft?.version).toBe(4);
    expect(info.pendingDraft?.status).toBe("pending-review");
    expect(info.pendingDraft?.values).toEqual([
      { variationId: "var_0", value: "control" },
      { variationId: "var_1", value: "draft-value" },
    ]);
    expect(info.pendingDraft?.pendingApproval).toBe(true);
  });

  it("does NOT widen the sibling fields the pre-launch checklist filters on", async () => {
    mockGetFeatures.mockResolvedValue([makeFeature([refRule("live-value")])]);
    mockGetRevisions.mockResolvedValue({
      flag: [makeDraft(4, [refRule("draft-value")])],
    });

    const [info] = await run(false);

    // changeExperimentStatus filters `pendingApproval` with no state gate and
    // reads `draftRevisionStatus` for the verdict — populating either here
    // would hard-block a running experiment on an unrelated draft.
    expect(info.pendingApproval).toBeUndefined();
    expect(info.draftRevisionVersion).toBeUndefined();
    expect(info.draftRevisionStatus).toBeUndefined();
    expect(info.hasMergeConflict).toBeUndefined();
    expect(info.hasUnrelatedDraftChanges).toBeUndefined();
  });

  it("exposes the live values as the before side of the diff", async () => {
    mockGetFeatures.mockResolvedValue([makeFeature([refRule("live-value")])]);
    mockGetRevisions.mockResolvedValue({
      flag: [makeDraft(4, [refRule("draft-value")])],
    });

    const [info] = await run(false);

    expect(info.liveValues).toEqual([
      { variationId: "var_0", value: "control" },
      { variationId: "var_1", value: "live-value" },
    ]);
  });

  it("populates pendingDraft for a first draft that has no live rule to compare", async () => {
    mockGetFeatures.mockResolvedValue([makeFeature([])]);
    mockGetRevisions.mockResolvedValue({
      flag: [makeDraft(4, [refRule("draft-value")])],
    });

    const [info] = await run(true);

    expect(info.state).toBe("draft");
    expect(info.pendingDraft?.version).toBe(4);
    expect(info.liveValues).toBeUndefined();
    // On a draft experiment the sibling fields ARE populated, as before.
    expect(info.draftRevisionVersion).toBe(4);
    expect(info.pendingApproval).toBe(true);
  });

  it("reports no pendingDraft when the draft's rule is identical to live", async () => {
    mockGetFeatures.mockResolvedValue([makeFeature([refRule("same")])]);
    mockGetRevisions.mockResolvedValue({
      flag: [makeDraft(4, [refRule("same")])],
    });

    const [info] = await run(false);

    expect(info.state).toBe("live");
    expect(info.pendingDraft).toBeUndefined();
  });

  it("reports no pendingDraft when there is no draft at all", async () => {
    mockGetFeatures.mockResolvedValue([makeFeature([refRule("live-value")])]);
    mockGetRevisions.mockResolvedValue({ flag: [] });

    const [info] = await run(false);

    expect(info.state).toBe("live");
    expect(info.pendingDraft).toBeUndefined();
  });
});
