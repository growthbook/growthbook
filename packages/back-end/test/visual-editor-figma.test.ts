import { scopeCss } from "back-end/src/api/visual-editor-ai/scopeCss";
import {
  parseFigmaFrameUrl,
  summarizeFigmaNode,
} from "back-end/src/services/figma";

describe("scopeCss", () => {
  const SCOPE = ".gbf-abc123";

  it("prefixes bare element selectors", () => {
    expect(scopeCss("button { color: red; }", SCOPE)).toContain(
      ".gbf-abc123 button {",
    );
  });

  it("leaves already-scoped selectors untouched (no double prefix)", () => {
    const out = scopeCss(".gbf-abc123 .title { color: red; }", SCOPE);
    expect(out).toContain(".gbf-abc123 .title {");
    expect(out).not.toContain(".gbf-abc123 .gbf-abc123");
  });

  it("maps :root / html / body / * onto the scope root", () => {
    expect(scopeCss(":root { --c: red; }", SCOPE)).toContain(".gbf-abc123 {");
    expect(scopeCss("html { margin: 0; }", SCOPE)).toContain(".gbf-abc123 {");
    expect(scopeCss("body { margin: 0; }", SCOPE)).toContain(".gbf-abc123 {");
    expect(scopeCss("* { box-sizing: border-box; }", SCOPE)).toContain(
      ".gbf-abc123 {",
    );
  });

  it("scopes each selector in a comma list", () => {
    const out = scopeCss("h1, h2 { margin: 0; }", SCOPE);
    expect(out).toContain(".gbf-abc123 h1");
    expect(out).toContain(".gbf-abc123 h2");
  });

  it("recurses into @media group rules", () => {
    const out = scopeCss(
      "@media (max-width: 600px) { button { color: red; } }",
      SCOPE,
    );
    expect(out).toContain("@media (max-width: 600px)");
    expect(out).toContain(".gbf-abc123 button");
  });

  it("passes @keyframes through without scoping inner steps", () => {
    const out = scopeCss(
      "@keyframes spin { from { opacity: 0; } to { opacity: 1; } }",
      SCOPE,
    );
    expect(out).toContain("@keyframes spin");
    expect(out).not.toContain(".gbf-abc123 from");
    expect(out).not.toContain(".gbf-abc123 to");
  });

  it("strips @import (unscopable, can load external resources)", () => {
    const out = scopeCss("@import url('x.css'); button { color: red; }", SCOPE);
    expect(out).not.toContain("@import");
    expect(out).toContain(".gbf-abc123 button");
  });

  it("returns empty string for empty input", () => {
    expect(scopeCss("", SCOPE)).toBe("");
    expect(scopeCss("   ", SCOPE)).toBe("");
  });
});

describe("parseFigmaFrameUrl", () => {
  it("parses a design URL with a dash-separated node id", () => {
    expect(
      parseFigmaFrameUrl(
        "https://www.figma.com/design/abc123KEY/My-File?node-id=12-345&t=x",
      ),
    ).toEqual({ fileKey: "abc123KEY", nodeId: "12:345" });
  });

  it("parses a file URL with an encoded colon node id", () => {
    expect(
      parseFigmaFrameUrl(
        "https://www.figma.com/file/KEY123/Name?node-id=1%3A2",
      ),
    ).toEqual({ fileKey: "KEY123", nodeId: "1:2" });
  });

  it("returns null for non-figma hosts", () => {
    expect(
      parseFigmaFrameUrl("https://evil.com/design/KEY/x?node-id=1-2"),
    ).toBeNull();
  });

  it("returns null when node-id is missing", () => {
    expect(
      parseFigmaFrameUrl("https://www.figma.com/design/KEY/My-File"),
    ).toBeNull();
  });

  it("returns null for unparseable input", () => {
    expect(parseFigmaFrameUrl("not a url")).toBeNull();
  });
});

describe("summarizeFigmaNode", () => {
  it("extracts frame size, colors, fonts and text", () => {
    const out = summarizeFigmaNode({
      type: "FRAME",
      name: "Hero",
      absoluteBoundingBox: { width: 1200, height: 600 },
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
      children: [
        {
          type: "TEXT",
          characters: "Welcome back!",
          style: { fontFamily: "Inter", fontWeight: 700, fontSize: 24 },
        },
      ],
    });
    expect(out).toContain("Frame size: 1200×600px");
    expect(out).toContain("#ff0000");
    expect(out).toContain("Inter 700 24px");
    expect(out).toContain("Welcome back!");
  });

  it("returns empty string for an empty node", () => {
    expect(summarizeFigmaNode({})).toBe("");
  });
});
