import { rowFilterValidator } from "../../src/validators/fact-table";

describe("rowFilterValidator", () => {
  const parse = (operator: string, values?: string[]) =>
    rowFilterValidator.safeParse({ operator, column: "signup_date", values });

  it("accepts a two-bound range", () => {
    expect(parse("between", ["2024-01-01", "2024-02-01"]).success).toBe(true);
    expect(parse("not_between", ["2024-01-01", "2024-02-01"]).success).toBe(
      true,
    );
  });

  it("accepts an open-ended range with a blank bound", () => {
    expect(parse("between", ["2024-01-01", ""]).success).toBe(true);
    expect(parse("between", ["", "2024-02-01"]).success).toBe(true);
  });

  it("accepts a range that has not been filled in yet", () => {
    expect(parse("between", []).success).toBe(true);
    expect(parse("between", undefined).success).toBe(true);
  });

  it("rejects a range with more than two values", () => {
    for (const operator of ["between", "not_between"]) {
      const result = parse(operator, [
        "2024-01-01",
        "2024-02-01",
        "2024-03-01",
      ]);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toStrictEqual(["values"]);
    }
  });

  it("does not restrict value counts for other operators", () => {
    expect(parse("in", ["a", "b", "c"]).success).toBe(true);
  });
});
