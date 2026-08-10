jest.mock("back-end/src/revisions/landingSequence", () => ({
  assertLandingBaseline: jest.fn(),
  // The POST-write half of the order. Distinct from the pre-check above: this one
  // catches a newer revision that claimed the merge after that check, whose claim
  // never touches the entity and so slips past the entity guard.
  assertLandingStillOwned: jest.fn(),
  tryRestoreEntityPreImage: jest.fn(),
  // The post-failure ownership baseline; a null would make compensation refuse
  // to guess, so tests that exercise the restore path get a persisted-doc
  // stand-in by default.
  capturePostFailureSnapshot: jest.fn(async () => ({ id: "ent_1" })),
  // Passthrough: these tests assert the landing's ordering, not the refresh
  // batching — that behavior is covered where the buffer is implemented.
  withBufferedPayloadRefreshes: jest.fn((_ctx, _event, fn) => fn()),
  // A stand-in class: landDirectChange discriminates CAS losses with
  // instanceof against the class it imports from THIS module, so any class
  // exported here is the identity that check sees.
  LandingConflictError: class LandingConflictError extends Error {},
}));
jest.mock("back-end/src/revisions/revisionActions", () => ({
  // The self-gate landDirectChange runs before recording anything; these tests
  // pin the landing's ORDERING, and authority has its own suites (the matrix +
  // engine-gate pins).
  assertCanPublishRevision: jest.fn(),
}));
jest.mock("back-end/src/revisions", () => ({
  getAdapter: () => ({ applyChanges: jest.fn() }),
}));

import {
  assertLandingBaseline as assertLandingBaselineImpl,
  assertLandingStillOwned as assertLandingStillOwnedImpl,
  LandingConflictError,
  tryRestoreEntityPreImage as tryRestoreEntityPreImageImpl,
} from "back-end/src/revisions/landingSequence";
import { landDirectChange } from "back-end/src/revisions/revertActions";
import { Context } from "back-end/src/models/BaseModel";
import { ConflictError } from "back-end/src/util/errors";

const assertLandingBaseline = assertLandingBaselineImpl as jest.Mock;
const tryRestoreEntityPreImage = tryRestoreEntityPreImageImpl as jest.Mock;
const assertLandingStillOwned = assertLandingStillOwnedImpl as jest.Mock;

/**
 * The order a direct landing writes in, which is the whole of its safety:
 *
 *  1. baseline checked BEFORE history is recorded, so a stale read never becomes
 *     history at all;
 *  2. baseline and "still the newest merge" re-checked once this landing has its
 *     place in the order, immediately before the entity write;
 *  3. on failure, live is put back FIRST and the merged revision is removed only
 *     once that succeeded — an unrecorded partial change is the one outcome no
 *     retry can repair, so when the restore fails the history is kept as the
 *     record of what actually happened.
 */

const entity = {
  id: "const_1",
  value: "before",
  dateUpdated: new Date("2026-01-01T00:00:00Z"),
};

function makeContext() {
  const createMerged = jest.fn().mockResolvedValue({ id: "rev_mine" });
  const dangerousDeleteByIdBypassPermission = jest.fn().mockResolvedValue({});
  const deleteById = jest.fn().mockResolvedValue({});
  return {
    calls: [] as string[],
    context: {
      models: {
        revisions: {
          createMerged,
          dangerousDeleteByIdBypassPermission,
          deleteById,
        },
      },
    } as unknown as Context,
    createMerged,
    dangerousDeleteByIdBypassPermission,
    deleteById,
  };
}

beforeEach(() => {
  assertLandingBaseline.mockReset().mockResolvedValue(undefined);
  tryRestoreEntityPreImage.mockReset().mockResolvedValue(true);
});

