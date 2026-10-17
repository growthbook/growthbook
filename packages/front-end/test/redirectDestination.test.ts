import { redirectDestinationParts } from "@/components/Experiment/LinkedChanges/redirectDestination";

const shown = (from: string, to: string) => {
  const parts = redirectDestinationParts(from, to);
  return parts
    ? `${parts.elided ? "…" : ""}${parts.kept}[${parts.changed}]`
    : null;
};

describe("redirectDestinationParts", () => {
  it("shows what changes from the last shared segment, in whole words", () => {
    expect(
      shown(
        "https://shop.example.com/checkout",
        "https://shop.example.com/checkout?layout=single-page",
      ),
    ).toBe("/checkout[?layout=single-page]");
    expect(
      shown(
        "https://shop.example.com/a/pricing",
        "https://shop.example.com/a/products/experiments",
      ),
    ).toBe("…/[products/experiments]");
  });

  it("keeps the host out of it", () => {
    expect(
      shown("https://www.example.com", "https://www.example.com/landing"),
    ).toBe("/[landing]");
  });

  it("shows the whole path of a destination up a level", () => {
    expect(
      shown("https://www.example.com/pricing", "https://www.example.com/"),
    ).toBe("[/]");
  });

  it("leaves another host or an unparseable URL to show in full", () => {
    expect(shown("https://a.com/x", "https://b.com/x")).toBeNull();
    expect(shown("not a url", "https://b.com/x")).toBeNull();
  });
});
