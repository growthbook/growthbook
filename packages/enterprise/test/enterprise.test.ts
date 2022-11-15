import { sayHello } from "../src/index";

describe("enterprise", () => {
  it("says hello", () => {
    expect(sayHello("Jeremy")).toEqual("Hello Jeremy!");
  });
});
