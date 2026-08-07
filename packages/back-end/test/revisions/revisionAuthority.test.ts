import type { Revision } from "shared/enterprise";
import type { RevisionAction } from "shared/permissions";
import type { Context } from "back-end/src/models/BaseModel";
import {
  canAdvanceRevision,
  canDiscardRevision,
  canRebaseRevision,
  isRevisionAuthor,
  mayBeRevisionAuthor,
} from "back-end/src/revisions/revisionAuthority";
import {
  assertCanPublishRevision,
  canTouchRevision,
} from "back-end/src/revisions/revisionActions";
import { canStageArchiveDraft } from "back-end/src/revisions/landAuthority";

/**
 * Who may move a generic draft along (request review, recall, discard). Uses
 * the REAL saved-group adapter and canAdvanceRevision — only the permission
 * answers and the revision store are faked — so what's pinned is the wiring:
 * which atom each arm consults, not just that some check happens.
 *
 * Saved groups keep the fixtures env-free; the config/constant adapters differ
 * only in project/environment extraction, which the permission matrices cover.
 */

function makeContext({
  granted = [],
  userId = "u_caller",
  revertTarget = null,
}: {
  granted?: RevisionAction[];
  userId?: string;
  revertTarget?: Record<string, unknown> | null;
}): Context {
  return {
    userId,
    org: { id: "org", settings: {} },
    permissions: {
      canRevisionAction: (_model: string, action: RevisionAction) =>
        granted.includes(action),
      throwPermissionError: () => {
        throw new Error("permission denied");
      },
    },
    models: {
      revisions: {
        getById: jest.fn(async () => revertTarget),
      },
    },
  } as unknown as Context;
}

const SNAPSHOT = {
  id: "grp1",
  projects: [],
  archived: false,
};

function makeRevision(over: Partial<Record<string, unknown>> = {}): Revision {
  return {
    id: "rev1",
    authorId: "author-x",
    status: "draft",
    revertedFrom: undefined,
    target: {
      type: "saved-group",
      id: "grp1",
      snapshot: SNAPSHOT,
      // A plain content edit — not a revert, not an archive.
      proposedChanges: [{ op: "replace", path: "/values", value: ["u9"] }],
    },
    ...over,
  } as unknown as Revision;
}

