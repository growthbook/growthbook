import { SafeRolloutInterface } from "shared/types/safe-rollout";
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

  let safeRollout: SafeRolloutInterface;
  let org;
  let context;

  beforeEach(() => {
    safeRollout = {
      id: "sr_123",
      organization: "123",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      autoSnapshots: false,
      exposureQueryId: "",
      status: "running",
      datasourceId: "ds_123",
      guardrailMetricIds: [],
      maxDuration: {
        amount: 7,
        unit: "days",
      },
      autoRollback: true,
      featureId: "feature",
      environment: "production",
      rampUpSchedule: {
        enabled: true,
        step: 1,
        steps: [0.1, 0.25, 0.5],
        rampUpCompleted: false,
      },
    };

    org = { id: "org", environments: [{ id: "production" }] };
    context = {
      org,
      models: {
        safeRollout: {
          getAllPayloadSafeRollouts: jest
            .fn()
            .mockResolvedValue(new Map([["sr_123", safeRollout]])),
        },
        savedGroups: {
          getAll: jest.fn().mockResolvedValue([]),
        },
      },
      userId: "aabb",
      email: "user@mail.com",
      userName: "User Name",
    };
  });

  afterEach(async () => {
    jest.clearAllMocks();
  });

  it("dispatches feature.created event on feature create", async () => {
    let rawPayload;

    jest
      .spyOn(EventModel, "create")
      .mockImplementation((doc: unknown, callback?: unknown) => {
        rawPayload = doc.data;
        const result = { toJSON: () => "" };
        if (callback) callback(null, result);
        return result;
      });

    await logFeatureCreatedEvent(context, featureSnapshot);

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
      }),
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
      }),
    );
  });

  it("dispatches feature.updated event on feature update", async () => {
    let rawPayload;

    jest
      .spyOn(EventModel, "create")
      .mockImplementation((doc: unknown, callback?: unknown) => {
        rawPayload = doc.data;
        const result = { toJSON: () => "" };
        if (callback) callback(null, result);
        return result;
      });

    await logFeatureUpdatedEvent(context, featureSnapshot, {
      ...featureSnapshot,
      description: "new description",
    });

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
      }),
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
      }),
    );
  });

  it("dispatches feature.deleted event on feature delete", async () => {
    let rawPayload;

    jest
      .spyOn(EventModel, "create")
      .mockImplementation((doc: unknown, callback?: unknown) => {
        rawPayload = doc.data;
        const result = { toJSON: () => "" };
        if (callback) callback(null, result);
        return result;
      });

    await logFeatureDeletedEvent(context, featureSnapshot);

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
      }),
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
      }),
    );
  });
});
