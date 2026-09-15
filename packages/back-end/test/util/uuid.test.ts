import { generateId } from "back-end/src/util/uuid";

describe("generateId", () => {
  it("returns prefix + literal '2' + base58 suffix", () => {
    const id = generateId("foo_");
    expect(id).toMatch(
      /^foo_2[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{21}$/,
    );
  });

  it("works with no prefix", () => {
    const id = generateId();
    expect(id).toMatch(
      /^2[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{21}$/,
    );
  });

  it("produces unique ids across rapid successive calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(generateId("x_"));
    expect(ids.size).toBe(1000);
  });

  it("sorts after legacy uniqid-style ids that start with '1'", () => {
    // uniqid encodes address+pid+time in base36 with a leading '1...' suffix.
    const legacy = "qry_19g6nmoipsmha";
    const fresh = generateId("qry_");
    expect([legacy, fresh].sort()).toEqual([legacy, fresh]);
  });

  it("is lexicographically time-ordered between successive calls", async () => {
    const first = generateId("x_");
    // Sleep just over 1ms to bump uuidv7's timestamp portion.
    await new Promise((r) => setTimeout(r, 2));
    const second = generateId("x_");
    expect(first < second).toBe(true);
  });
});
