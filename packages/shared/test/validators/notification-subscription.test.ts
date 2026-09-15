import { notificationSubscriptionSchema } from "../../src/validators/event-webhook";

const subscription = {
  events: [
    "experiment.*",
    "feature.revision.*",
    "savedGroup.revision.published",
  ],
  projects: [],
  tags: [],
  environments: [],
  experiments: ["exp_1"],
  metrics: ["fact__revenue"],
  features: ["checkout"],
  excludeEmptyUpdates: true,
};
it("validates subscription criteria independently of delivery settings", () => {
  expect(notificationSubscriptionSchema.parse(subscription)).toEqual(
    subscription,
  );
  expect(
    notificationSubscriptionSchema.safeParse({
      ...subscription,
      payloadType: "slack",
    }).success,
  ).toBe(false);
});
it.each([
  { events: [] },
  { events: ["experiment.notARealEvent"] },
  { metrics: "fact__revenue" },
])("rejects invalid criteria %j", (invalid) => {
  expect(
    notificationSubscriptionSchema.safeParse({ ...subscription, ...invalid })
      .success,
  ).toBe(false);
});
it("keeps the new policy optional for existing subscriptions", () => {
  const existing = {
    events: ["feature.*"],
    projects: [],
    tags: [],
    environments: [],
  };
  expect(notificationSubscriptionSchema.parse(existing)).toEqual(existing);
});
