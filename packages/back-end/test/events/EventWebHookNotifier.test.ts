import { EventWebHookNotifier } from "../../src/events/handlers/webhooks/EventWebHookNotifier";
import { getEventWebHookSignatureForPayload } from "../../src/events/handlers/webhooks/event-webhooks-utils";
import { cancellableFetch } from "../../src/util/http.util";

jest.mock("../../src/events/handlers/webhooks/event-webhooks-utils", () => ({
  getEventWebHookSignatureForPayload: jest.fn(),
}));

jest.mock("../../src/util/http.util", () => ({
  cancellableFetch: jest.fn(),
}));

describe("EventWebHookNotifier", () => {
  it("sends data to webhook", async () => {
    getEventWebHookSignatureForPayload.mockReturnValueOnce("some-signature");
    cancellableFetch.mockReturnValueOnce({
      responseWithoutBody: { ok: true, status: "all's good" },
      stringBody: "the response body",
    });

    const result = await EventWebHookNotifier.sendDataToWebHook({
      payload: "the payload",
      eventWebHook: {
        url: "http://foo.com/bla",
        signingKey: "the signing key",
      },
    });

    expect(result).toEqual({
      responseBody: "the response body",
      result: "success",
      statusCode: "all's good",
    });
    expect(cancellableFetch).toHaveBeenCalledWith(
      "http://foo.com/bla",
      {
        body: '"the payload"',
        headers: {
          "Content-Type": "application/json",
          "X-GrowthBook-Signature": "some-signature",
        },
        method: "POST",
      },
      { maxContentSize: 1000, maxTimeMs: 30000 },
    );
  });

  it("returns an an error when request fails", async () => {
    getEventWebHookSignatureForPayload.mockReturnValueOnce("some-signature");
    cancellableFetch.mockReturnValueOnce({
      responseWithoutBody: {
        ok: false,
        status: "sorry dude",
        statusText: "this is not good",
      },
      stringBody: "the failed response body",
    });

    const result = await EventWebHookNotifier.sendDataToWebHook({
      payload: "the payload",
      eventWebHook: {
        url: "http://foo.com/bla",
        signingKey: "the signing key",
      },
    });

    expect(result).toEqual({
      error: "this is not good",
      result: "error",
      statusCode: "sorry dude",
    });
    expect(cancellableFetch).toHaveBeenCalledWith(
      "http://foo.com/bla",
      {
        body: '"the payload"',
        headers: {
          "Content-Type": "application/json",
          "X-GrowthBook-Signature": "some-signature",
        },
        method: "POST",
      },
      { maxContentSize: 1000, maxTimeMs: 30000 },
    );
  });

  it("supports custom methods", async () => {
    getEventWebHookSignatureForPayload.mockReturnValueOnce("some-signature");
    cancellableFetch.mockReturnValueOnce({
      responseWithoutBody: { ok: true, status: "all's good" },
      stringBody: "the response body",
    });

    const result = await EventWebHookNotifier.sendDataToWebHook({
      payload: "the payload",
      eventWebHook: {
        url: "http://foo.com/bla",
        method: "PATCH",
        signingKey: "the signing key",
      },
    });

    expect(result).toEqual({
      responseBody: "the response body",
      result: "success",
      statusCode: "all's good",
    });
    expect(cancellableFetch).toHaveBeenCalledWith(
      "http://foo.com/bla",
      {
        body: '"the payload"',
        headers: {
          "Content-Type": "application/json",
          "X-GrowthBook-Signature": "some-signature",
        },
        method: "PATCH",
      },
      { maxContentSize: 1000, maxTimeMs: 30000 },
    );
  });

  it("supports custom headers", async () => {
    getEventWebHookSignatureForPayload.mockReturnValueOnce("some-signature");
    cancellableFetch.mockReturnValueOnce({
      responseWithoutBody: { ok: true, status: "all's good" },
      stringBody: "the response body",
    });

    const result = await EventWebHookNotifier.sendDataToWebHook({
      payload: "the payload",
      eventWebHook: {
        url: "http://foo.com/bla",
        headers: { foo: "bar" },
        signingKey: "the signing key",
      },
    });

    expect(result).toEqual({
      responseBody: "the response body",
      result: "success",
      statusCode: "all's good",
    });
    expect(cancellableFetch).toHaveBeenCalledWith(
      "http://foo.com/bla",
      {
        body: '"the payload"',
        headers: {
          "Content-Type": "application/json",
          "X-GrowthBook-Signature": "some-signature",
          foo: "bar",
        },
        method: "POST",
      },
      { maxContentSize: 1000, maxTimeMs: 30000 },
    );
  });
});
