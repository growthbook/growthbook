import { returnTrue } from "../src";

describe("enterprise", () => {
  it("runs tests", () => {
    expect(returnTrue()).toEqual(true);
  });
});
