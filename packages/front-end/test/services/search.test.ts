import React from "react";
import { useRouter } from "next/router";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { filterSearchTerm, transformQuery, useSearch } from "@/services/search";

vi.mock("next/router", () => ({
  useRouter: vi.fn(),
}));

describe("useSearch", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    // @ts-expect-error "partial test mock"
    vi.mocked(useRouter).mockReturnValue({
      query: {},
      pathname: "/",
      replace: vi.fn(),
    });
  });

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
    it("handles unquoted single value", () => {
      const query = `owner:Adriel`;
      const result = transformQuery(query, ["owner"]);
      expect(result).toEqual({
        searchTerm: "",
        syntaxFilters: [
          {
            field: "owner",
            operator: "",
            negated: false,
            values: ["Adriel"],
          },
        ],
      });
    });
    it("preserves commas inside quoted values", () => {
      const query = `owner:"Vieira, Adriel"`;
      const result = transformQuery(query, ["owner"]);
      expect(result).toEqual({
        searchTerm: "",
        syntaxFilters: [
          {
            field: "owner",
            operator: "",
            negated: false,
            values: ["Vieira, Adriel"],
          },
        ],
      });
    });
    it("treats comma-separated quoted values as separate values", () => {
      const query = `owner:"Vieira","Adriel"`;
      const result = transformQuery(query, ["owner"]);
      expect(result).toEqual({
        searchTerm: "",
        syntaxFilters: [
          {
            field: "owner",
            operator: "",
            negated: false,
            values: ["Vieira", "Adriel"],
          },
        ],
      });
    });
    it("preserves commas inside quoted values mixed with unquoted CSV", () => {
      const query = `owner:"Vieira, Adriel","Smith, John",bob`;
      const result = transformQuery(query, ["owner"]);
      expect(result).toEqual({
        searchTerm: "",
        syntaxFilters: [
          {
            field: "owner",
            operator: "",
            negated: false,
            values: ["Vieira, Adriel", "Smith, John", "bob"],
          },
        ],
      });
    });
    it("handles comma-only quoted value", () => {
      const query = `owner:","`;
      const result = transformQuery(query, ["owner"]);
      expect(result).toEqual({
        searchTerm: "",
        syntaxFilters: [
          {
            field: "owner",
            operator: "",
            negated: false,
            values: [","],
          },
        ],
      });
    });
    it("handles negated filter with comma in quoted value", () => {
      const query = `owner:!"Vieira, Adriel"`;
      const result = transformQuery(query, ["owner"]);
      expect(result).toEqual({
        searchTerm: "",
        syntaxFilters: [
          {
            field: "owner",
            operator: "",
            negated: true,
            values: ["Vieira, Adriel"],
          },
        ],
      });
    });
    it("handles multiple filters where one has commas in quotes", () => {
      const query = `owner:"Vieira, Adriel" tag:important`;
      const result = transformQuery(query, ["owner", "tag"]);
      expect(result).toEqual({
        searchTerm: "",
        syntaxFilters: [
          {
            field: "owner",
            operator: "",
            negated: false,
            values: ["Vieira, Adriel"],
          },
          {
            field: "tag",
            operator: "",
            negated: false,
            values: ["important"],
          },
        ],
      });
    });
    it("handles empty quoted value as no owner", () => {
      const query = `owner:""`;
      const result = transformQuery(query, ["owner"]);
      expect(result).toEqual({
        searchTerm: "",
        syntaxFilters: [
          {
            field: "owner",
            operator: "",
            negated: false,
            values: [""],
          },
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
  describe("manual sorting with syntax filters", () => {
    type SearchItem = {
      id: string;
      name: string;
      owner: string;
      dateCreated: number;
    };

    const items: SearchItem[] = [
      { id: "a", name: "alpha one", owner: "jeremy", dateCreated: 3 },
      { id: "b", name: "alpha two", owner: "jeremy", dateCreated: 1 },
      { id: "c", name: "alpha three", owner: "tom", dateCreated: 2 },
      { id: "d", name: "beta one", owner: "jeremy", dateCreated: 4 },
      { id: "e", name: "beta two", owner: "jeremy", dateCreated: 0 },
    ];

    const getSortLinkClass = (header: React.ReactElement): string => {
      const span = header.props.children as React.ReactElement;
      const link = React.Children.toArray(span.props.children).find(
        (child) => React.isValidElement(child) && child.type === "a",
      ) as React.ReactElement<{ className: string }>;

      return link.props.className;
    };

    const clickHeader = (header: React.ReactElement) => {
      const span = header.props.children as React.ReactElement<{
        onClick: (e: { preventDefault: () => void }) => void;
      }>;
      span.props.onClick({
        preventDefault: vi.fn(),
      });
    };

    it("keeps manual sorting enabled for filter-only queries", () => {
      const useSearchHook = () =>
        useSearch<SearchItem>({
          items,
          searchFields: ["name"],
          localStorageKey: "search-service-test-filter-only",
          defaultSortField: "dateCreated",
          searchTermFilters: {
            owner: (item) => item.owner,
          },
        });

      const { result } = renderHook(() => useSearchHook());

      act(() => {
        result.current.setSearchValue("owner:jeremy");
      });

      expect(result.current.unpaginatedItems.map((item) => item.id)).toEqual([
        "b",
        "a",
        "d",
        "e",
      ]);

      const header = result.current.SortableTH({
        field: "dateCreated",
        children: "Date Created",
      }) as React.ReactElement;

      act(() => {
        clickHeader(header);
      });

      expect(result.current.unpaginatedItems.map((item) => item.id)).toEqual([
        "d",
        "a",
        "b",
        "e",
      ]);
    });

    it("allows overriding relevance sort and resets when free-text changes", () => {
      const useSearchHook = () =>
        useSearch<SearchItem>({
          items,
          searchFields: ["name"],
          localStorageKey: "search-service-test-relevance-override",
          defaultSortField: "owner",
          searchTermFilters: {
            owner: (item) => item.owner,
          },
        });
      const { result } = renderHook(() => useSearchHook());

      act(() => {
        result.current.setSearchValue("alpha");
      });

      const dateCreatedHeader = result.current.SortableTH({
        field: "dateCreated",
        children: "Date Created",
      }) as React.ReactElement;
      const ownerHeader = result.current.SortableTH({
        field: "owner",
        children: "Owner",
      }) as React.ReactElement;

      // While relevance sort is active, all headers appear unsorted.
      expect(getSortLinkClass(dateCreatedHeader)).toBe("inactivesort");
      expect(getSortLinkClass(ownerHeader)).toBe("inactivesort");

      act(() => {
        clickHeader(dateCreatedHeader);
      });

      // Clicking a header disables relevance sorting and applies manual sort.
      expect(result.current.unpaginatedItems.map((item) => item.id)).toEqual([
        "b",
        "c",
        "a",
      ]);
      expect(
        getSortLinkClass(
          result.current.SortableTH({
            field: "dateCreated",
            children: "Date Created",
          }) as React.ReactElement,
        ),
      ).toBe("activesort");

      act(() => {
        result.current.setSearchValue("alpha owner:jeremy");
      });

      // Adding syntax filters without changing free-text preserves manual sort.
      expect(result.current.unpaginatedItems.map((item) => item.id)).toEqual([
        "b",
        "a",
      ]);

      act(() => {
        result.current.setSearchValue("beta owner:jeremy");
      });

      // Changing free-text re-enables relevance sorting.
      expect(
        getSortLinkClass(
          result.current.SortableTH({
            field: "dateCreated",
            children: "Date Created",
          }) as React.ReactElement,
        ),
      ).toBe("inactivesort");

      act(() => {
        result.current.setSearchValue("owner:jeremy");
      });

      // Removing free-text falls back to the last selected manual column sort.
      expect(result.current.unpaginatedItems.map((item) => item.id)).toEqual([
        "b",
        "a",
        "d",
        "e",
      ]);
      expect(
        getSortLinkClass(
          result.current.SortableTH({
            field: "dateCreated",
            children: "Date Created",
          }) as React.ReactElement,
        ),
      ).toBe("activesort");
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
