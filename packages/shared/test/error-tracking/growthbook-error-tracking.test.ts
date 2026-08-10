import { GrowthBook, GrowthBookClient } from "@growthbook/growthbook";
import {
  EVENT_GROWTHBOOK_ERROR,
  buildErrorEventProperties,
  captureError,
} from "../../src/error-tracking/growthbook-error-tracking";

describe("growthbookErrorTracking helpers", () => {
  it("builds GrowthBook Error payload without client fingerprint", () => {
    const err = new Error("something broke");
    err.stack = "Error: something broke\n  at foo (file.js:1:2)";
    const props = buildErrorEventProperties({
      error: err,
      props: { errorType: "manual" },
    });
    expect(props.title).toContain("something broke");
    expect(props.message).toEqual(props.title);
    expect(props.fingerprint).toBeUndefined();
    expect(props.errorType).toEqual("manual");
    expect(Array.isArray(props.stackFrames)).toBe(true);
  });

  it("props cannot override title or message", () => {
    const err = new Error("real message");
    const props = buildErrorEventProperties({
      error: err,
      props: {
        title: "wrong title",
        message: "wrong message",
      },
    });
    expect(props.title).toEqual("real message");
    expect(props.message).toEqual("real message");
  });

  it("logs via GrowthBookClient when userContext is provided", async () => {
    const client = new GrowthBookClient({ clientKey: "sdk-test" });
    const logEvent = jest.fn();
    client.logEvent = logEvent;

    await captureError({
      gb: client,
      error: new Error("server error"),
      userContext: { attributes: { id: "user-1" } },
      props: { errorType: "manual" },
    });

    expect(logEvent).toHaveBeenCalledWith(
      EVENT_GROWTHBOOK_ERROR,
      expect.objectContaining({
        message: "server error",
        errorType: "manual",
      }),
      { attributes: { id: "user-1" } },
    );
  });

  it("warns when GrowthBookClient is used without userContext", async () => {
    const client = new GrowthBookClient({ clientKey: "sdk-test" });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    await captureError({
      gb: client,
      error: new Error("orphan"),
    });

    expect(warn).toHaveBeenCalledWith(
      "captureError: pass userContext when gb is a GrowthBookClient.",
    );
    warn.mockRestore();
  });

  it("EVENT_GROWTHBOOK_ERROR matches warehouse filter string", () => {
    expect(EVENT_GROWTHBOOK_ERROR).toEqual("GrowthBook Error");
  });

  // @growthbook/growthbook ships both a CJS and an ESM build. A consumer
  // whose bundler resolves a different build than this package's own
  // (CommonJS) compiled output ends up with an object that behaves like a
  // GrowthBook instance but fails `instanceof` against this module's copy
  // of the class. Dispatch must not rely on instanceof for that reason —
  // this simulates that cross-build object with a plain, unrelated class.
  it("logs via a GrowthBook-shaped object from a different module instance", async () => {
    class OtherModuleGrowthBook {
      getClientKey() {
        return "sdk-test";
      }
      logEvent = jest.fn();
    }
    const fakeGrowthBook = new OtherModuleGrowthBook();
    expect(fakeGrowthBook).not.toBeInstanceOf(GrowthBook);

    await captureError({
      gb: fakeGrowthBook as unknown as GrowthBook,
      error: new Error("cross-module error"),
      props: { errorType: "manual" },
    });

    expect(fakeGrowthBook.logEvent).toHaveBeenCalledWith(
      EVENT_GROWTHBOOK_ERROR,
      expect.objectContaining({ message: "cross-module error" }),
    );
  });

  it("logs via a GrowthBookClient-shaped object from a different module instance", async () => {
    class OtherModuleGrowthBookClient {
      createScopedInstance() {
        /* marks this as client-like */
      }
      logEvent = jest.fn();
    }
    const fakeClient = new OtherModuleGrowthBookClient();
    expect(fakeClient).not.toBeInstanceOf(GrowthBookClient);

    await captureError({
      gb: fakeClient as unknown as GrowthBookClient,
      error: new Error("cross-module client error"),
      userContext: { attributes: { id: "user-1" } },
      props: { errorType: "manual" },
    });

    expect(fakeClient.logEvent).toHaveBeenCalledWith(
      EVENT_GROWTHBOOK_ERROR,
      expect.objectContaining({ message: "cross-module client error" }),
      { attributes: { id: "user-1" } },
    );
  });
});
