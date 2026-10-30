import { applyPaginationAndLoad } from "back-end/src/util/handler";

const keys = ["a", "b", "c", "d", "e"].map((id) => ({ id }));

describe("applyPaginationAndLoad", () => {
  it("loads only the requested page and returns it in key order", async () => {
    const load = jest.fn(async (ids: string[]) =>
      [...ids].reverse().map((id) => ({ id, full: true })),
    );

    const { filtered, returnFields } = await applyPaginationAndLoad(
      keys,
      { limit: 2, offset: 1 },
      load,
    );

    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(["b", "c"]);
    expect(filtered).toEqual([
      { id: "b", full: true },
      { id: "c", full: true },
    ]);
    expect(returnFields).toEqual({
      limit: 2,
      offset: 1,
      count: 2,
      total: 5,
      hasMore: true,
      nextOffset: 3,
    });
  });

  it("drops keys whose item no longer loads and counts what is returned", async () => {
    const { filtered, returnFields } = await applyPaginationAndLoad(
      keys,
      { limit: 3, offset: 0 },
      async (ids) => ids.filter((id) => id !== "b").map((id) => ({ id })),
    );

    expect(filtered.map((item) => item.id)).toEqual(["a", "c"]);
    expect(returnFields).toEqual({
      limit: 3,
      offset: 0,
      count: 2,
      total: 5,
      hasMore: true,
      nextOffset: 3,
    });
  });

  it("does not call load for a page past the end", async () => {
    const load = jest.fn(async (ids: string[]) => ids.map((id) => ({ id })));

    const { filtered, returnFields } = await applyPaginationAndLoad(
      keys,
      { limit: 10, offset: 5 },
      load,
    );

    expect(load).not.toHaveBeenCalled();
    expect(filtered).toEqual([]);
    expect(returnFields).toEqual({
      limit: 10,
      offset: 5,
      count: 0,
      total: 5,
      hasMore: false,
      nextOffset: null,
    });
  });

  it("validates pagination like applyPagination", async () => {
    await expect(
      applyPaginationAndLoad(keys, { limit: 0 }, async () => []),
    ).rejects.toThrow("Pagination limit must be between 1 and 100");
  });
});
