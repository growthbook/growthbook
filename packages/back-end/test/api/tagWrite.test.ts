import { resolveTagWrite } from "back-end/src/api/tags/postTag";

describe("resolveTagWrite", () => {
  const existing = { id: "beta", color: "blue", description: "Beta work" };

  it("leaves out fields as empty on a new tag", () => {
    expect(resolveTagWrite({ id: "beta" }, undefined)).toEqual({
      id: "beta",
      color: "",
      description: "",
    });
  });

  it("keeps left-out fields on an existing tag", () => {
    expect(resolveTagWrite({ id: "beta", color: "teal" }, existing)).toEqual({
      id: "beta",
      color: "teal",
      description: "Beta work",
    });
    expect(
      resolveTagWrite({ id: "beta", description: "New" }, existing),
    ).toEqual({ id: "beta", color: "blue", description: "New" });
  });

  it("clears a value sent as an empty string", () => {
    expect(
      resolveTagWrite({ id: "beta", color: "", description: "" }, existing),
    ).toEqual({ id: "beta", color: "", description: "" });
  });
});
