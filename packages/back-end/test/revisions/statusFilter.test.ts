import { buildRevisionStatusFilter } from "back-end/src/api/revisionValidations";

/**
 * `status` is a comma-separated list, and `open` is an ALIAS inside it, not a
 * stored status. Mixing the two used to lose data on both surfaces:
 *
 *  - REST returned the bare `"open"` sentinel the moment the list contained it, so
 *    `status=open,merged` silently dropped `merged`.
 *  - The internal controller passed the list through verbatim, so the same query
 *    reached Mongo as `$in: ["open", "merged"]` — `open` matches no document, so it
 *    collapsed the other way, to merged-only.
 *
 * Both are silent wrong answers rather than errors: a paging client just sees fewer
 * revisions than exist. Unknown tokens are already rejected upstream by
 * `revisionStatusQuery`, so this only has to get the alias right.
 */

describe("buildRevisionStatusFilter", () => {
  it("keeps the bare sentinel when `open` is alone", () => {
    // The model turns this into `$nin: [merged, discarded]`, which is WIDER than
    // any expansion — it also covers statuses this code doesn't know about — so
    // expanding unconditionally would be a quiet narrowing of its own.
    expect(buildRevisionStatusFilter("open")).toBe("open");
  });

  it("expands `open` when mixed with concrete statuses", () => {
    const result = buildRevisionStatusFilter("open,merged");
    expect(Array.isArray(result)).toBe(true);
    expect(new Set(result as string[])).toEqual(
      new Set([
        "draft",
        "pending-review",
        "approved",
        "changes-requested",
        "merged",
      ]),
    );
    // And never leaks the alias itself into the `$in`.
    expect(result).not.toContain("open");
  });

  it("does not drop a status the alias already covers", () => {
    // `draft` is inside `open`, so the naive fixes (concat, or "expand only the
    // ones not already there") both had a chance to duplicate or drop it.
    const result = buildRevisionStatusFilter("open,draft") as string[];
    expect(result.filter((s) => s === "draft")).toHaveLength(1);
  });

  it("passes ordinary input through", () => {
    expect(buildRevisionStatusFilter("merged")).toBe("merged");
    expect(buildRevisionStatusFilter("draft, merged")).toEqual([
      "draft",
      "merged",
    ]);
    expect(buildRevisionStatusFilter(undefined)).toBeUndefined();
    expect(buildRevisionStatusFilter("")).toBeUndefined();
    // Trailing separators are the shape a UI building the list from checkboxes
    // emits when nothing is checked.
    expect(buildRevisionStatusFilter(",,")).toBeUndefined();
  });
});
