import type { NotificationEvent } from "shared/types/events/notification-events";

const base = {
  experimentId: "exp-checkout",
  experimentName: "Checkout redesign",
};

export const notificationCardSamples: {
  name: string;
  event: NotificationEvent;
}[] = [
  {
    name: "srm (legacy payload)",
    event: {
      event: "experiment.warning",
      data: { object: { ...base, type: "srm", threshold: 0.001 } },
    } as NotificationEvent,
  },
  {
    name: "srm",
    event: {
      event: "experiment.warning",
      data: {
        object: {
          ...base,
          type: "srm",
          threshold: 0.001,
          pValue: 0.00042,
          variations: [
            { name: "Control", users: 6213, weight: 0.5 },
            { name: "One-page checkout", users: 3787, weight: 0.5 },
          ],
        },
      },
    } as NotificationEvent,
  },
];
