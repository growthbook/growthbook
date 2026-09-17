import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { createOrganization } from "back-end/src/models/OrganizationModel";
import { createEventWebHook } from "back-end/src/models/EventWebhookModel";
import {
  createEventWithPayload,
  EventModel,
} from "back-end/src/models/EventModel";

export async function waitUntil(
  ready: () => boolean | Promise<boolean>,
  timeoutMs = 30000,
) {
  const deadline = Date.now() + timeoutMs;
  while (!(await ready())) {
    if (Date.now() > deadline)
      throw new Error("Event queue did not make progress");
    await delay(10);
  }
}

export async function startWebhookReceiver(statusCodes: number[] = [200]) {
  const received: string[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    received.push(body);
    res.statusCode = statusCodes[received.length - 1] ?? 200;
    res.end(res.statusCode === 200 ? "ok" : "unavailable");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Missing local receiver address");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    received,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

export async function createFixture(url: string) {
  const org = await createOrganization({
    email: "queue@example.test",
    userId: "queue-test",
    name: "Queue test",
  });
  const webhook = await createEventWebHook({
    name: "Queue webhook",
    organizationId: org.id,
    url,
    enabled: true,
    events: ["experiment.info.significance"],
    projects: [],
    tags: [],
    environments: [],
    payloadType: "json",
    method: "POST",
    headers: {},
  });
  const createEvent = async ({
    metricId,
    notify = true,
  }: {
    metricId: string;
    notify?: boolean;
  }) => {
    await createEventWithPayload({
      organizationId: org.id,
      notify,
      payload: {
        event: "experiment.info.significance",
        object: "experiment",
        user: { type: "system" },
        projects: [],
        tags: [],
        environments: [],
        containsSecrets: false,
        data: {
          object: {
            experimentId: "exp-test",
            experimentName: "Queue test",
            metricId,
            metricName: metricId,
            variationId: "1",
            variationName: "Treatment",
            statsEngine: "bayesian",
            criticalValue: 0.99,
            winning: true,
          },
        },
      },
    });
    const event = await EventModel.findOne({
      organizationId: org.id,
      "data.data.object.metricId": metricId,
    }).orFail();
    return event.id;
  };
  return { org, webhook, createEvent };
}
