import { filterSearchTerm, transformQuery } from "@/services/search";

describe("useSearch", () => {
  describe("transformQuery", () => {
    it("should parse a query string into an object", () => {
      const query = "foo:bar hello baz:>3 world:!a f:1,2,3 h:!^yo unknown:yes";
      const result = transformQuery(query, ["foo", "baz", "world", "f", "h"]);
      expect(result).toEqual({
        searchTerm: "hello unknown:yes",
        syntaxFilters: [
          { field: "foo", operator: "", negated: false, values: ["bar"] },
          { field: "baz", operator: ">", negated: false, values: ["3"] },
          { field: "world", operator: "", negated: true, values: ["a"] },
          { field: "f", operator: "", negated: false, values: ["1", "2", "3"] },
          { field: "h", operator: "^", negated: true, values: ["yo"] },
        ],
      });
    });
    it("handles quoted strings", () => {
      const query = `hello foo:"my value" world bar:!^"a b"`;
      const result = transformQuery(query, ["foo", "bar"]);
      expect(result).toEqual({
        searchTerm: "hello world",
        syntaxFilters: [
          { field: "foo", operator: "", negated: false, values: ["my value"] },
          { field: "bar", operator: "^", negated: true, values: ["a b"] },
        ],
      });
    });
    it("trims extra spaces", () => {
      const query = "test foo:bar  ";
      const result = transformQuery(query, ["foo"]);
      expect(result).toEqual({
        searchTerm: "test",
        syntaxFilters: [
          { field: "foo", operator: "", negated: false, values: ["bar"] },
        ],
      });
    });
  });
  describe("filterSearchTerm", () => {
    it("should filter with default operator", () => {
      // Strings (exact default)
      expect(filterSearchTerm("foo", "", "f")).toEqual(false);
      expect(filterSearchTerm("foo", "", "foo")).toEqual(true);
      expect(filterSearchTerm("foo", "", "a")).toEqual(false);
      expect(filterSearchTerm("foo", "", "food")).toEqual(false);

      // Numbers (exact default)
      expect(filterSearchTerm(123, "", "1")).toEqual(false);
      expect(filterSearchTerm(123, "", "123")).toEqual(true);
      expect(filterSearchTerm(123, "", "1234")).toEqual(false);

      // Dates (startsWith default)
      const d = new Date("2021-06-10T12:00:00Z");
      expect(filterSearchTerm(d, "", "2021")).toEqual(true);
      expect(filterSearchTerm(d, "", "2021-06")).toEqual(true);
      expect(filterSearchTerm(d, "", "2021-07")).toEqual(false);
      expect(filterSearchTerm(d, "", "06-10")).toEqual(false);

      // Arrays
      expect(filterSearchTerm(["foo", "bar"], "", "f")).toEqual(false);
      expect(filterSearchTerm(["foo", "bar"], "", "b")).toEqual(false);
      expect(filterSearchTerm(["foo", "bar"], "", "foo")).toEqual(true);
      expect(filterSearchTerm(["foo", "bar"], "", "bar")).toEqual(true);
    });
    it("supports gt/lt operators", () => {
      // Numbers
      expect(filterSearchTerm(3, ">", "2")).toEqual(true);
      expect(filterSearchTerm(3, ">", "3")).toEqual(false);
      expect(filterSearchTerm(3, ">", "4")).toEqual(false);
      expect(filterSearchTerm(3, "<", "2")).toEqual(false);
      expect(filterSearchTerm(3, "<", "3")).toEqual(false);
      expect(filterSearchTerm(3, "<", "4")).toEqual(true);
      expect(filterSearchTerm(3, "<", "abc")).toEqual(false);
      expect(filterSearchTerm(3, ">", "abc")).toEqual(false);

      // Strings
      expect(filterSearchTerm("foo", ">", "bar")).toEqual(true);
      expect(filterSearchTerm("foo", ">", "Bar")).toEqual(true);
      expect(filterSearchTerm("Foo", ">", "bar")).toEqual(true);
      expect(filterSearchTerm("bar", ">", "foo")).toEqual(false);
      expect(filterSearchTerm("bar", "<", "foo")).toEqual(true);

      // Arrays
      expect(filterSearchTerm([5, 10], ">", "6")).toEqual(true);
      expect(filterSearchTerm([5, 10], "<", "6")).toEqual(true);
      expect(filterSearchTerm([5, 10], "<", "4")).toEqual(false);
      expect(filterSearchTerm([5, 10], ">", "16")).toEqual(false);
    });
    it("supports prefix (^) operator", () => {
      // Strings
      expect(filterSearchTerm("foo", "^", "f")).toEqual(true);
      expect(filterSearchTerm("foo", "^", "foo")).toEqual(true);
      expect(filterSearchTerm("foo", "^", "food")).toEqual(false);
      expect(filterSearchTerm("foo", "^", "o")).toEqual(false);

      // Numbers
      expect(filterSearchTerm(3, "^", "3")).toEqual(true);
      expect(filterSearchTerm(3, "^", "30")).toEqual(false);
      expect(filterSearchTerm(30, "^", "3")).toEqual(true);
      expect(filterSearchTerm(30, "^", "0")).toEqual(false);

      // Arrays
      expect(filterSearchTerm(["foo", "bar"], "^", "f")).toEqual(true);
    });
    it("supports contains (~) operator", () => {
      // Strings
      expect(filterSearchTerm("foo", "~", "f")).toEqual(true);
      expect(filterSearchTerm("foo", "~", "o")).toEqual(true);
      expect(filterSearchTerm("foo", "~", "oo")).toEqual(true);
      expect(filterSearchTerm("foo", "~", "bar")).toEqual(false);

      // Numbers
      expect(filterSearchTerm(3, "~", "3")).toEqual(true);
      expect(filterSearchTerm(3, "~", "30")).toEqual(false);
      expect(filterSearchTerm(30, "~", "3")).toEqual(true);
      expect(filterSearchTerm(30, "~", "0")).toEqual(true);
    });
  });
});
