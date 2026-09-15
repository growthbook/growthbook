import type { EventInterface } from "shared/types/events/event";
import type { ReqContext } from "back-end/types/request";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getExperimentsByIds } from "back-end/src/models/ExperimentModel";
import {
  matchesNotificationFilters,
  matchesNotificationResourceFilters,
} from "back-end/src/events/notificationFilters";
import { getNotificationResources } from "back-end/src/events/notificationResources";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
}));
jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentsByIds: jest.fn(),
}));
const metricGroups = jest.fn();
const rollouts = jest.fn();
const context = {
  org: { id: "org_a" },
  models: {
    metricGroups: { getAll: metricGroups },
    safeRollout: { getAllByFeatureId: rollouts },
  },
} as unknown as ReqContext;
const event = (
  resource: "experiment" | "feature",
  object: object,
  kind = "updated",
) =>
  ({
    organizationId: "org_a",
    version: 1,
    data: { event: `${resource}.${kind}`, object: resource, data: { object } },
  }) as EventInterface;
const metricFilter = { metrics: ["fact__revenue"] };
const related = {
  experiments: ["exp_a"],
  features: ["flag-a"],
  metrics: ["fact__revenue"],
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getFeature).mockResolvedValue(null);
  jest.mocked(getExperimentsByIds).mockResolvedValue([]);
  rollouts.mockResolvedValue([]);
  metricGroups.mockResolvedValue([
    { id: "mg_goals", metrics: ["fact__revenue"] },
  ]);
});

