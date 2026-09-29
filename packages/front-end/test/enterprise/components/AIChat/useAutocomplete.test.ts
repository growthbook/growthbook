import { remainingCompletion } from "@/enterprise/components/AIChat/Composer/useAutocomplete";

const s = { base: "create a flag", completion: " for checkout" };

describe("remainingCompletion", () => {
  it("shows the whole completion for the draft it was made for", () => {
    expect(remainingCompletion("create a flag", s)).toBe(" for checkout");
  });
  it("narrows as the user types into it", () => {
    expect(remainingCompletion("create a flag for ch", s)).toBe("eckout");
  });
  it("drops it when the draft diverges or shrinks", () => {
    expect(remainingCompletion("create a flag fo r", s)).toBe("");
    expect(remainingCompletion("create a fl", s)).toBe("");
    expect(remainingCompletion("create a flag", null)).toBe("");
  });
});
