import { notificationCardKindForEvent } from "shared/validators";

describe("notificationCardKindForEvent", () => {
  it("maps supported experiment events to platform-neutral card kinds", () => {
    expect(notificationCardKindForEvent("experiment.info.significance")).toBe(
      "significance",
    );
    expect(notificationCardKindForEvent("experiment.warning")).toBe("warning");
  });

  it("leaves unsupported events as text notifications", () => {
    expect(notificationCardKindForEvent("feature.updated")).toBeUndefined();
  });
});
