import { toRemoteGroupKey } from "../src/keys";

describe("toRemoteGroupKey", () => {
  it("matches String(value) for number attribute values", () => {
    for (const value of [1, -2.5, 1000, 0.1]) {
      expect(toRemoteGroupKey(String(value), true)).toBe(String(value));
    }
    expect(toRemoteGroupKey("001", true)).toBe("1");
    expect(toRemoteGroupKey("001", false)).toBe("001");
  });
});
