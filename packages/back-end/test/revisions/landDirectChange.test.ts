jest.mock("back-end/src/revisions/landingSequence", () => ({
  assertLandingBaseline: jest.fn(),
  tryRestoreEntityPreImage: jest.fn(),
  // Passthrough: these tests assert the landing's ordering, not the refresh
  // batching — that behavior is covered where the buffer is implemented.
  withBufferedPayloadRefreshes: jest.fn((_ctx, _event, fn) => fn()),
}));
jest.mock("back-end/src/revisions", () => ({
  getAdapter: () => ({ applyChanges: jest.fn() }),
}));

import {
  assertLandingBaseline as assertLandingBaselineImpl,
  tryRestoreEntityPreImage as tryRestoreEntityPreImageImpl,
} from "back-end/src/revisions/landingSequence";
import { landDirectChange } from "back-end/src/revisions/revertActions";
import { Context } from "back-end/src/models/BaseModel";
import { ConflictError } from "back-end/src/util/errors";

const assertLandingBaseline = assertLandingBaselineImpl as jest.Mock;
const tryRestoreEntityPreImage = tryRestoreEntityPreImageImpl as jest.Mock;

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
 *
 * Each of those was a finding. They are ordering properties, invisible to a test
 * that only checks the happy path.
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
        write: async () => {
          throw new Error("cascade failed");
        },
      }),
    ).rejects.toThrow("cascade failed");

    expect(order).toEqual(["restore", "remove-history"]);
    expect(tryRestoreEntityPreImage).toHaveBeenCalledWith(
      expect.objectContaining({
        preImage: entity,
        written: { value: "after" },
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
        write: async () => {
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
        write: async () => {
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
  it("re-reconciles what the write cascaded to, after restoring the entity", async () => {
    const h = makeContext();
    const order: string[] = [];
    tryRestoreEntityPreImage.mockImplementation(async () => {
      order.push("restore");
      return true;
    });
    const afterRestore = jest.fn(async () => {
      order.push("re-reconcile");
    });
    h.dangerousDeleteByIdBypassPermission.mockImplementation(async () => {
      order.push("remove-history");
      return {};
    });

    await expect(
      landDirectChange({
        context: h.context,
        entityType: "config",
        entity,
        patchOps: [],
        bypass: true,
        changes: { value: "after" },
        afterRestore,
        write: async () => {
          throw new Error("cascade failed");
        },
      }),
    ).rejects.toThrow("cascade failed");

    // Dependents are brought back in line BEFORE the history is dropped, since a
    // failure to do so means live is still mid-change.
    expect(order).toEqual(["restore", "re-reconcile", "remove-history"]);
  });

  it("keeps its history when the dependents cannot be re-reconciled", async () => {
    const h = makeContext();

    await expect(
      landDirectChange({
        context: h.context,
        entityType: "config",
        entity,
        patchOps: [],
        bypass: true,
        changes: { value: "after" },
        afterRestore: async () => {
          throw new Error("reconcile failed");
        },
        write: async () => {
          throw new Error("cascade failed");
        },
      }),
    ).rejects.toThrow("cascade failed");

    expect(h.dangerousDeleteByIdBypassPermission).not.toHaveBeenCalled();
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
        afterRestore: async () => undefined,
        write: jest.fn(),
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(tryRestoreEntityPreImage).not.toHaveBeenCalled();
  });
});
