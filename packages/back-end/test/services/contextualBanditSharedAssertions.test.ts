import { ContextualBanditInterface } from "shared/validators";
import { assertVariationsCoverBandit } from "back-end/src/api/contextual-bandits/_shared";

function makeCb(
  variations: Array<{
    id: string;
    status?: "active" | "pending" | "deactivated";
  }>,
): ContextualBanditInterface {
  return {
    id: "cb_test",
    variations: variations.map((v) => ({
      id: v.id,
      key: v.id,
      name: v.id,
      description: "",
      screenshots: [],
      ...(v.status ? { status: v.status } : {}),
    })),
  } as unknown as ContextualBanditInterface;
}

describe("assertVariationsCoverBandit", () => {
  it("accepts values keyed to every visible variation", () => {
    const cb = makeCb([{ id: "var_a" }, { id: "var_b" }]);
    expect(() =>
      assertVariationsCoverBandit(cb, [
        { variationId: "var_a", value: "1" },
        { variationId: "var_b", value: "2" },
      ]),
    ).not.toThrow();
  });

  it("ignores deactivated tombstones in the missing-value check", () => {
    const cb = makeCb([
      { id: "var_a" },
      { id: "var_b" },
      { id: "var_tomb_1", status: "deactivated" },
      { id: "var_tomb_2", status: "deactivated" },
    ]);
    expect(() =>
      assertVariationsCoverBandit(cb, [
        { variationId: "var_a", value: "1" },
        { variationId: "var_b", value: "2" },
      ]),
    ).not.toThrow();
  });

  it("rejects a value keyed to a deactivated tombstone as unknown", () => {
    const cb = makeCb([
      { id: "var_a" },
      { id: "var_b" },
      { id: "var_tomb", status: "deactivated" },
    ]);
    expect(() =>
      assertVariationsCoverBandit(cb, [
        { variationId: "var_a", value: "1" },
        { variationId: "var_b", value: "2" },
        { variationId: "var_tomb", value: "3" },
      ]),
    ).toThrow(/Unknown variation id "var_tomb"/);
  });

  it("throws when a visible variation has no value", () => {
    const cb = makeCb([{ id: "var_a" }, { id: "var_b" }, { id: "var_c" }]);
    expect(() =>
      assertVariationsCoverBandit(cb, [
        { variationId: "var_a", value: "1" },
        { variationId: "var_b", value: "2" },
      ]),
    ).toThrow(/Missing a value for contextual bandit variation\(s\): var_c/);
  });

  it("rejects duplicate variation ids", () => {
    const cb = makeCb([{ id: "var_a" }, { id: "var_b" }]);
    expect(() =>
      assertVariationsCoverBandit(cb, [
        { variationId: "var_a", value: "1" },
        { variationId: "var_a", value: "2" },
        { variationId: "var_b", value: "3" },
      ]),
    ).toThrow(/listed more than once/);
  });

  it("rejects unknown variation ids", () => {
    const cb = makeCb([{ id: "var_a" }, { id: "var_b" }]);
    expect(() =>
      assertVariationsCoverBandit(cb, [
        { variationId: "var_a", value: "1" },
        { variationId: "var_b", value: "2" },
        { variationId: "var_unknown", value: "3" },
      ]),
    ).toThrow(/Unknown variation id "var_unknown"/);
  });
});
