import { EventInterface } from "shared/types/events/event";
import { EventWebHookInterface } from "shared/types/event-webhook";
import {
  collectMetricIds,
  getSlackEventResource,
  matchesSlackResourceFilters,
  filterWebhooksByResources,
} from "../../src/events/handlers/webhooks/slackResourceFilters";
import { getContextForAgendaJobByOrgId } from "../../src/services/organizations";
import { getFeatureLinkedExperimentIds } from "../../src/models/FeatureModel";
import { getExperimentsByIds } from "../../src/models/ExperimentModel";

jest.mock("../../src/services/organizations", () => ({
  getContextForAgendaJobByOrgId: jest.fn(),
}));
jest.mock("../../src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
  getFeatureLinkedExperimentIds: jest.fn(),
}));
jest.mock("../../src/models/ExperimentModel", () => ({
  getExperimentsByIds: jest.fn(),
}));

beforeEach(() => jest.clearAllMocks());
const related = {
  experiments: ["exp_a"],
  metrics: ["fact__a"],
  features: ["flag-a"],
};
test("unset and empty filters preserve existing delivery", () => {
  expect(matchesSlackResourceFilters({}, related)).toBe(true);
  expect(
    matchesSlackResourceFilters(
      { experiments: [], features: [], metrics: [] },
      related,
    ),
  ).toBe(true);
});
test("filters intersect within each dimension and combine across dimensions", () => {
  expect(
    matchesSlackResourceFilters(
      {
        experiments: ["exp_a", "exp_b"],
        metrics: ["fact__a"],
        features: ["flag-a"],
      },
      related,
    ),
  ).toBe(true);
  expect(
    matchesSlackResourceFilters(
      { experiments: ["exp_a"], metrics: ["met_missing"] },
      related,
    ),
  ).toBe(false);
  expect(
    matchesSlackResourceFilters(
      { features: ["flag-a"] },
      { ...related, features: [] },
    ),
  ).toBe(false);
});
test("collects classic, fact and group metric IDs from nested payloads", () => {
  expect(
    new Set(
      collectMetricIds({
        object: {
          goalMetrics: ["met_a"],
          guardrails: ["fact__b"],
          metricIds: ["mg_c"],
          name: "other",
        },
      }),
    ),
  ).toEqual(new Set(["met_a", "fact__b", "mg_c"]));
});
test("unfiltered webhooks need no context or association queries", async () => {
  const hooks = [{} as EventWebHookInterface];
  expect(await filterWebhooksByResources({} as EventInterface, hooks)).toBe(
    hooks,
  );
  expect(getContextForAgendaJobByOrgId).not.toHaveBeenCalled();
});
test("experiment events match linked feature and configured metrics", async () => {
  const context = { org: { id: "org_a" } };
  jest
    .mocked(getContextForAgendaJobByOrgId)
    .mockResolvedValue(
      context as Awaited<ReturnType<typeof getContextForAgendaJobByOrgId>>,
    );
  jest
    .mocked(getExperimentsByIds)
    .mockResolvedValue([
      { linkedFeatures: ["flag-a"], goalMetrics: ["fact__a"] },
    ] as Awaited<ReturnType<typeof getExperimentsByIds>>);
  const hooks = [
    { features: ["flag-a"], metrics: ["fact__a"] } as EventWebHookInterface,
  ];
  expect(
    await filterWebhooksByResources(
      {
        organizationId: "org_a",
        data: { object: "experiment", data: { object: { id: "exp_a" } } },
      } as EventInterface,
      hooks,
    ),
  ).toEqual(hooks);
  expect(getExperimentsByIds).toHaveBeenCalledWith(context, ["exp_a"]);
  expect(getExperimentsByIds).toHaveBeenCalledTimes(1);
});
test("feature events match linked experiments", async () => {
  jest.mocked(getFeatureLinkedExperimentIds).mockResolvedValue(["exp_a"]);
  const hooks = [{ experiments: ["exp_a"] } as EventWebHookInterface];
  expect(
    await filterWebhooksByResources(
      {
        organizationId: "org_a",
        data: { object: "feature", data: { object: { id: "flag-a" } } },
      } as EventInterface,
      hooks,
    ),
  ).toEqual(hooks);
});
test("association failures propagate so queued delivery can retry", async () => {
  jest
    .mocked(getFeatureLinkedExperimentIds)
    .mockRejectedValue(new Error("DB unavailable"));
  await expect(
    filterWebhooksByResources(
      {
        organizationId: "org_a",
        data: { object: "feature", data: { object: { id: "flag-a" } } },
      } as EventInterface,
      [{ experiments: ["exp_a"] } as EventWebHookInterface],
    ),
  ).rejects.toThrow("DB unavailable");
});

test("normalizes current, legacy deleted and persisted resource ids", () => {
  const base = {
    data: {
      object: "experiment",
      data: { object: { experimentId: "exp_warning" } },
    },
  } as EventInterface;
  expect(getSlackEventResource(base)).toEqual({
    resource: "experiment",
    id: "exp_warning",
  });
  expect(
    getSlackEventResource({
      data: { object: "feature", data: { previous: { id: "deleted" } } },
    } as EventInterface),
  ).toEqual({ resource: "feature", id: "deleted" });
  expect(
    getSlackEventResource({ ...base, objectId: "persisted" } as EventInterface),
  ).toEqual({ resource: "experiment", id: "persisted" });
});

test("empty experiment updates skip Slack but preserve customer webhooks", async () => {
  const slack = { payloadType: "slack" } as EventWebHookInterface;
  const json = { payloadType: "json" } as EventWebHookInterface;
  const raw = {} as EventWebHookInterface;
  const event = {
    organizationId: "org_a",
    data: {
      event: "experiment.updated",
      data: { changes: { added: {}, removed: {}, modified: [] } },
    },
  };
  expect(await filterWebhooksByResources(event, [slack, json, raw])).toEqual([
    json,
    raw,
  ]);
  expect(getContextForAgendaJobByOrgId).not.toHaveBeenCalled();
});

test.each(["object", "previous"])(
  "deleted experiment uses %s snapshot links and metric ids",
  async (shape) => {
    jest.mocked(getExperimentsByIds).mockResolvedValueOnce([]);
    const hooks = [
      {
        features: ["deleted-flag"],
        metrics: ["fact__deleted"],
      } as EventWebHookInterface,
    ];
    expect(
      await filterWebhooksByResources(
        {
          organizationId: "org_a",
          data: {
            object: "experiment",
            data: {
              [shape]: {
                id: "exp_deleted",
                linkedFeatures: ["deleted-flag"],
                goalMetrics: ["fact__deleted"],
              },
            },
          },
        },
        hooks,
      ),
    ).toEqual(hooks);
  },
);
test("the live experiment's canonical links override stale event links", async () => {
  jest
    .mocked(getExperimentsByIds)
    .mockResolvedValueOnce([{ id: "exp_a", linkedFeatures: [] }] as Awaited<
      ReturnType<typeof getExperimentsByIds>
    >);
  expect(
    await filterWebhooksByResources(
      {
        organizationId: "org_a",
        data: {
          object: "experiment",
          data: { object: { id: "exp_a", linkedFeatures: ["old-flag"] } },
        },
      },
      [{ features: ["old-flag"] } as EventWebHookInterface],
    ),
  ).toEqual([]);
});
