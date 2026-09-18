import * as cheerio from "cheerio";

jest.mock("back-end/src/util/http.util", () => ({
  cancellableFetch: jest.fn(),
}));

import { cancellableFetch } from "back-end/src/util/http.util";
import {
  buildDigestFromEditorUrl,
  parseFetchableEditorUrl,
} from "back-end/src/api/visual-editor-ai/serverPageDigest";

const mockFetch = cancellableFetch as jest.Mock;

type FakeResponse = {
  status?: number;
  contentType?: string;
  location?: string;
  body?: string;
};

const respond = ({
  status = 200,
  contentType = "text/html; charset=utf-8",
  location,
  body = "",
}: FakeResponse) => ({
  responseWithoutBody: {
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type"
          ? contentType
          : name.toLowerCase() === "location"
            ? (location ?? null)
            : null,
    },
  },
  stringBody: body,
});

// A server-rendered marketing page: real copy, a heading tree, CTAs, a form,
// an image. Deliberately carries a CSS-Modules hashed class on the <h1> and a
// Tailwind class needing CSS escaping, so the selector fallbacks and the stem
// augmentation both get exercised.
const SSR_PAGE = `<!doctype html>
<html lang="en">
<head><title>Acme — Ship faster</title></head>
<body>
  <header><nav><a href="/pricing">Pricing</a><a href="/docs">Documentation</a></nav></header>
  <main>
    <section class="hero_section__a1b2c3">
      <h1 class="styles_heroTitle__x9f2q">Ship faster with Acme</h1>
      <p>Acme gives product teams a single place to run experiments, read the
      results, and roll changes out to everyone. Teams at hundreds of companies
      use it every day to decide what to build next, and to prove that what
      they shipped actually moved the numbers they care about. No SQL required,
      no data team ticket, no waiting three weeks for an answer that arrives
      after the decision has already been made.</p>
      <a class="btn" href="/signup">Get started</a>
      <a href="/demo" class="md:inline-flex">Book a demo</a>
    </section>
    <section id="signup">
      <h2>Join the beta</h2>
      <label for="email">Work email</label>
      <input id="email" name="email" type="email" placeholder="you@company.com" />
      <button type="submit">Subscribe</button>
    </section>
    <section>
      <h2>Trusted by teams everywhere</h2>
      <img src="/logos/wall.png" alt="Customer logos" width="800" height="120" />
      <img src="/px.gif" alt="" width="1" height="1" />
    </section>
  </main>
  <footer><a href="/privacy">Privacy policy</a></footer>
</body>
</html>`;

// A React shell: a bundle, an empty mount point, and a cookie banner whose
// copy is long enough to clear the raw text threshold on its own.
const CSR_SHELL = `<!doctype html>
<html><head><title>Acme</title></head>
<body>
  <div id="cookie-banner">
    <p>We use cookies and similar technologies to personalize content, to
    provide social media features and to analyze our traffic. We also share
    information about your use of our site with our social media, advertising
    and analytics partners who may combine it with other information that you
    have provided to them or that they have collected from your use of their
    services. You can read more in our cookie policy at any time.</p>
    <button>Accept all</button><button>Reject all</button>
    <a href="/cookies">Cookie policy</a><a href="/privacy">Privacy</a>
    <a href="/terms">Terms of service</a><a href="/imprint">Imprint</a>
  </div>
  <div id="root"></div>
  <script src="/static/js/main.8f3a1c.js"></script>
</body></html>`;

beforeEach(() => mockFetch.mockReset());

