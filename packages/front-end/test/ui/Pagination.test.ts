import { getPaginationModel } from "@/ui/Pagination";

describe("getPaginationModel", () => {
  describe("exact sequences", () => {
    it("returns no items and page 1 for an empty page set", () => {
      expect(getPaginationModel({ pageCount: 0, currentPage: 42 })).toEqual({
        pageCount: 0,
        currentPage: 1,
        items: [],
      });
    });

    it("renders every page when the count fits in the available slots", () => {
      expect(
        getPaginationModel({ pageCount: 1, currentPage: 1 }).items,
      ).toEqual([{ type: "page", page: 1 }]);
      expect(
        getPaginationModel({ pageCount: 2, currentPage: 1 }).items,
      ).toEqual([
        { type: "page", page: 1 },
        { type: "page", page: 2 },
      ]);
      expect(
        getPaginationModel({ pageCount: 5, currentPage: 1 }).items,
      ).toEqual([
        { type: "page", page: 1 },
        { type: "page", page: 2 },
        { type: "page", page: 3 },
        { type: "page", page: 4 },
        { type: "page", page: 5 },
      ]);
      expect(
        getPaginationModel({ pageCount: 7, currentPage: 1 }).items,
      ).toEqual([
        { type: "page", page: 1 },
        { type: "page", page: 2 },
        { type: "page", page: 3 },
        { type: "page", page: 4 },
        { type: "page", page: 5 },
        { type: "page", page: 6 },
        { type: "page", page: 7 },
      ]);
    });

    it("keeps seven slots across eight pages", () => {
      for (const currentPage of [1, 2, 3, 4]) {
        expect(getPaginationModel({ pageCount: 8, currentPage }).items).toEqual(
          [
            { type: "page", page: 1 },
            { type: "page", page: 2 },
            { type: "page", page: 3 },
            { type: "page", page: 4 },
            { type: "page", page: 5 },
            { type: "ellipsis", side: "end" },
            { type: "page", page: 8 },
          ],
        );
      }

      for (const currentPage of [5, 6, 7, 8]) {
        expect(getPaginationModel({ pageCount: 8, currentPage }).items).toEqual(
          [
            { type: "page", page: 1 },
            { type: "ellipsis", side: "start" },
            { type: "page", page: 4 },
            { type: "page", page: 5 },
            { type: "page", page: 6 },
            { type: "page", page: 7 },
            { type: "page", page: 8 },
          ],
        );
      }
    });

    it("keeps seven slots across ten pages", () => {
      for (const currentPage of [1, 2, 3, 4]) {
        expect(
          getPaginationModel({ pageCount: 10, currentPage }).items,
        ).toEqual([
          { type: "page", page: 1 },
          { type: "page", page: 2 },
          { type: "page", page: 3 },
          { type: "page", page: 4 },
          { type: "page", page: 5 },
          { type: "ellipsis", side: "end" },
          { type: "page", page: 10 },
        ]);
      }

      expect(
        getPaginationModel({ pageCount: 10, currentPage: 5 }).items,
      ).toEqual([
        { type: "page", page: 1 },
        { type: "ellipsis", side: "start" },
        { type: "page", page: 4 },
        { type: "page", page: 5 },
        { type: "page", page: 6 },
        { type: "ellipsis", side: "end" },
        { type: "page", page: 10 },
      ]);
      expect(
        getPaginationModel({ pageCount: 10, currentPage: 6 }).items,
      ).toEqual([
        { type: "page", page: 1 },
        { type: "ellipsis", side: "start" },
        { type: "page", page: 5 },
        { type: "page", page: 6 },
        { type: "page", page: 7 },
        { type: "ellipsis", side: "end" },
        { type: "page", page: 10 },
      ]);

      for (const currentPage of [7, 8, 9, 10]) {
        expect(
          getPaginationModel({ pageCount: 10, currentPage }).items,
        ).toEqual([
          { type: "page", page: 1 },
          { type: "ellipsis", side: "start" },
          { type: "page", page: 6 },
          { type: "page", page: 7 },
          { type: "page", page: 8 },
          { type: "page", page: 9 },
          { type: "page", page: 10 },
        ]);
      }
    });

    it("keeps seven slots across one hundred pages", () => {
      expect(
        getPaginationModel({ pageCount: 100, currentPage: 1 }).items,
      ).toEqual([
        { type: "page", page: 1 },
        { type: "page", page: 2 },
        { type: "page", page: 3 },
        { type: "page", page: 4 },
        { type: "page", page: 5 },
        { type: "ellipsis", side: "end" },
        { type: "page", page: 100 },
      ]);
      expect(
        getPaginationModel({ pageCount: 100, currentPage: 50 }).items,
      ).toEqual([
        { type: "page", page: 1 },
        { type: "ellipsis", side: "start" },
        { type: "page", page: 49 },
        { type: "page", page: 50 },
        { type: "page", page: 51 },
        { type: "ellipsis", side: "end" },
        { type: "page", page: 100 },
      ]);
      expect(
        getPaginationModel({ pageCount: 100, currentPage: 99 }).items,
      ).toEqual([
        { type: "page", page: 1 },
        { type: "ellipsis", side: "start" },
        { type: "page", page: 96 },
        { type: "page", page: 97 },
        { type: "page", page: 98 },
        { type: "page", page: 99 },
        { type: "page", page: 100 },
      ]);
    });
  });

  it("preserves the slot and gap invariants for larger page sets", () => {
    for (let pageCount = 8; pageCount <= 30; pageCount++) {
      for (let currentPage = 1; currentPage <= pageCount; currentPage++) {
        const { items } = getPaginationModel({ pageCount, currentPage });
        const pages = items.flatMap((item) =>
          item.type === "page" ? [item.page] : [],
        );

        expect(items).toHaveLength(7);
        expect(items[0]).toEqual({ type: "page", page: 1 });
        expect(items.at(-1)).toEqual({ type: "page", page: pageCount });
        expect(pages).toContain(currentPage);

        for (let index = 1; index < pages.length; index++) {
          expect(pages[index]).toBeGreaterThan(pages[index - 1]);
        }

        for (let index = 0; index < items.length; index++) {
          const item = items[index];
          if (item.type === "page") continue;

          const previousItem = items[index - 1];
          const nextItem = items[index + 1];
          expect(previousItem.type).toBe("page");
          expect(nextItem.type).toBe("page");

          if (previousItem.type === "page" && nextItem.type === "page") {
            expect(nextItem.page - previousItem.page).toBeGreaterThanOrEqual(3);
          }
        }
      }
    }
  });

  it("renders every page without ellipses for smaller page sets", () => {
    for (let pageCount = 1; pageCount <= 7; pageCount++) {
      for (let currentPage = 1; currentPage <= pageCount; currentPage++) {
        const { items } = getPaginationModel({ pageCount, currentPage });

        expect(items).toEqual(
          Array.from({ length: pageCount }, (_, index) => ({
            type: "page",
            page: index + 1,
          })),
        );
        expect(items.some((item) => item.type === "ellipsis")).toBe(false);
      }
    }
  });

  it("normalizes invalid page counts", () => {
    for (const pageCount of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(getPaginationModel({ pageCount, currentPage: 5 })).toEqual({
        pageCount: 0,
        currentPage: 1,
        items: [],
      });
    }
  });

  it.each([
    { input: 0, expected: 1 },
    { input: 999, expected: 10 },
    { input: 2.7, expected: 2 },
    { input: Number.NaN, expected: 1 },
  ])("normalizes current page $input to $expected", ({ input, expected }) => {
    expect(
      getPaginationModel({ pageCount: 10, currentPage: input }).currentPage,
    ).toBe(expected);
  });
});
