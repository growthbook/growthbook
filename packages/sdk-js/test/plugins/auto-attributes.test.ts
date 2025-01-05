import { GrowthBook } from "../../src";
import { autoAttributesPlugin } from "../../src/plugins/auto-attributes";

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

describe("autoAttributesPlugin", () => {
  beforeEach(() => {
    setWindowURL("http://localhost");
    document.title = "";
    Object.defineProperty(globalThis.navigator, "userAgent", {
      value: "jsdom",
    });
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
      browser: "unknown",
      deviceType: "desktop",
      url: "http://localhost/test?hello=world",
      host: "localhost",
      pageTitle: "",
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
      browser: "unknown",
      deviceType: "desktop",
      url: "http://localhost/new",
      host: "localhost",
      pageTitle: "",
      path: "/new",
      query: "",
    });

    gb.destroy();
  });

  it("supports additional attributes", () => {
    const plugin = autoAttributesPlugin({
      additionalAttributes: {
        hello: "world",
      },
    });
    const gb = new GrowthBook({
      plugins: [plugin],
      attributes: {
        // Doesn't overwrite inline attributes
        inline: "attribute",
      },
    });

    expect(gb.getAttributes()).toEqual({
      hello: "world",
      inline: "attribute",
      id: expect.any(String),
      browser: "unknown",
      deviceType: "desktop",
      url: "http://localhost/",
      host: "localhost",
      pageTitle: "",
      path: "/",
      query: "",
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

  it("parses UTM parameters from querystring", () => {
    setWindowURL("http://localhost/?utm_source=google&utm_medium=cpc");

    const plugin = autoAttributesPlugin();
    const gb = new GrowthBook({
      plugins: [plugin],
    });

    expect(gb.getAttributes()).toEqual({
      id: expect.any(String),
      browser: "unknown",
      deviceType: "desktop",
      url: "http://localhost/?utm_source=google&utm_medium=cpc",
      host: "localhost",
      pageTitle: "",
      path: "/",
      query: "?utm_source=google&utm_medium=cpc",
      utmSource: "google",
      utmMedium: "cpc",
    });
  });
});
