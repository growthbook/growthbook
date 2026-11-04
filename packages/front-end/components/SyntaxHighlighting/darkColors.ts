// Dark mode's code colors are light mode's with their lightness flipped, in
// OKLab so hue holds. Surfaces mirror; text lands in a band that stays
// readable on the dark surface, since a light palette's paler accents would
// otherwise come out dim.

type Rgb = [number, number, number];
type ColorRole = "text" | "surface";

// Where light mode's white lands: the dark panel (Radix gray 2).
const DARK_SURFACE = "#1a191b";
// Light text runs from black up to about this lightness...
const LIGHT_TEXT_MAX = 0.75;
// ...and dark text from near white down to this.
const DARK_TEXT_MAX = 0.93;
const DARK_TEXT_MIN = 0.65;
// Saturated color glows on a dark surface, so dark text is a little softer...
const DARK_TEXT_CHROMA = 0.8;
// ...and its pinks softer still and warmed toward salmon, as dark themes'
// strings usually are. Both fade out by WARM_REACH degrees from pink, so teals
// and blues hold.
const PINK_HUE = 0;
const PINK_WARMING = 20;
const PINK_CHROMA = 0.5;
const WARM_REACH = 60;

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  blue: "#0000ff",
};

function parseColor(color: string): { rgb: Rgb; alpha: number } | null {
  const named = NAMED_COLORS[color.toLowerCase()];
  if (named) return parseColor(named);

  const hex = color.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    const [r, g, b, a = 255] = (full.match(/../g) ?? []).map((h) =>
      parseInt(h, 16),
    );
    return { rgb: [r / 255, g / 255, b / 255], alpha: a / 255 };
  }

  const args = color.match(/^rgba?\(([^)]*)\)$/i)?.[1];
  if (args) {
    const [r, g, b, a = 1] = args
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    if ([r, g, b, a].some((n) => Number.isNaN(n))) return null;
    return { rgb: [r / 255, g / 255, b / 255], alpha: a };
  }
  return null;
}

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const fromLinear = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

function toOklab(rgb: Rgb): Rgb {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

// Linear sRGB, which may fall outside 0-1 when the color is out of gamut.
function oklabToLinear([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: Rgb) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

const SURFACE_LIGHTNESS = toOklab(
  parseColor(DARK_SURFACE)?.rgb ?? [0, 0, 0],
)[0];

function formatColor(rgb: Rgb, alpha: number): string {
  const [r, g, b] = rgb.map((c) =>
    Math.round(Math.min(1, Math.max(0, fromLinear(c))) * 255),
  );
  if (alpha < 1) return `rgba(${r}, ${g}, ${b}, ${+alpha.toFixed(3)})`;
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function darkLightness(L: number, role: ColorRole): number {
  if (role === "surface") return 1 - L * (1 - SURFACE_LIGHTNESS);
  const t = Math.min(L / LIGHT_TEXT_MAX, 1);
  return DARK_TEXT_MAX - t * (DARK_TEXT_MAX - DARK_TEXT_MIN);
}

function darkTextHue(a: number, b: number): [number, number] {
  const hue = (Math.atan2(b, a) * 180) / Math.PI;
  const fromPink = ((hue - PINK_HUE + 540) % 360) - 180;
  const pinkness = Math.max(0, 1 - Math.abs(fromPink) / WARM_REACH);
  const shift = (PINK_WARMING * pinkness * Math.PI) / 180;
  const chroma = DARK_TEXT_CHROMA - (DARK_TEXT_CHROMA - PINK_CHROMA) * pinkness;
  const cos = Math.cos(shift) * chroma;
  const sin = Math.sin(shift) * chroma;
  return [a * cos - b * sin, a * sin + b * cos];
}

// A light-mode color as dark mode shows it; unparseable colors pass through.
export function darkColor(color: string, role: ColorRole): string {
  const parsed = parseColor(color);
  if (!parsed) return color;
  const [L, lightA, lightB] = toOklab(parsed.rgb);
  const lightness = darkLightness(L, role);
  const [a, b] =
    role === "text" ? darkTextHue(lightA, lightB) : [lightA, lightB];
  // Keep the hue, shedding chroma until the color fits in sRGB.
  let chroma = 1;
  if (!inGamut(oklabToLinear([lightness, a, b]))) {
    let low = 0;
    for (let i = 0; i < 20; i++) {
      const mid = (low + chroma) / 2;
      if (inGamut(oklabToLinear([lightness, a * mid, b * mid]))) low = mid;
      else chroma = mid;
    }
    chroma = low;
  }
  return formatColor(
    oklabToLinear([lightness, a * chroma, b * chroma]),
    parsed.alpha,
  );
}

const CSS_COLORS =
  /url\([^)]*\)|#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|(?<![\w-])(?:black|white|red|blue)(?![\w-])/gi;

// A CSS property's value with its colors swapped for dark mode's.
export function darkDeclaration(property: string, value: string): string {
  const role: ColorRole = property === "color" ? "text" : "surface";
  return value.replace(CSS_COLORS, (match) =>
    match.toLowerCase().startsWith("url(") ? match : darkColor(match, role),
  );
}

// A stylesheet with its colors swapped for dark mode's.
export function darkCss(css: string): string {
  return css.replace(
    /([\w-]+)(\s*:\s*)([^;{}]+)/g,
    (_, property: string, separator: string, value: string) =>
      property + separator + darkDeclaration(property, value),
  );
}
