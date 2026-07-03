import { GrowthBookClient } from "@growthbook/growthbook";
import { vi } from "vitest";
import {
  GROWTHBOOK_ERROR_EVENT,
  buildErrorEventProperties,
  captureError,
} from "@/services/growthbook/plugins";

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
    const logEvent = vi.fn();
    client.logEvent = logEvent;

    await captureError({
      gb: client,
      error: new Error("server error"),
      userContext: { attributes: { id: "user-1" } },
      props: { errorType: "manual" },
    });

    expect(logEvent).toHaveBeenCalledWith(
      GROWTHBOOK_ERROR_EVENT,
      expect.objectContaining({
        message: "server error",
        errorType: "manual",
      }),
      { attributes: { id: "user-1" } },
    );
  });

  it("warns when GrowthBookClient is used without userContext", async () => {
    const client = new GrowthBookClient({ clientKey: "sdk-test" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await captureError({
      gb: client,
      error: new Error("orphan"),
    });

    expect(warn).toHaveBeenCalledWith(
      "captureError: pass userContext when gb is a GrowthBookClient.",
    );
    warn.mockRestore();
  });

  it("GROWTHBOOK_ERROR_EVENT matches warehouse filter string", () => {
    expect(GROWTHBOOK_ERROR_EVENT).toEqual("GrowthBook Error");
  });
});
