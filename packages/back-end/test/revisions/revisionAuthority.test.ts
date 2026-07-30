import type { Revision } from "shared/enterprise";
import type { RevisionAction } from "shared/permissions";
import type { Context } from "back-end/src/models/BaseModel";
import {
  canAdvanceRevision,
  canRebaseRevision,
} from "back-end/src/revisions/revisionAuthority";
import { assertCanPublishRevision } from "back-end/src/revisions/revisionActions";

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
