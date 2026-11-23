import { safeDecodeURIComponent, stringToBoolean } from "../../src/util";

describe("stringToBoolean", () => {
  it("should return true for truthy string values", () => {
    expect(stringToBoolean("true")).toBe(true);
    expect(stringToBoolean("yes")).toBe(true);
    expect(stringToBoolean("on")).toBe(true);
    expect(stringToBoolean("1")).toBe(true);
  });

  it("should return false for falsy string values", () => {
    expect(stringToBoolean("false")).toBe(false);
    expect(stringToBoolean("no")).toBe(false);
    expect(stringToBoolean("off")).toBe(false);
    expect(stringToBoolean("0")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(stringToBoolean("", false)).toBe(false);
    expect(stringToBoolean("", true)).toBe(false);
  });

  it("should return the default value for undefined", () => {
    expect(stringToBoolean(undefined, false)).toBe(false);
    expect(stringToBoolean(undefined, true)).toBe(true);
  });

  it("should return the default value for invalid string values", () => {
    expect(stringToBoolean("foo", true)).toBe(true);
    expect(stringToBoolean("bar", false)).toBe(false);
  });

  it("should have a default value of false if not specified", () => {
    expect(stringToBoolean("foo")).toBe(false);
  });
});

describe("safeDecodeURIComponent", () => {
  it("decodes a well-formed value", () => {
    expect(safeDecodeURIComponent("checkout%2Cv2")).toBe("checkout,v2");
  });

  // decodeURIComponent throws a URIError on a stray %, and these values come
  // from URLs and cookies a person can edit by hand.
  it("returns the raw value when the encoding is malformed", () => {
    expect(safeDecodeURIComponent("%")).toBe("%");
    expect(safeDecodeURIComponent("100% done")).toBe("100% done");
  });

  it("leaves a value with nothing to decode unchanged", () => {
    expect(safeDecodeURIComponent("plain-key")).toBe("plain-key");
  });
});
