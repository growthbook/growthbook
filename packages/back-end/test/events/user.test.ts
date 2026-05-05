import { findOrganizationsByMemberId } from "back-end/src/models/OrganizationModel";
import { getUserByEmail } from "back-end/src/models/UserModel";
import { trackLoginForUser } from "back-end/src/services/users";
import { createEventWithPayload } from "back-end/src/models/EventModel";
import { getLegacyMessageForNotificationEvent } from "back-end/src/events/handlers/legacy";

jest.mock("back-end/src/models/OrganizationModel", () => ({
  findOrganizationsByMemberId: jest.fn(),
}));

jest.mock("back-end/src/models/UserModel", () => ({
  getUserByEmail: jest.fn(),
}));

jest.mock("back-end/src/models/EventModel", () => ({
  createEventWithPayload: jest.fn(),
}));

describe("user events", () => {
  const org = { id: "org", environments: [{ id: "production" }] };

  it("dispatches user.login on user login", async () => {
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

    const expected = {
      organizationId: "org",
      objectId: "user-id",
      payload: {
        containsSecrets: true,
        data: {
          object: {
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
    };

    expect(createEventWithPayload).toHaveBeenCalledWith(expected);

    expect(getLegacyMessageForNotificationEvent(expected.payload)).toEqual({
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
    });
  });
});
