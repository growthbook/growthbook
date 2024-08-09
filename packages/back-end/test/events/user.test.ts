import bluebird from "bluebird";
import { setupApp } from "../api/api.setup";
import { EventWebHookNotifier } from "../../src/events/handlers/webhooks/EventWebHookNotifier";
import { getAgendaInstance } from "../../src/services/queueing";
import {
  getAllEventWebHooksForEvent,
  getEventWebHookById,
} from "../../src/models/EventWebhookModel";
import {
  findOrganizationById,
  findOrganizationsByMemberId,
} from "../../src/models/OrganizationModel";
import { getUserByEmail } from "../../src/models/UserModel";
import { trackLoginForUser } from "../../src/services/users";

jest.mock("../../src/models/EventWebhookModel", () => ({
  ...jest.requireActual("../../src/models/EventWebhookModel"),
  getAllEventWebHooksForEvent: jest.fn(),
  getEventWebHookById: jest.fn(),
}));

jest.mock("../../src/models/OrganizationModel", () => ({
  getSelfHostedOrganization: jest.fn(),
  findOrganizationById: jest.fn(),
  findOrganizationsByMemberId: jest.fn(),
}));

jest.mock("../../src/models/UserModel", () => ({
  getUserByEmail: jest.fn(),
}));

describe("user events", () => {
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

  it("dispatches user.login on user login", async () => {
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
    getUserByEmail.mockReturnValue({
      id: "user-id",
      name: "User Name",
      email: "user@mail.org",
    });
    findOrganizationsByMemberId.mockReturnValue([org]);

    await trackLoginForUser({
      email: "user@mail.org",
      device: "device",
      userAgent: "userAgent",
      ip: "ip",
      os: "os",
    });

    await flushJobs();

    expect(EventWebHookNotifier.sendDataToWebHook).toHaveBeenCalledWith({
      eventWebHook: { id: "webhook-aabbcc", method: "PUT", payloadType: "raw" },
      method: "PUT",
      payload: {
        containsSecrets: true,
        data: {
          current: {
            device: "device",
            email: "user@mail.org",
            id: "user-id",
            ip: "ip",
            name: "User Name",
            os: "os",
            userAgent: "userAgent",
          },
        },
        environments: [],
        event: "user.login",
        object: "user",
        projects: [],
        tags: [],
        user: {
          email: "user@mail.org",
          id: "user-id",
          name: "User Name",
          type: "dashboard",
        },
      },
    });
  });
});
