import { getAutoUpdateFailureOutcome } from "back-end/src/util/autoUpdateRetry";

const MINUTE = 60 * 1000;
const now = new Date("2026-10-06T12:00:00Z");

describe("getAutoUpdateFailureOutcome", () => {
  it("retries the first failure in 10 minutes", () => {
    expect(getAutoUpdateFailureOutcome(1, now)).toEqual({
      action: "retry",
      retryAt: new Date(now.getTime() + 10 * MINUTE),
    });
  });

  it("retries the second failure in 30 minutes", () => {
    expect(getAutoUpdateFailureOutcome(2, now)).toEqual({
      action: "retry",
      retryAt: new Date(now.getTime() + 30 * MINUTE),
    });
  });

  it("turns auto-updates off on the third failure", () => {
    expect(getAutoUpdateFailureOutcome(3, now)).toEqual({ action: "disable" });
  });
});
