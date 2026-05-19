import {
  buildErrorEventProperties,
  fingerprintForError,
  growthbookComposedError,
  normalizeErrorMessageForFingerprint,
  normalizeFilenameForFingerprint,
} from "../../src/plugins/growthbook-error-tracking";
import { EVENT_GROWTHBOOK_ERROR } from "../../src/core";

describe("growthbookErrorTracking helpers", () => {
  it("uses stable fingerprint for same message and stack", () => {
    const err = new Error("boom");
    err.stack = "Error: boom\n  at foo (file.js:1:2)";
    const a = fingerprintForError(err.message, err.stack, err.name);
    const b = fingerprintForError(err.message, err.stack, err.name);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(4);
  });

  it("ignores line and column changes in the same frame", () => {
    const stackA =
      "Error: boom\n  at onClick (src/app/errors-demo/page.tsx:120:11)";
    const stackB =
      "Error: boom\n  at onClick (src/app/errors-demo/page.tsx:188:7)";
    expect(fingerprintForError("boom", stackA, "Error")).toEqual(
      fingerprintForError("boom", stackB, "Error"),
    );
  });

  it("ignores bundled path prefixes for the same source file", () => {
    const stackA =
      "Error: boom\n  at onClick (src/app/errors-demo/page.tsx:10:1)";
    const stackB =
      "Error: boom\n  at onClick (webpack-internal:///(app-pages-browser)/./src/app/errors-demo/page.tsx:10:1)";
    expect(fingerprintForError("boom", stackA, "Error")).toEqual(
      fingerprintForError("boom", stackB, "Error"),
    );
  });

  it("groups dynamic message values with the same template", () => {
    const stack = "Error: boom\n  at loadUser (src/services/users.ts:40:5)";
    expect(fingerprintForError("User 123 not found", stack, "Error")).toEqual(
      fingerprintForError("User 456 not found", stack, "Error"),
    );
  });

  it("separates different static messages at the same stack location", () => {
    const stack = "Error: boom\n  at loadUser (src/services/users.ts:40:5)";
    expect(fingerprintForError("User not found", stack, "Error")).not.toEqual(
      fingerprintForError("Order not found", stack, "Error"),
    );
  });

  it("separates different error types with the same message and stack", () => {
    const stack = "Error: boom\n  at loadUser (src/services/users.ts:40:5)";
    expect(fingerprintForError("boom", stack, "Error")).not.toEqual(
      fingerprintForError("boom", stack, "TypeError"),
    );
  });

  it("normalizes volatile message values", () => {
    expect(normalizeErrorMessageForFingerprint("User 123 failed")).toEqual(
      "User {n} failed",
    );
    expect(
      normalizeErrorMessageForFingerprint(
        "Request failed for https://example.com/a",
      ),
    ).toEqual("Request failed for {url}");
    expect(
      normalizeErrorMessageForFingerprint(
        "Checkout failed 018f4e2a-7b3c-7def-8a2b-9c3d4e5f6789",
      ),
    ).toEqual("Checkout failed {uuid}");
  });

  it("normalizes bundled filenames to app-relative labels", () => {
    expect(
      normalizeFilenameForFingerprint(
        "webpack-internal:///(app-pages-browser)/./src/app/errors-demo/page.tsx:10:1",
      ),
    ).toEqual("errors-demo/page.tsx");
  });

  it("builds GrowthBook Error payload shape", () => {
    const props = buildErrorEventProperties(new Error("x"), {
      errorType: "manual",
    });
    expect(props.title).toContain("x");
    expect(props.message).toEqual(props.title);
    expect(props.fingerprint).toBeTruthy();
    expect(props.errorType).toEqual("manual");
    expect(Array.isArray(props.stackFrames)).toBe(true);
  });

  it("groups composed / template-literal tails when tagged with growthbookComposedError", () => {
    const stack = "Error: x\n  at demo (src/app/errors-demo/page.tsx:99:11)";
    const a = fingerprintForError(
      "Demo: hello abc12xyz suffix",
      stack,
      "Error",
      "Demo: hello {} suffix",
    );
    const b = fingerprintForError(
      "Demo: hello def99zzz suffix",
      stack,
      "Error",
      "Demo: hello {} suffix",
    );
    expect(a).toEqual(b);
    expect(
      fingerprintForError(
        "Demo: hello abc12xyz suffix",
        stack,
        "Error",
        "Different static {} suffix",
      ),
    ).not.toEqual(a);
  });

  it("growthbookComposedError fingerprints ignore interpolated random segments", () => {
    const errA = growthbookComposedError`Demo test (${"rand-a-9x2z"}) tail`;
    errA.stack = "Error\n  at t (demo.tsx:1:2)";
    const errB = growthbookComposedError`Demo test (${"DIFFERENT-ID"}) tail`;
    errB.stack = errA.stack;
    expect(buildErrorEventProperties(errA).fingerprint).toEqual(
      buildErrorEventProperties(errB).fingerprint,
    );
    const propsA = buildErrorEventProperties(errA);
    expect(propsA.title).toContain("rand-a-9x2z");
    expect(propsA.message).toContain("rand-a-9x2z");
    expect(propsA.title).not.toContain("{}");
  });

  it("extras cannot override fingerprint, title, or message", () => {
    const err = new Error("real message");
    const props = buildErrorEventProperties(err, {
      title: "wrong title",
      fingerprint: "deadbeef",
      message: "wrong message",
    } as Record<string, unknown>);
    expect(props.title).toEqual("real message");
    expect(props.message).toEqual("real message");
    expect(props.fingerprint).toEqual(
      buildErrorEventProperties(err).fingerprint,
    );
  });

  it("EVENT_GROWTHBOOK_ERROR matches warehouse filter string", () => {
    expect(EVENT_GROWTHBOOK_ERROR).toEqual("GrowthBook Error");
  });
});
