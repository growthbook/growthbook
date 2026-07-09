import { humanizeMutation } from "@/components/Experiment/visualChangesetHumanize";

describe("humanizeMutation – image src phrasing", () => {
  it("does not duplicate 'image' when the element itself is an <img>", () => {
    const h = humanizeMutation({
      selector: "img.hero-img",
      action: "set",
      attribute: "src",
      value: "https://example.com/new.png",
    });
    expect(h.human).toBe("Replaced the image");
    expect(h.human).not.toContain("image image");
  });

  it("keeps a descriptive noun (e.g. hero) but doesn't double 'image'", () => {
    const h = humanizeMutation({
      selector: ".hero",
      action: "set",
      attribute: "src",
      value: "https://example.com/new.png",
    });
    expect(h.human).toBe("Replaced the hero image");
  });

  it("collapses the vague 'element' fallback to just 'image'", () => {
    const h = humanizeMutation({
      selector: ".banner-xyz",
      action: "set",
      attribute: "src",
      value: "https://example.com/new.png",
    });
    expect(h.human).toBe("Replaced the image");
  });

  it("uses 'Removed the image' for an image removal on an <img>", () => {
    const h = humanizeMutation({
      selector: "img",
      action: "remove",
      attribute: "src",
    });
    expect(h.human).toBe("Removed the image");
  });
});
