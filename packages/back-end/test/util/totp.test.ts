import {
  base32Encode,
  getOtpauthUrl,
  verifyTotp,
} from "back-end/src/util/totp";

// RFC 6238 Appendix B SHA-1 vectors, truncated from 8 to 6 digits
const KEY = Buffer.from("12345678901234567890", "ascii");
const VECTORS: [number, string][] = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
];

describe("base32Encode", () => {
  it("matches RFC 4648 test vectors without padding", () => {
    expect(base32Encode(Buffer.from(""))).toBe("");
    expect(base32Encode(Buffer.from("f"))).toBe("MY");
    expect(base32Encode(Buffer.from("fo"))).toBe("MZXQ");
    expect(base32Encode(Buffer.from("foo"))).toBe("MZXW6");
    expect(base32Encode(Buffer.from("foob"))).toBe("MZXW6YQ");
    expect(base32Encode(Buffer.from("fooba"))).toBe("MZXW6YTB");
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
  });
});

describe("verifyTotp", () => {
  it.each(VECTORS)("accepts the RFC 6238 code at T=%i", (t, code) => {
    expect(verifyTotp(KEY, code, undefined, t * 1000)).toBe(Math.floor(t / 30));
  });

  it("accepts codes one step either side of now, but not two", () => {
    // "081804" is the code for the step containing T=1111111109
    const now = 1111111109 * 1000;
    expect(verifyTotp(KEY, "081804", undefined, now - 30_000)).not.toBeNull();
    expect(verifyTotp(KEY, "081804", undefined, now + 30_000)).not.toBeNull();
    expect(verifyTotp(KEY, "081804", undefined, now - 60_000)).toBeNull();
    expect(verifyTotp(KEY, "081804", undefined, now + 60_000)).toBeNull();
  });

  it("rejects a step that was already used", () => {
    const now = 59 * 1000;
    const step = verifyTotp(KEY, "287082", undefined, now);
    expect(step).toBe(1);
    expect(verifyTotp(KEY, "287082", 1, now)).toBeNull();
  });

  it("rejects malformed and wrong codes", () => {
    const now = 59 * 1000;
    expect(verifyTotp(KEY, "", undefined, now)).toBeNull();
    expect(verifyTotp(KEY, "28708", undefined, now)).toBeNull();
    expect(verifyTotp(KEY, "2870820", undefined, now)).toBeNull();
    expect(verifyTotp(KEY, "28708a", undefined, now)).toBeNull();
    expect(verifyTotp(KEY, "123456", undefined, now)).toBeNull();
  });
});

describe("getOtpauthUrl", () => {
  it("builds a URL authenticator apps can import", () => {
    expect(getOtpauthUrl(Buffer.from("foobar"), "a+b@example.com")).toBe(
      "otpauth://totp/GrowthBook%3Aa%2Bb%40example.com?secret=MZXW6YTBOI&issuer=GrowthBook",
    );
  });
});
