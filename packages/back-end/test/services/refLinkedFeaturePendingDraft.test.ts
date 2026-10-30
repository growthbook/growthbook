import type {
  ExperimentRefRule,
  FeatureInterface,
  FeatureRule,
} from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { ReqContext } from "back-end/types/request";
import { getRefLinkedFeatureInfo } from "back-end/src/services/experiments";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import {
  getFeatureRevisionsByFeatureIds,
  getLinkageSyncRevisionSummaries,
} from "back-end/src/models/FeatureRevisionModel";
import { getLiveAndBaseRevisionsForFeature } from "back-end/src/services/features";
import { getLaunchDraftVersion } from "back-end/src/util/featureExperimentSync";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeaturesByIds: jest.fn(),
}));
jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  getFeatureRevisionsByFeatureIds: jest.fn(),
  getLinkageSyncRevisionSummaries: jest.fn(),
  getActiveDraftMetadataByFeatureIds: jest.fn(async () => ({})),
}));
jest.mock("back-end/src/services/features", () => ({
  getLiveAndBaseRevisionsForFeature: jest.fn(),
}));

const mockGetFeatures = getFeaturesByIds as jest.Mock;
const mockGetRevisions = getFeatureRevisionsByFeatureIds as jest.Mock;
const mockLiveAndBase = getLiveAndBaseRevisionsForFeature as jest.Mock;
const mockSummaries = getLinkageSyncRevisionSummaries as jest.Mock;

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
  }) as FeatureRule;

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
  }) as FeatureInterface;

const makeDraft = (
  version: number,
  rules: FeatureRule[],
  baseVersion = 3,
): FeatureRevisionInterface =>
  ({
    featureId: "flag",
    organization: "org_1",
    version,
    status: "pending-review",
    baseVersion,
    rules,
    defaultValue: "control",
    environmentsEnabled: { production: true },
    dateCreated: new Date(),
    dateUpdated: new Date(),
  }) as FeatureRevisionInterface;

const context = {
  org: {
    id: "org_1",
    settings: { environments: [{ id: "production" }], requireReviews: true },
  },
  hasPremiumFeature: () => true,
  permissions: { canPublishFeature: () => true },
  getProjects: async () => [],
} as unknown as ReqContext;

// The page reads drafts normalized; a start reads them as stored. `stored`
// overrides a draft's rules where normalizing changed them.
const stub = ({
  live,
  drafts,
  bases = [],
  stored = {},
}: {
  live: FeatureRule[];
  drafts: FeatureRevisionInterface[];
  bases?: FeatureRevisionInterface[];
  stored?: Record<number, FeatureRule[]>;
}) => {
  const feature = makeFeature(live);
  mockGetFeatures.mockResolvedValue([feature]);
  mockGetRevisions.mockResolvedValue({ flag: drafts });
  const summaries = {
    openDrafts: drafts.map((d) => {
      const base =
        d.baseVersion !== feature.version
          ? bases.find((b) => b.version === d.baseVersion)
          : undefined;
      return {
        version: d.version,
        rules: stored[d.version] ?? d.rules,
        ...(base && { base: { version: base.version, rules: base.rules } }),
      };
    }),
    liveRevision: { version: feature.version, rules: live },
  };
  mockSummaries.mockResolvedValue(summaries);
  return summaries;
};

const run = (refIsDraft: boolean, ctx = context) =>
  getRefLinkedFeatureInfo({
    context: ctx,
    linkedFeatureIds: ["flag"],
    refIsDraft,
    matchRule: (rule) =>
      rule.type === "experiment-ref" && rule.experimentId === EXPERIMENT_ID,
    includeOtherPendingDrafts: true,
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockLiveAndBase.mockImplementation(async ({ feature }) => ({
    live: { ...makeDraft(3, feature.rules), status: "published" },
    base: { ...makeDraft(3, feature.rules), status: "published" },
  }));
});

