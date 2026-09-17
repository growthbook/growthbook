import { describe, expect, it } from "vitest";
import { filterToString } from "@/components/Search/SearchFilters";
import { SyntaxFilter, transformQuery } from "@/services/search";

describe("filterToString", () => {
  const roundTrip = (filter: SyntaxFilter) =>
    transformQuery(filterToString(filter), [filter.field]).syntaxFilters;

  it("serializes a simple filter", () => {
    expect(
      filterToString({
        field: "tag",
        operator: "",
        negated: false,
        values: ["checkout"],
      }),
    ).toBe("tag:checkout");
  });

  it("quotes values containing spaces", () => {
    expect(
      filterToString({
        field: "owner",
        operator: "",
        negated: false,
        values: ["Adriel Vieira"],
      }),
    ).toBe('owner:"Adriel Vieira"');
  });

  it("quotes values containing commas so they round-trip as one value", () => {
    const filter: SyntaxFilter = {
      field: "metric",
      operator: "",
      negated: false,
      values: ["a,b"],
    };
    expect(filterToString(filter)).toBe('metric:"a,b"');
    expect(roundTrip(filter)).toEqual([filter]);
  });

  it("round-trips multiple values where some contain commas or spaces", () => {
    const filter: SyntaxFilter = {
      field: "owner",
      operator: "",
      negated: false,
      values: ["Vieira, Adriel", "bob", "Smith, John"],
    };
    expect(roundTrip(filter)).toEqual([filter]);
  });

  it("serializes negation and operators", () => {
    expect(
      filterToString({
        field: "tag",
        operator: "^",
        negated: true,
        values: ["old"],
      }),
    ).toBe("tag:!^old");
  });
});
