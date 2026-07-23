import { ContextualBanditInterface } from "shared/validators";
import { ApiReqContext } from "back-end/types/api";
import { addVariationValuesToLinkedFeatures } from "back-end/src/enterprise/services/contextualBandits";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getDraftRevision } from "back-end/src/services/features";
import { updateRevision } from "back-end/src/models/FeatureRevisionModel";
import { publishPendingFeatureDraftsForContextualBandit } from "back-end/src/services/experiment-feature";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
}));
jest.mock("back-end/src/services/features", () => ({
  getDraftRevision: jest.fn(),
}));
jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  updateRevision: jest.fn(),
}));
jest.mock("back-end/src/services/featureRevisionEvents", () => ({
  recordRevisionUpdate: jest.fn(),
}));
jest.mock("back-end/src/services/experiment-feature", () => ({
  publishPendingFeatureDraftsForContextualBandit: jest
    .fn()
    .mockResolvedValue({ published: [], failed: [] }),
}));
jest.mock("back-end/src/services/contextualBanditChanges", () => ({
  refreshLinkedFeaturePayloads: jest.fn(),
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

const getFeatureMock = getFeature as jest.Mock;
const getDraftRevisionMock = getDraftRevision as jest.Mock;
const updateRevisionMock = updateRevision as jest.Mock;
const publishMock = publishPendingFeatureDraftsForContextualBandit as jest.Mock;

function cbRefRule() {
  return {
    id: "rule_1",
    type: "contextual-bandit-ref",
    contextualBanditId: "cb_1",
    enabled: true,
    allEnvironments: true,
    variations: [
      { variationId: "v0", value: "control" },
      { variationId: "v1", value: "treatment" },
    ],
  };
}

function makeFeature(valueType = "string", defaultValue = "control") {
  return {
    id: "feature",
    organization: "org_1",
    version: 4,
    valueType,
    defaultValue,
    environmentSettings: {},
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

function makeContext(cb: ContextualBanditInterface) {
  const addPendingFeatureDraft = jest.fn().mockResolvedValue(undefined);
  const getById = jest.fn().mockResolvedValue(cb);
  const warn = jest.fn();
  const context = {
    environments: ["production"],
    org: { id: "org_1", settings: {} },
    auditUser: { type: "dashboard", id: "u1", email: "u@x.co", name: "U" },
    logger: { warn },
    models: { contextualBandits: { addPendingFeatureDraft, getById } },
  } as unknown as ApiReqContext;
  return { context, addPendingFeatureDraft, getById, warn };
}

describe("addVariationValuesToLinkedFeatures", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getFeatureMock.mockResolvedValue(makeFeature());
    getDraftRevisionMock.mockImplementation(async () => ({
      version: 5,
      rules: [cbRefRule()],
    }));
    updateRevisionMock.mockImplementation(async (_c, _f, rev) => rev);
  });

  it("defaults a new arm's value to the control value and stages a draft", async () => {
    const cb = makeCb();
    const { context, addPendingFeatureDraft } = makeContext(cb);

    await addVariationValuesToLinkedFeatures(context, cb, ["v2"], undefined);

    const [, , , changes] = updateRevisionMock.mock.calls[0];
    const rule = changes.rules.find(
      (r: { type: string }) => r.type === "contextual-bandit-ref",
    );
    expect(rule.variations).toContainEqual({
      variationId: "v2",
      value: "control",
    });
    expect(addPendingFeatureDraft).toHaveBeenCalledWith("cb_1", "feature", 5);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("uses a caller-supplied value when provided", async () => {
    const cb = makeCb();
    const { context } = makeContext(cb);

    await addVariationValuesToLinkedFeatures(context, cb, ["v2"], {
      feature: { v2: "added" },
    });

    const [, , , changes] = updateRevisionMock.mock.calls[0];
    const rule = changes.rules.find(
      (r: { type: string }) => r.type === "contextual-bandit-ref",
    );
    expect(rule.variations).toContainEqual({
      variationId: "v2",
      value: "added",
    });
  });

  it("publishes staged drafts immediately for a running CB", async () => {
    const cb = makeCb({ status: "running" });
    const { context } = makeContext(cb);

    const { failures } = await addVariationValuesToLinkedFeatures(
      context,
      cb,
      ["v2"],
      undefined,
    );

    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(failures).toEqual([]);
  });

  it("surfaces + logs publish failures instead of swallowing them (#2)", async () => {
    const failed = [
      { featureId: "feature", revisionVersion: 5, reason: "needs-approval" },
    ];
    publishMock.mockResolvedValueOnce({ published: [], failed });
    const cb = makeCb({ status: "running" });
    const { context, warn } = makeContext(cb);

    const { failures } = await addVariationValuesToLinkedFeatures(
      context,
      cb,
      ["v2"],
      undefined,
    );

    expect(failures).toEqual(failed);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("throws on a value that fails the feature's type validation", async () => {
    getFeatureMock.mockResolvedValue(makeFeature("number", "1"));
    const cb = makeCb();
    const { context } = makeContext(cb);

    await expect(
      addVariationValuesToLinkedFeatures(context, cb, ["v2"], {
        feature: { v2: "not-a-number" },
      }),
    ).rejects.toThrow();
  });

  it("no-ops when the added arm already has a value on the rule", async () => {
    const cb = makeCb();
    const { context, addPendingFeatureDraft } = makeContext(cb);

    await addVariationValuesToLinkedFeatures(context, cb, ["v1"], undefined);

    expect(updateRevisionMock).not.toHaveBeenCalled();
    expect(addPendingFeatureDraft).not.toHaveBeenCalled();
  });

  it("no-ops when the CB has no linked features", async () => {
    const cb = makeCb({ linkedFeatures: [] });
    const { context } = makeContext(cb);

    await addVariationValuesToLinkedFeatures(context, cb, ["v2"], undefined);

    expect(getFeatureMock).not.toHaveBeenCalled();
    expect(updateRevisionMock).not.toHaveBeenCalled();
  });
});
