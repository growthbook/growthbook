/// <reference types="jest" />

import {
  isSameReviewCycle,
  reviewCycleOf,
  statusFromStandingVerdicts,
} from "../../src/enterprise/reviewCycle";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => {
  toBe: (expected: unknown) => void;
  toEqual: (expected: unknown) => void;
};

/**
 * Both engines resolve a revision's status through `statusFromStandingVerdicts`,
 * and the rule it encodes is a governance one: a request for changes OUTRANKS an
 * approval, so one reviewer's approval cannot clear another reviewer's standing
 * objection.
 *
 * That rule was stated in the function's own doc comment and enforced nowhere.
 * Swapping the two branches — so an approval wins and a revision with an
 * unresolved objection becomes publishable — passed all 425 revision tests and
 * all 462 model tests, in both engines at once.
 *
 * These are cheap because the function is pure. The engines' own suites cover
 * how verdicts are gathered; what belongs here is the precedence itself.
 */

describe("statusFromStandingVerdicts", () => {
  it("lets a request for changes outrank an approval", () => {
    // Order must not matter: whoever reviewed last does not decide the outcome.
    expect(
      statusFromStandingVerdicts(["approved", "changes-requested"], "draft"),
    ).toBe("changes-requested");
    expect(
      statusFromStandingVerdicts(["changes-requested", "approved"], "draft"),
    ).toBe("changes-requested");
  });

  it("approves only when nothing stands against it", () => {
    expect(statusFromStandingVerdicts(["approved"], "draft")).toBe("approved");
    expect(statusFromStandingVerdicts(["approved", "approved"], "draft")).toBe(
      "approved",
    );
  });

  it("falls back when no verdict stands", () => {
    // The caller chooses the fallback — the engines legitimately differ here,
    // which is why it is a parameter rather than a constant.
    expect(statusFromStandingVerdicts([], "draft")).toBe("draft");
    expect(statusFromStandingVerdicts([], "pending-review")).toBe(
      "pending-review",
    );
  });
});

describe("review cycle identity", () => {
  it("reads a revision predating the field as cycle 0", () => {
    // Legacy rows must still compare equal to each other rather than being
    // treated as perpetually superseded.
    expect(reviewCycleOf({})).toBe(0);
    expect(reviewCycleOf({ reviewCycle: 3 })).toBe(3);
    expect(isSameReviewCycle({}, { reviewCycle: 0 })).toBe(true);
  });

  it("tells a superseded cycle from the current one", () => {
    // The ABA this field exists for: recall-then-resubmit returns the revision
    // to the status it already held, so status cannot identify a round.
    expect(isSameReviewCycle({ reviewCycle: 1 }, { reviewCycle: 2 })).toBe(
      false,
    );
    expect(isSameReviewCycle({ reviewCycle: 2 }, { reviewCycle: 2 })).toBe(
      true,
    );
    expect(isSameReviewCycle({}, { reviewCycle: 1 })).toBe(false);
  });
});
