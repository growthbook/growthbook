import { ConflictError } from "back-end/src/util/errors";

const getById = jest.fn();
const applyChanges = jest.fn();
const afterRestorePreImage = jest.fn();

jest.mock("back-end/src/revisions", () => ({
  getAdapter: () => ({
    getModel: () => ({ getById }),
    applyChanges,
    afterRestorePreImage,
  }),
}));

import {
  assertLandingBaseline,
  liveMatchesDesiredState,
  restoreEntityPreImage,
  tryRestoreEntityPreImage,
} from "back-end/src/revisions/landingSequence";
import { CasConflictError, Context } from "back-end/src/models/BaseModel";

/**
 * The write sequencing every landing shares. It had no coverage at all, which is
 * how four concurrency findings arrived by code reading rather than by a failing
 * test — so the ordering rules are pinned here as executable statements:
 *
 *  - a landing computed against a stale read must not write;
 *  - a landing superseded by a newer merged revision must not write;
 *  - a failed write must put live back before its history is removed, and must
 *    KEEP that history when it cannot.
 */

const BASE = new Date("2026-01-01T00:00:00Z");

function contextWithLatestMerged(latestId: string | null): Context {
  return {
    models: {
      revisions: {
        getLatestMergedByTarget: jest
          .fn()
          .mockResolvedValue(latestId ? { id: latestId } : null),
      },
    },
  } as unknown as Context;
}

beforeEach(() => {
  getById.mockReset();
  applyChanges.mockReset();
  afterRestorePreImage.mockReset();
});

