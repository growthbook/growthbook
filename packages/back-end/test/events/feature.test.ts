import {
  logFeatureCreatedEvent,
  logFeatureUpdatedEvent,
  logFeatureDeletedEvent,
} from "back-end/src/models/FeatureModel";
import { getLegacyMessageForNotificationEvent } from "back-end/src/events/handlers/legacy";
import { featureSnapshot } from "back-end/test/snapshots/feature.snapshot";
import { EventModel } from "back-end/src/models/EventModel";
import { setupApp } from "back-end/test/api/api.setup";

jest.mock("back-end/src/events/notifiers/EventNotifier", () => ({
  EventNotifier: class Dummy {
    perform() {
      return undefined;
    }
  },
}));

describe("features events", () => {
  setupApp();

  const org = { id: "org", environments: [{ id: "production" }] };

  afterEach(async () => {
    jest.clearAllMocks();
  });

  it("dispatches feature.created event on feature create", async () => {
    let rawPayload;

    jest.spyOn(EventModel, "create").mockImplementation(({ data }) => {
      rawPayload = data;
      return { toJSON: () => "" };
    });

    await logFeatureCreatedEvent(
      {
        org,
        userId: "aabb",
        email: "user@mail.com",
        userName: "User Name",
      },
      featureSnapshot
    );

    expect(rawPayload).toEqual(
      expect.objectContaining({
        api_version: expect.any(String),
        containsSecrets: false,
        created: expect.any(Number),
        data: expect.objectContaining({
          object: expect.objectContaining({
            archived: true,
            dateCreated: expect.any(String),
            dateUpdated: expect.any(String),
            defaultValue: "defaultValue",
            description: "description",
            environments: {
              dev: { defaultValue: "defaultValue", enabled: false, rules: [] },
              production: {
                defaultValue: "defaultValue",
                enabled: false,
                rules: [],
              },
            },
            id: "id",
            owner: "owner",
            project: "project",
            revision: {
              comment: "",
              date: "",
              publishedBy: "",
              version: undefined,
            },
            tags: ["tag"],
            valueType: "string",
          }),
        }),
        environments: [],
        event: "feature.created",
        object: "feature",
        projects: ["project"],
        tags: ["tag"],
        user: {
          email: "user@mail.com",
          id: "aabb",
          name: "User Name",
          type: "dashboard",
        },
      })
    );

    expect(getLegacyMessageForNotificationEvent(rawPayload)).toEqual(
      expect.objectContaining({
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
        user: {
          email: "user@mail.com",
          id: "aabb",
          name: "User Name",
          type: "dashboard",
        },
      })
    );
  });

  it("dispatches feature.updated event on feature update", async () => {
    let rawPayload;

    jest.spyOn(EventModel, "create").mockImplementation(({ data }) => {
      rawPayload = data;
      return { toJSON: () => "" };
    });

    await logFeatureUpdatedEvent(
      {
        org,
        userId: "aabb",
        email: "user@mail.com",
        userName: "User Name",
      },
      featureSnapshot,
      { ...featureSnapshot, description: "new description" }
    );

    expect(rawPayload).toEqual(
      expect.objectContaining({
        api_version: expect.any(String),
        containsSecrets: false,
        created: expect.any(Number),
        data: expect.objectContaining({
          object: expect.objectContaining({
            archived: true,
            dateCreated: expect.any(String),
            dateUpdated: expect.any(String),
            defaultValue: "defaultValue",
            description: "new description",
            environments: {
              dev: { defaultValue: "defaultValue", enabled: false, rules: [] },
              production: {
                defaultValue: "defaultValue",
                enabled: false,
                rules: [],
              },
            },
            id: "id",
            owner: "owner",
            project: "project",
            revision: {
              comment: "",
              date: "",
              publishedBy: "",
              version: undefined,
            },
            tags: ["tag"],
            valueType: "string",
          }),
          previous_attributes: { description: "description" },
        }),
        environments: [],
        event: "feature.updated",
        object: "feature",
        projects: ["project"],
        tags: ["tag"],
        user: {
          email: "user@mail.com",
          id: "aabb",
          name: "User Name",
          type: "dashboard",
        },
      })
    );

    expect(getLegacyMessageForNotificationEvent(rawPayload)).toEqual(
      expect.objectContaining({
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
        user: {
          email: "user@mail.com",
          id: "aabb",
          name: "User Name",
          type: "dashboard",
        },
      })
    );
  });

  it("dispatches feature.deleted event on feature delete", async () => {
    let rawPayload;

    jest.spyOn(EventModel, "create").mockImplementation(({ data }) => {
      rawPayload = data;
      return { toJSON: () => "" };
    });

    await logFeatureDeletedEvent(
      {
        org,
        userId: "aabb",
        email: "user@mail.com",
        userName: "User Name",
      },
      featureSnapshot
    );

    expect(rawPayload).toEqual(
      expect.objectContaining({
        api_version: expect.any(String),
        containsSecrets: false,
        created: expect.any(Number),
        data: expect.objectContaining({
          object: expect.objectContaining({
            archived: true,
            dateCreated: expect.any(String),
            dateUpdated: expect.any(String),
            defaultValue: "defaultValue",
            description: "description",
            environments: {
              dev: { defaultValue: "defaultValue", enabled: false, rules: [] },
              production: {
                defaultValue: "defaultValue",
                enabled: false,
                rules: [],
              },
            },
            id: "id",
            owner: "owner",
            project: "project",
            revision: {
              comment: "",
              date: "",
              publishedBy: "",
              version: undefined,
            },
            tags: ["tag"],
            valueType: "string",
          }),
        }),
        environments: [],
        event: "feature.deleted",
        object: "feature",
        projects: ["project"],
        tags: ["tag"],
        user: {
          email: "user@mail.com",
          id: "aabb",
          name: "User Name",
          type: "dashboard",
        },
      })
    );

    expect(getLegacyMessageForNotificationEvent(rawPayload)).toEqual(
      expect.objectContaining({
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
        user: {
          email: "user@mail.com",
          id: "aabb",
          name: "User Name",
          type: "dashboard",
        },
      })
    );
  });
});
