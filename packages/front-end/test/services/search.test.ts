import React from "react";
import { useRouter } from "next/router";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildFilterUrl,
  filterSearchTerm,
  tagFilterOnClick,
  transformQuery,
  useSearch,
} from "@/services/search";

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

  describe("buildFilterUrl", () => {
    // Resolves the value that useSearch would see by extracting ?q= from the built URL.
    const extractQ = (url: string): string => {
      const search = url.includes("?") ? url.split("?")[1] : "";
      const params = new URLSearchParams(search);
      return params.get("q") ?? "";
    };

    const parseBuiltUrl = (value: string) =>
      transformQuery(extractQ(buildFilterUrl("/features", "tag", value)), [
        "tag",
      ]);

    it("round-trips a simple slug tag", () => {
      expect(parseBuiltUrl("team-platform")).toEqual({
        searchTerm: "",
        syntaxFilters: [
          {
            field: "tag",
            operator: "",
            negated: false,
            values: ["team-platform"],
          },
        ],
      });
    });

    it("round-trips values containing reserved operator prefixes", () => {
      // Without quoting these would parse as negation/operators instead of literal values.
      for (const value of ["!foo", "^bar", ">baz", "<qux", "=zip", "~hey"]) {
        expect(parseBuiltUrl(value)).toEqual({
          searchTerm: "",
          syntaxFilters: [
            {
              field: "tag",
              operator: "",
              negated: false,
              values: [value],
            },
          ],
        });
      }
    });

    it("round-trips values with whitespace, commas, and colons", () => {
      for (const value of ["my tag", "a,b", "key:value", "foo bar, baz"]) {
        expect(parseBuiltUrl(value)).toEqual({
          searchTerm: "",
          syntaxFilters: [
            {
              field: "tag",
              operator: "",
              negated: false,
              values: [value],
            },
          ],
        });
      }
    });

    it("strips embedded double-quotes (parser cannot escape them)", () => {
      // Not a round-trip: the parser's `"[^"]*"` has no escape mechanism, so we drop inner quotes.
      expect(parseBuiltUrl(`a"b"c`)).toEqual({
        searchTerm: "",
        syntaxFilters: [
          { field: "tag", operator: "", negated: false, values: ["abc"] },
        ],
      });
    });

    it("URL-encodes the query param", () => {
      const url = buildFilterUrl("/features", "tag", "team-platform");
      expect(url).toBe("/features?q=tag%3A%22team-platform%22");
    });
  });

  describe("tagFilterOnClick", () => {
    const makeEvent = (
      overrides: Partial<React.MouseEvent> = {},
    ): React.MouseEvent =>
      ({
        preventDefault: vi.fn(),
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        ...overrides,
      }) as unknown as React.MouseEvent;

    const apply = (
      currentValue: string,
      tag: string,
    ): { next: string; event: React.MouseEvent } => {
      const setSearchValue = vi.fn<(value: string) => void>();
      const event = makeEvent();
      tagFilterOnClick(currentValue, setSearchValue)(tag, event);
      expect(setSearchValue).toHaveBeenCalledTimes(1);
      return { next: setSearchValue.mock.calls[0][0], event };
    };

    it("calls preventDefault on a plain left click", () => {
      const { event } = apply("", "foo");
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["metaKey", { metaKey: true }],
      ["ctrlKey", { ctrlKey: true }],
      ["shiftKey", { shiftKey: true }],
      ["altKey", { altKey: true }],
    ])(
      "falls through (no preventDefault, no setSearchValue) for %s click",
      (_label, overrides) => {
        const setSearchValue = vi.fn<(value: string) => void>();
        const event = makeEvent(overrides);
        tagFilterOnClick("owner:alice", setSearchValue)("team-platform", event);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(setSearchValue).not.toHaveBeenCalled();
      },
    );

    it("adds a tag clause when the search is empty", () => {
      expect(apply("", "team-platform").next).toBe(`tag:"team-platform"`);
    });

    it("appends a tag clause when no existing tag clause is present", () => {
      expect(apply("owner:alice some-text", "team-platform").next).toBe(
        `owner:alice some-text tag:"team-platform"`,
      );
    });

    it("replaces an existing unquoted tag clause", () => {
      expect(apply("tag:foo owner:alice", "team-platform").next).toBe(
        `owner:alice tag:"team-platform"`,
      );
    });

    it("replaces an existing quoted tag clause", () => {
      expect(apply(`owner:alice tag:"foo bar" baz`, "team-platform").next).toBe(
        `owner:alice baz tag:"team-platform"`,
      );
    });

    it("replaces a negated/operator tag clause", () => {
      expect(apply("owner:alice tag:!^old", "new").next).toBe(
        `owner:alice tag:"new"`,
      );
    });

    it("replaces a comma-separated tag clause", () => {
      expect(apply(`tag:foo,bar,"a b" rest`, "new").next).toBe(
        `rest tag:"new"`,
      );
    });

    it("strips embedded double-quotes from the new tag value", () => {
      expect(apply("", `a"b"c`).next).toBe(`tag:"abc"`);
    });

    it("produces a value that parses as the expected single tag filter", () => {
      const { next } = apply("owner:alice tag:foo free-text", "team-platform");
      expect(transformQuery(next, ["owner", "tag"])).toEqual({
        searchTerm: "free-text",
        syntaxFilters: [
          { field: "owner", operator: "", negated: false, values: ["alice"] },
          {
            field: "tag",
            operator: "",
            negated: false,
            values: ["team-platform"],
          },
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

  describe("duplicate item ids", () => {
    type SearchItem = {
      id: string;
      name: string;
    };

    it("searches all rows even when ids are duplicated", () => {
      const items: SearchItem[] = [
        { id: "dup", name: "first row token" },
        { id: "dup", name: "second row token" },
        { id: "unique", name: "other token" },
      ];

      const { result } = renderHook(() =>
        useSearch<SearchItem>({
          items,
          searchFields: ["name"],
          localStorageKey: "search-service-test-duplicate-ids",
          defaultSortField: "name",
        }),
      );

      act(() => {
        result.current.setSearchValue("second row token");
      });
      expect(result.current.filteredItems.length).toBe(3);
      expect(result.current.filteredItems.map((i) => i.name)).toStrictEqual([
        "second row token",
        "first row token",
        "other token",
      ]);
      expect(result.current.filteredItems.map((i) => i.id)).toStrictEqual([
        "dup",
        "dup",
        "unique",
      ]);

      act(() => {
        result.current.setSearchValue("second");
      });
      expect(result.current.filteredItems.length).toBe(1);
      expect(result.current.filteredItems[0]?.id).toBe("dup");
      expect(result.current.filteredItems[0]?.name).toBe("second row token");

      act(() => {
        result.current.setSearchValue("row");
      });
      expect(result.current.filteredItems.length).toBe(2);
      expect(result.current.filteredItems.map((i) => i.name)).toStrictEqual([
        "first row token",
        "second row token",
      ]);

      act(() => {
        result.current.setSearchValue("token");
      });
      expect(result.current.filteredItems.length).toBe(3);
      expect(result.current.filteredItems.map((i) => i.name)).toStrictEqual([
        "other token",
        "first row token",
        "second row token",
      ]);
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
