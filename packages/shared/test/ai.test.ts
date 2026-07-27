import {
  formatAIRateLimitRetryMessage,
  parseAspectRatio,
  snapAspectRatio,
  aspectRatioToDims,
  humanizeAspectRatio,
  buildImageAspectInstruction,
} from "../src/ai";

describe("formatAIRateLimitRetryMessage", () => {
  it("formats duration with singular units when appropriate", () => {
    expect(formatAIRateLimitRetryMessage(3661)).toBe(
      "You have reached the AI request limit. Try again in 1 hour and 1 minute.",
    );
    expect(formatAIRateLimitRetryMessage("3600")).toBe(
      "You have reached the AI request limit. Try again in 1 hour.",
    );
    expect(formatAIRateLimitRetryMessage(7200)).toBe(
      "You have reached the AI request limit. Try again in 2 hours.",
    );
    expect(formatAIRateLimitRetryMessage(120)).toBe(
      "You have reached the AI request limit. Try again in 2 minutes.",
    );
  });

  it("uses sub-minute copy when under one minute", () => {
    expect(formatAIRateLimitRetryMessage(45)).toBe(
      "You have reached the AI request limit. Try again in less than a minute.",
    );
  });

  it("returns generic copy when missing or invalid", () => {
    expect(formatAIRateLimitRetryMessage(undefined)).toContain(
      "Please try again later",
    );
    expect(formatAIRateLimitRetryMessage("x")).toContain(
      "Please try again later",
    );
  });
});

describe("parseAspectRatio", () => {
  it("parses valid w:h ratios", () => {
    expect(parseAspectRatio("16:9")).toBeCloseTo(16 / 9);
    expect(parseAspectRatio("1:1")).toBe(1);
    expect(parseAspectRatio("1920:480")).toBe(4);
    expect(parseAspectRatio("1.91:1")).toBeCloseTo(1.91);
    expect(parseAspectRatio(" 3:4 ")).toBeCloseTo(0.75);
  });

  it("returns null for unparseable or non-positive input", () => {
    expect(parseAspectRatio(undefined)).toBeNull();
    expect(parseAspectRatio(null)).toBeNull();
    expect(parseAspectRatio("")).toBeNull();
    expect(parseAspectRatio("16x9")).toBeNull();
    expect(parseAspectRatio("0:1")).toBeNull();
    expect(parseAspectRatio("1:0")).toBeNull();
  });
});

describe("snapAspectRatio", () => {
  const supported = ["1:1", "3:2", "2:3", "16:9", "9:16"];

  it("snaps to the closest supported ratio (log space)", () => {
    expect(snapAspectRatio("1920:480", supported)).toBe("16:9"); // 4.0 -> widest
    expect(snapAspectRatio("100:101", supported)).toBe("1:1");
    expect(snapAspectRatio("9:16", supported)).toBe("9:16");
    expect(snapAspectRatio("1000:1500", supported)).toBe("2:3");
  });

  it("falls back to 1:1 for unparseable input when available", () => {
    expect(snapAspectRatio(undefined, supported)).toBe("1:1");
    expect(snapAspectRatio("garbage", supported)).toBe("1:1");
  });

  it("falls back to the first entry when 1:1 is unavailable", () => {
    expect(snapAspectRatio(undefined, ["16:9", "9:16"])).toBe("16:9");
  });
});

describe("aspectRatioToDims", () => {
  it("keeps the longer edge at 1024", () => {
    expect(aspectRatioToDims("1:1")).toEqual({ width: 1024, height: 1024 });
    expect(aspectRatioToDims("16:9")).toEqual({ width: 1024, height: 576 });
    expect(aspectRatioToDims("9:16")).toEqual({ width: 576, height: 1024 });
  });
});

describe("humanizeAspectRatio", () => {
  it("reduces by gcd to a readable ratio", () => {
    expect(humanizeAspectRatio("1920:480", "16:9")).toBe("4:1");
    expect(humanizeAspectRatio("1024:768", "4:3")).toBe("4:3");
  });

  it("falls back when the reduced terms are awkwardly large or non-integer", () => {
    expect(humanizeAspectRatio("1456:817", "16:9")).toBe("16:9");
    expect(humanizeAspectRatio("1.91:1", "16:9")).toBe("16:9");
  });
});

describe("buildImageAspectInstruction", () => {
  it("returns empty string when there is no slot ratio to match", () => {
    expect(
      buildImageAspectInstruction({
        requestedRatio: undefined,
        snappedRatio: "1:1",
        honorsAspectRatio: true,
      }),
    ).toBe("");
  });

  it("emits a light instruction when the model emits a matching shape", () => {
    const out = buildImageAspectInstruction({
      requestedRatio: "16:9",
      snappedRatio: "16:9",
      honorsAspectRatio: true,
    });
    expect(out).toContain("16:9");
    expect(out).toContain("filling the frame");
    expect(out).not.toContain("center-cropped");
  });

  it("emits a safe-area instruction on a meaningful mismatch", () => {
    const out = buildImageAspectInstruction({
      requestedRatio: "1920:480", // 4:1 slot
      snappedRatio: "16:9", // closest the model can emit
      honorsAspectRatio: true,
    });
    expect(out).toContain("4:1");
    expect(out).toContain("center-cropped");
    expect(out).toContain("centered");
  });

  it("always emits the safe-area instruction for models that ignore the ratio hint", () => {
    // Even when snapped === requested, an ignore-the-hint model's output
    // shape is unpredictable, so we still guard with the safe area.
    const out = buildImageAspectInstruction({
      requestedRatio: "16:9",
      snappedRatio: "16:9",
      honorsAspectRatio: false,
    });
    expect(out).toContain("center-cropped");
  });
});
