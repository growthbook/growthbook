import { ContextualBanditInterface } from "shared/validators";
import {
  CB_TO_EXPERIMENT_SYNC_FIELDS,
  buildExperimentSyncChanges,
} from "back-end/src/enterprise/services/contextualBanditForwardSync";

/**
 * Minimal CB doc factory — only the fields the forward-sync touches.
 * Cast through `unknown` so the test doesn't have to enumerate the
 * dozens of unrelated CB fields that don't affect the helper.
 */
function makeCb(
  overrides: Partial<ContextualBanditInterface> = {},
): ContextualBanditInterface {
  return {
    id: "cb_1",
    organization: "org_1",
    experiment: "exp_1",
    name: "My CB",
    description: "desc",
    hypothesis: "hyp",
    project: "proj_1",
    owner: "user_1",
    tags: ["t1"],
    archived: false,
    status: "running",
    trackingKey: "tk",
    hashAttribute: "id",
    hashVersion: 2,
    disableStickyBucketing: false,
    variations: [
      { id: "v0", key: "0", name: "Control", screenshots: [] },
      { id: "v1", key: "1", name: "Variant", screenshots: [] },
    ],
    datasourceId: "ds_1",
    datasource: "ds_1",
    exposureQueryId: "eaq_1",
    goalMetrics: ["m_goal"],
    secondaryMetrics: [],
    guardrailMetrics: [],
    defaultMetricPriorSettings: {
      override: false,
      proper: false,
      mean: 0,
      stddev: 0.1,
    },
    phases: [],
    contextualAttributes: ["country"],
    maxContexts: 300,
    treeModel: "regression_tree",
    minUsersPerLeaf: 100,
    maxLeaves: 12,
    holdoutPercent: 0,
    canonicalFormVersion: 1,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    ...overrides,
  } as ContextualBanditInterface;
}

describe("buildExperimentSyncChanges", () => {
  it("returns an empty object when no sync-set field is in the updates", () => {
    const updates = { phases: [] } as Partial<ContextualBanditInterface>;
    const newDoc = makeCb();
    const changes = buildExperimentSyncChanges(updates, newDoc);
    expect(changes).toEqual({});
  });

  it("copies only the changed fields off the new doc, not the rest of it", () => {
    const updates: Partial<ContextualBanditInterface> = {
      name: "Renamed CB",
      goalMetrics: ["m_goal_new"],
    };
    const newDoc = makeCb({
      name: "Renamed CB",
      description: "should not appear in changes",
      goalMetrics: ["m_goal_new"],
    });

    const changes = buildExperimentSyncChanges(updates, newDoc);

    expect(changes).toEqual({
      name: "Renamed CB",
      goalMetrics: ["m_goal_new"],
    });
    // Untouched fields stay untouched even though `newDoc` carries them.
    expect(changes).not.toHaveProperty("description");
    expect(changes).not.toHaveProperty("hypothesis");
    expect(changes).not.toHaveProperty("project");
  });

  it("ignores keys outside the sync set (phases, datasourceId alias, CB-only config)", () => {
    const updates: Partial<ContextualBanditInterface> = {
      phases: [{ dateStarted: new Date(), currentLeafWeights: [] }],
      datasourceId: "ds_2",
      maxContexts: 500,
      treeModel: "linear_tree",
      minUsersPerLeaf: 50,
      maxLeaves: 20,
      holdoutPercent: 0,
      canonicalFormVersion: 1,
      contextualAttributes: ["country", "device"],
      targetingAttributeColumns: ["country", "device"],
      defaultMetricPriorSettings: {
        override: false,
        proper: false,
        mean: 0,
        stddev: 0.1,
      },
      decisionMetric: "m_decision",
    };
    const newDoc = makeCb({ ...updates });

    const changes = buildExperimentSyncChanges(updates, newDoc);

    expect(changes).toEqual({});
  });

  it("copies the status flip when only status is in the update", () => {
    const updates: Partial<ContextualBanditInterface> = {
      status: "stopped",
    };
    const newDoc = makeCb({ status: "stopped" });

    const changes = buildExperimentSyncChanges(updates, newDoc);

    expect(changes).toEqual({ status: "stopped" });
  });

  it("copies variations on update (full Variation shape with id + screenshots)", () => {
    const newVariations = [
      { id: "v0", key: "0", name: "A", screenshots: [] },
      { id: "v1", key: "1", name: "B", screenshots: [] },
      { id: "v2", key: "2", name: "C", screenshots: [] },
    ];
    const updates: Partial<ContextualBanditInterface> = {
      variations: newVariations,
    };
    const newDoc = makeCb({ variations: newVariations });

    const changes = buildExperimentSyncChanges(updates, newDoc);

    expect(changes).toEqual({ variations: newVariations });
  });

  it("is idempotent — calling twice with the same updates returns the same diff", () => {
    const updates: Partial<ContextualBanditInterface> = {
      goalMetrics: ["m1", "m2"],
      attributionModel: "experimentDuration",
    };
    const newDoc = makeCb({ ...updates });

    const first = buildExperimentSyncChanges(updates, newDoc);
    const second = buildExperimentSyncChanges(updates, newDoc);

    expect(first).toEqual(second);
    expect(first).toEqual({
      goalMetrics: ["m1", "m2"],
      attributionModel: "experimentDuration",
    });
  });

  it("the exported sync-field set matches the spec'd, narrow scope", () => {
    expect([...CB_TO_EXPERIMENT_SYNC_FIELDS].sort()).toEqual(
      [
        "activationMetric",
        "archived",
        "attributionModel",
        "customFields",
        "datasource",
        "description",
        "exposureQueryId",
        "fallbackAttribute",
        "goalMetrics",
        "guardrailMetrics",
        "hashAttribute",
        "hashVersion",
        "hypothesis",
        "metricOverrides",
        "name",
        "owner",
        "project",
        "queryFilter",
        "regressionAdjustmentEnabled",
        "secondaryMetrics",
        "segment",
        "skipPartialData",
        "status",
        "tags",
        "trackingKey",
        "variations",
      ].sort(),
    );
  });
});
