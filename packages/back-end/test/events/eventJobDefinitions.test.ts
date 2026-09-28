import { Agenda } from "agenda";
import { EventNotifier } from "back-end/src/events/notifiers/EventNotifier";
import { EventWebHookNotifier } from "back-end/src/events/handlers/webhooks/EventWebHookNotifier";

describe("event notification job definitions", () => {
  it("defines eventCreated and eventWebHook up front, and only once", () => {
    const agenda = { define: jest.fn() } as unknown as Agenda;

    EventNotifier.defineJob(agenda);
    EventWebHookNotifier.defineJob(agenda);

    expect(agenda.define).toHaveBeenCalledWith(
      "eventCreated",
      expect.any(Function),
    );
    expect(agenda.define).toHaveBeenCalledWith(
      "eventWebHook",
      expect.any(Function),
    );
    expect(agenda.define).toHaveBeenCalledTimes(2);

    new EventNotifier("evt_123", agenda);
    new EventWebHookNotifier(
      { eventId: "evt_123", eventWebHookId: "ewh_123" },
      agenda,
    );
    EventNotifier.defineJob(agenda);
    EventWebHookNotifier.defineJob(agenda);

    expect(agenda.define).toHaveBeenCalledTimes(2);
  });
});
