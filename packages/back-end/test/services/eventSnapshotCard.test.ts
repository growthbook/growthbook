import type { NotificationEvent } from "shared/types/events/notification-events";
import { buildEventSnapshotCard } from "back-end/src/services/notificationCards/eventSnapshotCard";

describe("immutable event cards", () => {
  it("renders a stop without claiming an outcome that was not recorded", () => {
    const event = {
      event: "experiment.status.stopped",
      data: {
        object: {
          type: "stopped",
          experimentId: "exp-1",
          experimentName: "Checkout",
          enableTemporaryRollout: false,
        },
      },
    } as NotificationEvent;
    expect(buildEventSnapshotCard(event)?.summary).toEqual([
      "Experiment stopped.",
    ]);
  });
  it("does not call an inconclusive stop a rollback or ship", () => {
    const event = {
      event: "experiment.status.stopped",
      data: {
        object: {
          type: "stopped",
          experimentId: "exp-1",
          experimentName: "Checkout",
          results: "inconclusive",
          enableTemporaryRollout: false,
        },
      },
    } as NotificationEvent;
    expect(buildEventSnapshotCard(event)).toMatchObject({
      event: "stopped",
      summary: ["Experiment stopped. Result: inconclusive."],
    });
  });
});
