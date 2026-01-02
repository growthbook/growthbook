import { growthbookTrackingPlugin } from "../../src/plugins/growthbook-tracking";
import {
  EVENT_EXPERIMENT_VIEWED,
  EVENT_FEATURE_EVALUATED,
  GrowthBook,
  GrowthBookClient,
} from "../../src";

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
      },
    );

    gb.destroy();
  });

  it("Can track multiple events without a race condition", async () => {
    // Make the fetch call take 100ms
    fetchMock.mockImplementation(async () => {
      await sleep(100);
    });

    const plugin = growthbookTrackingPlugin({
      queueFlushInterval: 100,
    });
    const gb = new GrowthBook({
      clientKey: "test",
      plugins: [plugin],
    });

    gb.logEvent("test");
    await sleep(150);

    // By now, the first fetch should be in-flight
    // New events should get queued for the next fetch
    gb.logEvent("test2");

    // Wait for both fetches to finish
    await sleep(225);
    expect(fetchMock).toHaveBeenCalledTimes(2);

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
      attributes: {
        id: "123",
        foo: "bar",
      },
    });

    // Mock console.log
    const log = jest.spyOn(console, "log").mockImplementation(() => {});

    gb.logEvent("test", { bar: "baz" });

    // Should have been logged to console
    expect(log).toHaveBeenCalledWith("Logging event to GrowthBook", {
      context_json: { foo: "bar" },
      device_id: "123",
      event_name: "test",
      page_id: null,
      properties_json: { bar: "baz" },
      sdk_language: "js",
      sdk_version: "",
      session_id: null,
      url: "http://localhost:3000",
      user_id: null,
    });

    // Should NOT have been sent to the server
    await sleep(150);
    expect(fetchMock).not.toHaveBeenCalled();

    gb.destroy();
  });

  it("Skips logging duplicate Feature Evaluted events", async () => {
    const plugin = growthbookTrackingPlugin();

    const gb = new GrowthBook({
      clientKey: "test",
      plugins: [plugin],
      url: "http://localhost:3000",
      attributes: {
        foo: "bar",
      },
    });

    // Skips feature evalutead events with the same properties
    gb.logEvent(EVENT_FEATURE_EVALUATED, { foo: "bar" });
    gb.logEvent(EVENT_FEATURE_EVALUATED, { foo: "bar" });
    gb.logEvent(EVENT_FEATURE_EVALUATED, { foo: "baz" });

    await sleep(150);
    let body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.length).toBe(2);
    expect(body[0].properties_json).toEqual({ foo: "bar" });
    expect(body[1].properties_json).toEqual({ foo: "baz" });

    // Also skips experiment viewed events with the same properties
    gb.logEvent(EVENT_EXPERIMENT_VIEWED, { foo: "bar" });
    gb.logEvent(EVENT_EXPERIMENT_VIEWED, { foo: "bar" });
    gb.logEvent(EVENT_EXPERIMENT_VIEWED, { foo: "baz" });

    await sleep(150);
    body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.length).toBe(2);
    expect(body[0].properties_json).toEqual({ foo: "bar" });
    expect(body[1].properties_json).toEqual({ foo: "baz" });

    // Skips the fetch entirely if there are no new events to log
    gb.logEvent(EVENT_FEATURE_EVALUATED, { foo: "bar" });
    await sleep(150);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // De-dupe ignores url and attribute changes by default
    gb.updateAttributes({ foo: "baz" });
    gb.setURL("http://localhost:3001");
    gb.logEvent(EVENT_FEATURE_EVALUATED, { foo: "bar" });
    await sleep(150);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    gb.destroy();
  });

  it("uses key attributes when de-duping events", async () => {
    const plugin = growthbookTrackingPlugin({
      dedupeKeyAttributes: ["foo"],
    });

    const gb = new GrowthBook({
      clientKey: "test",
      plugins: [plugin],
      url: "http://localhost:3000",
      attributes: {
        foo: "bar",
        bar: "baz",
      },
    });

    gb.logEvent(EVENT_FEATURE_EVALUATED);
    await sleep(150);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // If a key attribute changes, it should not be considered a duplicate
    gb.updateAttributes({ foo: "baz" });
    gb.logEvent(EVENT_FEATURE_EVALUATED);
    await sleep(150);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // If a non-key attribute changes, it should be considered a duplicate
    gb.updateAttributes({ bar: "qux" });
    gb.logEvent(EVENT_FEATURE_EVALUATED);
    await sleep(150);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // If a key attribute changes back, it should be considered a duplicate again
    gb.updateAttributes({ foo: "bar" });
    gb.logEvent(EVENT_FEATURE_EVALUATED);
    await sleep(150);
    expect(fetchMock).toHaveBeenCalledTimes(2);

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
      "https://us1.gb-ingest.com/track?client_key=test2",
    );
    const body3 = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(body3.length).toBe(1);
    expect(body3[0].event_name).toBe("test");

    gb.destroy();
    gb2.destroy();
  });

  it("does not de-dupe custom events", async () => {
    const plugin = growthbookTrackingPlugin();

    const gb = new GrowthBook({
      clientKey: "test",
      plugins: [plugin],
      url: "http://localhost:3000",
      attributes: {
        foo: "bar",
      },
    });

    gb.logEvent("custom");
    gb.logEvent("custom");
    gb.logEvent("custom", { foo: "bar" });
    gb.logEvent("custom", { foo: "bar" });

    await sleep(150);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.length).toBe(4);

    gb.destroy();
  });

  it("works for GrowthBookClient and user-scoped instances", async () => {
    const plugin = growthbookTrackingPlugin({
      dedupeKeyAttributes: ["id"],
    });

    const gb = new GrowthBookClient({
      clientKey: "test",
      plugins: [plugin],
    });

    const userContext = { attributes: { id: "123" } };

    // Global logged event with user context
    gb.logEvent(EVENT_FEATURE_EVALUATED, {}, userContext);

    await sleep(150);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // De-dupe
    gb.logEvent(EVENT_FEATURE_EVALUATED, {}, userContext);
    await sleep(150);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // User-scoped logged event
    const gb2 = gb.createScopedInstance({ attributes: { id: "456" } });
    gb2.logEvent(EVENT_FEATURE_EVALUATED);

    await sleep(150);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // De-dupe
    gb2.logEvent(EVENT_FEATURE_EVALUATED);
    await sleep(150);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    gb.destroy();
  });
});
