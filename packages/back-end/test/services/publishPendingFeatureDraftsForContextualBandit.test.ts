import type { ContextualBanditInterface } from "shared/validators";
import { autoMerge } from "shared/util";
import type { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
  publishRevision: jest.fn(),
  prevalidatePublishRevision: jest.fn(),
  editFeatureRules: jest.fn(),
}));

jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  getRevision: jest.fn(),
  discardRevision: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentModel", () => ({
  removePendingFeatureDraftFromExperiment: jest.fn(),
}));

jest.mock("back-end/src/services/features", () => ({
  assertCanAutoPublish: jest.fn(),
  getDraftRevision: jest.fn(),
  getLiveAndBaseRevisionsForFeature: jest.fn(),
  getLiveRevisionForFeature: jest.fn(),
}));

jest.mock("back-end/src/util/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("shared/util", () => ({
  ...jest.requireActual("shared/util"),
  autoMerge: jest.fn(),
}));

jest.mock("back-end/src/services/featurePublishGates", () => ({
  ...jest.requireActual("back-end/src/services/featurePublishGates"),
  assessRevisionApproval: jest.fn(),
}));

import { publishPendingFeatureDraftsForContextualBandit } from "back-end/src/services/experiment-feature";
import { assessRevisionApproval } from "back-end/src/services/featurePublishGates";
import { getFeature, publishRevision } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { getLiveAndBaseRevisionsForFeature } from "back-end/src/services/features";

// A bandit start publishes its pending drafts under the same governance as an
// experiment start.

const cb = {
  id: "cb_1",
  name: "bandit",
  pendingFeatureDrafts: [{ featureId: "flag", revisionVersion: 6 }],
} as unknown as ContextualBanditInterface;

function context(settings: Record<string, unknown>): ReqContext {
  return {
    org: { id: "org_1", settings },
    environments: ["production"],
    teams: [],
    hasPremiumFeature: () => true,
    models: { contextualBandits: { removePendingFeatureDraft: jest.fn() } },
  } as unknown as ReqContext;
}

beforeEach(() => {
  jest.clearAllMocks();
  (getFeature as jest.Mock).mockResolvedValue({
    id: "flag",
    organization: "org_1",
  });
  (getRevision as jest.Mock).mockResolvedValue({
    version: 6,
    status: "draft",
    baseVersion: 4,
    rules: [],
  });
  // Live advanced past the draft's base, but the merge itself is clean.
  (getLiveAndBaseRevisionsForFeature as jest.Mock).mockResolvedValue({
    live: { version: 5, rules: [] },
    base: { version: 4, rules: [] },
  });
  (autoMerge as jest.Mock).mockReturnValue({
    success: true,
    conflicts: [],
    result: { rules: [{ id: "fr_1" }] },
  });
  (assessRevisionApproval as jest.Mock).mockReturnValue({
    requiresReview: false,
    uncoveredApprovers: [],
    hasCoveringApproval: false,
    requiredApproverTeams: { satisfied: true, unmet: [] },
    requiredProjectApprovers: { satisfied: true, unmet: [] },
    satisfied: true,
  });
});

describe("publishPendingFeatureDraftsForContextualBandit", () => {
  it("refuses a mergeable diverged draft when the org requires rebase before publish", async () => {
    const result = await publishPendingFeatureDraftsForContextualBandit(
      context({ requireRebaseBeforePublish: true }),
      cb,
    );
    expect(result).toEqual({
      published: [],
      failed: [
        { featureId: "flag", revisionVersion: 6, reason: "needs-rebase" },
      ],
    });
    expect(publishRevision).not.toHaveBeenCalled();
  });

  it("auto-merges and publishes the same draft when the org does not", async () => {
    const result = await publishPendingFeatureDraftsForContextualBandit(
      context({}),
      cb,
    );
    expect(result).toEqual({
      published: [{ featureId: "flag", revisionVersion: 6 }],
      failed: [],
    });
    expect(publishRevision).toHaveBeenCalledTimes(1);
  });
});
