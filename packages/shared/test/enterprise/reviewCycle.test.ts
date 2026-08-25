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

/** Verifies verdict precedence shared by both revision engines. */

describe("statusFromStandingVerdicts", () => {
  it("lets a request for changes outrank an approval", () => {
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
    expect(statusFromStandingVerdicts([], "draft")).toBe("draft");
    expect(statusFromStandingVerdicts([], "pending-review")).toBe(
      "pending-review",
    );
  });
});

describe("review cycle identity", () => {
  it("reads a revision predating the field as cycle 0", () => {
    expect(reviewCycleOf({})).toBe(0);
    expect(reviewCycleOf({ reviewCycle: 3 })).toBe(3);
    expect(isSameReviewCycle({}, { reviewCycle: 0 })).toBe(true);
  });

  it("tells a superseded cycle from the current one", () => {
    expect(isSameReviewCycle({ reviewCycle: 1 }, { reviewCycle: 2 })).toBe(
      false,
    );
    expect(isSameReviewCycle({ reviewCycle: 2 }, { reviewCycle: 2 })).toBe(
      true,
    );
    expect(isSameReviewCycle({}, { reviewCycle: 1 })).toBe(false);
  });
});
