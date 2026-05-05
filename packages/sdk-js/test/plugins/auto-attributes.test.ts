import { GrowthBook, GrowthBookClient } from "../../src";
import { autoAttributesPlugin } from "../../src/plugins/auto-attributes";

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

Object.defineProperty(window, "location", {
  value: {
    ...window.location,
  },
  writable: true,
});

Object.defineProperty(navigator, "userAgent", {
  value: navigator.userAgent,
  writable: true,
});
Object.defineProperty(document, "title", {
  value: document.title,
  writable: true,
});

function setWindowURL(urlString: string) {
  const url = new URL(urlString);
  window.location.href = url.href;
  window.location.pathname = url.pathname;
  window.location.host = url.host;
  window.location.search = url.search;
}

function deleteAllCookies() {
  document.cookie.split(";").forEach((cookie) => {
    document.cookie = cookie.replace(/^ +/, "").replace(/=.*/, `=;`);
  });
}

function getCookie(name: string): string {
  const value = "; " + document.cookie;
  const parts = value.split(`; ${name}=`);
  return parts.length === 2 ? parts[1].split(";")[0] : "";
}

describe("autoAttributesPlugin", () => {
  const baseAttributes = {
    browser: "unknown",
    deviceType: "desktop",
    url: "http://localhost/",
    host: "localhost",
    pageTitle: "",
    path: "/",
    query: "",
  };

  beforeEach(() => {
    setWindowURL("http://localhost");
    document.title = "";
    Object.defineProperty(globalThis.navigator, "userAgent", {
      value: "jsdom",
    });

    deleteAllCookies();
  });

  it("should set initial attributes", async () => {
    setWindowURL("http://localhost/test?hello=world");

    // User agent
    Object.defineProperty(globalThis.navigator, "userAgent", {
      value:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
    });

    // Add document.title
    document.title = "Test Title";

    const plugin = autoAttributesPlugin();
    const gb = new GrowthBook({
      plugins: [plugin],
    });

    expect(gb.getAttributes()).toEqual({
      id: expect.any(String),
      browser: "chrome",
      deviceType: "desktop",
      url: "http://localhost/test?hello=world",
      host: "localhost",
      pageTitle: "Test Title",
      path: "/test",
      query: "?hello=world",
    });

    gb.destroy();
  });
  it("should update attributes on URL change", async () => {
    setWindowURL("http://localhost/test?hello=world");

    const plugin = autoAttributesPlugin();
    const gb = new GrowthBook({
      plugins: [plugin],
    });

    expect(gb.getUrl()).toBe("http://localhost/test?hello=world");
    expect(gb.getAttributes()).toEqual({
      id: expect.any(String),
      ...baseAttributes,
      url: "http://localhost/test?hello=world",
      path: "/test",
      query: "?hello=world",
    });

    // Change URL
    setWindowURL("http://localhost/new");

    // Wait for update
    await new Promise((r) => setTimeout(r, 600));

    expect(gb.getUrl()).toBe("http://localhost/new");
    expect(gb.getAttributes()).toEqual({
      id: expect.any(String),
      ...baseAttributes,
      url: "http://localhost/new",
      path: "/new",
    });

    gb.destroy();
  });

  it("detects mobile device", () => {
    // iOS
    Object.defineProperty(globalThis.navigator, "userAgent", {
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
    });

    const plugin = autoAttributesPlugin();
    const gb = new GrowthBook({
      plugins: [plugin],
    });

    expect(gb.getAttributes().deviceType).toBe("mobile");
    expect(gb.getAttributes().browser).toBe("safari");
    gb.destroy();
  });

  it("parses UTM parameters from querystring and stores in session storage", () => {
    setWindowURL(
      "http://localhost/?utm_source=google&utm_medium=cpc&utm_unknown=foo",
    );

    // Mock sessionStorage
    const sessionStorage = {
      getItem: jest.fn(),
      setItem: jest.fn(),
    };
    Object.defineProperty(window, "sessionStorage", {
      value: sessionStorage,
      writable: true,
    });
    const originalSessionStorage = window.sessionStorage;
    window.sessionStorage =
      sessionStorage as unknown as typeof window.sessionStorage;

    // Make getItem throw to test fault tolerance
    sessionStorage.getItem.mockImplementationOnce(() => {
      throw new Error("Simulated error");
    });

    const plugin = autoAttributesPlugin();
    const gb = new GrowthBook({
      plugins: [plugin],
    });

    expect(gb.getAttributes()).toEqual({
      id: expect.any(String),
      ...baseAttributes,
      url: "http://localhost/?utm_source=google&utm_medium=cpc&utm_unknown=foo",
      query: "?utm_source=google&utm_medium=cpc&utm_unknown=foo",
      utmSource: "google",
      utmMedium: "cpc",
    });

    // Should have persisted UTM parameters in session storage
    expect(sessionStorage.getItem).toHaveBeenCalledWith("utm_params");
    expect(sessionStorage.setItem).toHaveBeenCalledWith(
      "utm_params",
      JSON.stringify({ utmSource: "google", utmMedium: "cpc" }),
    );

    sessionStorage.getItem.mockReturnValueOnce(
      JSON.stringify({ utmSource: "google", utmMedium: "cpc" }),
    );

    // UTM should still be picked up on a new GrowthBook instance with a different URL
    setWindowURL("http://localhost/");
    const gb2 = new GrowthBook({
      plugins: [plugin],
    });
    expect(gb2.getAttributes()).toEqual({
      id: expect.any(String),
      ...baseAttributes,
      utmSource: "google",
      utmMedium: "cpc",
    });

    gb.destroy();
    gb2.destroy();
    window.sessionStorage = originalSessionStorage;
  });

  it("pulls in dataLayer variables as attributes", () => {
    // Mock dataLayer
    const originalDataLayer = window.dataLayer;
    window.dataLayer = [
      { foo: "bar", bar: "baz" },
      // Skip events
      { event: "pageview" },
      // Skip non-objects
      "string",
      // Skip empty objects
      {},
      // Skip known properties
      { gtm: "foo" },
      // Skip non-primitive values
      {
        user: {
          email: "foo",
        },
        cb: () => true,
      },
      // Use the latest value of each property
      { foo: "bar2" },
    ];

    const plugin = autoAttributesPlugin();
    const gb = new GrowthBook({
      plugins: [plugin],
    });

    expect(gb.getAttributes()).toEqual({
      id: expect.any(String),
      ...baseAttributes,
      foo: "bar2",
      bar: "baz",
    });

    gb.destroy();
    window.dataLayer = originalDataLayer;
  });

  it("can override uuid key", () => {
    const plugin = autoAttributesPlugin({ uuidKey: "my_uuid" });
    const gb = new GrowthBook({
      plugins: [plugin],
    });

    expect(gb.getAttributes()).toEqual({
      my_uuid: expect.any(String),
      ...baseAttributes,
    });

    gb.destroy();
  });

  it("can hardcode a uuid", () => {
    const plugin = autoAttributesPlugin({ uuid: "my_uuid" });
    const gb = new GrowthBook({
      plugins: [plugin],
    });

    expect(gb.getAttributes()).toEqual({
      id: "my_uuid",
      ...baseAttributes,
    });

    gb.destroy();
  });

  it("reads an existing uuid from a cookie", () => {
    document.cookie = "gb_uuid=my_uuid";

    const plugin = autoAttributesPlugin({ uuidCookieName: "gb_uuid" });
    const gb = new GrowthBook({
      plugins: [plugin],
    });

    expect(gb.getAttributes()).toEqual({
      id: "my_uuid",
      ...baseAttributes,
    });

    gb.destroy();
  });

  it("persists generated uuid to cookie", () => {
    const plugin = autoAttributesPlugin();
    const gb = new GrowthBook({
      plugins: [plugin],
    });

    const uuid = gb.getAttributes().id;
    expect(getCookie("gbuuid")).toBe(uuid);

    gb.destroy();
  });

  it("can disable uuid auto-persist", () => {
    const plugin = autoAttributesPlugin({ uuidAutoPersist: false });
    const gb = new GrowthBook({
      plugins: [plugin],
    });

    const uuid = gb.getAttributes().id;
    expect(getCookie("gbuuid")).toBe("");

    // Trigger persist
    document.dispatchEvent(new Event("growthbookpersist"));
    expect(getCookie("gbuuid")).toBe(uuid);

    gb.destroy();
  });

  it("works with GrowthBookClient and user-scoped instances", () => {
    const plugin = autoAttributesPlugin();
    const gb = new GrowthBookClient({
      plugins: [plugin],
    });

    // Auto-attributes are not set on the global instance
    expect(gb.getGlobalAttributes()).toEqual({});

    // Auto-attributes are set on the user-scoped instance
    const userContext = { attributes: { bar: "456" } };
    gb.createScopedInstance(userContext);
    expect(userContext.attributes).toEqual({
      bar: "456",
      id: expect.any(String),
      ...baseAttributes,
    });

    gb.destroy();
  });
});
