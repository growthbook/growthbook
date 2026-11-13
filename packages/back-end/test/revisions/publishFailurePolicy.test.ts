import {
  BadRequestError,
  ConflictError,
  MergeConflictError,
  TerminalPublishError,
} from "back-end/src/util/errors";
import {
  classifyPublishFailure,
  decideScheduledPublishOutcome,
  SCHEDULED_PUBLISH_MAX_ATTEMPTS,
} from "back-end/src/revisions/publishFailurePolicy";

describe("classifyPublishFailure", () => {
  it("classifies TerminalPublishError as terminal", () => {
    expect(classifyPublishFailure(new TerminalPublishError("checklist"))).toBe(
      "terminal",
    );
  });

  it("classifies a duck-typed terminal marker as terminal", () => {
    // Survives a re-throw / cross-module boundary where instanceof is unreliable.
    expect(
      classifyPublishFailure({ message: "x", terminalPublishFailure: true }),
    ).toBe("terminal");
  });

  it("classifies merge conflicts and other errors as transient", () => {
    expect(classifyPublishFailure(new MergeConflictError("conflict", []))).toBe(
      "transient",
    );
    expect(classifyPublishFailure(new ConflictError("rebase"))).toBe(
      "transient",
    );
    expect(classifyPublishFailure(new BadRequestError("sibling lock"))).toBe(
      "transient",
    );
  });

  it("defaults unknown / infrastructure errors to transient", () => {
    expect(classifyPublishFailure(new Error("mongo blip"))).toBe("transient");
    expect(classifyPublishFailure("some string")).toBe("transient");
    expect(classifyPublishFailure(null)).toBe("transient");
    expect(classifyPublishFailure(undefined)).toBe("transient");
    expect(classifyPublishFailure({ terminalPublishFailure: false })).toBe(
      "transient",
    );
  });
});

describe("decideScheduledPublishOutcome", () => {
  const now = new Date("2026-07-10T12:00:00.000Z");

  it("gives up immediately on a terminal failure, even on attempt 1", () => {
    const outcome = decideScheduledPublishOutcome({
      error: new TerminalPublishError("checklist required"),
      attempts: 1,
      now,
    });
    expect(outcome).toEqual({
      action: "give-up",
      classification: "terminal",
      attempts: 1,
    });
  });

  it("retries a transient failure under the cap, with backoff", () => {
    const outcome = decideScheduledPublishOutcome({
      error: new MergeConflictError("conflict", []),
      attempts: 3,
      now,
    });
    expect(outcome.action).toBe("retry");
    if (outcome.action !== "retry") throw new Error("expected retry");
    expect(outcome.classification).toBe("transient");
    expect(outcome.nextAttemptAt).toEqual(new Date(now.getTime() + 30_000));
  });

  it("gives up on a transient failure once the cap is reached", () => {
    const outcome = decideScheduledPublishOutcome({
      error: new MergeConflictError("conflict", []),
      attempts: SCHEDULED_PUBLISH_MAX_ATTEMPTS,
      now,
    });
    expect(outcome).toEqual({
      action: "give-up",
      classification: "transient",
      attempts: SCHEDULED_PUBLISH_MAX_ATTEMPTS,
    });
  });

  it("respects a custom maxAttempts", () => {
    expect(
      decideScheduledPublishOutcome({
        error: new Error("blip"),
        attempts: 2,
        now,
        maxAttempts: 3,
      }).action,
    ).toBe("retry");
    expect(
      decideScheduledPublishOutcome({
        error: new Error("blip"),
        attempts: 3,
        now,
        maxAttempts: 3,
      }).action,
    ).toBe("give-up");
  });
});
