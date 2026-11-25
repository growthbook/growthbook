import type { NotificationEvent } from "back-end/src/events/notification-events";
import {
  filterEventForEnvironments,
  webhookEventEnvironments,
  webhookTakesEvent,
} from "back-end/src/events/handlers/utils";

/**
 * The delivery filter, and the contract `[]` carries.
 *
 * `eventEnvironments.ts` states it: an empty routing array means the event has NO
 * environment-scoped impact, and such events reach only subscriptions without a
 * filter. It had no tests, and widening `[]` to "everything" at this layer looked
 * reasonable — it sent every description edit to every environment-filtered
 * webhook, because a metadata edit's producer legitimately emits [].
 *
 * An event that really does reach all environments says so at the producer, which
 * is the only place that can tell the two apart.
 */

const event = (environments: string[]) =>
  ({ environments }) as unknown as NotificationEvent;

describe("filterEventForEnvironments", () => {
  it("delivers anything to a subscription with no filter", () => {
    for (const envs of [[], ["dev"], ["dev", "production"]]) {
      expect(
        filterEventForEnvironments({ event: event(envs), environments: [] }),
      ).toBe(true);
    }
  });

  it("delivers when the event overlaps the filter", () => {
    expect(
      filterEventForEnvironments({
        event: event(["dev", "production"]),
        environments: ["production"],
      }),
    ).toBe(true);
  });

  it("withholds when the event names only other environments", () => {
    expect(
      filterEventForEnvironments({
        event: event(["dev"]),
        environments: ["production"],
      }),
    ).toBe(false);
  });

  // The contract, and the case a previous fix inverted here rather than at the
  // producer: no environment-scoped impact reaches no filtered subscription.
  it("withholds an event with no environment-scoped impact", () => {
    expect(
      filterEventForEnvironments({
        event: event([]),
        environments: ["production"],
      }),
    ).toBe(false);
  });
});

const filters = (
  overrides: Partial<Parameters<typeof webhookTakesEvent>[0]> = {},
): Parameters<typeof webhookTakesEvent>[0] => ({
  payloadType: "json",
  projects: [],
  tags: [],
  environments: [],
  ...overrides,
});

describe("webhookTakesEvent", () => {
  const datadog = filters({ payloadType: "datadog" });

  it("sends Datadog only the events it converts, once they reach an environment", () => {
    expect(
      webhookTakesEvent(datadog, {
        event: "feature.updated",
        environments: ["production"],
      }),
    ).toBe(true);
    expect(
      webhookTakesEvent(datadog, {
        event: "user.login",
        environments: ["production"],
      }),
    ).toBe(false);
    expect(
      webhookTakesEvent(datadog, {
        event: "feature.updated",
        environments: [],
      }),
    ).toBe(false);
  });

  it("leaves other webhooks to their environment filter", () => {
    expect(
      webhookTakesEvent(filters(), { event: "user.login", environments: [] }),
    ).toBe(true);
  });
});

describe("webhookEventEnvironments", () => {
  it("matches the event's own Projects and tags", () => {
    const event = {
      event: "feature.updated",
      projects: ["checkout"],
      tags: ["payments"],
      environments: ["dev", "production"],
    };
    expect(webhookEventEnvironments(filters(), event)).toEqual([
      "dev",
      "production",
    ]);
    expect(
      webhookEventEnvironments(
        filters({
          projects: ["checkout"],
          tags: ["payments"],
          environments: ["production"],
        }),
        event,
      ),
    ).toEqual(["production"]);
    expect(
      webhookEventEnvironments(filters({ projects: ["search"] }), event),
    ).toBeNull();
    expect(
      webhookEventEnvironments(filters({ tags: ["beta"] }), event),
    ).toBeNull();
  });

  it("reaches Project and tag filters through a shared change's dependents", () => {
    const savedGroupUpdated = {
      event: "savedGroup.updated",
      projects: [],
      tags: [],
      environments: ["dev", "production"],
      relatedEntities: [
        {
          type: "feature" as const,
          id: "checkout-flow",
          environments: ["production"],
          projects: ["checkout"],
          tags: ["payments"],
        },
        {
          type: "experiment" as const,
          id: "exp_search",
          environments: ["dev", "production"],
          projects: ["search"],
          tags: ["ranking"],
        },
      ],
    };
    const reach = (overrides: Parameters<typeof filters>[0]) =>
      webhookEventEnvironments(filters(overrides), savedGroupUpdated);

    expect(reach({ projects: ["checkout"] })).toEqual(["production"]);
    expect(reach({ tags: ["payments"] })).toEqual(["production"]);
    expect(reach({ projects: ["checkout"], environments: ["dev"] })).toBeNull();
    expect(reach({ projects: ["billing"] })).toBeNull();
    // One dependent has to pass both filters.
    expect(reach({ projects: ["checkout"], tags: ["ranking"] })).toBeNull();
    // Limited to other Projects, its contents stay out whatever uses it.
    expect(
      webhookEventEnvironments(filters({ projects: ["checkout"] }), {
        ...savedGroupUpdated,
        projects: ["billing"],
      }),
    ).toBeNull();
    expect(
      webhookEventEnvironments(
        filters({ projects: ["checkout"], tags: ["payments"] }),
        { ...savedGroupUpdated, projects: ["checkout"] },
      ),
    ).toEqual(["production"]);
    // Only shared resources route through what they touch.
    expect(
      webhookEventEnvironments(filters({ projects: ["checkout"] }), {
        ...savedGroupUpdated,
        event: "experiment.updated",
      }),
    ).toBeNull();
  });
});
