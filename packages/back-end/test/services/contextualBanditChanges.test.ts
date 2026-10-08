import { ContextualBanditInterface } from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import { ReqContext } from "back-end/types/request";
import {
  contextualBanditUpdateAffectsPayload,
  refreshLinkedFeaturePayloads,
} from "back-end/src/services/contextualBanditChanges";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getAllFeatures: jest.fn(),
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

const getAllFeaturesMock = getAllFeatures as jest.MockedFunction<
  typeof getAllFeatures
>;
const queueSDKPayloadRefreshMock =
  queueSDKPayloadRefresh as jest.MockedFunction<typeof queueSDKPayloadRefresh>;

function makeContext(): ReqContext {
  // No org.settings.environments → getEnvironmentIdsFromOrg falls back to
  // the default ["dev", "production"].
  return {
    org: { id: "org_1" },
    getAllProjectIds: jest.fn().mockResolvedValue([]),
  } as unknown as ReqContext;
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

  it("queues a refresh with keys derived from a feature's enabled contextual-bandit-ref rule", async () => {
    const context = makeContext();
    const cb = makeCb();
    getAllFeaturesMock.mockResolvedValue([makeLinkedFeature()]);

    await refreshLinkedFeaturePayloads(context, cb, "contextualBandit.refresh");

    expect(getAllFeaturesMock).toHaveBeenCalledWith(context);
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

  it("refreshes a feature that references the CB even when it is missing from cb.linkedFeatures (drift)", async () => {
    const context = makeContext();
    // linkedFeatures is stale/empty, but a feature's rule still references the
    // CB — the refresh must be derived from the rules, not linkedFeatures.
    const cb = makeCb({ linkedFeatures: [] });
    getAllFeaturesMock.mockResolvedValue([
      makeLinkedFeature({
        id: "feat_2",
      } as unknown as Partial<FeatureInterface>),
    ]);

    await refreshLinkedFeaturePayloads(context, cb, "contextualBandit.refresh");

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

  it("does not queue a refresh when the org has no features", async () => {
    getAllFeaturesMock.mockResolvedValue([]);

    await refreshLinkedFeaturePayloads(
      makeContext(),
      makeCb({ linkedFeatures: [] }),
      "contextualBandit.refresh",
    );

    expect(queueSDKPayloadRefreshMock).not.toHaveBeenCalled();
  });

  it("does not queue a refresh when the feature's rule points at a different CB", async () => {
    getAllFeaturesMock.mockResolvedValue([
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
    getAllFeaturesMock.mockResolvedValue([
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

  it("refreshes every environment for a visual bandit with no linked rule", async () => {
    getAllFeaturesMock.mockResolvedValue([]);

    await refreshLinkedFeaturePayloads(
      makeContext(),
      makeCb({
        linkedFeatures: [],
        project: "prj_a",
        hasVisualChangesets: true,
      }),
      "contextualBandit.refresh",
    );

    expect(queueSDKPayloadRefreshMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadKeys: [
          { environment: "dev", project: "" },
          { environment: "dev", project: "prj_a" },
          { environment: "production", project: "" },
          { environment: "production", project: "prj_a" },
        ],
      }),
    );
  });

  it("refreshes every environment when asked to, after the last changeset is gone", async () => {
    getAllFeaturesMock.mockResolvedValue([]);

    await refreshLinkedFeaturePayloads(
      makeContext(),
      makeCb({ linkedFeatures: [], hasVisualChangesets: false }),
      "contextualBandit.refresh",
      { includeVisualKeys: true },
    );

    expect(queueSDKPayloadRefreshMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadKeys: [
          { environment: "dev", project: "" },
          { environment: "production", project: "" },
        ],
      }),
    );
  });

  it("adds the visual keys to the linked rule's keys without duplicates", async () => {
    getAllFeaturesMock.mockResolvedValue([makeLinkedFeature()]);

    await refreshLinkedFeaturePayloads(
      makeContext(),
      makeCb(),
      "contextualBandit.refresh",
      { includeVisualKeys: true },
    );

    expect(queueSDKPayloadRefreshMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadKeys: [
          { environment: "production", project: "" },
          { environment: "dev", project: "" },
        ],
      }),
    );
  });
});

describe("contextualBanditUpdateAffectsPayload", () => {
  const running = makeCb({ status: "running", project: "prj_a" });

  it("is true when a running bandit's targeting changes", () => {
    const updates = { condition: '{"country":"US"}' };
    expect(
      contextualBanditUpdateAffectsPayload(running, updates, {
        ...running,
        ...updates,
      }),
    ).toBe(true);
  });

  it("is true when a running bandit is stopped or archived", () => {
    for (const updates of [
      { status: "stopped" as const },
      { archived: true },
    ]) {
      expect(
        contextualBanditUpdateAffectsPayload(running, updates, {
          ...running,
          ...updates,
        }),
      ).toBe(true);
    }
  });

  it("is true when a running bandit moves project", () => {
    const updates = { project: "prj_b" };
    expect(
      contextualBanditUpdateAffectsPayload(running, updates, {
        ...running,
        ...updates,
      }),
    ).toBe(true);
  });

  it("is true when a running bandit is renamed or retagged", () => {
    for (const updates of [{ name: "Renamed" }, { tags: ["promo"] }]) {
      expect(
        contextualBanditUpdateAffectsPayload(running, updates, {
          ...running,
          ...updates,
        }),
      ).toBe(true);
    }
  });

  it("is false for fields the payload does not read", () => {
    const updates = { description: "New" };
    expect(
      contextualBanditUpdateAffectsPayload(running, updates, {
        ...running,
        ...updates,
      }),
    ).toBe(false);
  });

  it("is false when a payload field is resent unchanged", () => {
    const updates = { project: "prj_a", coverage: running.coverage };
    expect(
      contextualBanditUpdateAffectsPayload(running, updates, {
        ...running,
        ...updates,
      }),
    ).toBe(false);
  });

  it("is false for edits to a draft that stays a draft", () => {
    const draft = makeCb({ status: "draft" });
    const updates = { condition: '{"country":"US"}' };
    expect(
      contextualBanditUpdateAffectsPayload(draft, updates, {
        ...draft,
        ...updates,
      }),
    ).toBe(false);
  });

  it("is true when a draft is started through the update", () => {
    const draft = makeCb({ status: "draft" });
    const updates = { status: "running" as const };
    expect(
      contextualBanditUpdateAffectsPayload(draft, updates, {
        ...draft,
        ...updates,
      }),
    ).toBe(true);
  });
});