describe("canAdvanceRevision", () => {
  it("draft authority covers any draft", async () => {
    const context = makeContext({ granted: ["draft"] });
    expect(await canAdvanceRevision(context, makeRevision())).toBe(true);
  });

  it("no authority covers nothing", async () => {
    const context = makeContext({ granted: [] });
    expect(await canAdvanceRevision(context, makeRevision())).toBe(false);
  });

  describe("the author arm", () => {
    it("lets a reverter advance their own draft, whatever it contains", async () => {
      const context = makeContext({ granted: ["revert"], userId: "author-x" });
      expect(await canAdvanceRevision(context, makeRevision())).toBe(true);
    });

    it("does not extend to someone else's mixed draft", async () => {
      const context = makeContext({ granted: ["revert"] });
      expect(await canAdvanceRevision(context, makeRevision())).toBe(false);
    });

    it("never matches on an empty-string id", async () => {
      // API-key contexts have userId "" and an owner-less bootstrap revision
      // can too; a bare equality would call every API key "the author".
      const context = makeContext({ granted: ["revert"], userId: "" });
      expect(
        await canAdvanceRevision(context, makeRevision({ authorId: "" })),
      ).toBe(false);
    });
  });

  describe("the revert arm", () => {
    it("reaches a pure revert of a published revision", async () => {
      const context = makeContext({
        granted: ["revert"],
        revertTarget: {
          id: "rev_target",
          status: "merged",
          target: {
            type: "saved-group",
            id: "grp1",
            // The state this revision left behind when it published.
            snapshot: { ...SNAPSHOT, values: ["old"] },
            proposedChanges: [],
          },
        },
      });
      const draft = makeRevision({
        revertedFrom: "rev_target",
        target: {
          type: "saved-group",
          id: "grp1",
          snapshot: SNAPSHOT,
          // Restores exactly what the target recorded — nothing else.
          proposedChanges: [{ op: "replace", path: "/values", value: ["old"] }],
        },
      });
      expect(await canAdvanceRevision(context, draft)).toBe(true);
    });

    it("does not reach a draft with no revert provenance", async () => {
      const context = makeContext({ granted: ["revert"] });
      expect(await canAdvanceRevision(context, makeRevision())).toBe(false);
    });
  });

  describe("the delete arm", () => {
    const archiveDraft = makeRevision({
      target: {
        type: "saved-group",
        id: "grp1",
        snapshot: SNAPSHOT,
        proposedChanges: [{ op: "replace", path: "/archived", value: true }],
      },
    });

    it("reaches a draft that only archives the entity", async () => {
      // Granting ONLY the delete action pins the atom: were this arm still
      // wired to the adapter's bypass-tier canDelete, it would fail here.
      const context = makeContext({ granted: ["delete"] });
      expect(await canAdvanceRevision(context, archiveDraft)).toBe(true);
    });

    it("does not reach a mixed draft", async () => {
      const context = makeContext({ granted: ["delete"] });
      expect(await canAdvanceRevision(context, makeRevision())).toBe(false);
    });

    it("does not reach a draft that archives AND changes content", async () => {
      // Without the purity check, co-staging an archive op would hand a
      // delete-only role authority over the content riding along with it.
      const context = makeContext({ granted: ["delete"] });
      expect(
        await canAdvanceRevision(
          context,
          makeRevision({
            target: {
              type: "saved-group",
              id: "grp1",
              snapshot: SNAPSHOT,
              proposedChanges: [
                { op: "replace", path: "/archived", value: true },
                { op: "replace", path: "/values", value: ["smuggled"] },
              ],
            },
          }),
        ),
      ).toBe(false);
    });
  });
});

describe("assertCanPublishRevision", () => {
  const archiveOps = [{ op: "replace", path: "/archived", value: true }];

  async function attempt(
    granted: RevisionAction[],
    revision: Revision,
  ): Promise<boolean> {
    const context = makeContext({ granted });
    try {
      await assertCanPublishRevision(context, revision, SNAPSHOT);
      return true;
    } catch {
      return false;
    }
  }

  it("lands an ordinary revision on publish authority", async () => {
    expect(await attempt(["publish"], makeRevision())).toBe(true);
    expect(await attempt([], makeRevision())).toBe(false);
  });

  describe("an archiving revision", () => {
    const archiveRevision = makeRevision({
      target: {
        type: "saved-group",
        id: "grp1",
        snapshot: SNAPSHOT,
        proposedChanges: archiveOps,
      },
    });

    it("lands on delete authority alone — archiving is delete-class", async () => {
      expect(await attempt(["delete"], archiveRevision)).toBe(true);
    });

    it("is refused to a publisher who cannot delete", async () => {
      expect(await attempt(["publish"], archiveRevision)).toBe(false);
    });

    it("does not let delete authority land content riding along", async () => {
      const mixed = makeRevision({
        target: {
          type: "saved-group",
          id: "grp1",
          snapshot: SNAPSHOT,
          proposedChanges: [
            ...archiveOps,
            { op: "replace", path: "/values", value: ["smuggled"] },
          ],
        },
      });
      expect(await attempt(["delete"], mixed)).toBe(false);
      // Publish gets it past the archive gate only alongside delete.
      expect(await attempt(["publish", "delete"], mixed)).toBe(true);
    });
  });
});

