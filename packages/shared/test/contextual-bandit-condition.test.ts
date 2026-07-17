import { leafConditionFromContexts } from "../src/experiments/contextual-bandit-condition";
import { contextualBanditAttrCol } from "../src/experiments/contextual-bandit-columns";

describe("leafConditionFromContexts", () => {
  const order = ["country", "device"];

  it("returns {} for no contexts (catch-all leaf)", () => {
    expect(leafConditionFromContexts([], order)).toEqual({});
  });

  it("emits a single equality object for one context", () => {
    expect(
      leafConditionFromContexts([{ country: "US", device: "mobile" }], order),
    ).toEqual({ country: "US", device: "mobile" });
  });

  it("collapses a single varying attribute into $in (sorted values)", () => {
    expect(
      leafConditionFromContexts(
        [
          { country: "US", device: "mobile" },
          { country: "CA", device: "mobile" },
        ],
        order,
      ),
    ).toEqual({ country: { $in: ["CA", "US"] }, device: "mobile" });
  });

  it("falls back to $or when more than one attribute varies", () => {
    expect(
      leafConditionFromContexts(
        [
          { country: "US", device: "mobile" },
          { country: "CA", device: "desktop" },
        ],
        order,
      ),
    ).toEqual({
      $or: [
        { country: "US", device: "mobile" },
        { country: "CA", device: "desktop" },
      ],
    });
  });

  it("de-prefixes internal contextual-bandit attribute columns", () => {
    expect(
      leafConditionFromContexts(
        [{ [contextualBanditAttrCol("country")]: "US" }],
        order,
      ),
    ).toEqual({ country: "US" });
  });

  it("is deterministic regardless of input context order", () => {
    const a = leafConditionFromContexts(
      [
        { country: "US", device: "mobile" },
        { country: "CA", device: "mobile" },
      ],
      order,
    );
    const b = leafConditionFromContexts(
      [
        { country: "CA", device: "mobile" },
        { country: "US", device: "mobile" },
      ],
      order,
    );
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
