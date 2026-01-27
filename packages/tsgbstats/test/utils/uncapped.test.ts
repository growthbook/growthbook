import { replaceWithUncapped } from "../../src/utils/uncapped";

describe("replaceWithUncapped", () => {
  it("replaces main columns with uncapped versions", () => {
    const data = [
      {
        dimension: "",
        baseline_main_sum: 100,
        baseline_main_sum_squares: 1000,
        baseline_uncapped_main_sum: 150,
        baseline_uncapped_main_sum_squares: 2000,
        baseline_users: 50,
        v1_main_sum: 120,
        v1_main_sum_squares: 1200,
        v1_uncapped_main_sum: 180,
        v1_uncapped_main_sum_squares: 2400,
        v1_users: 55,
      },
    ];

    const result = replaceWithUncapped(data);

    expect(result[0].baseline_main_sum).toBe(150);
    expect(result[0].baseline_main_sum_squares).toBe(2000);
    expect(result[0].v1_main_sum).toBe(180);
    expect(result[0].v1_main_sum_squares).toBe(2400);
  });

  it("does not modify data if uncapped columns are missing", () => {
    const data = [
      {
        dimension: "",
        baseline_main_sum: 100,
        baseline_main_sum_squares: 1000,
        baseline_users: 50,
      },
    ];

    const result = replaceWithUncapped(data);

    expect(result[0].baseline_main_sum).toBe(100);
    expect(result[0].baseline_main_sum_squares).toBe(1000);
  });

  it("returns deep copy of data", () => {
    const data = [{ baseline_main_sum: 100 }];
    const result = replaceWithUncapped(data);

    result[0].baseline_main_sum = 999;
    expect(data[0].baseline_main_sum).toBe(100);
  });
});