describe("canRebaseRevision", () => {
  const updatableFields = new Set(["values", "archived", "description"]);
  const base = { values: ["u1"], description: "d" };

  function attempt({
    granted,
    live,
    revision = makeRevision(),
  }: {
    granted: RevisionAction[];
    live: Record<string, unknown>;
    revision?: Revision;
  }) {
    return canRebaseRevision({
      context: makeContext({ granted }),
      revision,
      baseSnapshot: base,
      liveSnapshot: live,
      updatableFields,
    });
  }

  const archiveDraft = makeRevision({
    target: {
      type: "saved-group",
      id: "grp1",
      snapshot: SNAPSHOT,
      proposedChanges: [{ op: "replace", path: "/archived", value: true }],
    },
  });

  it("draft authority covers a rebase that pulls changes in", async () => {
    expect(
      await attempt({ granted: ["draft"], live: { ...base, values: ["u2"] } }),
    ).toBe(true);
  });

  it("lets a narrow atom re-anchor a draft it could already advance", async () => {
    expect(
      await attempt({
        granted: ["delete"],
        live: base,
        revision: archiveDraft,
      }),
    ).toBe(true);
  });

  it("refuses a narrow atom once the rebase would pull something in", async () => {
    // The whole point: rebasing must not become a way to sweep someone else's
    // change into a draft the thin atom is allowed to land.
    expect(
      await attempt({
        granted: ["delete"],
        live: { ...base, values: ["someone else"] },
        revision: archiveDraft,
      }),
    ).toBe(false);
  });

  it("notices a live change in a field the draft never touches", async () => {
    // checkMergeConflicts would report neither a conflict nor a changed field
    // here, yet the rebase adopts `description` from live.
    expect(
      await attempt({
        granted: ["delete"],
        live: { ...base, description: "edited by someone else" },
        revision: archiveDraft,
      }),
    ).toBe(false);
  });

  it("refuses a narrow atom over a draft it could not advance anyway", async () => {
    expect(await attempt({ granted: ["delete"], live: base })).toBe(false);
  });

  it("treats absent and null as the same value", async () => {
    expect(
      await attempt({
        granted: ["delete"],
        live: { ...base, archived: null },
        revision: archiveDraft,
      }),
    ).toBe(true);
  });
});

/**
 * The model-layer backstop behind the per-action gates. It is deliberately the
 * union of every action, because a revision document is written by drafting,
 * reviewing, reverting, publishing and archiving alike and the model cannot see
 * which one it is.
 *
 * Delete was missing from that union, so staging an archive as a draft — which the
 * handler allows on the delete atom alone, since archiving is delete-class — passed
 * the handler and then failed underneath it. Two layers, two answers, for one
 * request.
 */
describe("canTouchRevision", () => {
  const holders: RevisionAction[] = [
    "draft",
    "review",
    "revert",
    "publish",
    "delete",
  ];

  it.each(holders)("admits a caller holding only %s", (action) => {
    expect(
      canTouchRevision("saved-group", makeContext({ granted: [action] }), {
        projects: [],
      }),
    ).toBe(true);
  });

  it("refuses a caller holding none of them", () => {
    expect(
      canTouchRevision("saved-group", makeContext({ granted: [] }), {
        projects: [],
      }),
    ).toBe(false);
  });

  // The regression this closes, stated end to end: the handler admits a
  // delete-only caller staging a pure archive, so the backstop must too.
  it("agrees with the handler about a delete-only archive staging", () => {
    const context = makeContext({ granted: ["delete"] });
    const stagingAllowed = canStageArchiveDraft({
      permissions: context.permissions,
      model: "saved-group",
      entity: { projects: [] },
      archived: true,
    });
    expect(stagingAllowed).toBe(true);
    expect(canTouchRevision("saved-group", context, { projects: [] })).toBe(
      stagingAllowed,
    );
  });

  // The delete arm is directional. Returning an entity to service is publish-class
  // both here and at `canLandArchivedState`, so a delete-only caller staging an
  // UNARCHIVE was staging a draft it could never land.
  it.each([
    ["archiving", true, true],
    ["unarchiving", false, false],
  ])("delete-only staging, %s", (_label, archived, expected) => {
    expect(
      canStageArchiveDraft({
        permissions: makeContext({ granted: ["delete"] }).permissions,
        model: "saved-group",
        entity: { projects: [] },
        archived,
      }),
    ).toBe(expected);
  });

  it.each([true, false])(
    "draft authority stages either direction (archived=%s)",
    (archived) => {
      expect(
        canStageArchiveDraft({
          permissions: makeContext({ granted: ["draft"] }).permissions,
          model: "saved-group",
          entity: { projects: [] },
          archived,
        }),
      ).toBe(true);
    },
  );
});

