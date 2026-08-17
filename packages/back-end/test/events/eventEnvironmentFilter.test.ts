import type { NotificationEvent } from "back-end/src/events/notification-events";
import { filterEventForEnvironments } from "back-end/src/events/handlers/utils";

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
