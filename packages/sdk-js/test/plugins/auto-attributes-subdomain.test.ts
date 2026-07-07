import { Experiment, GrowthBook } from "../../src";
import { autoAttributesPlugin } from "../../src/plugins/auto-attributes";

/**
 * Simulates the real-world "redirect experiment across subdomains" scenario that
 * causes a Sample Ratio Mismatch (SRM) in the Managed Warehouse.
 *
 * The GrowthBook anonymous id (`gbuuid`) is stored in a first-party cookie. By
 * default that cookie is *host-only*, so redirecting from `www.example.com` to
 * `app.example.com` finds no cookie on the new host, mints a brand new id, and
 * re-buckets the user into a fresh variation. The warehouse then counts the same
 * human as two `device_id`s in (potentially) two different arms -> SRM.
 *
 * Mixpanel hides this via identity merge. We reproduce the same effect in the
 * SDK by scoping the cookie to the parent domain (".example.com") so every
 * subdomain reads the *same* id -> one human, one id, one variation.
 *
 * jsdom's `document.cookie` is tied to a single origin and can't model
 * cross-subdomain scoping, so we install a small domain-aware cookie jar that
 * follows real browser rules and lets us "navigate" between hosts.
 */

type StoredCookie = {
  name: string;
  value: string;
  hostOnly: boolean;
  // Registrable scope (no leading dot). For host-only cookies this is the host
  // that set the cookie.
  scope: string;
};

class CookieJar {
  private store = new Map<string, StoredCookie>();
  // The host the "browser" is currently on. Change this to simulate a redirect.
  host = "www.example.com";

  private matches(cookie: StoredCookie): boolean {
    if (cookie.hostOnly) return this.host === cookie.scope;
    return this.host === cookie.scope || this.host.endsWith("." + cookie.scope);
  }

  get(): string {
    return [...this.store.values()]
      .filter((c) => this.matches(c))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }

  set(cookieString: string): void {
    const parts = cookieString.split(";").map((p) => p.trim());
    const [nameValue, ...attrs] = parts;
    const eq = nameValue.indexOf("=");
    if (eq === -1) return;
    const name = nameValue.slice(0, eq);
    const value = nameValue.slice(eq + 1);

    let domain = "";
    for (const attr of attrs) {
      const [k, v = ""] = attr.split("=");
      if (k.toLowerCase() === "domain") domain = v.trim();
    }

    if (domain) {
      const scope = domain.replace(/^\./, "");
      // Browsers reject a domain cookie the current host isn't a member of.
      const allowed = this.host === scope || this.host.endsWith("." + scope);
      if (!allowed) return;
      this.store.set(name, { name, value, hostOnly: false, scope });
    } else {
      this.store.set(name, {
        name,
        value,
        hostOnly: true,
        scope: this.host,
      });
    }
  }

  reset(): void {
    this.store.clear();
    this.host = "www.example.com";
  }
}

const jar = new CookieJar();

// A 3-way redirect experiment matching the reported 10 / 45 / 45 split, keyed on
// the auto-attributes anonymous id (`id`).
const REDIRECT_EXPERIMENT: Experiment<string> = {
  key: "redirect-test",
  variations: ["no-redirect", "redirect-a", "redirect-b"],
  weights: [0.1, 0.45, 0.45],
};

function loadPageAndBucket(host: string, cookieDomain?: string) {
  jar.host = host;
  const gb = new GrowthBook({
    plugins: [
      autoAttributesPlugin(
        cookieDomain ? { uuidCookieDomain: cookieDomain } : {},
      ),
    ],
  });
  const id = gb.getAttributes().id as string;
  const variation = gb.run(REDIRECT_EXPERIMENT).value;
  gb.destroy();
  return { id, variation };
}

describe("auto-attributes uuid stability across a subdomain redirect", () => {
  let cookieDescriptor: PropertyDescriptor | undefined;

  beforeAll(() => {
    cookieDescriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "cookie",
    );
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => jar.get(),
      set: (v: string) => jar.set(v),
    });
  });

  afterAll(() => {
    if (cookieDescriptor) {
      Object.defineProperty(document, "cookie", cookieDescriptor);
    }
  });

  beforeEach(() => {
    jar.reset();
  });

  it("reproduces the bug: host-only cookie re-mints the id on the new subdomain", () => {
    const landing = loadPageAndBucket("www.example.com");
    // Cookie is written host-only for www.example.com...
    expect(jar.get()).toContain(`gbuuid=${landing.id}`);

    // ...so after the redirect to app.example.com the cookie is not visible and
    // a brand new id is generated (this is the SRM-causing re-bucketing).
    const destination = loadPageAndBucket("app.example.com");
    expect(destination.id).not.toBe(landing.id);
  });

  it("fixes it: parent-domain cookie keeps one stable id across subdomains", () => {
    const landing = loadPageAndBucket("www.example.com", ".example.com");

    // The same id is readable on every subdomain of example.com.
    jar.host = "app.example.com";
    expect(jar.get()).toContain(`gbuuid=${landing.id}`);

    const destination = loadPageAndBucket("app.example.com", ".example.com");
    expect(destination.id).toBe(landing.id);
  });

  it("achieves 'identity merge': the user keeps the same variation across the redirect", () => {
    const landing = loadPageAndBucket("www.example.com", ".example.com");
    const destination = loadPageAndBucket("app.example.com", ".example.com");

    // Same stable id + same experiment => deterministically the same variation.
    // One human = one unit = one arm, exactly like Mixpanel's identity merge.
    expect(destination.id).toBe(landing.id);
    expect(destination.variation).toBe(landing.variation);
  });

  it("keeps the id stable across a deeper -> parent subdomain hop too", () => {
    const first = loadPageAndBucket("shop.eu.example.com", ".example.com");
    const second = loadPageAndBucket("example.com", ".example.com");
    expect(second.id).toBe(first.id);
    expect(second.variation).toBe(first.variation);
  });
});
