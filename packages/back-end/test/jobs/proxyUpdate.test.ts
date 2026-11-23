import Agenda, { Job } from "agenda";
import { Response } from "node-fetch";
import { OrganizationInterface } from "shared/types/organization";
import { WEBHOOK_CONSECUTIVE_FAILURES_THRESHOLD } from "shared/constants";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { ReqContextClass } from "back-end/src/services/context";
import addProxyUpdateJob from "back-end/src/jobs/proxyUpdate";
import {
  createSDKConnection,
  editSDKConnection,
  findSDKConnectionById,
  setProxyError,
  setProxyFailureAlertedAt,
} from "back-end/src/models/SdkConnectionModel";
import { cancellableFetch } from "back-end/src/util/http.util";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { createEvent } from "back-end/src/models/EventModel";
import {
  isEmailEnabled,
  sendSdkProxyErrorEmail,
} from "back-end/src/services/email";
import {
  describeProxyError,
  PROXY_ALERT_AFTER_MS,
  PROXY_ALERT_REMINDER_MS,
  PROXY_CHECKS_FOR_MS,
  sendSdkProxyAlert,
} from "back-end/src/services/sdkProxyErrors";
import {
  connectTestMongo,
  disconnectTestMongo,
} from "back-end/test/test-helpers";

// On Cloud each connection sets its own proxy host
jest.mock("back-end/src/util/secrets", () => ({
  ...jest.requireActual("back-end/src/util/secrets"),
  IS_CLOUD: true,
}));
jest.mock("back-end/src/controllers/features", () => ({
  getFeatureDefinitionsWithCache: jest.fn().mockResolvedValue({
    features: {},
    dateUpdated: null,
  }),
}));
jest.mock("back-end/src/services/features", () => ({
  queueSDKPayloadRefresh: jest.fn(),
}));
jest.mock("back-end/src/services/audit", () => ({
  createModelAuditLogger: () => ({
    logCreate: jest.fn(),
    logUpdate: jest.fn(),
    logDelete: jest.fn(),
  }),
}));
jest.mock("back-end/src/util/http.util", () => ({
  ...jest.requireActual("back-end/src/util/http.util"),
  cancellableFetch: jest.fn(),
}));
jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgId: jest.fn(),
}));
jest.mock("back-end/src/models/EventModel", () => ({
  createEvent: jest.fn(),
}));
jest.mock("back-end/src/services/email", () => ({
  isEmailEnabled: jest.fn(),
  sendSdkProxyErrorEmail: jest.fn(),
}));

const org: OrganizationInterface = {
  id: "org_1",
  url: "",
  dateCreated: new Date(),
  name: "Test org",
  ownerEmail: "owner@example.com",
  members: [],
  invites: [],
};

const MB = 1024 * 1024;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Built after connecting, since creating a context sets up the models
let context: ReqContextClass;
let runJob: (job: Job) => Promise<void>;
let onFail: (error: Error, job: Job) => Promise<void>;
let agenda: Agenda;

const respond = (status: number, body = "") => ({
  responseWithoutBody: new Response(body, { status }),
  stringBody: body,
});

const createProxiedConnection = async ({ proxyEnabled = true } = {}) => {
  // Answers the healthcheck that runs when a proxied connection is created
  if (proxyEnabled) {
    jest
      .mocked(cancellableFetch)
      .mockResolvedValueOnce(respond(200, '{"proxyVersion":"1.0.0"}'));
  }
  return createSDKConnection(context, {
    organization: org.id,
    name: "Web app",
    languages: ["javascript"],
    sdkVersion: "1.7.0",
    environment: "production",
    projects: [],
    encryptPayload: false,
    hashSecureAttributes: false,
    includeVisualExperiments: false,
    includeDraftExperiments: false,
    includeExperimentNames: true,
    includeRedirectExperiments: false,
    includeRuleIds: false,
    includeProjectIdInMetadata: false,
    includeCustomFieldsInMetadata: false,
    allowedCustomFieldsInMetadata: [],
    includeTagsInMetadata: false,
    proxyEnabled,
    proxyHost: "https://proxy.example.com",
  });
};

const FIRST_ATTEMPT = 0;
const RETRY = 1;

const createJob = (
  connectionId: string,
  { cloud = false, attempt = FIRST_ATTEMPT, scheduledCheck = false } = {},
) => {
  const job = agenda.create("proxyUpdate", {
    orgId: org.id,
    connectionId,
    useCloudProxy: cloud,
    retryCount: attempt,
    scheduledCheck,
  });
  jest.spyOn(job, "save").mockResolvedValue(job);
  return job;
};

