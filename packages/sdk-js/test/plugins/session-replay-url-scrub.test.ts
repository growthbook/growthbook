import {
  scrubEventUrls,
  scrubUrl,
} from "../../src/plugins/session-replay-url-scrub";

describe("session replay URL scrubbing", () => {
  it("strips query params and fragments and redacts ID-like path segments", () => {
    expect(
      scrubUrl(
        "https://app.example.com/users/123/orders/f47ac10b-58cc-4372-a567-0e02b2c3d479?email=user@example.com&token=secret#access_token=abc",
      ),
    ).toBe("https://app.example.com/users/[id]/orders/[id]");
  });

  it("preserves allowlisted query params and customer-approved fragments", () => {
    expect(
      scrubUrl(
        "https://app.example.com/search?tab=settings&token=secret&page=2#section",
        {
          allowQueryParams: ["tab", "page"],
          keepFragment: true,
        },
      ),
    ).toBe("https://app.example.com/search?tab=settings&page=2#section");
  });

  it("resolves relative URLs against the current page before scrubbing", () => {
    window.history.pushState(
      {},
      "",
      "/accounts/abc123def4567890/settings?token=secret",
    );

    expect(scrubUrl("../users/123?email=user@example.com")).toBe(
      "http://localhost/accounts/users/[id]",
    );
  });

  it("applies custom path redaction patterns", () => {
    expect(
      scrubUrl("https://app.example.com/orders/ORD-12AB34CD/details", {
        redactPathPatterns: [/^ORD-[0-9A-Z]+$/],
      }),
    ).toBe("https://app.example.com/orders/[id]/details");
  });

  it("scrubs meta event hrefs", () => {
    const event = {
      type: 4,
      timestamp: 1000,
      data: {
        href: "https://app.example.com/users/123?token=secret#access_token=abc",
        width: 1024,
      },
    };

    expect(scrubEventUrls(event)).toEqual({
      ...event,
      data: {
        href: "https://app.example.com/users/[id]",
        width: 1024,
      },
    });
  });

  it("scrubs URL attributes throughout full snapshot trees", () => {
    const event = {
      type: 2,
      timestamp: 1000,
      data: {
        node: {
          type: 0,
          childNodes: [
            {
              type: 2,
              tagName: "a",
              attributes: {
                href: "https://app.example.com/users/123?token=secret",
                class: "link",
              },
              childNodes: [
                {
                  type: 2,
                  tagName: "img",
                  attributes: {
                    src: "https://cdn.example.com/assets/abcdef1234567890.png?signature=secret",
                  },
                },
              ],
            },
          ],
        },
      },
    };

    expect(scrubEventUrls(event)).toEqual({
      ...event,
      data: {
        node: {
          type: 0,
          childNodes: [
            {
              type: 2,
              tagName: "a",
              attributes: {
                href: "https://app.example.com/users/[id]",
                class: "link",
              },
              childNodes: [
                {
                  type: 2,
                  tagName: "img",
                  attributes: {
                    src: "https://cdn.example.com/assets/abcdef1234567890.png",
                  },
                },
              ],
            },
          ],
        },
      },
    });
  });

  it("scrubs URL attributes in mutation events", () => {
    const event = {
      type: 3,
      timestamp: 1000,
      data: {
        source: 0,
        attributes: [
          {
            id: 1,
            attributes: {
              "data-url":
                "https://app.example.com/accounts/123?email=user@example.com",
              title: "Account",
            },
          },
          {
            id: 2,
            attributes: {
              "aria-label": "unchanged",
            },
          },
        ],
      },
    };

    expect(scrubEventUrls(event)).toEqual({
      ...event,
      data: {
        source: 0,
        attributes: [
          {
            id: 1,
            attributes: {
              "data-url": "https://app.example.com/accounts/[id]",
              title: "Account",
            },
          },
          {
            id: 2,
            attributes: {
              "aria-label": "unchanged",
            },
          },
        ],
      },
    });
  });

  it("returns the original event when there is nothing to scrub", () => {
    const event = {
      type: 3,
      timestamp: 1000,
      data: {
        source: 1,
        positions: [],
      },
    };

    expect(scrubEventUrls(event)).toBe(event);
  });
});
