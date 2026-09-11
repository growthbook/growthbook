import { experimentInterface } from "shared/validators";
import { parseSliceMetricId } from "shared/experiments";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { setupApp } from "back-end/test/api/api.setup";
import { snapshotFactory } from "back-end/test/factories/Snapshot.factory";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";
import { experimentSnapshot } from "back-end/test/snapshots/experiment.snapshot";
import { ReqContextClass } from "back-end/src/services/context";
import { notifySignificance } from "back-end/src/services/experimentNotifications";
import { EventModel, getEvent } from "back-end/src/models/EventModel";
import { getAgendaInstance } from "back-end/src/services/queueing";
import { webHooksEventHandler } from "back-end/src/events/handlers/webhooks/webHooksEventHandler";
import { EventNotifier } from "back-end/src/events/notifiers/EventNotifier";
import { EventWebHookNotifier } from "back-end/src/events/handlers/webhooks/EventWebHookNotifier";
import {
  createEventWebHook,
  EventWebHookModel,
  getEventWebHookById,
} from "back-end/src/models/EventWebhookModel";
import { getSlackMessageForNotificationEvent } from "back-end/src/events/handlers/slack/slack-event-handler-utils";
import {
  isEmailEnabled,
  sendExperimentChangesEmail,
} from "back-end/src/services/email";

jest.mock("back-end/src/services/email", () => ({
  isEmailEnabled: jest.fn(),
  sendExperimentChangesEmail: jest.fn(),
}));

function makeResults() {
  const metrics = 100,
    slices = 6,
    treatments = 4;
  const metricIds = Array.from({ length: metrics }, (v, i) => `fact__${i}`);
  const allIds = metricIds.flatMap((id) => [
    id,
    ...Array.from({ length: slices }, (v, i) => `${id}?dim:country=level${i}`),
  ]);
  const variations = Array.from({ length: treatments + 1 }, (v, i) => ({
    id: `var_${i}`,
    name: `Variation ${i}`,
    key: String(i),
    screenshots: [],
  }));
  const experiment = experimentInterface.strip().parse({
    ...experimentSnapshot,
    goalMetrics: metricIds,
    variations,
    project: "project_1",
    tags: ["checkout"],
    decisionFrameworkSettings: {},
    phases: [
      {
        dateStarted: new Date(),
        name: "Main",
        reason: "",
        coverage: 1,
        condition: "{}",
        variations: variations.map(({ id }) => ({ id, status: "active" })),
        variationWeights: variations.map(() => 1 / variations.length),
      },
    ],
  });
  const snapshot = snapshotFactory.build({
    experiment: experiment.id,
    organization: experiment.organization,
    type: "standard",
    triggeredBy: "schedule",
    analyses: [
      {
        analysisKey: "analysis_main",
        dateCreated: new Date(),
        status: "success",
        settings: {
          dimensions: [],
          statsEngine: "frequentist",
          differenceType: "relative",
          numGoalMetrics: metrics,
          numGuardrailMetrics: 0,
        },
        results: [
          {
            name: "All",
            srm: 1,
            variations: variations.map((variation, i) => ({
              users: 10000,
              metrics: Object.fromEntries(
                allIds.map((id) => {
                  const value = i === 0 ? 1000 : i <= 2 ? 2000 : 500;
                  const result: SnapshotMetric = {
                    users: 10000,
                    value,
                    cr: value / 10000,
                    expected: value / 1000 - 1,
                    pValue: 0.00001,
                    ci: i <= 2 ? [0.5, 1.5] : [-0.75, -0.25],
                  };
                  return [id, result];
                }),
              ),
            })),
          },
        ],
      },
    ],
  });
  return { experiment, snapshot };
}

