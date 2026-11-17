import { darkColor, darkCss } from "@/components/SyntaxHighlighting/darkColors";

const channels = (hex: string) =>
  (hex.slice(1).match(/../g) ?? []).map((h) => parseInt(h, 16));

describe("darkColor", () => {
  it("keeps a color's hue while lightening it for dark text", () => {
    const [r, g, b] = channels(darkColor("#00009f", "text"));
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
    expect(r + g + b).toBeGreaterThan(0x9f);
  });

  it("warms pink text toward salmon", () => {
    const [r, g, b] = channels(darkColor("#e3116c", "text"));
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it("keeps alpha", () => {
    expect(darkColor("rgba(0, 0, 0, 0.07)", "surface")).toBe(
      "rgba(255, 255, 255, 0.07)",
    );
  });

  it("passes through what it can't parse", () => {
    expect(darkColor("var(--gray-a3)", "text")).toBe("var(--gray-a3)");
  });
});

describe("darkCss", () => {
  it("treats color as text and everything else as surface, leaving urls and other words alone", () => {
    const css =
      ".a {color: black;background: #ffffff;white-space: pre;}.b {background: url(data:image/png;base64,red/blue+white) repeat-y;}";
    expect(darkCss(css)).toBe(
      ".a {color: #e8e8e8;background: #191919;white-space: pre;}.b {background: url(data:image/png;base64,red/blue+white) repeat-y;}",
    );
  });
});
