import { getEventForwarderNoEventsMessage } from "./eventForwarderActivityConfig";

describe("getEventForwarderNoEventsMessage", () => {
  it("blames a pause before the usage limit", () => {
    expect(
      getEventForwarderNoEventsMessage({ isPaused: true, isOverLimit: true }),
    ).toBe("Forwarding is paused, so no new events are arriving.");
  });
  it("names the usage limit when forwarding is blocked", () => {
    expect(
      getEventForwarderNoEventsMessage({ isPaused: false, isOverLimit: true }),
    ).toBe(
      "The monthly event limit has been reached, so no new events are arriving.",
    );
  });
  it("says nothing was forwarded otherwise", () => {
    expect(
      getEventForwarderNoEventsMessage({ isPaused: false, isOverLimit: false }),
    ).toBe("No events were forwarded during this period.");
  });
});
