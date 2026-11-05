import { parseAggregateFilter } from "../src/aggregate-filters";

describe("parseAggregateFilter", () => {
  it("parses every supported operator, ignoring whitespace", () => {
    expect(
      parseAggregateFilter("> 0, < 5 , >= 10, <= 15, =1.5, !=0.15, <> 0.15"),
    ).toEqual({
      conditions: [
        { operator: ">", value: "0" },
        { operator: "<", value: "5" },
        { operator: ">=", value: "10" },
        { operator: "<=", value: "15" },
        { operator: "=", value: "1.5" },
        { operator: "!=", value: "0.15" },
        { operator: "<>", value: "0.15" },
      ],
      invalid: [],
    });
  });

  it("skips empty parts", () => {
    expect(parseAggregateFilter(",>=3,,")).toEqual({
      conditions: [{ operator: ">=", value: "3" }],
      invalid: [],
    });
    expect(parseAggregateFilter(" , ")).toEqual({
      conditions: [],
      invalid: [],
    });
  });

  it("returns invalid parts in order alongside the valid ones", () => {
    expect(parseAggregateFilter(">5, %3, foobar, <, >-1")).toEqual({
      conditions: [{ operator: ">", value: "5" }],
      invalid: ["%3", "foobar", "<", ">-1"],
    });
  });
});