describe("landDirectChange", () => {
  it("checks the baseline before recording history, and again before writing", async () => {
    const h = makeContext();
    const order: string[] = [];
    assertLandingBaseline.mockImplementation(async (args) => {
      order.push(args.requireLatestMergedId ? "recheck" : "baseline");
    });
    h.createMerged.mockImplementation(async () => {
      order.push("history");
      return { id: "rev_mine" };
    });

    await landDirectChange({
      context: h.context,
      entityType: "constant",
      entity,
      patchOps: [],
      bypass: true,
      write: async () => {
        order.push("write");
        return "ok";
      },
    });

    expect(order).toEqual(["baseline", "history", "recheck", "write"]);
  });

  it("re-checks against its own merged revision, not just the entity", async () => {
    const h = makeContext();
    await landDirectChange({
      context: h.context,
      entityType: "constant",
      entity,
      patchOps: [],
      bypass: true,
      write: async () => "ok",
    });

    expect(assertLandingBaseline).toHaveBeenLastCalledWith(
      expect.objectContaining({ requireLatestMergedId: "rev_mine" }),
    );
  });

  it("fences the order AFTER the write, not only before it", async () => {
    // The pre-check establishes the order; a newer revision can still claim the
    // merge in the window between it and the entity write, and that claim never
    // touches the entity — so the entity guard passes and this landing writes older
    // state under newer history. Only a post-write re-ask sees it.
    const h = makeContext();
    await landDirectChange({
      context: h.context,
      entityType: "constant",
      entity,
      patchOps: [],
      bypass: true,
      write: async () => "ok",
    });

    expect(assertLandingStillOwned).toHaveBeenCalledWith(
      expect.objectContaining({ mergedId: "rev_mine" }),
    );
  });

  it("compensates when the post-write fence refuses", async () => {
    // Losing here means we have ALREADY written, so the refusal has to reach the
    // caller's compensation rather than being swallowed — that is what makes the
    // race recoverable instead of merely detected.
    const h = makeContext();
    assertLandingStillOwned.mockRejectedValueOnce(
      new ConflictError("superseded"),
    );

    await expect(
      landDirectChange({
        context: h.context,
        entityType: "constant",
        entity,
        patchOps: [],
        bypass: true,
        write: async () => "ok",
      }),
    ).rejects.toThrow(/superseded/i);
  });

  it("records nothing when the baseline check refuses up front", async () => {
    const h = makeContext();
    const write = jest.fn();
    assertLandingBaseline.mockRejectedValueOnce(
      new ConflictError("entity moved"),
    );

    await expect(
      landDirectChange({
        context: h.context,
        entityType: "constant",
        entity,
        patchOps: [],
        bypass: true,
        write,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(h.createMerged).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("removes its history when superseded between recording and writing", async () => {
    const h = makeContext();
    const write = jest.fn();
    assertLandingBaseline
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ConflictError("superseded"));

    await expect(
      landDirectChange({
        context: h.context,
        entityType: "constant",
        entity,
        patchOps: [],
        bypass: true,
        write,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(write).not.toHaveBeenCalled();
    expect(h.dangerousDeleteByIdBypassPermission).toHaveBeenCalledWith(
      "rev_mine",
    );
  });

  it("restores live before removing history when the write fails", async () => {
    const h = makeContext();
    const order: string[] = [];
    tryRestoreEntityPreImage.mockImplementation(async () => {
      order.push("restore");
      return true;
    });
    h.dangerousDeleteByIdBypassPermission.mockImplementation(async () => {
      order.push("remove-history");
      return {};
    });

    await expect(
      landDirectChange({
        context: h.context,
        entityType: "constant",
        entity,
        patchOps: [],
        bypass: true,
        changes: { value: "after" },
        // Reports its entity write, then fails in a later step — the shape a
        // Config root-plus-cascade apply has, and the case compensation is for.
        write: async (report) => {
          report({ id: "ent_1", value: "after" });
          throw new Error("cascade failed");
        },
      }),
    ).rejects.toThrow("cascade failed");

    expect(order).toEqual(["restore", "remove-history"]);
    expect(tryRestoreEntityPreImage).toHaveBeenCalledWith(
      expect.objectContaining({
        preImage: entity,
        // What the write REPORTED persisting, not the caller's intent: adapters
        // and model hooks normalize, so ownership is judged against what
        // actually landed on the doc.
        written: { id: "ent_1", value: "after" },
        persistedKeys: ["value"],
      }),
    );
  });

  // The rule that matters most: a live entity left mid-change must stay
  // discoverable. Deleting the revision would erase the only record of it.
  it("keeps its history when live cannot be restored", async () => {
    const h = makeContext();
    tryRestoreEntityPreImage.mockResolvedValue(false);

    await expect(
      landDirectChange({
        context: h.context,
        entityType: "constant",
        entity,
        patchOps: [],
        bypass: true,
        changes: { value: "after" },
        // Reports its entity write, then fails in a later step — the shape a
        // Config root-plus-cascade apply has, and the case compensation is for.
        write: async (report) => {
          report({ id: "ent_1", value: "after" });
          throw new Error("cascade failed");
        },
      }),
    ).rejects.toThrow("cascade failed");

    expect(h.dangerousDeleteByIdBypassPermission).not.toHaveBeenCalled();
  });

  // Removing the revision is implied by the landing the caller was already
  // authorized for. Routing it through the permission-checked delete let a
  // revert-only API key strand phantom merged history it could not clean up.
  it("removes history without re-asking for delete permission", async () => {
    const h = makeContext();

    await expect(
      landDirectChange({
        context: h.context,
        entityType: "constant",
        entity,
        patchOps: [],
        bypass: true,
        changes: { value: "after" },
        write: async (report) => {
          report({ id: "ent_1", value: "after" });
          throw new Error("write failed");
        },
      }),
    ).rejects.toThrow("write failed");

    expect(h.deleteById).not.toHaveBeenCalled();
    expect(h.dangerousDeleteByIdBypassPermission).toHaveBeenCalledWith(
      "rev_mine",
    );
  });

  it("skips compensation for a write with nothing to put back", async () => {
    const h = makeContext();

    await expect(
      landDirectChange({
        context: h.context,
        entityType: "constant",
        entity,
        patchOps: [],
        bypass: true,
        write: async () => {
          throw new Error("write failed");
        },
      }),
    ).rejects.toThrow("write failed");

    // No `changes` means a single-document write: nothing partial to restore, so
    // the history is removed directly.
    expect(tryRestoreEntityPreImage).not.toHaveBeenCalled();
    expect(h.dangerousDeleteByIdBypassPermission).toHaveBeenCalledWith(
      "rev_mine",
    );
  });

  it("surfaces the original failure, not a compensation failure", async () => {
    const h = makeContext();
    h.dangerousDeleteByIdBypassPermission.mockRejectedValue(
      new Error("history removal failed"),
    );

    await expect(
      landDirectChange({
        context: h.context,
        entityType: "constant",
        entity,
        patchOps: [],
        bypass: true,
        write: async () => {
          throw new Error("the real failure");
        },
      }),
    ).rejects.toThrow("the real failure");
  });
  // The dependent-cascade re-run lives inside the shared restore now (the
  // adapter's afterRestorePreImage) — at this level the contract is: history is
  // dropped only when that restore reports CLEAN, and kept when it does not.
  it("keeps its history when the restore reports unclean", async () => {
    const h = makeContext();
    tryRestoreEntityPreImage.mockResolvedValueOnce(false);

    await expect(
      landDirectChange({
        context: h.context,
        entityType: "config",
        entity,
        patchOps: [],
        bypass: true,
        changes: { value: "after" },
        // Reports its entity write, then fails in a later step — the shape a
        // Config root-plus-cascade apply has, and the case compensation is for.
        write: async (report) => {
          report({ id: "ent_1", value: "after" });
          throw new Error("cascade failed");
        },
      }),
    ).rejects.toThrow("cascade failed");

    expect(tryRestoreEntityPreImage).toHaveBeenCalled();
    expect(h.dangerousDeleteByIdBypassPermission).not.toHaveBeenCalled();
  });

  // The report fires from inside the document write, before audit and the
  // afterUpdate hooks — so no report means the write truly did not land, never
  // "landed but unreported" (which would leave a live change with no record).
  it("removes its history when a write with changes reports nothing", async () => {
    const h = makeContext();

    await expect(
      landDirectChange({
        context: h.context,
        entityType: "config",
        entity,
        patchOps: [],
        bypass: true,
        changes: { value: "after" },
        // Never calls `report` — the un-instrumented shape.
        write: async () => {
          throw new Error("cascade failed");
        },
      }),
    ).rejects.toThrow("cascade failed");

    // Nothing to restore, and the merged revision is phantom history — a record
    // of a landing that wrote nothing must not survive. Same reading as bulk and
    // the generic publish.
    expect(tryRestoreEntityPreImage).not.toHaveBeenCalled();
    expect(h.dangerousDeleteByIdBypassPermission).toHaveBeenCalled();
  });

  // `cascade` has to be read at compensation time, not at call time: the apply
  // reports its root write BEFORE running the cascade, so a value captured in
  // the reporter is still empty and compensation would silently skip descendants.
  it("sees cascade entries appended AFTER the write reported", async () => {
    const h = makeContext();
    // The adapter's own array: created before the write, handed over at report
    // time, appended to as the cascade proceeds.
    const adapterCascade: {
      before: Record<string, unknown> & { id: string };
      written: Record<string, unknown>;
    }[] = [];

    await expect(
      landDirectChange({
        context: h.context,
        entityType: "config",
        entity,
        patchOps: [],
        bypass: true,
        changes: { value: "after" },
        cascade: () => adapterCascade,
        write: async (report) => {
          report({ id: "ent_1", value: "after" });
          // Only now does the cascade run and record a descendant write.
          adapterCascade.push({
            before: { id: "desc_1", schema: "before" },
            written: { schema: "after" },
          });
          throw new Error("cascade failed");
        },
      }),
    ).rejects.toThrow("cascade failed");

    // Compensation restored the DESCENDANT, which only happens if the thunk's
    // result is iterated late — an early copy misses the later pushes.
    expect(tryRestoreEntityPreImage).toHaveBeenCalledWith(
      expect.objectContaining({
        preImage: { id: "desc_1", schema: "before" },
        persistedKeys: ["schema"],
      }),
    );
  });

  // Ordering, at this level: the ROOT goes back before the descendant. Restoring a
  // descendant while the root still declares a field is normalized straight back to
  // stripped AND reports success, so the wrong order is silent.
  it("restores the root before any cascade entry", async () => {
    const h = makeContext();
    const order: string[] = [];
    tryRestoreEntityPreImage.mockImplementation(async (args) => {
      order.push((args.preImage as { id: string }).id);
      return true;
    });

    await expect(
      landDirectChange({
        context: h.context,
        entityType: "config",
        entity,
        patchOps: [],
        bypass: true,
        changes: { value: "after" },
        cascade: () => [
          { before: { id: "desc_1" }, written: { schema: "after" } },
        ],
        write: async (report) => {
          report({ id: "ent_1", value: "after" });
          throw new Error("cascade failed");
        },
      }),
    ).rejects.toThrow("cascade failed");

    expect(order).toEqual(["const_1", "desc_1"]);
  });

  // A rejected CAS means the guarded write matched NOTHING: compensating would
  // compare live against values this landing never wrote, mistake a concurrent
  // winner's identical values for its own, and undo the winner. History is still
  // removed — a record of a landing that wrote nothing must not survive.
  it("never compensates a landing that lost its CAS race", async () => {
    const h = makeContext();

    await expect(
      landDirectChange({
        context: h.context,
        entityType: "constant",
        entity,
        patchOps: [],
        bypass: true,
        changes: { value: "after" },
        write: async () => {
          throw new LandingConflictError("constant", entity.id);
        },
      }),
    ).rejects.toBeInstanceOf(LandingConflictError);

    expect(tryRestoreEntityPreImage).not.toHaveBeenCalled();
    expect(h.dangerousDeleteByIdBypassPermission).toHaveBeenCalled();
  });

  // Compensation decides ownership by comparing live to what THIS landing meant to
  // write. After a pre-write refusal it never wrote, so a concurrent landing that
  // happens to hold the same value would be mistaken for ours and undone.
  it("never compensates a write it did not start", async () => {
    const h = makeContext();
    assertLandingBaseline
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ConflictError("superseded"));

    await expect(
      landDirectChange({
        context: h.context,
        entityType: "constant",
        entity,
        patchOps: [],
        bypass: true,
        changes: { value: "after" },
        write: jest.fn(),
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(tryRestoreEntityPreImage).not.toHaveBeenCalled();
  });
});