describe("getRefLinkedFeatureInfo pendingDraft", () => {
  it("reports a running experiment's unpublished edit through pendingDraft alone", async () => {
    stub({
      live: [refRule("live-value")],
      drafts: [makeDraft(4, [refRule("draft-value")])],
    });

    const [info] = await run(false);

    expect(info.state).toBe("live");
    expect(info.values).toEqual([
      { variationId: "var_0", value: "control" },
      { variationId: "var_1", value: "live-value" },
    ]);
    expect(info.pendingDraft?.version).toBe(4);
    expect(info.pendingDraft?.status).toBe("pending-review");
    expect(info.pendingDraft?.values).toEqual([
      { variationId: "var_0", value: "control" },
      { variationId: "var_1", value: "draft-value" },
    ]);
    expect(info.pendingDraft?.pendingApproval).toBe(true);
    expect(info.liveValues).toEqual([
      { variationId: "var_0", value: "control" },
      { variationId: "var_1", value: "live-value" },
    ]);
    // Set on a running experiment, these would hard-block its start on an
    // unrelated draft.
    expect(info.pendingApproval).toBeUndefined();
    expect(info.draftRevisionVersion).toBeUndefined();
    expect(info.draftRevisionStatus).toBeUndefined();
    expect(info.hasMergeConflict).toBeUndefined();
    expect(info.hasUnrelatedDraftChanges).toBeUndefined();
  });

  it("offers every draft that adds the rule when live has none, newest first", async () => {
    stub({
      live: [],
      drafts: [
        makeDraft(4, [refRule("older-edit")]),
        makeDraft(5, [refRule("draft-value")]),
      ],
    });

    const [info] = await run(true);

    expect(info.state).toBe("draft");
    expect(info.pendingDraft?.version).toBe(5);
    expect(info.otherPendingDrafts?.map((d) => d.version)).toEqual([4]);
    expect(info.liveValues).toBeUndefined();
    expect(info.draftRevisionVersion).toBe(5);
    expect(info.pendingApproval).toBe(true);
  });

  it.each([
    { targetingProjects: ["prj_targeted"], pendingApproval: true },
    { targetingProjects: [], pendingApproval: undefined },
  ])(
    "judges approval by every Project governing the flag (targeting $targetingProjects)",
    async ({ targetingProjects, pendingApproval }) => {
      // Only the Project the flag may target has a review rule.
      const reviewed = {
        ...context,
        org: {
          ...context.org,
          settings: {
            ...context.org.settings,
            requireReviews: [
              {
                requireReviewOn: true,
                resetReviewOnChange: false,
                environments: [],
                projects: ["prj_targeted"],
              },
            ],
          },
        },
      } as unknown as ReqContext;
      stub({ live: [], drafts: [makeDraft(5, [refRule("draft-value")])] });
      mockGetFeatures.mockResolvedValue([
        { ...makeFeature([]), targetingProjects },
      ]);

      const [info] = await run(true, reviewed);

      expect(info.pendingApproval).toBe(pendingApproval);
      expect(info.pendingDraft?.pendingApproval).toBe(!!pendingApproval);
    },
  );

  it("offers every draft that changes the rule, newest first", async () => {
    stub({
      live: [refRule("live-value")],
      drafts: [
        makeDraft(4, [refRule("older-edit")]),
        makeDraft(5, [refRule("newer-edit")]),
        makeDraft(6, [refRule("live-value")]),
      ],
    });

    const [info] = await run(false);

    expect(info.pendingDraft?.version).toBe(5);
    expect(info.otherPendingDrafts?.map((d) => d.version)).toEqual([4]);
  });

  it("passes over a draft that only holds the rule as it was when the draft was cut", async () => {
    stub({
      live: [refRule("republished")],
      bases: [
        { ...makeDraft(2, [refRule("live-value")]), status: "published" },
      ],
      drafts: [
        makeDraft(4, [refRule("real-edit")], 2),
        makeDraft(5, [refRule("live-value")], 2),
        makeDraft(6, [refRule("republished")]),
      ],
    });

    const [info] = await run(false);

    expect(info.pendingDraft?.version).toBe(4);
    expect(info.otherPendingDrafts).toBeUndefined();
  });

  describe("offers exactly the draft a start launches", () => {
    const scoped = (environments: string[], value = "draft-value") =>
      ({
        ...refRule(value),
        allEnvironments: false,
        environments,
      }) as ExperimentRefRule;

    it.each([
      {
        name: "a rule that runs in no environment",
        live: [],
        draft: scoped([]),
        stored: scoped([]),
      },
      {
        name: "a rule only in environments outside the flag's Project",
        live: [refRule("live-value")],
        // Reading the draft narrows the rule to the environments it can reach.
        draft: scoped([]),
        stored: scoped(["staging"]),
      },
      {
        name: "a rule whose change normalizing hides",
        live: [scoped(["production"], "live-value")],
        draft: scoped(["production"], "live-value"),
        stored: scoped(["production", "staging"], "live-value"),
      },
    ])("for $name", async ({ live, draft, stored }) => {
      const summaries = stub({
        live,
        drafts: [makeDraft(4, [draft])],
        stored: { 4: [stored] },
      });

      const [info] = await run(true);

      expect(
        getLaunchDraftVersion(
          EXPERIMENT_ID,
          summaries.openDrafts,
          summaries.liveRevision,
        ),
      ).toBe(4);
      expect(info.pendingDraft?.version).toBe(4);
      expect(info.pendingDraft?.values).toEqual(draft.variations);
    });

    it("offers none when a start launches none", async () => {
      const summaries = stub({
        live: [refRule("live-value")],
        drafts: [makeDraft(4, [refRule("live-value")])],
      });

      const [info] = await run(true);

      expect(
        getLaunchDraftVersion(
          EXPERIMENT_ID,
          summaries.openDrafts,
          summaries.liveRevision,
        ),
      ).toBeNull();
      expect(info.pendingDraft).toBeUndefined();
    });
  });
});
