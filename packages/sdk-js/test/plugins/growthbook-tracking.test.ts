import { growthbookTrackingPlugin } from "../../src/plugins/growthbook-tracking";
import { GrowthBook } from "../../src";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("growthbookTrackingPlugin", () => {
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = global.fetch = jest.fn();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    // eslint-disable-next-line
    delete (global as any).fetch;
  });

  it("Logs events to the server", async () => {
    const plugin = growthbookTrackingPlugin();

    const gb = new GrowthBook({
      clientKey: "test",
      plugins: [plugin],
      attributes: {
        hello: "world",
        id: "123",
        user_id: "456",
        page_id: "a",
        session_id: "789",
      },
      url: "http://localhost:3000",
    });

    gb.logEvent("test");
    await sleep(50);

    gb.updateAttributes({
      page_id: "b",
    });
    gb.logEvent("another");

    // Should not have been called yet
    expect(fetchMock).not.toHaveBeenCalled();

    await sleep(75);

    expect(fetchMock).toHaveBeenCalledWith(
      `https://us1.gb-ingest.com/track?client_key=test`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "text/plain",
        },
        body: JSON.stringify([
          {
            event_name: "test",
            properties_json: {},
            user_id: "456",
            device_id: "123",
            page_id: "a",
            session_id: "789",
            sdk_language: "js",
            sdk_version: "",
            url: "http://localhost:3000",
            context_json: { hello: "world" },
          },
          {
            event_name: "another",
            properties_json: {},
            user_id: "456",
            device_id: "123",
            page_id: "b",
            session_id: "789",
            sdk_language: "js",
            sdk_version: "",
            url: "http://localhost:3000",
            context_json: { hello: "world" },
          },
        ]),
        credentials: "omit",
      }
    );

    gb.destroy();
  });

  it("Can be disabled and debugged", async () => {
    const plugin = growthbookTrackingPlugin({
      debug: true,
      enable: false,
    });

    const gb = new GrowthBook({
      clientKey: "test",
      plugins: [plugin],
      url: "http://localhost:3000",
    });

    // Mock console.log
    const log = jest.spyOn(console, "log").mockImplementation(() => {});

    gb.logEvent("test");

    // Should have been logged to console
    expect(log).toHaveBeenCalledWith("Logging event to GrowthBook", {
      eventName: "test",
      attributes: {},
      properties: {},
      url: "http://localhost:3000",
    });

    // Should NOT have been sent to the server
    await sleep(150);
    expect(fetchMock).not.toHaveBeenCalled();

    gb.destroy();
  });

  it("Skips logging duplicate events", async () => {
    const plugin = growthbookTrackingPlugin();

    const gb = new GrowthBook({
      clientKey: "test",
      plugins: [plugin],
      url: "http://localhost:3000",
      attributes: {
        foo: "bar",
      },
    });

    gb.logEvent("test");
    gb.logEvent("test");
    gb.logEvent("test2");

    await sleep(150);
    let body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.length).toBe(2);
    expect(body[0].event_name).toBe("test");
    expect(body[1].event_name).toBe("test2");

    // Also skips events with duplicate properties
    gb.logEvent("test", { foo: "bar" });
    gb.logEvent("test", { foo: "bar" });
    gb.logEvent("test", { foo: "baz" });

    await sleep(150);
    body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.length).toBe(2);
    expect(body[0].event_name).toBe("test");
    expect(body[0].properties_json).toEqual({ foo: "bar" });
    expect(body[1].event_name).toBe("test");
    expect(body[1].properties_json).toEqual({ foo: "baz" });

    // Skips the fetch entirely if there are no new events to log
    gb.logEvent("test");
    await sleep(150);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // If the growthbook attributes change, it should not be considered a duplicate
    gb.updateAttributes({ foo: "baz" });
    gb.logEvent("test");
    gb.logEvent("test");

    await sleep(150);
    body = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(body.length).toBe(1);
    expect(body[0].event_name).toBe("test");

    // If the growthbook url changes, it should not be considered a duplicate
    gb.setURL("http://localhost:3001");
    gb.logEvent("test");
    gb.logEvent("test");

    await sleep(150);
    body = JSON.parse(fetchMock.mock.calls[3][1].body);
    expect(body.length).toBe(1);
    expect(body[0].event_name).toBe("test");

    gb.destroy();
  });

  it("Picks up events logged to window.gbEvents", async () => {
    // Events logged before the plugin
    window.gbEvents = [];
    window.gbEvents.push("test");
    window.gbEvents.push({
      eventName: "test2",
      properties: { hello: "world" },
    });

    const plugin = growthbookTrackingPlugin();

    const gb = new GrowthBook({
      clientKey: "test",
      plugins: [plugin],
      url: "http://localhost:3000",
      attributes: {
        foo: "bar",
      },
    });

    await sleep(150);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.length).toBe(2);
    expect(body[0].event_name).toBe("test");
    expect(body[1].event_name).toBe("test2");
    expect(body[1].properties_json).toEqual({ hello: "world" });

    // Picks up events after the plugin is initialized
    window.gbEvents.push("test3");
    await sleep(150);
    const body2 = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body2.length).toBe(1);
    expect(body2[0].event_name).toBe("test3");

    // A new GrowthBook instance does not pick up the events that have already been fired
    const gb2 = new GrowthBook({
      clientKey: "test2",
      plugins: [plugin],
      url: "http://localhost:3000",
      attributes: {
        foo: "bar",
      },
    });

    await sleep(150);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // New events will now be routed to the new instance
    // De-duped by plugin instance, so same event name should still be fired
    window.gbEvents.push("test");
    await sleep(150);

    expect(fetchMock.mock.calls[2][0]).toBe(
      "https://us1.gb-ingest.com/track?client_key=test2"
    );
    const body3 = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(body3.length).toBe(1);
    expect(body3[0].event_name).toBe("test");

    gb.destroy();
    gb2.destroy();
  });
});
