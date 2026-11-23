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
    // Halves of a payload split across two appends
    html(`<img src=x onerror="alert(1)`, "append"),
    html(`<img src=x one`, "append"),
    html(`<!--`, "append"),
    // A decoy end marker ahead of the unclosed half
    html(`<gb-end></gb-end><img src=x onerror="alert(1)`, "append"),
    attr("onclick", "alert(1)"),
    attr("ONCLICK", "alert(1)"),
    attr("srcdoc", "<p>hi</p>"),
    attr("href", "javascript:alert(1)"),
    attr("href", "script:alert(1)", "append"),
    attr("href", ":alert(1)", "append"),
    { css: "a{}</style><script>alert(1)</script>" },
    { css: "a { width: expression(alert(1)) }" },
    { css: "a { background: url(javascript:alert(1)) }" },
  ])("blocks %j", (change) => {
    expect(() => assertNoInjectedJs([change])).toThrow(/JavaScript/);
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

  it("checks a stored change once it is edited, and says where", () => {
    expect(() =>
      assertNoInjectedJs([{ ...stored, css: "a { color: red }" }], opts),
    ).toThrow(
      'found event handler attribute "onclick" in the mutation for "a.cta", variation "Blue button"',
    );
  });
});