/**
 * Author separation across the identityless boundary.
 *
 * Two questions look like one. "Is this caller provably the author?" grants rights
 * (discard, edit your own draft) and must be NO when nobody can be identified.
 * "Could this caller be the author?" withholds one — the review — and must be YES for
 * the same reason. Answering both with `isRevisionAuthor` let an org-scoped API key
 * with draft and review open a revision and approve it.
 */
describe("mayBeRevisionAuthor", () => {
  it.each([
    ["a user reviewing their own draft", "u_1", "u_1", true],
    ["a user reviewing someone else's", "u_1", "u_2", false],
    // Both identityless: two org API keys are indistinguishable, so the review is
    // refused rather than assumed to be a different key.
    ["an org key on an authorless revision", "", "", true],
    [undefined, undefined, undefined, true],
    // A named author is definitively not this key.
    ["an org key on a user's revision", "u_1", "", false],
    ["a user on an authorless revision", "", "u_1", false],
  ])("%s", (_label, authorId, userId, expected) => {
    expect(mayBeRevisionAuthor(authorId, userId)).toBe(expected);
  });

  // The grant direction keeps its old answer — widening it would hand every org key
  // authorship of every authorless revision, which is the bug in the other direction.
  it("does not grant authorship to an identityless caller", () => {
    expect(isRevisionAuthor("", "")).toBe(false);
    expect(isRevisionAuthor(undefined, undefined)).toBe(false);
  });
});

/**
 * Discarding is narrower than advancing.
 *
 * `canAdvanceRevision` lets a narrow atom act on a draft that only does what the atom
 * covers, so a delete-only role could discard ANY pure-archive draft — another
 * author's, and one already in review. Moving your own work along and destroying
 * someone else's are different questions.
 */
describe("canDiscardRevision", () => {
  const archiveDraft = (authorId: string) =>
    ({
      authorId,
      target: {
        type: "saved-group",
        snapshot: { projects: [] },
        proposedChanges: [{ op: "replace", path: "/archived", value: true }],
      },
    }) as unknown as Revision;

  it("admits draft authority over anyone's draft", async () => {
    const context = makeContext({ granted: ["draft"], userId: "u_1" });
    expect(await canDiscardRevision(context, archiveDraft("u_2"))).toBe(true);
  });

  it("admits the author of the draft", async () => {
    const context = makeContext({ granted: [], userId: "u_1" });
    expect(await canDiscardRevision(context, archiveDraft("u_1"))).toBe(true);
  });

  // The case this exists for: a qa-style delete-only role could throw away another
  // author's archive draft, which `canAdvanceRevision` still allows.
  it("refuses a delete-only role on someone else's archive draft", async () => {
    const context = makeContext({ granted: ["delete"], userId: "u_1" });
    const draft = archiveDraft("u_2");
    expect(await canDiscardRevision(context, draft)).toBe(false);
    expect(await canAdvanceRevision(context, draft)).toBe(true);
  });

  it("refuses an identityless caller on an authorless draft", async () => {
    const context = makeContext({ granted: ["delete"], userId: "" });
    expect(await canDiscardRevision(context, archiveDraft(""))).toBe(false);
  });
});
