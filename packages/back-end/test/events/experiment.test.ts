import bluebird from "bluebird";
import {
  createExperiment,
  updateExperiment,
  deleteExperimentByIdForOrganization,
} from "../../src/models/ExperimentModel";
import { setupApp } from "../api/api.setup";
import { EventWebHookNotifier } from "../../src/events/handlers/webhooks/EventWebHookNotifier";
import { getAgendaInstance } from "../../src/services/queueing";
import {
  getAllEventWebHooksForEvent,
  getEventWebHookById,
} from "../../src/models/EventWebhookModel";
import { findOrganizationById } from "../../src/models/OrganizationModel";
import { experimentSnapshot } from "../snapshots/experiment.snapshot";
import {
  notifyMultipleExposures,
  notifySrm,
} from "../../src/services/experimentNotifications";

jest.mock("../../src/models/EventWebhookModel", () => ({
  ...jest.requireActual("../../src/models/EventWebhookModel"),
  getAllEventWebHooksForEvent: jest.fn(),
  getEventWebHookById: jest.fn(),
}));

jest.mock("../../src/models/OrganizationModel", () => ({
  ...jest.requireActual("../../src/models/OrganizationModel"),
  findOrganizationById: jest.fn(),
}));

describe("experiments events", () => {
  setupApp();

  const org = { id: "org", environments: [{ id: "production" }] };

  const flushJobs = async () => {
    const agenda = getAgendaInstance();

    const flush = async (jobs: []) => {
      if (!jobs.length) return;

      await bluebird.each(jobs, async (j) => {
        await j.run();
        await j.remove();
      });
      await flush(await agenda.jobs());
    };

    await flush(await agenda.jobs());
  };

  it("dispatches experiment.created event on experiment create", async () => {
    const webhook = { id: "webhook-aabbcc", payloadType: "raw", mehod: "PUT" };

    jest
      .spyOn(EventWebHookNotifier, "sendDataToWebHook")
      .mockReturnValue({ result: "success", bla: 123 });
    jest
      .spyOn(EventWebHookNotifier, "handleWebHookSuccess")
      .mockReturnValue(undefined);
    getAllEventWebHooksForEvent.mockReturnValue([webhook]);
    getEventWebHookById.mockReturnValue(webhook);
    findOrganizationById.mockReturnValue(org);

    await createExperiment({
      context: {
        org,
        auditUser: {
          type: "api_key",
          apiKey: "aabbcc",
        },
      },
      data: experimentSnapshot,
    });

    await flushJobs();

    expect(EventWebHookNotifier.sendDataToWebHook).toHaveBeenCalledWith(
      expect.objectContaining({
        eventWebHook: {
          id: "webhook-aabbcc",
          mehod: "PUT",
          payloadType: "raw",
        },
        method: "POST",
        payload: expect.objectContaining({
          containsSecrets: false,
          data: expect.objectContaining({
            current: expect.objectContaining({
              archived: false,
              autoRefresh: true,
              bucketVersion: 1,
              dateCreated: expect.any(String),
              dateUpdated: expect.any(String),
              description: "",
              disableStickyBucketing: false,
              fallbackAttribute: "",
              hashAttribute: "id",
              hashVersion: 2,
              hypothesis: "",
              id: "exp_dd4gxd4lyel8bwi",
              minBucketVersion: 0,
              name: "Add To Cart",
              owner: "u_dd4g20lalsnhhp9x",
              phases: [
                {
                  coverage: 1,
                  dateEnded: "",
                  dateStarted: "2023-07-09T15:53:00.000Z",
                  name: "Main",
                  reasonForStopping: "",
                  savedGroupTargeting: [],
                  seed: "add-cart",
                  targetingCondition: "{}",
                  trafficSplit: [
                    { variationId: "var_lyel8229", weight: 0.5 },
                    { variationId: "var_lyel822a", weight: 0.5 },
                  ],
                },
              ],
              project: "",
              settings: {
                activationMetric: { metricId: "met_dd4gxd4lyel6394" },
                assignmentQueryId: "user_id",
                attributionModel: "firstExposure",
                datasourceId: "ds_dd4gxd4lyel5js1",
                experimentId: "add-cart",
                goals: [{ metricId: "metric-aacc" }],
                guardrails: [{ metricId: "metric-eeff" }],
                inProgressConversions: "include",
                queryFilter: "",
                regressionAdjustmentEnabled: false,
                secondaryMetrics: [{ metricId: "metric-ccdd" }],
                segmentId: "",
                statsEngine: "bayesian",
              },
              status: "running",
              tags: [],
              variations: [
                {
                  description: "",
                  key: "0",
                  name: "Control",
                  screenshots: [],
                  variationId: "var_lyel8229",
                },
                {
                  description: "",
                  key: "1",
                  name: "Variation 1",
                  screenshots: [],
                  variationId: "var_lyel822a",
                },
              ],
            }),
          }),
          environments: [],
          event: "experiment.created",
          object: "experiment",
          projects: [""],
          tags: [],
          user: { apiKey: "aabbcc", type: "api_key" },
        }),
      })
    );
  });

  it("dispatches experiment.created event on experiment update", async () => {
    const webhook = { id: "webhook-aabbcc", payloadType: "raw", mehod: "PUT" };

    jest
      .spyOn(EventWebHookNotifier, "sendDataToWebHook")
      .mockReturnValue({ result: "success", bla: 123 });
    jest
      .spyOn(EventWebHookNotifier, "handleWebHookSuccess")
      .mockReturnValue(undefined);
    getAllEventWebHooksForEvent.mockReturnValue([webhook]);
    getEventWebHookById.mockReturnValue(webhook);
    findOrganizationById.mockReturnValue(org);

    await updateExperiment({
      context: {
        org,
        auditUser: {
          type: "api_key",
          apiKey: "aabbcc",
        },
      },
      experiment: { id: "experiment-aaddbb", ...experimentSnapshot },
      changes: { name: "new name" },
    });

    await flushJobs();

    expect(EventWebHookNotifier.sendDataToWebHook).toHaveBeenCalledWith(
      expect.objectContaining({
        eventWebHook: {
          id: "webhook-aabbcc",
          mehod: "PUT",
          payloadType: "raw",
        },
        method: "POST",
        payload: expect.objectContaining({
          containsSecrets: false,
          data: expect.objectContaining({
            current: expect.objectContaining({
              archived: false,
              autoRefresh: true,
              bucketVersion: 1,
              dateCreated: expect.any(String),
              dateUpdated: expect.any(String),
              description: "",
              disableStickyBucketing: false,
              fallbackAttribute: "",
              hashAttribute: "id",
              hashVersion: 2,
              hypothesis: "",
              id: "exp_dd4gxd4lyel8bwi",
              minBucketVersion: 0,
              name: "new name",
              owner: "u_dd4g20lalsnhhp9x",
              phases: [
                {
                  coverage: 1,
                  dateEnded: "",
                  dateStarted: "2023-07-09T15:53:00.000Z",
                  name: "Main",
                  reasonForStopping: "",
                  savedGroupTargeting: [],
                  seed: "add-cart",
                  targetingCondition: "{}",
                  trafficSplit: [
                    { variationId: "var_lyel8229", weight: 0.5 },
                    { variationId: "var_lyel822a", weight: 0.5 },
                  ],
                },
              ],
              project: "",
              settings: {
                activationMetric: { metricId: "met_dd4gxd4lyel6394" },
                assignmentQueryId: "user_id",
                attributionModel: "firstExposure",
                datasourceId: "ds_dd4gxd4lyel5js1",
                experimentId: "add-cart",
                goals: [{ metricId: "metric-aacc" }],
                guardrails: [{ metricId: "metric-eeff" }],
                inProgressConversions: "include",
                queryFilter: "",
                regressionAdjustmentEnabled: false,
                secondaryMetrics: [{ metricId: "metric-ccdd" }],
                segmentId: "",
                statsEngine: "bayesian",
              },
              status: "running",
              tags: [],
              variations: [
                {
                  description: "",
                  key: "0",
                  name: "Control",
                  screenshots: [],
                  variationId: "var_lyel8229",
                },
                {
                  description: "",
                  key: "1",
                  name: "Variation 1",
                  screenshots: [],
                  variationId: "var_lyel822a",
                },
              ],
            }),
            previous: expect.objectContaining({
              archived: false,
              autoRefresh: true,
              bucketVersion: 1,
              dateCreated: expect.any(String),
              dateUpdated: expect.any(String),
              description: "",
              disableStickyBucketing: false,
              fallbackAttribute: "",
              hashAttribute: "id",
              hashVersion: 2,
              hypothesis: "",
              id: "exp_dd4gxd4lyel8bwi",
              minBucketVersion: 0,
              name: "Add To Cart",
              owner: "u_dd4g20lalsnhhp9x",
              phases: [
                {
                  coverage: 1,
                  dateEnded: "",
                  dateStarted: "2023-07-09T15:53:00.000Z",
                  name: "Main",
                  reasonForStopping: "",
                  savedGroupTargeting: [],
                  seed: "add-cart",
                  targetingCondition: "{}",
                  trafficSplit: [
                    { variationId: "var_lyel8229", weight: 0.5 },
                    { variationId: "var_lyel822a", weight: 0.5 },
                  ],
                },
              ],
              project: "",
              settings: {
                activationMetric: { metricId: "met_dd4gxd4lyel6394" },
                assignmentQueryId: "user_id",
                attributionModel: "firstExposure",
                datasourceId: "ds_dd4gxd4lyel5js1",
                experimentId: "add-cart",
                goals: [{ metricId: "metric-aacc" }],
                guardrails: [{ metricId: "metric-eeff" }],
                inProgressConversions: "include",
                queryFilter: "",
                regressionAdjustmentEnabled: false,
                secondaryMetrics: [{ metricId: "metric-ccdd" }],
                segmentId: "",
                statsEngine: "bayesian",
              },
              status: "running",
              tags: [],
              variations: [
                {
                  description: "",
                  key: "0",
                  name: "Control",
                  screenshots: [],
                  variationId: "var_lyel8229",
                },
                {
                  description: "",
                  key: "1",
                  name: "Variation 1",
                  screenshots: [],
                  variationId: "var_lyel822a",
                },
              ],
            }),
          }),
          environments: [],
          event: "experiment.updated",
          object: "experiment",
          projects: [""],
          tags: [],
          user: { apiKey: "aabbcc", type: "api_key" },
        }),
      })
    );
  });

  it("dispatches experiment.created event on experiment deletion", async () => {
    const webhook = { id: "webhook-aabbcc", payloadType: "raw", mehod: "PUT" };

    jest
      .spyOn(EventWebHookNotifier, "sendDataToWebHook")
      .mockReturnValue({ result: "success", bla: 123 });
    jest
      .spyOn(EventWebHookNotifier, "handleWebHookSuccess")
      .mockReturnValue(undefined);
    getAllEventWebHooksForEvent.mockReturnValue([webhook]);
    getEventWebHookById.mockReturnValue(webhook);
    findOrganizationById.mockReturnValue(org);

    await deleteExperimentByIdForOrganization(
      {
        org,
        auditUser: {
          type: "api_key",
          apiKey: "aabbcc",
        },
      },
      { id: "experiment-aabb", ...experimentSnapshot }
    );

    await flushJobs();

    expect(EventWebHookNotifier.sendDataToWebHook).toHaveBeenCalledWith(
      expect.objectContaining({
        eventWebHook: {
          id: "webhook-aabbcc",
          mehod: "PUT",
          payloadType: "raw",
        },
        method: "POST",
        payload: expect.objectContaining({
          containsSecrets: false,
          data: expect.objectContaining({
            previous: expect.objectContaining({
              archived: false,
              autoRefresh: true,
              bucketVersion: 1,
              dateCreated: expect.any(String),
              dateUpdated: expect.any(String),
              description: "",
              disableStickyBucketing: false,
              fallbackAttribute: "",
              hashAttribute: "id",
              hashVersion: 2,
              hypothesis: "",
              id: "exp_dd4gxd4lyel8bwi",
              minBucketVersion: 0,
              name: "Add To Cart",
              owner: "u_dd4g20lalsnhhp9x",
              phases: [
                {
                  coverage: 1,
                  dateEnded: "",
                  dateStarted: "2023-07-09T15:53:00.000Z",
                  name: "Main",
                  reasonForStopping: "",
                  savedGroupTargeting: [],
                  seed: "add-cart",
                  targetingCondition: "{}",
                  trafficSplit: [
                    { variationId: "var_lyel8229", weight: 0.5 },
                    { variationId: "var_lyel822a", weight: 0.5 },
                  ],
                },
              ],
              project: "",
              settings: {
                activationMetric: { metricId: "met_dd4gxd4lyel6394" },
                assignmentQueryId: "user_id",
                attributionModel: "firstExposure",
                datasourceId: "ds_dd4gxd4lyel5js1",
                experimentId: "add-cart",
                goals: [{ metricId: "metric-aacc" }],
                guardrails: [{ metricId: "metric-eeff" }],
                inProgressConversions: "include",
                queryFilter: "",
                regressionAdjustmentEnabled: false,
                secondaryMetrics: [{ metricId: "metric-ccdd" }],
                segmentId: "",
                statsEngine: "bayesian",
              },
              status: "running",
              tags: [],
              variations: [
                {
                  description: "",
                  key: "0",
                  name: "Control",
                  screenshots: [],
                  variationId: "var_lyel8229",
                },
                {
                  description: "",
                  key: "1",
                  name: "Variation 1",
                  screenshots: [],
                  variationId: "var_lyel822a",
                },
              ],
            }),
          }),
          environments: [],
          event: "experiment.deleted",
          object: "experiment",
          projects: [""],
          tags: [],
          user: { apiKey: "aabbcc", type: "api_key" },
        }),
      })
    );
  });

  it("dispatches experiment.warnings event on multiple exposures", async () => {
    const webhook = { id: "webhook-aabbcc", payloadType: "raw", mehod: "PUT" };

    jest
      .spyOn(EventWebHookNotifier, "sendDataToWebHook")
      .mockReturnValue({ result: "success", bla: 123 });
    jest
      .spyOn(EventWebHookNotifier, "handleWebHookSuccess")
      .mockReturnValue(undefined);
    getAllEventWebHooksForEvent.mockReturnValue([webhook]);
    getEventWebHookById.mockReturnValue(webhook);
    findOrganizationById.mockReturnValue(org);

    await notifyMultipleExposures({
      context: {
        org,
        userId: "user-aabb",
        email: "user@email.com",
        userName: "User Name",
        auditUser: {
          type: "api_key",
          apiKey: "aabbcc",
        },
      },
      experiment: { id: "experiment-aabb", ...experimentSnapshot },
      results: { variations: [{ users: 100 }] },
      snapshot: { multipleExposures: 10, totalUsers: 100 },
    });

    await flushJobs();

    expect(EventWebHookNotifier.sendDataToWebHook).toHaveBeenCalledWith({
      eventWebHook: {
        id: "webhook-aabbcc",
        mehod: "PUT",
        payloadType: "raw",
      },
      method: "POST",
      payload: {
        containsSecrets: false,
        data: {
          experimentId: "exp_dd4gxd4lyel8bwi",
          experimentName: "Add To Cart",
          percent: 0.1,
          type: "multiple-exposures",
          usersCount: 10,
        },
        environments: [],
        event: "experiment.warning",
        object: "experiment",
        projects: [],
        tags: [],
        user: {
          email: "user@email.com",
          id: "user-aabb",
          name: "User Name",
          type: "dashboard",
        },
      },
    });
  });

  it("dispatches experiment.warnings event on srm", async () => {
    const webhook = { id: "webhook-aabbcc", payloadType: "raw", mehod: "PUT" };

    jest
      .spyOn(EventWebHookNotifier, "sendDataToWebHook")
      .mockReturnValue({ result: "success", bla: 123 });
    jest
      .spyOn(EventWebHookNotifier, "handleWebHookSuccess")
      .mockReturnValue(undefined);
    getAllEventWebHooksForEvent.mockReturnValue([webhook]);
    getEventWebHookById.mockReturnValue(webhook);
    findOrganizationById.mockReturnValue(org);

    await notifySrm({
      context: {
        org: { ...org, settings: { srmThreshold: 0.5 } },
        userId: "user-aabb",
        email: "user@email.com",
        userName: "User Name",
        auditUser: {
          type: "api_key",
          apiKey: "aabbcc",
        },
      },
      experiment: { id: "experiment-aabb", ...experimentSnapshot },
      results: { srm: 0.1 },
      snapshot: { multipleExposures: 10, totalUsers: 100 },
    });

    await flushJobs();

    expect(EventWebHookNotifier.sendDataToWebHook).toHaveBeenCalledWith({
      eventWebHook: { id: "webhook-aabbcc", mehod: "PUT", payloadType: "raw" },
      method: "POST",
      payload: {
        containsSecrets: false,
        data: {
          experimentId: "exp_dd4gxd4lyel8bwi",
          experimentName: "Add To Cart",
          threshold: 0.5,
          type: "srm",
        },
        environments: [],
        event: "experiment.warning",
        object: "experiment",
        projects: [],
        tags: [],
        user: {
          email: "user@email.com",
          id: "user-aabb",
          name: "User Name",
          type: "dashboard",
        },
      },
    });
  });
});
