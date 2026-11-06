import {
  redirectDestinationParts,
  withoutProtocol,
} from "@/components/Experiment/LinkedChanges/redirectDestination";

const shown = (from: string, to: string) => {
  const parts = redirectDestinationParts(from, to);
  return parts ? `${parts.elided ? "…" : ""}${parts.path}` : null;
};

describe("redirectDestinationParts", () => {
  it("shows the path from the last shared segment", () => {
    expect(
      shown(
        "https://shop.example.com/checkout",
        "https://shop.example.com/checkout?layout=single-page",
      ),
    ).toBe("/checkout?layout=single-page");
    expect(
      shown(
        "https://shop.example.com/a/pricing",
        "https://shop.example.com/a/products/experiments",
      ),
    ).toBe("…/products/experiments");
  });

  it("shows the whole path of a destination up a level", () => {
    expect(
      shown("https://www.example.com/pricing", "https://www.example.com/"),
    ).toBe("/");
  });

  it("leaves another host or an unparseable URL to show in full", () => {
    expect(shown("https://a.com/x", "https://b.com/x")).toBeNull();
    expect(shown("not a url", "https://b.com/x")).toBeNull();
  });
});

describe("withoutProtocol", () => {
  it("drops a leading http or https scheme and nothing else", () => {
    expect(withoutProtocol("https://www.example.com/a")).toBe(
      "www.example.com/a",
    );
    expect(withoutProtocol("HTTP://localhost:3001")).toBe("localhost:3001");
    expect(withoutProtocol("example.com/https://x")).toBe(
      "example.com/https://x",
    );
    expect(withoutProtocol("ftp://example.com")).toBe("ftp://example.com");
  });
});