const push = (
  connectionId: string,
  options: { cloud?: boolean; attempt?: number; scheduledCheck?: boolean } = {},
) => runJob(createJob(connectionId, options));

// Runs the job the way Agenda does, including its fail handler
const pushAndHandleFailure = async (job: Job) => {
  try {
    await runJob(job);
  } catch (e) {
    await onFail(e instanceof Error ? e : new Error(String(e)), job);
  }
};

const savedProxy = async (id: string) =>
  (await findSDKConnectionById(context, id))?.proxy;

// Puts the connection's proxy in a failing state that started `msAgo`
const failingFor = async (connection: SDKConnectionInterface, msAgo: number) =>
  setProxyError(
    context,
    {
      ...connection,
      proxy: {
        ...connection.proxy,
        failingSince: new Date(Date.now() - msAgo),
      },
    },
    "earlier error",
  );

// Like node-fetch's error, whose message includes the URL and any login in it
const connectionRefused = () =>
  Object.assign(
    new Error(
      "request to https://user:secret@proxy.example.com/proxy/features failed, reason: connect ECONNREFUSED",
    ),
    { code: "ECONNREFUSED" },
  );

// The admin email is sent in the background
const flushEmails = () => new Promise((resolve) => setImmediate(resolve));

const sentEvents = () =>
  jest.mocked(createEvent).mock.calls.map(([params]) => params.event);

beforeAll(async () => {
  await connectTestMongo();
  context = new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: "key_test" },
    role: "admin",
  });
  agenda = new Agenda();
  const define = jest.spyOn(agenda, "define");
  const on = jest.spyOn(agenda, "on");
  addProxyUpdateJob(agenda);
  runJob = define.mock.calls[0][1];
  const failListener = on.mock.calls.find(
    ([event]) => event === "fail:proxyUpdate",
  )?.[1];
  if (!failListener) throw new Error("No fail listener");
  onFail = failListener;
});
afterAll(async () => {
  await disconnectTestMongo();
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getContextForAgendaJobByOrgId).mockResolvedValue(context);
  jest.mocked(createEvent).mockResolvedValue("event_1");
  jest.mocked(isEmailEnabled).mockReturnValue(true);
});

describe("recording failures", () => {
  it("records a 413 without counting it toward disabling", async () => {
    const connection = await createProxiedConnection();
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(413));

    await expect(push(connection.id)).rejects.toThrow(
      "exceeds the proxy's request size limit",
    );

    expect(await savedProxy(connection.id)).toMatchObject({
      enabled: true,
      connected: false,
      consecutiveFailures: 0,
      failingSince: expect.any(Date),
      error: expect.stringContaining("Increase MAX_FEATURES_PAYLOAD_SIZE"),
    });
  });

  it("counts other error statuses toward disabling", async () => {
    const connection = await createProxiedConnection();
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(500));

    await expect(push(connection.id)).rejects.toThrow();

    expect(await savedProxy(connection.id)).toMatchObject({
      enabled: true,
      consecutiveFailures: 1,
      error: "POST returned an invalid status code: 500",
    });
  });

  it("records a proxy that doesn't respond without counting it toward disabling", async () => {
    const connection = await createProxiedConnection();
    jest.mocked(cancellableFetch).mockRejectedValueOnce(connectionRefused());

    await expect(push(connection.id)).rejects.toThrow("ECONNREFUSED");

    expect(await savedProxy(connection.id)).toMatchObject({
      enabled: true,
      connected: false,
      consecutiveFailures: 0,
      error: "Couldn't reach the proxy (ECONNREFUSED).",
    });
  });

  it("says how long it waited when the proxy times out", async () => {
    const connection = await createProxiedConnection();
    const timeout = new Error("The user aborted a request.");
    timeout.name = "AbortError";
    jest.mocked(cancellableFetch).mockRejectedValueOnce(timeout);

    await expect(push(connection.id)).rejects.toThrow();

    expect((await savedProxy(connection.id))?.error).toBe(
      "The proxy didn't respond within 30 seconds.",
    );
  });

  it("keeps the time the proxy started failing", async () => {
    const connection = await createProxiedConnection();
    const { failingSince } = await failingFor(connection, 2 * HOUR);
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(500));

    await expect(push(connection.id)).rejects.toThrow();

    expect((await savedProxy(connection.id))?.failingSince).toEqual(
      failingSince,
    );
  });

  it("gives the proxy as long as an SDK webhook to reply", async () => {
    const connection = await createProxiedConnection();
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(200));

    await push(connection.id);

    expect(cancellableFetch).toHaveBeenLastCalledWith(
      "https://proxy.example.com/proxy/features",
      expect.anything(),
      expect.objectContaining({ maxTimeMs: 30000 }),
    );
  });
});

