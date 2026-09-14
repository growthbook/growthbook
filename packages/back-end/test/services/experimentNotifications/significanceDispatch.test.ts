import mongoose from "mongoose";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { setupApp } from "back-end/test/api/api.setup";
import { snapshotFactory } from "back-end/test/factories/Snapshot.factory";
import { createOrganization } from "back-end/src/models/OrganizationModel";
import { createEventWebHook } from "back-end/src/models/EventWebhookModel";
import { ExperimentModel } from "back-end/src/models/ExperimentModel";
import { EventModel } from "back-end/src/models/EventModel";
import { ReqContextClass } from "back-end/src/services/context";
import { notifySignificance } from "back-end/src/services/experimentNotifications";
import { getAgendaInstance } from "back-end/src/services/queueing";
import { hasEventSubscribers } from "back-end/src/events/hasEventSubscribers";
import { sendExperimentChangesEmail } from "back-end/src/services/email";
import { metrics, experiments } from "./experimentSignificance.mocks.json";

jest.mock("back-end/src/events/hasEventSubscribers", () => ({
  hasEventSubscribers: jest.fn(
    jest.requireActual("back-end/src/events/hasEventSubscribers")
      .hasEventSubscribers,
  ),
}));
jest.mock("back-end/src/services/email", () => ({
  ...jest.requireActual("back-end/src/services/email"),
  isEmailEnabled: () => true,
  sendExperimentChangesEmail: jest.fn(),
}));

const { isReady } = setupApp();

it.each([false, true])(
  "preserves history and email, and checks subscriptions once per batch: subscribed=%s",
  async (subscribed) => {
    await isReady;
    const queue = getAgendaInstance();
    await queue._collection.deleteMany({});
    const org = await createOrganization({
      email: "significance@example.test",
      userId: "significance-test",
      name: "Significance test",
    });
    const context = new ReqContextClass({
      org,
      role: "admin",
      auditUser: { type: "system" },
    });
    const metric = metrics[0];
    await mongoose.connection
      .collection("metrics")
      .insertOne({ ...metric, organization: org.id });
    const experiment = await ExperimentModel.create({
      ...experiments[0],
      organization: org.id,
      goalMetrics: [metric.id],
      guardrails: [],
    });
    if (subscribed) {
      await createEventWebHook({
        organizationId: org.id,
        name: "Significance consumer",
        url: "http://localhost/unused",
        enabled: true,
        events: ["experiment.info.*"],
        projects: [],
        tags: [],
        environments: [],
        payloadType: "json",
        method: "POST",
        headers: {},
      });
    }
    const ids = ["US", "CA", "GB"].map(
      (country) => `${metric.id}?dim:country=${country}`,
    );
    const baseline: SnapshotMetric = { users: 10000, value: 8000, cr: 0.8 };
    const treatment: SnapshotMetric = {
      users: 10000,
      value: 6000,
      cr: 0.6,
      expected: -0.25,
      chanceToWin: 0.00001,
      ci: [-0.3, -0.2],
    };
    const snapshot = snapshotFactory.build({
      experiment: experiment.id,
      organization: org.id,
      type: "standard",
      triggeredBy: "schedule",
      settings: { goalMetrics: [metric.id] },
      analyses: [
        {
          analysisKey: "default",
          dateCreated: new Date(),
          status: "success",
          settings: {
            statsEngine: "bayesian",
            dimensions: [],
            differenceType: "relative",
            numGoalMetrics: 1,
            numGuardrailMetrics: 0,
          },
          results: [
            {
              name: "",
              srm: 1,
              variations: [baseline, treatment].map((stats) => ({
                users: 10000,
                metrics: Object.fromEntries(ids.map((id) => [id, stats])),
              })),
            },
          ],
        },
      ],
    });

    await notifySignificance({ context, experiment, snapshot });

    expect(hasEventSubscribers).toHaveBeenCalledTimes(1);
    expect(sendExperimentChangesEmail).toHaveBeenCalledTimes(1);
    const history = await EventModel.find({
      event: "experiment.info.significance",
    });
    expect(history).toHaveLength(3);
    expect(history.map((event) => event.data)).toEqual(
      expect.arrayContaining(
        ids.map((metricId) =>
          expect.objectContaining({
            data: expect.objectContaining({
              object: expect.objectContaining({ metricId }),
            }),
          }),
        ),
      ),
    );
    expect(
      await queue._collection.countDocuments({ name: "eventCreated" }),
    ).toBe(subscribed ? 3 : 0);
  },
);
