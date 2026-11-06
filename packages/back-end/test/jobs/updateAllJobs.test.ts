import { WebhookInterface } from "shared/types/webhook";
import { ReqContext } from "back-end/types/request";
import { hasSdkPayloadListeners } from "back-end/src/jobs/updateAllJobs";

const defaultSecrets = {
  IS_CLOUD: false,
  WEBHOOKS: [] as unknown[],
  FASTLY_SERVICE_ID: "",
  FASTLY_API_TOKEN: "",
  PROXY_ENABLED: false,
  PROXY_HOST_INTERNAL: "",
  PROXY_HOST_PUBLIC: "",
};

// The state lives inside the factory because modules imported by
// updateAllJobs read some of these values at load time.
jest.mock("back-end/src/util/secrets", () => {
  const state = {
    IS_CLOUD: false,
    WEBHOOKS: [] as unknown[],
    FASTLY_SERVICE_ID: "",
    FASTLY_API_TOKEN: "",
    PROXY_ENABLED: false,
    PROXY_HOST_INTERNAL: "",
    PROXY_HOST_PUBLIC: "",
  };
  return {
    ...jest.requireActual("back-end/src/util/secrets"),
    mockState: state,
    get IS_CLOUD() {
      return state.IS_CLOUD;
    },
    get WEBHOOKS() {
      return state.WEBHOOKS;
    },
    get FASTLY_SERVICE_ID() {
      return state.FASTLY_SERVICE_ID;
    },
    get FASTLY_API_TOKEN() {
      return state.FASTLY_API_TOKEN;
    },
    get PROXY_ENABLED() {
      return state.PROXY_ENABLED;
    },
    get PROXY_HOST_INTERNAL() {
      return state.PROXY_HOST_INTERNAL;
    },
    get PROXY_HOST_PUBLIC() {
      return state.PROXY_HOST_PUBLIC;
    },
  };
});

const mockSecrets: typeof defaultSecrets = jest.requireMock(
  "back-end/src/util/secrets",
).mockState;

const webhook = (disabled: boolean) => ({ disabled }) as WebhookInterface;

function makeContext({
  sdk = [],
  legacy = [],
}: { sdk?: WebhookInterface[]; legacy?: WebhookInterface[] } = {}) {
  const getAll = jest.fn().mockResolvedValue(sdk);
  const findAllLegacySdkWebhooks = jest.fn().mockResolvedValue(legacy);
  const context = {
    models: { sdkWebhooks: { getAll, findAllLegacySdkWebhooks } },
  } as unknown as ReqContext;
  return { context, getAll, findAllLegacySdkWebhooks };
}

describe("hasSdkPayloadListeners", () => {
  beforeEach(() => {
    Object.assign(mockSecrets, defaultSecrets, { WEBHOOKS: [] });
  });

  it("is false when nothing is configured", async () => {
    const { context, getAll, findAllLegacySdkWebhooks } = makeContext();
    expect(await hasSdkPayloadListeners(context)).toBe(false);
    expect(getAll).toHaveBeenCalledTimes(1);
    expect(findAllLegacySdkWebhooks).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "IS_CLOUD", setup: () => (mockSecrets.IS_CLOUD = true) },
    {
      name: "WEBHOOKS",
      setup: () => (mockSecrets.WEBHOOKS = [{ url: "https://x" }]),
    },
    {
      name: "Fastly",
      setup: () => {
        mockSecrets.FASTLY_SERVICE_ID = "svc";
        mockSecrets.FASTLY_API_TOKEN = "token";
      },
    },
    {
      name: "a proxy with an internal host",
      setup: () => {
        mockSecrets.PROXY_ENABLED = true;
        mockSecrets.PROXY_HOST_INTERNAL = "http://proxy";
      },
    },
    {
      name: "a proxy with a public host",
      setup: () => {
        mockSecrets.PROXY_ENABLED = true;
        mockSecrets.PROXY_HOST_PUBLIC = "https://proxy";
      },
    },
  ])("is true for $name without reading the database", async ({ setup }) => {
    setup();
    const { context, getAll, findAllLegacySdkWebhooks } = makeContext();
    expect(await hasSdkPayloadListeners(context)).toBe(true);
    expect(getAll).not.toHaveBeenCalled();
    expect(findAllLegacySdkWebhooks).not.toHaveBeenCalled();
  });

  it("ignores half-configured Fastly and a proxy with no host", async () => {
    mockSecrets.FASTLY_SERVICE_ID = "svc";
    mockSecrets.PROXY_ENABLED = true;
    const { context } = makeContext();
    expect(await hasSdkPayloadListeners(context)).toBe(false);
  });

  it("is true for an enabled SDK webhook, without the legacy read", async () => {
    const { context, findAllLegacySdkWebhooks } = makeContext({
      sdk: [webhook(true), webhook(false)],
    });
    expect(await hasSdkPayloadListeners(context)).toBe(true);
    expect(findAllLegacySdkWebhooks).not.toHaveBeenCalled();
  });

  it("is true for an enabled legacy webhook", async () => {
    const { context } = makeContext({ legacy: [webhook(false)] });
    expect(await hasSdkPayloadListeners(context)).toBe(true);
  });

  it("ignores disabled webhooks", async () => {
    const { context } = makeContext({
      sdk: [webhook(true)],
      legacy: [webhook(true)],
    });
    expect(await hasSdkPayloadListeners(context)).toBe(false);
  });
});
