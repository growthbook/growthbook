import { assertNoInjectedJs } from "back-end/src/util/visualChanges";

const html = (value: string, action: "set" | "append" = "set") => ({
  domMutations: [{ selector: "div", action, attribute: "html", value }],
});
const attr = (
  attribute: string,
  value: string,
  action: "set" | "append" = "set",
) => ({ domMutations: [{ selector: "a", action, attribute, value }] });

describe("assertNoInjectedJs", () => {
  it.each([
    html(`<p class="x">Hello <b>world</b> &amp; friends</p>`),
    html(`<style>a > b { color: red }</style><a href="https://x.com">x</a>`),
    html(`<iframe src="https://www.youtube.com/embed/x"></iframe>`),
    html(`Only one=1 left, learn javascript today`),
    attr("href", "https://example.com/?a=1"),
    attr("style", "color: red", "append"),
    attr("class", "online"),
    attr("title", "JavaScript: a primer"),
    attr("aria-label", ": continued", "append"),
    html(`<img src="/js.png" alt="JavaScript: a primer">`),
    html(`<select><option value="a" selected>A &lt; B</option></select>`),
    html(`<table><tr><td>1 < 2<br>ok</td></tr></table><p>open paragraph`),
    // Ways to clear a handler that is already on the page
    {
      domMutations: [{ selector: "a", action: "remove", attribute: "onclick" }],
    },
    attr("onclick", ""),
    { css: ".a { scroll-behavior: smooth; background: url(/x.png) }" },
    { css: "", domMutations: [] },
    {},
  ])("allows %j", (change) => {
    expect(() => assertNoInjectedJs([change])).not.toThrow();
  });

  it.each([
    html(`<img src=x onerror=alert(1)>`),
    html(`<IMG SRC=x OnErRoR="alert(1)">`),
    html(`<svg/onload=alert(1)>`),
    html(`<script>alert(1)</script>`),
    html(`<base href="https://evil.example/">`),
    html(`<a href="jav&#x61;script:alert(1)">x</a>`),
    html(`<a href=" java\tscript:alert(1)">x</a>`),
    html(`<iframe srcdoc="<script>alert(1)</script>"></iframe>`),
    html(`<form><button formaction="javascript:alert(1)">x</button></form>`),
    html(`<svg><a><set attributeName=href to="x;javascript:alert(1)" />`),
    // Raw text in HTML, but live markup when the target is inside an <svg>
    html(`<style><img src=x onerror=alert(1)></style>`),
    // Dropped by an HTML5 parser, kept by a browser with customizable <select>
    html(`<select><img src=x onerror=alert(1)></select>`),
    html(`<select><option><img src=x onerror=alert(1)></option></select>`),
    html(`<select><button onclick=alert(1)>x</button></select>`),
    html(`<select><a href="jav&#x61;script:alert(1)">x</a></select>`),
    html(`<select><svg><style><img src=x onerror=alert(1)></style></svg>`),
    html(`<select><script>alert(1)</script></select>`),
    html(`<select><!-- a --!><img src=x onerror=alert(1)><!-- b --></select>`),
    html(`<select><![CDATA[ x ><img src=x onerror=alert(1)> ]]></select>`),
    html(
      `<select><iframe><!--</iframe><img src=x onerror=alert(1)>--></select>`,
    ),
    // Kept by a browser when the mutation targets <html> or a table row
    html(`<body onscroll=alert(1)>x</body>`),
    html(`<frameset onresize=alert(1)><frame onload=alert(1)></frameset>`),
    html(`<div></div><td onclick=alert(1)>x</td>`),
    // Halves of a payload split across two appends
    html(`<img src=x onerror="alert(1)`, "append"),
    html(`<img src=x one`, "append"),
    html(`<!--`, "append"),
    // A decoy end marker ahead of the unclosed half
    html(`<gb-end></gb-end><img src=x onerror="alert(1)`, "append"),
    attr("onclick", "alert(1)"),
    attr("ONCLICK", "alert(1)"),
    attr("srcdoc", "<p>hi</p>"),
    attr("ontitle", "alert(1)"),
    attr("href", "javascript:alert(1)"),
    attr("href", "script:alert(1)", "append"),
    attr("href", ":alert(1)", "append"),
    { css: "a{}</style><script>alert(1)</script>" },
    { css: "a { width: expression(alert(1)) }" },
    { css: "a { background: url(javascript:alert(1)) }" },
  ])("blocks %j", (change) => {
    expect(() => assertNoInjectedJs([change])).toThrow(/JavaScript/);
  });

  it("checks deeply nested raw text in linear time", () => {
    let value = "x";
    for (let i = 0; i < 30; i++) {
      value = `<select></select><title>${value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")}</title>`;
    }
    const start = Date.now();
    expect(() => assertNoInjectedJs([html(value)])).not.toThrow();
    expect(Date.now() - start).toBeLessThan(2000);
  });

  const on = (selector: string) => ({
    domMutations: [
      { selector, action: "set" as const, attribute: "html", value: "x" },
    ],
  });

  it.each([
    "script",
    "script[type]",
    "head > SCRIPT",
    "body script#ld",
    ":is(div, script)",
    "svg|script",
    "base",
    "head base[href]",
  ])("blocks a mutation of %s", (selector) => {
    expect(() => assertNoInjectedJs([on(selector)])).toThrow(
      /targets a <script> or <base> element/,
    );
    // Clearing an attribute is enough to arm a <script type="application/ld+json">
    expect(() =>
      assertNoInjectedJs([
        { domMutations: [{ selector, action: "remove", attribute: "type" }] },
      ]),
    ).toThrow(/JavaScript/);
  });

  it.each([
    ".base",
    "#script",
    "div.base-layer > p",
    "noscript",
    "script-loader",
    "basefont",
    `[alt="Customer base"]`,
    `a[href*="script"]`,
    `[aria-label="Run script"] span`,
  ])("allows a mutation of %s", (selector) => {
    expect(() => assertNoInjectedJs([on(selector)])).not.toThrow();
  });

  it("limits how many tags an HTML mutation can have", () => {
    expect(() =>
      assertNoInjectedJs([html("<p>x</p>".repeat(2500))]),
    ).not.toThrow();
    expect(() => assertNoInjectedJs([html("<div>".repeat(20000))])).toThrow(
      "cannot have more than 20,000 tags",
    );
  });

  const stored = {
    id: "vc_1",
    variation: "v1",
    description: "",
    css: "",
    domMutations: [
      { selector: "a.cta", action: "set", attribute: "onclick", value: "x()" },
    ],
  } as const;
  const opts = {
    stored: [{ ...stored, domMutations: [...stored.domMutations] }],
    variations: [{ id: "v1", name: "Blue button" }],
  };

  it("skips a change identical to its stored version", () => {
    expect(() => assertNoInjectedJs([{ ...stored }], opts)).not.toThrow();
  });

  it("checks a stored change that is moved to another element", () => {
    const moved = stored.domMutations.map((m) => ({ ...m, selector: "body" }));
    expect(() =>
      assertNoInjectedJs([{ ...stored, domMutations: moved }], opts),
    ).toThrow(/onclick/);
  });

  it("checks a stored change once it is edited, and says where", () => {
    expect(() =>
      assertNoInjectedJs([{ ...stored, css: "a { color: red }" }], opts),
    ).toThrow(
      'found event handler attribute "onclick" in the mutation for "a.cta", variation "Blue button"',
    );
  });
});
