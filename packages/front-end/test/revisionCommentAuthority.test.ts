import { canCommentOnRevisionEntity } from "@/components/Revision/revisionCommentAuthority";

/**
 * Mirrors the server's `canCommentOnRevision`. Two things make this worth
 * pinning: commenting is participation, so draft or review authority allows it
 * as well as the addComments atom; and it is decided on the REVISION's snapshot,
 * not the live entity, because a comment belongs to the revision and the
 * revision's project may predate a move.
 */

type Util = Parameters<typeof canCommentOnRevisionEntity>[0];

function util({
  addComment = [],
  draft = [],
  review = [],
}: {
  addComment?: string[];
  draft?: string[];
  review?: string[];
}): Util {
  const asked = (obj: { project?: string; projects?: string[] }) =>
    obj.projects ?? (obj.project ? [obj.project] : []);
  const holds =
    (allowed: string[]) => (obj: { project?: string; projects?: string[] }) =>
      asked(obj).some((p) => allowed.includes(p)) ||
      (asked(obj).length === 0 && allowed.includes(""));
  return {
    canAddComment: (projects: string[]) => holds(addComment)({ projects }),
    canRevisionAction: (
      _type: string,
      action: string,
      obj: { project?: string; projects?: string[] },
    ) =>
      action === "draft"
        ? holds(draft)(obj)
        : action === "review"
          ? holds(review)(obj)
          : false,
  } as unknown as Util;
}

const liveInB = { project: "b" };
const revisionFromA = { target: { snapshot: { project: "a" } } };

describe("canCommentOnRevisionEntity", () => {
  it("accepts the addComments atom on its own", () => {
    expect(
      canCommentOnRevisionEntity(
        util({ addComment: ["a"] }),
        "config",
        revisionFromA,
        liveInB,
      ),
    ).toBe(true);
  });

  it("accepts draft authority, which the server also accepts", () => {
    expect(
      canCommentOnRevisionEntity(
        util({ draft: ["a"] }),
        "config",
        revisionFromA,
        liveInB,
      ),
    ).toBe(true);
  });

  it("accepts review authority, so reviewers are not shut out of the thread", () => {
    expect(
      canCommentOnRevisionEntity(
        util({ review: ["a"] }),
        "config",
        revisionFromA,
        liveInB,
      ),
    ).toBe(true);
  });

  it("refuses someone with none of the three", () => {
    expect(
      canCommentOnRevisionEntity(
        util({ addComment: ["z"], draft: ["z"], review: ["z"] }),
        "config",
        revisionFromA,
        liveInB,
      ),
    ).toBe(false);
  });

  it("decides on the revision's snapshot, not the live entity", () => {
    // The entity has moved A→B. Authority in A — where the revision was authored
    // — is what counts, and authority in B alone is not enough.
    expect(
      canCommentOnRevisionEntity(
        util({ addComment: ["a"] }),
        "config",
        revisionFromA,
        liveInB,
      ),
    ).toBe(true);
    expect(
      canCommentOnRevisionEntity(
        util({ addComment: ["b"] }),
        "config",
        revisionFromA,
        liveInB,
      ),
    ).toBe(false);
  });

  it("falls back to the live entity when no revision is selected", () => {
    expect(
      canCommentOnRevisionEntity(
        util({ addComment: ["b"] }),
        "config",
        null,
        liveInB,
      ),
    ).toBe(true);
  });

  it("reads the whole project list for a multi-project entity", () => {
    const sgRevision = { target: { snapshot: { projects: ["p1", "p2"] } } };
    expect(
      canCommentOnRevisionEntity(
        util({ addComment: ["p2"] }),
        "saved-group",
        sgRevision,
        { projects: ["p9"] },
      ),
    ).toBe(true);
  });
});
