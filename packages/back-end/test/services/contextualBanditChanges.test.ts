import { ContextualBanditInterface } from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import { ReqContext } from "back-end/types/request";
import { refreshLinkedFeaturePayloads } from "back-end/src/services/contextualBanditChanges";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeaturesByIds: jest.fn(),
}));

jest.mock("back-end/src/services/features", () => ({
  queueSDKPayloadRefresh: jest.fn(),
}));

jest.mock("back-end/src/services/audit", () => ({
  auditDetailsUpdate: jest.fn(),
}));

jest.mock("back-end/src/services/experiment-feature", () => ({
  publishPendingFeatureDraftsForContextualBandit: jest.fn(),
  formatPendingDraftFailureMessage: jest.fn(),
}));

const getFeaturesByIdsMock = getFeaturesByIds as jest.MockedFunction<
  typeof getFeaturesByIds
>;
const queueSDKPayloadRefreshMock =
  queueSDKPayloadRefresh as jest.MockedFunction<typeof queueSDKPayloadRefresh>;

function makeContext(): ReqContext {
  // No org.settings.environments → getEnvironmentIdsFromOrg falls back to
  // the default ["dev", "production"].
  return { org: { id: "org_1" } } as unknown as ReqContext;
}

function makeCb(
  overrides: Partial<ContextualBanditInterface> = {},
): ContextualBanditInterface {
  return {
    id: "cb_1",
    organization: "org_1",
    linkedFeatures: ["feat_1"],
    ...overrides,
  } as unknown as ContextualBanditInterface;
}

function makeLinkedFeature(
  overrides: Partial<FeatureInterface> = {},
): FeatureInterface {
  return {
    id: "feat_1",
    organization: "org_1",
    project: "",
    environmentSettings: {
      production: { enabled: true },
    },
    rules: [
      {
        id: "rule_1",
        type: "contextual-bandit-ref",
        contextualBanditId: "cb_1",
        enabled: true,
        environments: ["production"],
        variations: [],
      },
    ],
    ...overrides,
  } as unknown as FeatureInterface;
}

describe("refreshLinkedFeaturePayloads", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("queues a refresh with keys derived from the linked feature's enabled contextual-bandit-ref rule", async () => {
    const context = makeContext();
    const cb = makeCb();
    getFeaturesByIdsMock.mockResolvedValue([makeLinkedFeature()]);

    await refreshLinkedFeaturePayloads(context, cb, "contextualBandit.refresh");

    expect(getFeaturesByIdsMock).toHaveBeenCalledWith(context, ["feat_1"]);
    expect(queueSDKPayloadRefreshMock).toHaveBeenCalledTimes(1);
    expect(queueSDKPayloadRefreshMock).toHaveBeenCalledWith({
      context,
      payloadKeys: [{ environment: "production", project: "" }],
      auditContext: {
        event: "contextualBandit.refresh",
        model: "contextualBandit",
        id: "cb_1",
      },
    });
  });

  it("does not queue a refresh when the CB has no linked features", async () => {
    getFeaturesByIdsMock.mockResolvedValue([]);

    await refreshLinkedFeaturePayloads(
      makeContext(),
      makeCb({ linkedFeatures: [] }),
      "contextualBandit.refresh",
    );

    expect(queueSDKPayloadRefreshMock).not.toHaveBeenCalled();
  });

  it("does not queue a refresh when the linked feature's rule points at a different CB", async () => {
    getFeaturesByIdsMock.mockResolvedValue([
      makeLinkedFeature({
        rules: [
          {
            id: "rule_1",
            type: "contextual-bandit-ref",
            contextualBanditId: "cb_other",
            enabled: true,
            environments: ["production"],
            variations: [],
          },
        ],
      } as unknown as Partial<FeatureInterface>),
    ]);

    await refreshLinkedFeaturePayloads(
      makeContext(),
      makeCb(),
      "contextualBandit.refresh",
    );

    expect(queueSDKPayloadRefreshMock).not.toHaveBeenCalled();
  });

  it("does not queue a refresh when the matching rule is disabled", async () => {
    getFeaturesByIdsMock.mockResolvedValue([
      makeLinkedFeature({
        rules: [
          {
            id: "rule_1",
            type: "contextual-bandit-ref",
            contextualBanditId: "cb_1",
            enabled: false,
            environments: ["production"],
            variations: [],
          },
        ],
      } as unknown as Partial<FeatureInterface>),
    ]);

    await refreshLinkedFeaturePayloads(
      makeContext(),
      makeCb(),
      "contextualBandit.refresh",
    );

    expect(queueSDKPayloadRefreshMock).not.toHaveBeenCalled();
  });
});