describe("parseFetchableEditorUrl", () => {
  it("accepts a plain public page URL", () => {
    expect(parseFetchableEditorUrl("https://example.com/pricing")?.href).toBe(
      "https://example.com/pricing",
    );
  });

  // Egress filtering is the proxy's job. An install editing an app on its own
  // network is a supported case, not an attack, and a hostname blocklist here
  // would only break the no-proxy installs it pretends to protect.
  it.each([
    ["an intranet host", "http://marketing-staging/"],
    ["an internal TLD", "https://app.internal/dashboard"],
    ["a private address", "http://10.1.2.3/"],
    ["localhost during development", "http://localhost:3000/"],
  ])("is not an SSRF control: allows %s", (_label, url) => {
    expect(parseFetchableEditorUrl(url)).not.toBeNull();
  });

  it.each([
    ["wildcard pattern", "https://example.com/blog/*"],
    ["non-http scheme", "file:///etc/passwd"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,<h1>hi</h1>"],
    ["embedded credentials", "https://user:pw@example.com/"],
    ["garbage", "not a url"],
    ["empty", ""],
  ])("rejects %s", (_label, url) => {
    expect(parseFetchableEditorUrl(url)).toBeNull();
  });
});

describe("buildDigestFromEditorUrl", () => {
  it("builds a catalog whose selectors each resolve to exactly one element", async () => {
    mockFetch.mockResolvedValue(respond({ body: SSR_PAGE }));

    const digest = await buildDigestFromEditorUrl("https://example.com/");
    expect(digest).not.toBeNull();
    if (!digest) return;

    expect(digest.title).toBe("Acme — Ship faster");
    expect(digest.headings.map((h) => h.text)).toEqual([
      "Ship faster with Acme",
      "Join the beta",
      "Trusted by teams everywhere",
    ]);
    expect(digest.buttons.map((b) => b.text)).toEqual(
      expect.arrayContaining(["Get started", "Book a demo", "Subscribe"]),
    );
    expect(digest.inputs[0]).toMatchObject({
      type: "email",
      name: "email",
      label: "Work email",
      placeholder: "you@company.com",
    });
    // Declared 1x1 spacer dropped, real logo kept.
    expect(digest.images.map((i) => i.src)).toEqual(["/logos/wall.png"]);
    // Landmarks present on the page are listed; ones that aren't, aren't.
    expect(digest.structural.map((s) => s.selector)).toEqual([
      "html",
      "body",
      "header",
      "nav",
      "main",
      "footer",
    ]);
    expect(digest.pageStructure.length).toBeGreaterThan(0);

    // The whole point of the digest: every selector it hands the model must
    // resolve, and resolve to one element. A selector that matches zero or
    // many is a mutation applied to the wrong node on a real visitor's page.
    const $ = cheerio.load(SSR_PAGE);
    const selectors = [
      ...digest.headings,
      ...digest.buttons,
      ...digest.links,
      ...digest.inputs,
      ...digest.images,
      ...digest.pageStructure,
    ].map((e) => e.selector);
    expect(selectors.length).toBeGreaterThan(10);
    for (const selector of selectors) {
      expect([selector, $(selector).length]).toEqual([selector, 1]);
    }

    // Build-time hashes must never be anchored on — they rotate on the site's
    // next deploy and silently break the saved variation.
    for (const selector of selectors) {
      expect(selector).not.toContain("a1b2c3");
      expect(selector).not.toContain("x9f2q");
    }

    // ...but the stable stem behind the hash is, so a selector that HAS gone
    // stale matches nothing rather than the wrong element.
    const h1 = digest.headings.find((h) => h.tag === "h1");
    expect(h1?.selector).toContain('[class*="heroTitle"]');
  });

  // Scheme upgrade, www canonicalization and trailing slashes are what real
  // sites bounce through before serving the page the user is editing.
  it.each([
    ["http -> https", "http://example.com", ["https://example.com/"]],
    [
      "apex -> www",
      "https://example.com/pricing",
      ["https://www.example.com/pricing"],
    ],
    [
      "www -> apex",
      "https://www.example.com/pricing",
      ["https://example.com/pricing"],
    ],
    [
      "trailing slash added",
      "https://example.com/pricing",
      ["https://example.com/pricing/"],
    ],
    [
      "a full canonicalization chain",
      "http://example.com/pricing",
      ["https://example.com/pricing", "https://www.example.com/pricing/"],
    ],
  ])("follows %s", async (_label, from, chain) => {
    for (const location of chain) {
      mockFetch.mockResolvedValueOnce(respond({ status: 301, location }));
    }
    mockFetch.mockResolvedValueOnce(respond({ body: SSR_PAGE }));

    const digest = await buildDigestFromEditorUrl(from);
    expect(digest).not.toBeNull();
    // The digest reports the URL it actually read.
    expect(digest?.url).toBe(chain[chain.length - 1]);
    expect(mockFetch).toHaveBeenCalledTimes(chain.length + 1);
  });

  it.each([
    [
      "a redirect to a login page",
      respond({ status: 302, location: "https://example.com/login?next=%2F" }),
    ],
    [
      "a cross-origin redirect",
      respond({ status: 301, location: "https://www.other.com/" }),
    ],
    [
      "a locale redirect",
      respond({ status: 308, location: "https://example.com/en-us/" }),
    ],
    [
      "a redirect to another subdomain",
      respond({ status: 301, location: "https://shop.example.com/" }),
    ],
    [
      "a redirect that adds query params",
      respond({ status: 302, location: "https://example.com/?gdpr=1" }),
    ],
    ["a 3xx with no Location", respond({ status: 302 })],
    ["a 401", respond({ status: 401, body: SSR_PAGE })],
    ["a 403", respond({ status: 403, body: SSR_PAGE })],
    ["a 500", respond({ status: 500, body: SSR_PAGE })],
    [
      "a non-HTML content type",
      respond({ contentType: "application/json", body: "{}" }),
    ],
  ])("returns null on %s", async (_label, response) => {
    mockFetch.mockResolvedValue(response);
    await expect(
      buildDigestFromEditorUrl("https://example.com/"),
    ).resolves.toBeNull();
  });

  it("refuses an https -> http downgrade mid-chain", async () => {
    mockFetch.mockResolvedValue(
      respond({ status: 301, location: "http://example.com/" }),
    );
    await expect(
      buildDigestFromEditorUrl("https://example.com/"),
    ).resolves.toBeNull();
  });

  it("gives up on a redirect loop instead of following forever", async () => {
    mockFetch
      .mockResolvedValueOnce(
        respond({ status: 301, location: "https://www.example.com/" }),
      )
      .mockResolvedValue(
        respond({ status: 301, location: "https://example.com/" }),
      );

    await expect(
      buildDigestFromEditorUrl("https://example.com/"),
    ).resolves.toBeNull();
    expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("skips a client-rendered shell even when boilerplate clears the text bar", async () => {
    mockFetch.mockResolvedValue(respond({ body: CSR_SHELL }));
    await expect(
      buildDigestFromEditorUrl("https://example.com/"),
    ).resolves.toBeNull();
  });

  it("skips a page with almost no content", async () => {
    mockFetch.mockResolvedValue(
      respond({ body: "<html><body><h1>Hi</h1></body></html>" }),
    );
    await expect(
      buildDigestFromEditorUrl("https://example.com/"),
    ).resolves.toBeNull();
  });

  it("returns null instead of throwing when the fetch blows up", async () => {
    mockFetch.mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    await expect(
      buildDigestFromEditorUrl("https://example.com/"),
    ).resolves.toBeNull();
  });

  it("never fetches an unfetchable editorUrl", async () => {
    await expect(
      buildDigestFromEditorUrl("https://example.com/blog/*"),
    ).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("requests the page without following redirects and with truncation fatal", async () => {
    mockFetch.mockResolvedValue(respond({ body: SSR_PAGE }));
    await buildDigestFromEditorUrl("https://example.com/");

    const [, init, limits] = mockFetch.mock.calls[0];
    expect(init.redirect).toBe("manual");
    expect(limits.throwOnTruncate).toBe(true);
    expect(limits.maxContentSize).toBeGreaterThan(0);
    expect(limits.maxTimeMs).toBeGreaterThan(0);
  });
});
