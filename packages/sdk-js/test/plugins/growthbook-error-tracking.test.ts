import {
  buildErrorEventProperties,
  captureGrowthBookError,
  setFingerprint,
} from "../../src/plugins/growthbook-error-tracking";
import { GrowthBook } from "../../src/GrowthBook";
import { EVENT_GROWTHBOOK_ERROR } from "../../src/core";

describe("growthbookErrorTracking helpers", () => {
  it("builds GrowthBook Error payload without client fingerprint", () => {
    const err = new Error("something broke");
    err.stack = "Error: something broke\n  at foo (file.js:1:2)";
    const props = buildErrorEventProperties(err, {
      errorType: "manual",
    });
    expect(props.title).toContain("something broke");
    expect(props.message).toEqual(props.title);
    expect(props.fingerprint).toBeUndefined();
    expect(props.errorType).toEqual("manual");
    expect(Array.isArray(props.stackFrames)).toBe(true);
  });

  it("setFingerprint applies a string fingerprint on the next capture", async () => {
    const gb = new GrowthBook({ clientKey: "sdk-test" });
    const logEvent = jest.fn();
    gb.logEvent = logEvent;

    setFingerprint(gb, "my-custom-group");
    await captureGrowthBookError(gb, new Error("volatile 123"), {
      errorType: "manual",
    });

    expect(logEvent).toHaveBeenCalledWith(
      EVENT_GROWTHBOOK_ERROR,
      expect.objectContaining({
        fingerprint: "my-custom-group",
        message: "volatile 123",
      }),
    );
  });

  it("setFingerprint applies fingerprintParts on the next capture", async () => {
    const gb = new GrowthBook({ clientKey: "sdk-test" });
    const logEvent = jest.fn();
    gb.logEvent = logEvent;

    setFingerprint(gb, ["checkout", "failed"]);
    await captureGrowthBookError(gb, new Error("order 999"), {
      errorType: "manual",
    });

    expect(logEvent).toHaveBeenCalledWith(
      EVENT_GROWTHBOOK_ERROR,
      expect.objectContaining({
        fingerprintParts: ["checkout", "failed"],
      }),
    );
    const props = logEvent.mock.calls[0][1];
    expect(props.fingerprint).toBeUndefined();
  });

  it("extras cannot override title or message", () => {
    const err = new Error("real message");
    const props = buildErrorEventProperties(err, {
      title: "wrong title",
      message: "wrong message",
    } as Record<string, unknown>);
    expect(props.title).toEqual("real message");
    expect(props.message).toEqual("real message");
  });

  it("EVENT_GROWTHBOOK_ERROR matches warehouse filter string", () => {
    expect(EVENT_GROWTHBOOK_ERROR).toEqual("GrowthBook Error");
  });
});
