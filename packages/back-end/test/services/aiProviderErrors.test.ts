import {
  PUBLIC_STREAM_ERROR,
  getPublicAIErrorMessage,
} from "back-end/src/enterprise/services/aiProviderErrors";

// Shaped like the AI SDK's APICallError and RetryError; the real "ai" package
// is stubbed in back-end tests.
const apiError = (statusCode: number) =>
  Object.assign(new Error("provider error"), {
    name: "AI_APICallError",
    statusCode,
    responseBody: '{"error":{"message":"User not found."}}',
  });

describe("getPublicAIErrorMessage", () => {
  it.each([401, 403])("names a rejected key on %s", (status) => {
    expect(getPublicAIErrorMessage(apiError(status))).toMatch(
      /rejected the API key/,
    );
  });

  it("points at the model ID and base URL on 404", () => {
    expect(getPublicAIErrorMessage(apiError(404))).toMatch(/model ID/);
  });

  it("unwraps retry errors", () => {
    const err = Object.assign(new Error("failed after retries"), {
      name: "AI_RetryError",
      lastError: apiError(401),
    });
    expect(getPublicAIErrorMessage(err)).toMatch(/rejected the API key/);
  });

  it.each([
    ["a server error", apiError(500)],
    ["a rate limit", apiError(429)],
    ["a plain error", new Error("socket hang up")],
    ["a non-error", "boom"],
    [
      "a non-numeric status",
      Object.assign(new Error("x"), { statusCode: "401" }),
    ],
  ])("stays generic for %s", (_label, err) => {
    expect(getPublicAIErrorMessage(err)).toBe(PUBLIC_STREAM_ERROR);
  });
});
