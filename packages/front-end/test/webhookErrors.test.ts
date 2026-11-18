import { describeWebhookError } from "@/components/Features/SDKConnections/webhookErrors";

describe("describeWebhookError", () => {
  it("reads a nested JSON message and keeps the body pretty", () => {
    const { message, body } = describeWebhookError(
      '{"success":false,"error":{"message":"Token \\"abc\\" not found","id":""}}',
    );
    expect(message).toBe('Token "abc" not found');
    expect(body).toContain('\n  "success": false');
  });

  it("falls back through common message fields", () => {
    expect(describeWebhookError('{"message":"Nope"}').message).toBe("Nope");
    expect(describeWebhookError('{"error":"Bad key"}').message).toBe("Bad key");
    expect(
      describeWebhookError('{"errors":[{"message":"First"}]}').message,
    ).toBe("First");
    expect(describeWebhookError('{"ok":false}').message).toBe(
      "The endpoint returned an error.",
    );
  });

  it("names an HTML page, and passes plain text through", () => {
    expect(describeWebhookError("<!DOCTYPE html><p>502</p>").message).toBe(
      "The endpoint returned an HTML page.",
    );
    expect(
      describeWebhookError("Returned an invalid status code: 404"),
    ).toEqual({ message: "Returned an invalid status code: 404", body: null });
  });
});
