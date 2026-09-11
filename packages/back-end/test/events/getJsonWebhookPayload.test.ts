import {
  eventWebHookApiVersion,
  eventWebHookInterface,
} from "shared/validators";
import { NotificationEvent } from "shared/types/events/base-types";
import { getJsonWebhookPayload } from "back-end/src/events/handlers/webhooks/getJsonWebhookPayload";

const change = {
  metricId: "fact__revenue?dim:country=US",
  metricName: "Revenue",
  variationId: "variation_1",
  variationName: "Treatment",
  statsEngine: "bayesian",
  criticalValue: 0.99,
  winning: true,
};
const scalar = {
  event: "experiment.info.significance",
  object: "experiment",
  api_version: "2024-07-31",
  created: 123,
  user: { type: "system" },
  projects: ["project_1"],
  tags: [],
  environments: [],
  containsSecrets: false,
  data: {
    object: { experimentId: "exp_1", experimentName: "Checkout", ...change },
  },
} satisfies NotificationEvent;
const batch = {
  ...scalar,
  api_version: "2026-09-11",
  data: {
    object: {
      experimentId: "exp_1",
      experimentName: "Checkout",
      changes: [change, { ...change, metricId: "fact__other", winning: false }],
    },
  },
} satisfies NotificationEvent;

it("keeps a batch intact for the new version and reconstructs complete legacy payloads", () => {
  expect(getJsonWebhookPayload(batch, "2026-09-11")).toEqual(batch);
  expect(getJsonWebhookPayload(batch, "2024-07-31", 0)).toEqual(scalar);
  expect(getJsonWebhookPayload(batch, "2024-07-31", 1)).toEqual({
    ...scalar,
    data: {
      object: {
        ...scalar.data.object,
        metricId: "fact__other",
        winning: false,
      },
    },
  });
});

it("preserves the original payload and version of stored scalar events", () => {
  expect(getJsonWebhookPayload(scalar, "2024-07-31")).toEqual(scalar);
  expect(getJsonWebhookPayload(scalar, "2026-09-11")).toEqual(scalar);
});

it("sets the selected version on other events without changing their data", () => {
  const event = {
    ...scalar,
    event: "webhook.test",
    object: "webhook",
    data: { object: { webhookId: "ewh_1" } },
  } satisfies NotificationEvent;
  for (const apiVersion of eventWebHookApiVersion.options) {
    expect(getJsonWebhookPayload(event, apiVersion)).toEqual({
      ...event,
      api_version: apiVersion,
    });
  }
});

it("accepts supported versions and omission without defaulting updates", () => {
  const schema = eventWebHookInterface.pick({ apiVersion: true });
  expect(schema.parse({})).toEqual({});
  for (const apiVersion of eventWebHookApiVersion.options) {
    expect(schema.parse({ apiVersion })).toEqual({ apiVersion });
  }
  expect(schema.safeParse({ apiVersion: "2099-01-01" }).success).toBe(false);
});