describe("significance delivery", () => {
  const { isReady } = setupApp();
  afterEach(() => jest.restoreAllMocks());

  it("aggregates 2,800 results and uses one managed delivery or one legacy job per result", async () => {
    await isReady;
    const context = new ReqContextClass({
      org: {
        id: experimentSnapshot.organization,
        name: "Test organization",
        ownerEmail: "test@example.com",
        url: "",
        dateCreated: new Date(),
        members: [],
      },
      auditUser: { type: "system" },
      role: "admin",
      teams: [],
    });
    jest.spyOn(context.models.metricGroups, "getAll").mockResolvedValue([]);
    jest
      .spyOn(context.models.watch, "getExperimentWatchers")
      .mockResolvedValue([]);
    jest
      .spyOn(context.models.factMetrics, "getById")
      .mockImplementation(async (id) =>
        factMetricFactory.build({ id, inverse: id === "fact__0" }),
      );
    jest.mocked(isEmailEnabled).mockReturnValue(true);
    const { experiment, snapshot } = makeResults();
    const perform = jest.spyOn(EventNotifier.prototype, "perform");
    await notifySignificance({ context, experiment, snapshot });
    await Promise.all(perform.mock.results.map(({ value }) => value));
    const documents = await EventModel.find({
      event: "experiment.info.significance",
    });
    expect(documents).toHaveLength(1);
    const agenda = getAgendaInstance();
    expect(await agenda.jobs({ name: "eventCreated" })).toHaveLength(1);
    const event = await getEvent(documents[0].id);
    if (
      !event?.version ||
      event.data.event !== "experiment.info.significance" ||
      !("changes" in event.data.data.object)
    )
      throw new Error("Missing aggregate event");
    const { changes } = event.data.data.object;
    expect(changes).toHaveLength(2800);
    expect(
      changes
        .filter((change) => change.metricId === "fact__0")
        .map(({ winning }) => winning),
    ).toEqual([false, false, true, true]);
    expect(
      changes.filter(
        (change) => parseSliceMetricId(change.metricId).isSliceMetric,
      ),
    ).toHaveLength(2400);
    expect(sendExperimentChangesEmail).toHaveBeenCalledTimes(1);

    for (const destination of [
      { name: "legacy", payloadType: "json", apiVersion: "2024-07-31" },
      { name: "batch", payloadType: "json" },
      { name: "slack", payloadType: "slack" },
      { name: "discord", payloadType: "discord" },
    ] as const) {
      const webhook = await createEventWebHook({
        ...destination,
        organizationId: context.org.id,
        url: "https://example.test/webhook",
        enabled: true,
        events: ["experiment.info.significance"],
        projects: [],
        tags: [],
        environments: [],
        method: "POST",
        headers: {},
      });
      if (destination.name === "legacy") {
        expect(webhook.apiVersion).toBe("2024-07-31");
        await EventWebHookModel.updateOne(
          { id: webhook.id },
          { $unset: { apiVersion: 1 } },
        );
        expect(
          (await getEventWebHookById(webhook.id, context.org.id))?.apiVersion,
        ).toBe("2024-07-31");
      } else {
        expect(webhook.apiVersion).toBe("2026-09-11");
      }
    }
    const enqueue = jest.spyOn(EventWebHookNotifier.prototype, "enqueue");
    await webHooksEventHandler(event, context);
    await Promise.all(enqueue.mock.results.map(({ value }) => value));
    const jobs = await agenda.jobs({ name: "eventWebHook" });
    expect(jobs).toHaveLength(2803);
    const legacy = jobs.filter(
      ({ attrs }) =>
        attrs.data.delivery.payloadType === "json" &&
        attrs.data.delivery.apiVersion === "2024-07-31",
    );
    expect(
      new Set(legacy.map(({ attrs }) => attrs.data.delivery.changeIndex)).size,
    ).toBe(2800);
    for (const payloadType of ["slack", "discord"]) {
      expect(
        jobs.filter(
          ({ attrs }) => attrs.data.delivery.payloadType === payloadType,
        ),
      ).toHaveLength(1);
    }
    const message = await getSlackMessageForNotificationEvent(
      event.data,
      event.id,
    );
    expect(message?.text).toContain("2800 metric/variation results");
    expect(message?.text).toContain("1400 winning, 1400 losing");
  });
});
