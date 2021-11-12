import { addNonconvertingUsersToStats } from "../src/services/stats";

describe("stats", () => {
  it("adjusts stats when ignoreNull is false", () => {
    const res = addNonconvertingUsersToStats({
      users: 500,
      count: 100,
      mean: 10,
      stddev: 5,
    });
    expect(res).toEqual({
      mean: 2,
      stddev: 4.58170099067321,
    });
  });
});
