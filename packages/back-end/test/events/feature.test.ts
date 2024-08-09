import bluebird from "bluebird";
import {
  createFeature,
  updateFeature,
  deleteFeature,
} from "../../src/models/FeatureModel";
import { setupApp } from "../api/api.setup";
import { EventWebHookNotifier } from "../../src/events/handlers/webhooks/EventWebHookNotifier";
import { getAgendaInstance } from "../../src/services/queueing";
import {
  getAllEventWebHooksForEvent,
  getEventWebHookById,
} from "../../src/models/EventWebhookModel";
import { findOrganizationById } from "../../src/models/OrganizationModel";

jest.mock("../../src/models/EventWebhookModel", () => ({
  ...jest.requireActual("../../src/models/EventWebhookModel"),
  getAllEventWebHooksForEvent: jest.fn(),
  getEventWebHookById: jest.fn(),
}));

jest.mock("../../src/models/OrganizationModel", () => ({
  ...jest.requireActual("../../src/models/OrganizationModel"),
  findOrganizationById: jest.fn(),
}));

describe("features events", () => {
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

  it("dispatches feature.created event on feature create", async () => {
    const webhook = { id: "webhook-aabbcc", payloadType: "raw", method: "PUT" };

    jest
      .spyOn(EventWebHookNotifier, "sendDataToWebHook")
      .mockReturnValue({ result: "success", bla: 123 });
    jest
      .spyOn(EventWebHookNotifier, "handleWebHookSuccess")
      .mockReturnValue(undefined);
    getAllEventWebHooksForEvent.mockReturnValue([webhook]);
    getEventWebHookById.mockReturnValue(webhook);
    findOrganizationById.mockReturnValue(org);

    await createFeature(
      {
        org,
        auditUser: {
          type: "api_key",
          apiKey: "aabbcc",
        },
      },
      {
        defaultValue: "defaultValue",
        valueType: "string",
        owner: "owner",
        description: "description",
        project: "project",
        id: "id",
        archived: true,
        tags: ["tag"],
        dateCreated: new Date(),
        dateUpdated: new Date(),
      }
    );

    await flushJobs();

    expect(EventWebHookNotifier.sendDataToWebHook).toHaveBeenCalledWith(
      expect.objectContaining({
        eventWebHook: {
          id: "webhook-aabbcc",
          method: "PUT",
          payloadType: "raw",
        },
        method: "PUT",
        payload: expect.objectContaining({
          containsSecrets: false,
          data: expect.objectContaining({
            current: expect.objectContaining({
              archived: true,
              dateCreated: expect.any(String),
              dateUpdated: expect.any(String),
              defaultValue: "defaultValue",
              description: "description",
              environments: {
                dev: {
                  defaultValue: "defaultValue",
                  enabled: false,
                  rules: [],
                },
                production: {
                  defaultValue: "defaultValue",
                  enabled: false,
                  rules: [],
                },
              },
              id: "id",
              owner: "owner",
              project: "project",
              revision: { comment: "", date: "", publishedBy: "" },
              tags: ["tag"],
              valueType: "string",
            }),
          }),
          environments: [],
          event: "feature.created",
          object: "feature",
          projects: ["project"],
          tags: ["tag"],
          user: { apiKey: "aabbcc", type: "api_key" },
        }),
      })
    );
  });

  it("dispatches feature.created event on feature update", async () => {
    const webhook = { id: "webhook-aabbcc", payloadType: "raw", method: "PUT" };

    jest
      .spyOn(EventWebHookNotifier, "sendDataToWebHook")
      .mockReturnValue({ result: "success", bla: 123 });
    jest
      .spyOn(EventWebHookNotifier, "handleWebHookSuccess")
      .mockReturnValue(undefined);
    getAllEventWebHooksForEvent.mockReturnValue([webhook]);
    getEventWebHookById.mockReturnValue(webhook);
    findOrganizationById.mockReturnValue(org);

    await updateFeature(
      {
        org,
        auditUser: {
          type: "api_key",
          apiKey: "aabbcc",
        },
      },
      {
        id: "aabbcc",
        defaultValue: "defaultValue",
        valueType: "string",
        owner: "owner",
        description: "description",
        project: "project",
        id: "id",
        archived: true,
        tags: ["tag"],
        dateCreated: new Date(),
        dateUpdated: new Date(),
      },
      { description: "new description" }
    );

    await flushJobs();

    expect(EventWebHookNotifier.sendDataToWebHook).toHaveBeenCalledWith(
      expect.objectContaining({
        eventWebHook: {
          id: "webhook-aabbcc",
          method: "PUT",
          payloadType: "raw",
        },
        method: "PUT",
        payload: expect.objectContaining({
          containsSecrets: false,
          data: expect.objectContaining({
            current: expect.objectContaining({
              archived: true,
              dateCreated: expect.any(String),
              dateUpdated: expect.any(String),
              defaultValue: "defaultValue",
              description: "new description",
              environments: {
                dev: {
                  defaultValue: "defaultValue",
                  enabled: false,
                  rules: [],
                },
                production: {
                  defaultValue: "defaultValue",
                  enabled: false,
                  rules: [],
                },
              },
              id: "id",
              owner: "owner",
              project: "project",
              revision: { comment: "", date: "", publishedBy: "" },
              tags: ["tag"],
              valueType: "string",
            }),
            previous: expect.objectContaining({
              archived: true,
              dateCreated: expect.any(String),
              dateUpdated: expect.any(String),
              defaultValue: "defaultValue",
              description: "description",
              environments: {
                dev: {
                  defaultValue: "defaultValue",
                  enabled: false,
                  rules: [],
                },
                production: {
                  defaultValue: "defaultValue",
                  enabled: false,
                  rules: [],
                },
              },
              id: "id",
              owner: "owner",
              project: "project",
              revision: { comment: "", date: "", publishedBy: "" },
              tags: ["tag"],
              valueType: "string",
            }),
          }),
          environments: [],
          event: "feature.updated",
          object: "feature",
          projects: ["project"],
          tags: ["tag"],
          user: { apiKey: "aabbcc", type: "api_key" },
        }),
      })
    );
  });

  it("dispatches feature.created event on feature deletion", async () => {
    const webhook = { id: "webhook-aabbcc", payloadType: "raw", method: "PUT" };

    jest
      .spyOn(EventWebHookNotifier, "sendDataToWebHook")
      .mockReturnValue({ result: "success", bla: 123 });
    jest
      .spyOn(EventWebHookNotifier, "handleWebHookSuccess")
      .mockReturnValue(undefined);
    getAllEventWebHooksForEvent.mockReturnValue([webhook]);
    getEventWebHookById.mockReturnValue(webhook);
    findOrganizationById.mockReturnValue(org);

    await deleteFeature(
      {
        org,
        auditUser: {
          type: "api_key",
          apiKey: "aabbcc",
        },
      },
      {
        id: "aabbcc",
        defaultValue: "defaultValue",
        valueType: "string",
        owner: "owner",
        description: "description",
        project: "project",
        id: "id",
        archived: true,
        tags: ["tag"],
        dateCreated: new Date(),
        dateUpdated: new Date(),
      }
    );

    await flushJobs();

    expect(EventWebHookNotifier.sendDataToWebHook).toHaveBeenCalledWith(
      expect.objectContaining({
        eventWebHook: {
          id: "webhook-aabbcc",
          method: "PUT",
          payloadType: "raw",
        },
        method: "PUT",
        payload: expect.objectContaining({
          containsSecrets: false,
          data: expect.objectContaining({
            previous: expect.objectContaining({
              archived: true,
              dateCreated: expect.any(String),
              dateUpdated: expect.any(String),
              defaultValue: "defaultValue",
              description: "description",
              environments: {
                dev: {
                  defaultValue: "defaultValue",
                  enabled: false,
                  rules: [],
                },
                production: {
                  defaultValue: "defaultValue",
                  enabled: false,
                  rules: [],
                },
              },
              id: "id",
              owner: "owner",
              project: "project",
              revision: { comment: "", date: "", publishedBy: "" },
              tags: ["tag"],
              valueType: "string",
            }),
          }),
          environments: [],
          event: "feature.deleted",
          object: "feature",
          projects: ["project"],
          tags: ["tag"],
          user: { apiKey: "aabbcc", type: "api_key" },
        }),
      })
    );
  });
});