describe("assertLandingBaseline", () => {
  const args = {
    entityType: "constant" as const,
    entityId: "const_1",
    baselineDateUpdated: BASE,
  };

  it("passes when the entity is still where the change was computed from", async () => {
    getById.mockResolvedValue({ id: "const_1", dateUpdated: new Date(BASE) });
    await expect(
      assertLandingBaseline({
        ...args,
        context: contextWithLatestMerged(null),
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses when the entity moved under the change", async () => {
    getById.mockResolvedValue({
      id: "const_1",
      dateUpdated: new Date("2026-01-02T00:00:00Z"),
    });
    await expect(
      assertLandingBaseline({
        ...args,
        context: contextWithLatestMerged(null),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses when the entity is gone", async () => {
    getById.mockResolvedValue(null);
    await expect(
      assertLandingBaseline({
        ...args,
        context: contextWithLatestMerged(null),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  // An entity that has never been written carries no dateUpdated; absent must
  // compare equal to absent rather than reading as drift.
  it("treats an absent timestamp on both sides as unchanged", async () => {
    getById.mockResolvedValue({ id: "const_1" });
    await expect(
      assertLandingBaseline({
        ...args,
        baselineDateUpdated: null,
        context: contextWithLatestMerged(null),
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses when a newer merged revision has superseded this landing", async () => {
    getById.mockResolvedValue({ id: "const_1", dateUpdated: new Date(BASE) });
    await expect(
      assertLandingBaseline({
        ...args,
        context: contextWithLatestMerged("rev_newer"),
        requireLatestMergedId: "rev_mine",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("passes when this landing's own revision is still the newest", async () => {
    getById.mockResolvedValue({ id: "const_1", dateUpdated: new Date(BASE) });
    await expect(
      assertLandingBaseline({
        ...args,
        context: contextWithLatestMerged("rev_mine"),
        requireLatestMergedId: "rev_mine",
      }),
    ).resolves.toBeUndefined();
  });

  // This case used to assert that a NULL latest passes, which is exactly backwards.
  // Both callers that supply `requireLatestMergedId` are holding a revision that is
  // already merged — `landDirectChange` after `createMerged`, and the stranded-merge
  // recovery — so the query must find at least that row. Null means it is GONE, and
  // reading that as "no competing merge" let the entity write land with no history
  // recording it.
  it("refuses when the merged revision it requires has vanished", async () => {
    getById.mockResolvedValue({ id: "const_1", dateUpdated: new Date(BASE) });
    await expect(
      assertLandingBaseline({
        ...args,
        context: contextWithLatestMerged(null),
        requireLatestMergedId: "rev_mine",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("restoreEntityPreImage", () => {
  const context = {} as Context;
  const preImage = { id: "const_1", value: "before", name: "Original" };

  it("restores a key the failed apply still owns", async () => {
    // Live holds what the apply wrote, so the apply is the last writer.
    getById.mockResolvedValue({ id: "const_1", value: "after" });
    applyChanges.mockResolvedValue({ persistedKeys: ["value"], written: {} });

    await restoreEntityPreImage({
      context,
      entityType: "constant",
      preImage,
      persistedKeys: ["value"],
      written: { value: "after" },
    });

    expect(applyChanges).toHaveBeenCalledWith(
      context,
      expect.anything(),
      { value: "before" },
      // Guarded: the restore is itself a read-decide-write, so an unguarded
      // write could replace a newer landing arriving after the ownership read.
      { isRevert: true, guarded: true },
    );
  });

  it("re-runs the adapter's cascade with the keys it restored", async () => {
    getById.mockResolvedValue({ id: "const_1", value: "after" });
    applyChanges.mockResolvedValue({ persistedKeys: ["value"], written: {} });

    await restoreEntityPreImage({
      context,
      entityType: "constant",
      preImage,
      persistedKeys: ["value"],
      written: { value: "after" },
    });

    // Dependents the failed cascade touched answer to the restored root — the
    // adapter decides from the restored keys whether its cascade must re-run. The
    // No reporter: the repair cascade's own writes are deliberately not rolled
    // back, because ancestor normalization would strip them straight back — see
    // `restoreEntityPreImage` for why that machinery came out again.
    expect(afterRestorePreImage).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ id: "const_1" }),
      ["value"],
    );
  });

  it("skips the cascade when nothing was ours to restore", async () => {
    // A later writer owns the key: the restore is a no-op, and re-running the
    // cascade would act on state the rival's own apply already reconciled.
    getById.mockResolvedValue({ id: "const_1", value: "someone-elses" });

    await restoreEntityPreImage({
      context,
      entityType: "constant",
      preImage,
      persistedKeys: ["value"],
      written: { value: "after" },
    });

    expect(afterRestorePreImage).not.toHaveBeenCalled();
  });

  it("re-decides ownership and retries when the restore loses its race", async () => {
    getById
      .mockResolvedValueOnce({ id: "const_1", value: "after" })
      // The re-read after the CAS loss: a rival now owns the key.
      .mockResolvedValueOnce({ id: "const_1", value: "someone-elses" });
    applyChanges.mockRejectedValueOnce(new CasConflictError());

    await restoreEntityPreImage({
      context,
      entityType: "constant",
      preImage: { id: "const_1", value: "before" },
      persistedKeys: ["value"],
      written: { value: "after" },
    });

    // Second attempt saw the rival's value, so nothing was ours to restore —
    // one guarded attempt, then a clean no-op.
    expect(applyChanges).toHaveBeenCalledTimes(1);
  });

  it("leaves a key a later writer has since changed", async () => {
    // Someone else wrote after us; their value is newer intent, not ours to undo.
    getById.mockResolvedValue({ id: "const_1", value: "someone-elses" });
    applyChanges.mockResolvedValue({ persistedKeys: [], written: {} });

    await restoreEntityPreImage({
      context,
      entityType: "constant",
      preImage,
      persistedKeys: ["value"],
      written: { value: "after" },
    });

    expect(applyChanges).not.toHaveBeenCalled();
  });

  it("fails loudly when the restore write drops a field", async () => {
    getById.mockResolvedValue({ id: "const_1", value: "after" });
    // Normalization swallowed the field: reported as persisting nothing.
    applyChanges.mockResolvedValue({ persistedKeys: [], written: {} });

    await expect(
      restoreEntityPreImage({
        context,
        entityType: "constant",
        preImage,
        persistedKeys: ["value"],
        written: { value: "after" },
      }),
    ).rejects.toThrow(/restore dropped field/);
  });

  it("fails when the entity no longer exists to restore onto", async () => {
    getById.mockResolvedValue(null);
    await expect(
      restoreEntityPreImage({
        context,
        entityType: "constant",
        preImage,
        persistedKeys: ["value"],
        written: { value: "after" },
      }),
    ).rejects.toThrow(/no longer exists/);
  });

  // The caller has to distinguish "live is clean" from "live is stuck", because
  // that decides whether the merged revision may be removed.
  it("reports failure rather than throwing, in its best-effort form", async () => {
    getById.mockResolvedValue(null);
    await expect(
      tryRestoreEntityPreImage({
        context,
        entityType: "constant",
        preImage,
        persistedKeys: ["value"],
        written: { value: "after" },
      }),
    ).resolves.toBe(false);

    getById.mockResolvedValue({ id: "const_1", value: "after" });
    applyChanges.mockResolvedValue({ persistedKeys: ["value"], written: {} });
    await expect(
      tryRestoreEntityPreImage({
        context,
        entityType: "constant",
        preImage,
        persistedKeys: ["value"],
        written: { value: "after" },
      }),
    ).resolves.toBe(true);
  });
});

describe("liveMatchesDesiredState", () => {
  const updatableFields = new Set(["value", "name"]);

  it("is true when every updatable field already holds the desired value", () => {
    expect(
      liveMatchesDesiredState({
        live: { value: "x", name: "n", dateUpdated: BASE },
        desiredState: { value: "x", name: "n" },
        updatableFields,
      }),
    ).toBe(true);
  });

  it("is false when one differs", () => {
    expect(
      liveMatchesDesiredState({
        live: { value: "x", name: "other" },
        desiredState: { value: "x", name: "n" },
        updatableFields,
      }),
    ).toBe(false);
  });

  // A merge drops ops for fields it can't write, so they must not decide whether
  // the change landed.
  it("ignores fields the merge cannot write", () => {
    expect(
      liveMatchesDesiredState({
        live: { value: "x" },
        desiredState: { value: "x", organization: "org_other" },
        updatableFields,
      }),
    ).toBe(true);
  });

  it("is false when the entity is missing", () => {
    expect(
      liveMatchesDesiredState({
        live: null,
        desiredState: { value: "x" },
        updatableFields,
      }),
    ).toBe(false);
  });
});
