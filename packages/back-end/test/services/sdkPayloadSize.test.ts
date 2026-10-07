import { sdkConnectionPayloadSizeNotificationPayload } from "shared/validators";
import type { NotificationEvent } from "shared/types/events/notification-events";
import type { SDKConnectionInterface } from "shared/types/sdk-connection";
import type { ReqContext } from "back-end/types/request";
import { createEvent } from "back-end/src/models/EventModel";
import {
  claimSDKConnectionNotifiedPayloadSizeLevel,
  findSDKConnectionsWithPayloadOver,
  setSDKConnectionPayloadSize,
} from "back-end/src/models/SdkConnectionModel";
import { getUsersByIds } from "back-end/src/models/UserModel";
import {
  isEmailEnabled,
  sendSdkPayloadSizeEmail,
} from "back-end/src/services/email";
import {
  getSdkPayloadSizeAlerts,
  getSdkPayloadSizeLimitBytes,
  recordSdkPayloadSize,
  withReadablePayloadBreakdowns,
} from "back-end/src/services/sdkPayloadSize";
import { getFeatureMetaInfoByIds } from "back-end/src/models/FeatureModel";
import { getSDKPayloadCacheLocation } from "back-end/src/models/SdkConnectionCacheModel";
import { getSlackMessageForNotificationEvent } from "back-end/src/events/handlers/slack/slack-event-handler-utils";

jest.mock("back-end/src/models/EventModel", () => ({ createEvent: jest.fn() }));
jest.mock("back-end/src/models/SdkConnectionModel", () => ({
  findSDKConnectionsWithPayloadOver: jest.fn(),
  setSDKConnectionPayloadSize: jest.fn(),
  claimSDKConnectionNotifiedPayloadSizeLevel: jest.fn(),
}));
jest.mock("back-end/src/models/SdkConnectionCacheModel", () => ({
  getSDKPayloadCacheLocation: jest.fn(),
}));
jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeatureMetaInfoByIds: jest.fn(),
}));
jest.mock("back-end/src/models/UserModel", () => ({
  getUsersByIds: jest.fn(),
}));
jest.mock("back-end/src/services/email", () => ({
  isEmailEnabled: jest.fn(),
  sendSdkPayloadSizeEmail: jest.fn(),
}));

const MB = 1024 * 1024;
const context = {
  org: {
    id: "org",
    ownerEmail: "owner@example.com",
    members: [
      { id: "u_admin", role: "admin" },
      { id: "u_eng", role: "engineer" },
    ],
  },
} as unknown as ReqContext;
const connection = {
  id: "sdk_1",
  name: "Web app",
  environment: "production",
  projects: [],
  languages: ["javascript"],
  sdkVersion: "1.6.0",
  savedGroupFormat: "inline",
} as unknown as SDKConnectionInterface;
const size = (bytes: number) => ({
  bytes,
  limitBytes: 16 * MB,
  measuredAt: new Date(),
  breakdown: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(claimSDKConnectionNotifiedPayloadSizeLevel)
    .mockResolvedValue(true);
  jest.mocked(getSDKPayloadCacheLocation).mockReturnValue("mongo");
  jest.mocked(isEmailEnabled).mockReturnValue(true);
  jest.mocked(createEvent).mockResolvedValue("event-1");
  jest
    .mocked(getUsersByIds)
    .mockResolvedValue([{ email: "admin@example.com" }] as never);
});

it("announces a rise once, by event, Slack, and email to admins", async () => {
  await recordSdkPayloadSize(context, connection, size(17 * MB));

  expect(setSDKConnectionPayloadSize).toHaveBeenCalledTimes(1);
  expect(claimSDKConnectionNotifiedPayloadSizeLevel).toHaveBeenCalledWith(
    context,
    connection,
    "over-limit",
  );
  const event = jest.mocked(createEvent).mock.calls[0][0];
  expect(event).toMatchObject({
    object: "sdkConnection",
    objectId: "sdk_1",
    event: "payloadSize.warning",
    environments: ["production"],
  });
  expect(
    sdkConnectionPayloadSizeNotificationPayload.parse(event.data.object),
  ).toMatchObject({
    level: "over-limit",
    recommendations: [
      { type: "saved-group-references" },
      { type: "limit-projects" },
      { type: "archive-stale-features" },
    ],
  });
  const message = await getSlackMessageForNotificationEvent(
    {
      event: "sdkConnection.payloadSize.warning",
      data: event.data,
    } as NotificationEvent,
    "event",
  );
  expect(message?.text).toContain("Web app - Payload Over Size Limit.");

  expect(getUsersByIds).toHaveBeenCalledWith(["u_admin"]);
  expect(jest.mocked(sendSdkPayloadSizeEmail).mock.calls[0][0].emails).toEqual([
    "owner@example.com",
    "admin@example.com",
  ]);
});