test("empty filters match without relationship queries", async () => {
  expect(
    await matchesNotificationFilters(
      context,
      event("experiment", { id: "exp_a" }),
      {},
    ),
  ).toBe(true);
  expect(getExperimentsByIds).not.toHaveBeenCalled();
  expect(getFeature).not.toHaveBeenCalled();
  expect(metricGroups).not.toHaveBeenCalled();
});
test("resource filters combine across dimensions and intersect within them", () => {
  expect(matchesNotificationResourceFilters({}, related)).toBe(true);
  expect(
    matchesNotificationResourceFilters(
      { experiments: ["exp_a", "exp_b"], ...metricFilter },
      related,
    ),
  ).toBe(true);
  expect(
    matchesNotificationResourceFilters(
      { experiments: ["missing"], ...metricFilter },
      related,
    ),
  ).toBe(false);
});
test("snapshot metrics include activation metrics without matching arbitrary strings", async () => {
  const resources = await getNotificationResources(
    context,
    event("experiment", {
      id: "exp_a",
      name: "fact__unrelated",
      settings: {
        goals: [{ metricId: "fact__revenue", overrides: {} }],
        activationMetric: { metricId: "fact__activation", overrides: {} },
      },
    }),
    metricFilter,
  );
  expect(resources.metrics).toEqual(["fact__revenue", "fact__activation"]);
});
test.each(["fact__revenue", "mg_goals", "fact__revenue?country=US"])(
  "matches an experiment using %s",
  async (metricId) => {
    jest
      .mocked(getExperimentsByIds)
      .mockResolvedValue([{ id: "exp_a", goalMetrics: [metricId] }] as Awaited<
        ReturnType<typeof getExperimentsByIds>
      >);
    expect(
      await matchesNotificationFilters(
        context,
        event("experiment", { experimentId: "exp_a", type: "srm" }, "warning"),
        metricFilter,
      ),
    ).toBe(true);
  },
);
test.each(["goals", "secondaryMetrics", "guardrails"])(
  "deleted experiments retain API snapshot %s",
  async (key) => {
    expect(
      await matchesNotificationFilters(
        context,
        event(
          "experiment",
          {
            id: "exp_deleted",
            settings: { [key]: [{ metricId: "fact__revenue", overrides: {} }] },
            linkedFeatures: ["flag-a"],
          },
          "deleted",
        ),
        { ...metricFilter, features: ["flag-a"] },
      ),
    ).toBe(true);
  },
);
test("live canonical links override stale experiment snapshot links", async () => {
  jest
    .mocked(getExperimentsByIds)
    .mockResolvedValue([{ id: "exp_a", linkedFeatures: [] }] as Awaited<
      ReturnType<typeof getExperimentsByIds>
    >);
  expect(
    await matchesNotificationFilters(
      context,
      event("experiment", { id: "exp_a", linkedFeatures: ["flag-a"] }),
      { features: ["flag-a"] },
    ),
  ).toBe(false);
});
test("deleted features retain canonical links even when no current rule references them", async () => {
  const deleted = {
    ...event("feature", { id: "flag-a" }, "deleted"),
    relatedResources: { experiments: ["exp_a"] },
  };
  expect(
    await matchesNotificationFilters(context, deleted, {
      experiments: ["exp_a"],
    }),
  ).toBe(true);
});
test("older deleted feature events recover experiment references from API rules", async () => {
  const deleted = event(
    "feature",
    {
      id: "flag-a",
      environments: {
        production: {
          rules: [{ type: "experiment-ref", experimentId: "exp_a" }],
        },
      },
    },
    "deleted",
  );
  expect(
    await matchesNotificationFilters(context, deleted, {
      experiments: ["exp_a"],
    }),
  ).toBe(true);
});
test("feature metrics include inline rules, linked experiments and safe rollouts", async () => {
  jest.mocked(getFeature).mockResolvedValue({
    id: "flag-a",
    linkedExperiments: ["exp_a"],
    rules: [{ type: "experiment", goalMetrics: ["fact__inline"] }],
  } as Awaited<ReturnType<typeof getFeature>>);
  jest
    .mocked(getExperimentsByIds)
    .mockResolvedValue([{ id: "exp_a", goalMetrics: ["mg_goals"] }] as Awaited<
      ReturnType<typeof getExperimentsByIds>
    >);
  rollouts.mockResolvedValue([{ guardrailMetricIds: ["fact__rollout"] }]);
  const resources = await getNotificationResources(
    context,
    event("feature", { id: "flag-a" }),
    metricFilter,
  );
  expect(resources.metrics).toEqual(
    expect.arrayContaining(["fact__inline", "fact__rollout", "fact__revenue"]),
  );
});
test.each(["fact__revenue", { metricId: "fact__revenue" }])(
  "legacy snapshots have the same resource matching semantics for %j",
  async (metric) => {
    const legacy = {
      organizationId: "org_a",
      data: {
        event: "experiment.deleted",
        object: "experiment",
        data: {
          previous: {
            id: "exp_a",
            settings: { goals: [metric] },
          },
        },
      },
    } as EventInterface;
    expect(
      await matchesNotificationFilters(context, legacy, metricFilter),
    ).toBe(true);
  },
);
test("bookkeeping policy is explicit and independent of delivery format", async () => {
  const update = {
    ...event("experiment", { id: "exp_a" }),
    data: {
      event: "experiment.updated",
      data: {
        object: { id: "exp_a", dateUpdated: "today" },
        previous_attributes: { dateUpdated: "yesterday" },
        changes: { added: {}, removed: {}, modified: [] },
      },
    },
  } as EventInterface;
  for (const payloadType of ["slack", "discord", "json", "raw"]) {
    const subscription = { payloadType, excludeEmptyUpdates: true };
    expect(
      await matchesNotificationFilters(context, update, subscription),
    ).toBe(false);
    expect(
      await matchesNotificationFilters(context, update, {
        ...subscription,
        excludeEmptyUpdates: false,
      }),
    ).toBe(true);
  }
  expect(await matchesNotificationFilters(context, update, {})).toBe(true);
});
test("lookup failures remain visible to the delivery job", async () => {
  jest.mocked(getFeature).mockRejectedValue(new Error("DB unavailable"));
  await expect(
    matchesNotificationFilters(context, event("feature", { id: "flag-a" }), {
      experiments: ["exp_a"],
    }),
  ).rejects.toThrow("DB unavailable");
});

test("persisted resource IDs take precedence over IDs within a revision payload", async () => {
  const revision = {
    ...event("feature", { id: "revision-3" }, "revision.published"),
    objectId: "flag-a",
  };
  expect(
    await matchesNotificationFilters(context, revision, {
      features: ["flag-a"],
    }),
  ).toBe(true);
  expect(getFeature).not.toHaveBeenCalled();
});

test("malformed historical feature rules fail visibly instead of dropping relationships", async () => {
  await expect(
    matchesNotificationFilters(
      context,
      event(
        "feature",
        {
          id: "flag-a",
          environments: {
            production: {
              rules: [{ type: "experiment-ref", experimentId: 123 }],
            },
          },
        },
        "deleted",
      ),
      { experiments: ["exp_a"] },
    ),
  ).rejects.toThrow();
});

test.each([
  [{ type: "experiment", goalMetrics: ["fact__inline"] }],
  { production: [{ type: "experiment", goalMetrics: ["fact__inline"] }] },
])(
  "historical revision rule layouts retain metric relationships",
  async (rules) => {
    expect(
      await matchesNotificationFilters(
        context,
        {
          ...event(
            "feature",
            { featureId: "flag-a", rules },
            "revision.published",
          ),
          objectId: "flag-a",
        },
        { metrics: ["fact__inline"] },
      ),
    ).toBe(true);
  },
);