describe("alerts", () => {
  it("doesn't alert on the first attempt", async () => {
    const connection = await createProxiedConnection();
    await failingFor(connection, 2 * HOUR);
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(500));

    await expect(push(connection.id)).rejects.toThrow();

    expect(createEvent).not.toHaveBeenCalled();
  });

  it("doesn't alert when the proxy has failed for less than an hour", async () => {
    const connection = await createProxiedConnection();
    await failingFor(connection, PROXY_ALERT_AFTER_MS - HOUR / 2);
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(500));

    await expect(push(connection.id, { attempt: RETRY })).rejects.toThrow();

    expect(createEvent).not.toHaveBeenCalled();
  });

  it("alerts when the retry fails and the proxy has failed for an hour", async () => {
    const connection = await createProxiedConnection();
    await failingFor(connection, 2 * HOUR);
    jest.mocked(cancellableFetch).mockRejectedValueOnce(connectionRefused());

    await expect(push(connection.id, { attempt: RETRY })).rejects.toThrow();
    await flushEmails();

    expect(jest.mocked(createEvent).mock.calls[0][0]).toMatchObject({
      object: "sdkConnection",
      event: "proxy.failing",
      data: {
        object: {
          connectionId: connection.id,
          status: null,
          error: "Couldn't reach the proxy (ECONNREFUSED).",
        },
      },
    });
    const payloads = jest
      .mocked(createEvent)
      .mock.calls.map(([params]) => params.data);
    expect(JSON.stringify(payloads)).not.toContain("secret");
    expect(sendSdkProxyErrorEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        emails: ["owner@example.com"],
        disabled: false,
      }),
    );
    expect((await savedProxy(connection.id))?.failureAlertedAt).toEqual(
      expect.any(Date),
    );
  });

  it("doesn't alert again within a day", async () => {
    const connection = await createProxiedConnection();
    await failingFor(connection, 2 * HOUR);
    await setProxyFailureAlertedAt(
      context,
      connection,
      new Date(Date.now() - HOUR),
    );
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(500));

    await expect(push(connection.id, { attempt: RETRY })).rejects.toThrow();

    expect(createEvent).not.toHaveBeenCalled();
  });

  it("reminds once a day while the proxy keeps failing", async () => {
    const connection = await createProxiedConnection();
    await failingFor(connection, 2 * PROXY_ALERT_REMINDER_MS);
    await setProxyFailureAlertedAt(
      context,
      connection,
      new Date(Date.now() - PROXY_ALERT_REMINDER_MS - HOUR),
    );
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(500));

    await expect(push(connection.id, { attempt: RETRY })).rejects.toThrow();
    await flushEmails();

    expect(sentEvents()).toEqual(["proxy.failing"]);
    // Reminders go only to event subscribers, who can turn them off
    expect(sendSdkProxyErrorEmail).not.toHaveBeenCalled();
  });

  it("alerts right away when the proxy is disabled", async () => {
    const connection = await createProxiedConnection();
    await setProxyError(
      context,
      {
        ...connection,
        proxy: {
          ...connection.proxy,
          consecutiveFailures: WEBHOOK_CONSECUTIVE_FAILURES_THRESHOLD - 2,
        },
      },
      "earlier error",
    );
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(500));

    await expect(push(connection.id)).rejects.toThrow();
    await flushEmails();

    expect(sentEvents()).toEqual(["proxy.disabled"]);
    expect(sendSdkProxyErrorEmail).toHaveBeenCalledWith(
      expect.objectContaining({ disabled: true }),
    );
    expect(await savedProxy(connection.id)).toMatchObject({
      enabled: false,
      failureAlertedAt: expect.any(Date),
    });
  });

  it("keeps the alert time when recovered can't be sent, so it's tried again", async () => {
    const connection = await createProxiedConnection();
    await failingFor(connection, 2 * HOUR);
    await setProxyFailureAlertedAt(context, connection, new Date());
    jest.mocked(createEvent).mockResolvedValueOnce(null);
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(200));

    await push(connection.id);

    expect(await savedProxy(connection.id)).toMatchObject({
      connected: true,
      error: "",
      failingSince: null,
      failureAlertedAt: expect.any(Date),
    });
  });

  it("tells subscribers when the proxy recovers after an alert, without email", async () => {
    const connection = await createProxiedConnection();
    await failingFor(connection, 2 * HOUR);
    await setProxyFailureAlertedAt(context, connection, new Date());
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(200));

    await push(connection.id);
    await flushEmails();

    expect(sentEvents()).toEqual(["proxy.recovered"]);
    expect(sendSdkProxyErrorEmail).not.toHaveBeenCalled();
    expect(await savedProxy(connection.id)).toMatchObject({
      connected: true,
      error: "",
      failingSince: null,
      failureAlertedAt: null,
    });
  });

  it("sends recovered after the proxy is re-enabled", async () => {
    const connection = await createProxiedConnection({ proxyEnabled: false });
    await setProxyFailureAlertedAt(context, connection, new Date());
    const alerted = await findSDKConnectionById(context, connection.id);
    if (!alerted) throw new Error("No connection");
    await editSDKConnection(context, alerted, { proxyEnabled: true });
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(200));

    await push(connection.id);

    expect(sentEvents()).toEqual(["proxy.recovered"]);
    expect((await savedProxy(connection.id))?.failureAlertedAt).toBeNull();
  });

  it("treats an alert from before the current failures as not sent", async () => {
    const connection = await createProxiedConnection();
    await setProxyFailureAlertedAt(
      context,
      connection,
      new Date(Date.now() - 3 * DAY),
    );
    await failingFor(connection, HOUR / 2);
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(500));

    await expect(push(connection.id, { attempt: RETRY })).rejects.toThrow();
    expect(createEvent).not.toHaveBeenCalled();

    await failingFor(connection, 2 * HOUR);
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(500));

    await expect(push(connection.id, { attempt: RETRY })).rejects.toThrow();
    await flushEmails();

    expect(sentEvents()).toEqual(["proxy.failing"]);
    expect(sendSdkProxyErrorEmail).toHaveBeenCalled();
  });

  it("doesn't send recovered when no alert was sent", async () => {
    const connection = await createProxiedConnection();
    await failingFor(connection, HOUR / 2);
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(200));

    await push(connection.id);

    expect(createEvent).not.toHaveBeenCalled();
    expect((await savedProxy(connection.id))?.failingSince).toBeNull();
  });

  it("doesn't save the alert time when the event wasn't saved", async () => {
    const connection = await createProxiedConnection();
    await failingFor(connection, 2 * HOUR);
    jest.mocked(createEvent).mockResolvedValueOnce(null);
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(500));

    await expect(push(connection.id, { attempt: RETRY })).rejects.toThrow();
    await flushEmails();

    expect(sendSdkProxyErrorEmail).not.toHaveBeenCalled();
    expect((await savedProxy(connection.id))?.failureAlertedAt).toBeUndefined();
  });
});