it("hands the level back when the event isn't saved, so it retries", async () => {
  jest.mocked(createEvent).mockResolvedValue(null);
  await recordSdkPayloadSize(context, connection, size(9 * MB));
  expect(claimSDKConnectionNotifiedPayloadSizeLevel).toHaveBeenLastCalledWith(
    context,
    expect.objectContaining({ notifiedPayloadSizeLevel: "warning" }),
    "ok",
  );
  expect(sendSdkPayloadSizeEmail).not.toHaveBeenCalled();
});

it("stays quiet when another refresh claimed the level first", async () => {
  jest
    .mocked(claimSDKConnectionNotifiedPayloadSizeLevel)
    .mockResolvedValue(false);
  await recordSdkPayloadSize(context, connection, size(9 * MB));
  expect(createEvent).not.toHaveBeenCalled();
  expect(sendSdkPayloadSizeEmail).not.toHaveBeenCalled();
});

it("lowers the remembered level quietly, and skips writes when unchanged", async () => {
  await recordSdkPayloadSize(
    context,
    { ...connection, notifiedPayloadSizeLevel: "danger" },
    size(2 * MB),
  );
  expect(claimSDKConnectionNotifiedPayloadSizeLevel).toHaveBeenCalledWith(
    context,
    expect.anything(),
    "ok",
  );
  expect(createEvent).not.toHaveBeenCalled();

  jest.clearAllMocks();
  await recordSdkPayloadSize(
    context,
    { ...connection, notifiedPayloadSizeLevel: "warning" },
    size(9 * MB),
  );
  expect(claimSDKConnectionNotifiedPayloadSizeLevel).not.toHaveBeenCalled();
});

it("never throws, so the payload still gets cached", async () => {
  jest
    .mocked(setSDKConnectionPayloadSize)
    .mockRejectedValueOnce(new Error("mongo down"));
  await expect(
    recordSdkPayloadSize(context, connection, size(17 * MB)),
  ).resolves.toBeUndefined();
});

it("keeps only the Feature Flags and Saved Groups the viewer can read", async () => {
  jest
    .mocked(getFeatureMetaInfoByIds)
    .mockResolvedValue([{ id: "readable_flag" }] as never);
  const viewer = {
    ...context,
    models: {
      savedGroups: { getReadScopesByIds: jest.fn().mockResolvedValue([]) },
    },
  } as unknown as ReqContext;
  const entry = (id: string) => ({ id, bytes: MB });
  const [redacted] = await withReadablePayloadBreakdowns(viewer, [
    {
      ...connection,
      payloadSize: {
        ...size(10 * MB),
        breakdown: {
          measuredAt: new Date(),
          bytes: 10 * MB,
          sections: {},
          largestFeatures: [entry("readable_flag"), entry("secret_flag")],
          largestSavedGroups: [entry("grp_secret")],
        },
      },
    },
  ]);
  expect(redacted.payloadSize?.breakdown).toMatchObject({
    largestFeatures: [entry("readable_flag")],
    largestSavedGroups: [],
  });
});

it("measures and shows nothing when payloads aren't cached", async () => {
  jest.mocked(getSDKPayloadCacheLocation).mockReturnValue("none");
  expect(await getSdkPayloadSizeLimitBytes()).toBeNull();
  expect(await getSdkPayloadSizeAlerts(context)).toEqual([]);
  expect(findSDKConnectionsWithPayloadOver).not.toHaveBeenCalled();
});
