import {
  parseEnvInt,
  parseIntWithDefault,
  parseIntWithDefaultCapped,
  parseOptionalInt,
} from "../../src/util/numbers";

describe("parseIntWithDefault", () => {
  it("returns fallback for undefined and null", () => {
    expect(parseIntWithDefault(undefined, 3600)).toBe(3600);
    expect(parseIntWithDefault(null, 99)).toBe(99);
  });

  it("returns fallback for empty or whitespace string", () => {
    expect(parseIntWithDefault("", 3600)).toBe(3600);
    expect(parseIntWithDefault("   ", 3600)).toBe(3600);
  });

  it("parses integer strings", () => {
    expect(parseIntWithDefault("0", 3600)).toBe(0);
    expect(parseIntWithDefault("3600", 0)).toBe(3600);
    expect(parseIntWithDefault("  42  ", 0)).toBe(42);
  });

  it("parses finite numbers", () => {
    expect(parseIntWithDefault(3600, 0)).toBe(3600);
    expect(parseIntWithDefault(0, 3600)).toBe(0);
  });

  it("returns fallback for NaN and non-numeric strings", () => {
    expect(parseIntWithDefault(NaN, 7)).toBe(7);
    expect(parseIntWithDefault("abc", 7)).toBe(7);
    expect(parseIntWithDefault({}, 7)).toBe(7);
  });

  it("truncates toward zero like parseInt", () => {
    expect(parseIntWithDefault(3.9, 0)).toBe(3);
    expect(parseIntWithDefault("3.9", 0)).toBe(3);
  });

  it("supports NaN as fallback for invalid-only signaling", () => {
    expect(Number.isNaN(parseIntWithDefault("x", NaN))).toBe(true);
    expect(Number.isNaN(parseIntWithDefault(undefined, NaN))).toBe(true);
  });
});

describe("parseOptionalInt", () => {
  it("returns undefined for missing, blank, or invalid input", () => {
    expect(parseOptionalInt(undefined)).toBeUndefined();
    expect(parseOptionalInt(null)).toBeUndefined();
    expect(parseOptionalInt("")).toBeUndefined();
    expect(parseOptionalInt("   ")).toBeUndefined();
    expect(parseOptionalInt("x")).toBeUndefined();
  });

  it("returns parsed integers including 0", () => {
    expect(parseOptionalInt("0")).toBe(0);
    expect(parseOptionalInt("60")).toBe(60);
    expect(parseOptionalInt(42)).toBe(42);
  });
});

describe("parseIntWithDefaultCapped", () => {
  it("parses then caps at max", () => {
    expect(parseIntWithDefaultCapped("200", 50, 100)).toBe(100);
    expect(parseIntWithDefaultCapped("30", 50, 100)).toBe(30);
    expect(parseIntWithDefaultCapped("bad", 50, 100)).toBe(50);
  });
});

describe("parseEnvInt", () => {
  beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns default only when value is undefined", () => {
    expect(parseEnvInt(undefined, 42, { name: "TEST_VAR" })).toBe(42);
    expect(parseEnvInt("10", 42, { name: "TEST_VAR" })).toBe(10);
  });

  it("returns default for invalid or out-of-range values", () => {
    expect(parseEnvInt("x", 7, { name: "TEST_VAR" })).toBe(7);
    expect(parseEnvInt("5", 9, { min: 10, name: "TEST_VAR" })).toBe(9);
    expect(parseEnvInt("5", 9, { max: 3, name: "TEST_VAR" })).toBe(9);
  });

  it("warns when invalid", () => {
    jest.restoreAllMocks();
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseEnvInt("nope", 100, { name: "MY_VAR" })).toBe(100);
    expect(warn).toHaveBeenCalledWith(
      'WARNING! Invalid value for MY_VAR: "nope". Falling back to default: 100',
    );
  });
});
