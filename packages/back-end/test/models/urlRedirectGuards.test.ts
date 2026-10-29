// Loaded first: the model sits on an import cycle that only resolves from here.
import "back-end/src/services/context";
import {
  assertNoRedirectLoop,
  assertRedirectDestinations,
} from "back-end/src/models/UrlRedirectModel";

const to = (variation: string, url: string) => ({ variation, url });

describe("assertRedirectDestinations", () => {
  const variationIds = ["v0", "v1"];
  const redirect = (variations: string[]) => ({
    urlPattern: "https://shop.test/cart",
    destinationURLs: variations.map((v) => to(v, `https://shop.test/${v}`)),
  });

  it("accepts one destination per variation in either mode", () => {
    for (const exact of [true, false]) {
      expect(() =>
        assertRedirectDestinations(redirect(["v1", "v0"]), variationIds, {
          exact,
        }),
      ).not.toThrow();
    }
  });

  it.each([
    { name: "a variation with no destination", given: ["v0"] },
    {
      name: "a second destination standing in for a missing one",
      given: ["v0", "v0"],
    },
  ])("refuses $name in either mode", ({ given }) => {
    for (const exact of [true, false]) {
      expect(() =>
        assertRedirectDestinations(redirect(given), variationIds, { exact }),
      ).toThrow(
        "The URL Redirect from https://shop.test/cart needs one destination for each variation.",
      );
    }
  });

  it.each([
    {
      name: "a destination for a variation it doesn't have",
      given: ["v0", "v1", "v2"],
    },
    {
      name: "a second destination for one variation",
      given: ["v0", "v1", "v1"],
    },
  ])("refuses $name only when exact", ({ given }) => {
    expect(() =>
      assertRedirectDestinations(redirect(given), variationIds, {
        exact: true,
      }),
    ).toThrow("needs one destination for each variation");
    expect(() =>
      assertRedirectDestinations(redirect(given), variationIds, {
        exact: false,
      }),
    ).not.toThrow();
  });
});

describe("assertNoRedirectLoop", () => {
  const sale = {
    urlPattern: "https://shop.test/sale",
    destinationURLs: [
      to("v0", "https://shop.test/sale-a"),
      to("v1", "https://shop.test/sale-b"),
    ],
  };

  it.each([
    {
      name: "an origin the other's origin matches",
      other: {
        urlPattern: "https://shop.test/sale/",
        destinationURLs: [to("v0", "https://shop.test/clearance")],
      },
      message:
        "The URL Redirect from https://shop.test/sale matches the origin of the one from https://shop.test/sale/.",
    },
    {
      name: "an origin the other's destination lands on",
      other: {
        urlPattern: "https://shop.test/home",
        destinationURLs: [to("v0", "https://shop.test/sale")],
      },
      message:
        "The URL Redirect from https://shop.test/sale matches a destination of the one from https://shop.test/home.",
    },
    {
      name: "a destination that lands on the other's origin",
      other: {
        urlPattern: "https://shop.test/sale-b",
        destinationURLs: [to("v0", "https://shop.test/outlet")],
      },
      message:
        "A destination of the URL Redirect from https://shop.test/sale matches the origin of the one from https://shop.test/sale-b.",
    },
    {
      name: "a destination under the other's wildcard origin",
      other: {
        urlPattern: "https://shop.test/sale-*",
        destinationURLs: [to("v0", "https://shop.test/outlet")],
      },
      message:
        "A destination of the URL Redirect from https://shop.test/sale matches the origin of the one from https://shop.test/sale-*.",
    },
  ])("refuses $name", ({ other, message }) => {
    expect(() => assertNoRedirectLoop(sale, [other])).toThrow(message);
  });

  it("accepts redirects that never chain into each other", () => {
    expect(() =>
      assertNoRedirectLoop(sale, [
        {
          urlPattern: "https://shop.test/about",
          destinationURLs: [to("v0", "https://shop.test/about-us")],
        },
        {
          urlPattern: "https://blog.test/sale",
          destinationURLs: [to("v0", "https://blog.test/deals")],
        },
      ]),
    ).not.toThrow();
  });

  it("checks every other redirect, not just the first", () => {
    expect(() =>
      assertNoRedirectLoop(sale, [
        {
          urlPattern: "https://shop.test/about",
          destinationURLs: [to("v0", "https://shop.test/about-us")],
        },
        {
          urlPattern: "https://shop.test/landing",
          destinationURLs: [to("v0", "https://shop.test/sale")],
        },
      ]),
    ).toThrow(
      "matches a destination of the one from https://shop.test/landing",
    );
  });
});
