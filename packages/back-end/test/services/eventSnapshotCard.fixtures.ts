import type { NotificationEvent } from "shared/types/events/notification-events";

const base = {
  experimentId: "exp-checkout",
  experimentName: "Checkout redesign",
};

export const eventSnapshotCardSamples: {
  name: string;
  event: NotificationEvent;
}[] = [
  {
    name: "srm",
    event: {
      event: "experiment.warning",
      data: { object: { ...base, type: "srm", threshold: 0.001 } },
    } as NotificationEvent,
  },
];
