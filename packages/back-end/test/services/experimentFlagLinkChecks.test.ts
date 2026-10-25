import type { ExperimentInterface } from "shared/validators";
import type { ExperimentRefRule, FeatureInterface } from "shared/types/feature";
import type { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
  publishRevision: jest.fn(),
}));

jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  discardRevision: jest.fn(),
  getRevision: jest.fn(),
  updateRevision: jest.fn(),
}));

jest.mock("back-end/src/services/featureRevisionEvents", () => ({
  recordRevisionUpdate: jest.fn(),
}));

jest.mock("back-end/src/services/features", () => ({
  assertCanAutoPublish: jest.fn(),
  generateRuleId: jest.fn(() => "fr_new"),
  getDraftRevision: jest.fn(),
  getLiveAndBaseRevisionsForFeature: jest.fn(),
  getLiveRevisionForFeature: jest.fn(),
}));

jest.mock("back-end/src/api/features/validations", () => ({
  ...jest.requireActual("back-end/src/api/features/validations"),
  assertValidRuleWrite: jest.fn(),
}));

jest.mock("back-end/src/services/configValidation", () => ({
  ...jest.requireActual("back-end/src/services/configValidation"),
  assertConfigBackedFeatureValuesValid: jest.fn(),
}));

jest.mock("back-end/src/services/holdouts", () => ({
  ...jest.requireActual("back-end/src/services/holdouts"),
  resolveHoldoutExperimentToLink: jest.fn(),
}));

import {
  assertFlagKeepable,
  assertFlagLinkable,
  linkFeatureToExperiment,
} from "back-end/src/services/experiment-feature";
import {
  assertCanAutoPublish,
  getDraftRevision,
} from "back-end/src/services/features";
import {
  discardRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { assertValidRuleWrite } from "back-end/src/api/features/validations";
import { resolveHoldoutExperimentToLink } from "back-end/src/services/holdouts";

const mockGetDraftRevision = getDraftRevision as jest.Mock;
const mockAssertValidRuleWrite = assertValidRuleWrite as jest.Mock;
const mockResolveHoldout = resolveHoldoutExperimentToLink as jest.Mock;

const context = {
  org: { id: "org_1", settings: {} },
  environments: ["production"],
  permissions: {
    canEditFeatureDrafts: () => true,
    canPublishFeature: () => true,
    throwPermissionError: () => {
      throw new Error("permission");
    },
  },
} as unknown as ReqContext;

const feature = {
  id: "flag",
  organization: "org_1",
  version: 3,
  valueType: "string",
  defaultValue: "a",
  holdout: { id: "ho_1", value: "a" },
  environmentSettings: {},
  rules: [],
} as unknown as FeatureInterface;

// As this save leaves it: v2 is added in the same save.
const planned = {
  id: "exp_1",
  name: "Experiment",
  status: "draft",
  variations: [{ id: "v0" }, { id: "v1" }, { id: "v2" }],
  pendingFeatureUnlinks: [],
} as unknown as ExperimentInterface;

const rule: ExperimentRefRule = {
  type: "experiment-ref",
  id: "",
  description: "",
  enabled: true,
  experimentId: "exp_1",
  allEnvironments: true,
  variations: ["v0", "v1", "v2"].map((variationId) => ({
    variationId,
    value: "a",
  })),
} as ExperimentRefRule;

beforeEach(() => jest.clearAllMocks());

describe("assertFlagLinkable", () => {
  it("judges the rule and the holdout against the experiment it is given", async () => {
    await assertFlagLinkable({
      context,
      experiment: planned,
      feature,
      rule,
      forceNewDraft: true,
    });

    expect(mockAssertValidRuleWrite.mock.calls[0][4]).toEqual([planned]);
    // A draft cut from live carries live's holdout.
    expect(mockResolveHoldout).toHaveBeenCalledWith(
      expect.objectContaining({
        experiment: planned,
        effectiveHoldout: feature.holdout,
      }),
    );
  });
});

describe("linkFeatureToExperiment", () => {
  it("starts no draft when the holdout refuses the link", async () => {
    mockResolveHoldout.mockRejectedValueOnce(new Error("holdout"));

    await expect(
      linkFeatureToExperiment({
        context,
        experiment: planned,
        feature,
        rule,
        eventAudit: { type: "dashboard" } as never,
        audit: jest.fn(),
        forceNewDraft: true,
      }),
    ).rejects.toThrow("holdout");
    expect(mockGetDraftRevision).not.toHaveBeenCalled();
  });

  it("discards the draft it opened when the publish is refused", async () => {
    const draft = { featureId: "flag", version: 4, rules: [] };
    mockGetDraftRevision.mockResolvedValueOnce(draft);
    (updateRevision as jest.Mock).mockResolvedValueOnce(draft);
    (assertCanAutoPublish as jest.Mock).mockRejectedValueOnce(
      new Error("needs approval"),
    );

    await expect(
      linkFeatureToExperiment({
        context,
        experiment: planned,
        feature,
        rule,
        eventAudit: { type: "dashboard" } as never,
        audit: jest.fn(),
        autoPublish: true,
      }),
    ).rejects.toThrow("needs approval");
    expect(discardRevision).toHaveBeenCalledWith(
      context,
      draft,
      undefined,
      null,
    );
  });

  it("keeps an existing draft it was adding to", async () => {
    mockGetDraftRevision.mockResolvedValueOnce({
      featureId: "flag",
      version: 2,
    });
    (updateRevision as jest.Mock).mockRejectedValueOnce(new Error("changed"));

    await expect(
      linkFeatureToExperiment({
        context,
        experiment: planned,
        feature,
        rule,
        eventAudit: { type: "dashboard" } as never,
        audit: jest.fn(),
        draftVersion: 2,
      }),
    ).rejects.toThrow("changed");
    expect(discardRevision).not.toHaveBeenCalled();
  });
});

describe("assertFlagKeepable", () => {
  it("refuses a flag the experiment isn't removing", async () => {
    await expect(assertFlagKeepable(context, planned, feature)).rejects.toThrow(
      'Feature Flag "flag" is not being removed from this experiment',
    );
  });
});
