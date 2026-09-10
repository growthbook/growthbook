import { vi } from "vitest";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { ReqContext } from "back-end/types/request";
import { fireGlobalSdkWebhooks } from "back-end/src/jobs/sdkWebhooks";
import { getFeatureDefinitionsWithCache } from "back-end/src/controllers/features";

vi.mock("back-end/src/util/secrets", async () => ({
  ...(await vi.importActual<typeof import("back-end/src/util/secrets")>(
    "back-end/src/util/secrets",
  )),
  // No global webhooks configured (the WEBHOOKS env var is unset)
  WEBHOOKS: [],
}));
vi.mock("back-end/src/controllers/features", () => ({
  getFeatureDefinitionsWithCache: vi.fn().mockResolvedValue({
    features: {},
    dateUpdated: null,
  }),
}));
vi.mock("back-end/src/util/http.util", async () => ({
  ...(await vi.importActual<typeof import("back-end/src/util/http.util")>(
    "back-end/src/util/http.util",
  )),
  cancellableFetch: vi.fn(),
}));

describe("fireGlobalSdkWebhooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not generate SDK payloads when no global webhooks are configured", async () => {
    const connections = [
      {
        id: "sdk_1",
        key: "sdk-key-1",
        organization: "org-1",
        environment: "production",
        projects: [],
        languages: ["javascript"],
      },
      {
        id: "sdk_2",
        key: "sdk-key-2",
        organization: "org-1",
        environment: "production",
        projects: ["p1"],
        languages: ["javascript"],
      },
    ] as unknown as SDKConnectionInterface[];

    await fireGlobalSdkWebhooks(
      { org: { id: "org-1" } } as unknown as ReqContext,
      connections,
    );

    expect(getFeatureDefinitionsWithCache).not.toHaveBeenCalled();
  });
});
