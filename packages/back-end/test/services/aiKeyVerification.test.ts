import { verifyAIKey } from "back-end/src/services/aiCredentials";
import {
  NonPublicAIEndpointError,
  getAIEndpointFetch,
} from "back-end/src/services/aiEndpoint";
import { fetch } from "back-end/src/util/http.util";

jest.mock("back-end/src/services/aiEndpoint", () => ({
  ...jest.requireActual("back-end/src/services/aiEndpoint"),
  getAIEndpointFetch: jest.fn(),
}));

jest.mock("back-end/src/util/http.util", () => ({
  ...jest.requireActual("back-end/src/util/http.util"),
  fetch: jest.fn(),
}));

const mockFetch = fetch as jest.MockedFunction<typeof fetch>;
const respond = (status: number) =>
  mockFetch.mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
  } as Awaited<ReturnType<typeof fetch>>);

describe("verifyAIKey", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    jest.mocked(getAIEndpointFetch).mockReturnValue(undefined);
  });

  it("rejects an endpoint the Cloud guard refuses to connect to", async () => {
    jest.mocked(getAIEndpointFetch).mockReturnValue(
      jest.fn().mockRejectedValue(
        Object.assign(new TypeError("fetch failed"), {
          cause: new NonPublicAIEndpointError("blocked"),
        }),
      ),
    );
    const result = await verifyAIKey(
      "openai",
      "sk-test",
      "https://localtest.me/v1",
    );
    expect(result).toEqual({
      valid: false,
      message: "The base URL must point to a publicly reachable host.",
    });
  });

  it("accepts a key the provider's own API confirms, with no warning", async () => {
    respond(200);
    expect(await verifyAIKey("openai", "sk-test")).toEqual({ valid: true });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.anything(),
    );
  });

  it("checks against the custom endpoint and warns it can't fully verify", async () => {
    respond(200);
    const result = await verifyAIKey(
      "openai",
      "sk-or-test",
      "https://openrouter.ai/api/v1",
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      expect.anything(),
    );
    expect(result.valid).toBe(true);
    expect(result.message).toMatch(/can't be fully verified/);
  });

  it("still rejects a key the custom endpoint refuses", async () => {
    respond(401);
    const result = await verifyAIKey(
      "openai",
      "sk-or-test",
      "https://openrouter.ai/api/v1",
    );
    expect(result.valid).toBe(false);
  });
});
