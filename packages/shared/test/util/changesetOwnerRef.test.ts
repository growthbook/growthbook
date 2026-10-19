import { changesetOwnerRef } from "shared/util";

describe("changesetOwnerRef", () => {
  it("resolves an experiment-owned changeset", () => {
    expect(changesetOwnerRef({ experiment: "exp_1" })).toEqual({
      kind: "experiment",
      id: "exp_1",
    });
  });

  it("resolves a bandit-owned changeset", () => {
    expect(changesetOwnerRef({ contextualBandit: "cb_1" })).toEqual({
      kind: "contextual-bandit",
      id: "cb_1",
    });
  });

  it("returns null when neither owner is set", () => {
    expect(changesetOwnerRef({})).toBeNull();
    expect(
      changesetOwnerRef({ experiment: "", contextualBandit: "" }),
    ).toBeNull();
  });
});