describe("scheduled checks", () => {
  it("retries a failed first attempt after 5 seconds", async () => {
    const connection = await createProxiedConnection();
    const job = createJob(connection.id);
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(500));

    await pushAndHandleFailure(job);

    expect(job.attrs.data.retryCount).toBe(RETRY);
    expect(job.attrs.nextRunAt?.getTime()).toBeLessThanOrEqual(
      Date.now() + 5000,
    );
  });

  it("checks again when the first alert is due", async () => {
    const connection = await createProxiedConnection();
    const { failingSince } = await failingFor(connection, HOUR / 4);
    const job = createJob(connection.id, { attempt: RETRY });
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(500));

    await pushAndHandleFailure(job);

    expect(createEvent).not.toHaveBeenCalled();
    expect(job.attrs.nextRunAt).toEqual(
      new Date(failingSince.getTime() + PROXY_ALERT_AFTER_MS),
    );
  });

  it("checks again a day after an alert", async () => {
    const connection = await createProxiedConnection();
    await failingFor(connection, 2 * HOUR);
    const job = createJob(connection.id, { attempt: RETRY });
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(500));

    await pushAndHandleFailure(job);

    const alertedAt = (await savedProxy(connection.id))?.failureAlertedAt;
    if (!alertedAt) throw new Error("No alert was sent");
    expect(job.attrs.nextRunAt).toEqual(
      new Date(alertedAt.getTime() + PROXY_ALERT_REMINDER_MS),
    );
  });

  it("marks a rescheduled run as a scheduled check", async () => {
    const connection = await createProxiedConnection();
    await failingFor(connection, HOUR / 4);
    const job = createJob(connection.id, { attempt: RETRY });
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(500));

    await pushAndHandleFailure(job);

    expect(job.attrs.data.scheduledCheck).toBe(true);
  });

  it("doesn't count a failed scheduled check toward disabling", async () => {
    const connection = await createProxiedConnection();
    await failingFor(connection, 2 * HOUR);
    const before = (await savedProxy(connection.id))?.consecutiveFailures;
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(500));

    await expect(
      push(connection.id, { attempt: RETRY, scheduledCheck: true }),
    ).rejects.toThrow();

    expect((await savedProxy(connection.id))?.consecutiveFailures).toBe(before);
  });

  it("stops checking after the proxy has failed for 7 days", async () => {
    const connection = await createProxiedConnection();
    await failingFor(connection, PROXY_CHECKS_FOR_MS + DAY);
    await setProxyFailureAlertedAt(
      context,
      connection,
      new Date(Date.now() - HOUR),
    );
    const job = createJob(connection.id, { attempt: RETRY });
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(500));

    await pushAndHandleFailure(job);

    expect(job.save).not.toHaveBeenCalled();
  });

  it("doesn't check our cloud proxy again", async () => {
    const connection = await createProxiedConnection();
    const job = createJob(connection.id, { cloud: true, attempt: RETRY });
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(500));
    const scheduledAt = job.attrs.nextRunAt;

    await pushAndHandleFailure(job);

    expect(job.attrs.nextRunAt).toEqual(scheduledAt);
    expect(job.save).not.toHaveBeenCalled();
  });

  it("skips a check once the connection's proxy was turned off", async () => {
    const connection = await createProxiedConnection({ proxyEnabled: false });

    await push(connection.id, { attempt: RETRY });

    expect(cancellableFetch).not.toHaveBeenCalled();
  });
});

describe("GrowthBook Cloud proxy", () => {
  it("leaves the connection alone when the push fails", async () => {
    const connection = await createProxiedConnection();
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(413));

    await expect(push(connection.id, { cloud: true })).rejects.toThrow();

    expect(await savedProxy(connection.id)).toMatchObject({
      connected: true,
      consecutiveFailures: 0,
      error: "",
    });
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("leaves the connection alone when it doesn't respond", async () => {
    const connection = await createProxiedConnection();
    jest.mocked(cancellableFetch).mockRejectedValueOnce(connectionRefused());

    await expect(
      push(connection.id, { cloud: true, attempt: RETRY }),
    ).rejects.toThrow();

    expect((await savedProxy(connection.id))?.error).toBe("");
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("is still pushed to after the connection's own proxy is disabled", async () => {
    const connection = await createProxiedConnection();
    await setProxyError(
      context,
      {
        ...connection,
        proxy: {
          ...connection.proxy,
          consecutiveFailures: WEBHOOK_CONSECUTIVE_FAILURES_THRESHOLD - 1,
        },
      },
      "down",
    );
    jest.mocked(cancellableFetch).mockResolvedValueOnce(respond(200));

    await push(connection.id, { cloud: true });

    expect(cancellableFetch).toHaveBeenLastCalledWith(
      "https://proxy.growthbook.io/proxy/features",
      expect.anything(),
      expect.anything(),
    );
  });
});

describe("sendSdkProxyAlert", () => {
  it("doesn't throw when the event can't be saved", async () => {
    const connection = await createProxiedConnection();
    jest.mocked(createEvent).mockRejectedValueOnce(new Error("db down"));

    await expect(
      sendSdkProxyAlert(context, connection, {
        state: "failing",
        status: 500,
        error: "down",
        failingSince: new Date(),
      }),
    ).resolves.toBe(false);
  });
});

describe("describeProxyError", () => {
  it("names the payload size and the setting to change for a 413", () => {
    expect(describeProxyError(413, 4.1 * MB)).toBe(
      "The SDK payload (4.1 MB) exceeds the proxy's request size limit. Increase MAX_FEATURES_PAYLOAD_SIZE on the proxy (MAX_PAYLOAD_SIZE on older versions), and any request size limit on a load balancer or ingress in front of it.",
    );
  });
});
