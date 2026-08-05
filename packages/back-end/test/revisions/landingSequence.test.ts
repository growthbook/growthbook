import { ConflictError } from "back-end/src/util/errors";

const getById = jest.fn();
const applyChanges = jest.fn();

jest.mock("back-end/src/revisions", () => ({
  getAdapter: () => ({
    getModel: () => ({ getById }),
    applyChanges,
  }),
}));

import {
  assertLandingBaseline,
  liveMatchesDesiredState,
  restoreEntityPreImage,
  tryRestoreEntityPreImage,
} from "back-end/src/revisions/landingSequence";
import { Context } from "back-end/src/models/BaseModel";

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

  it("passes when nothing has been merged for the target yet", async () => {
    getById.mockResolvedValue({ id: "const_1", dateUpdated: new Date(BASE) });
    await expect(
      assertLandingBaseline({
        ...args,
        context: contextWithLatestMerged(null),
        requireLatestMergedId: "rev_mine",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("restoreEntityPreImage", () => {
  const context = {} as Context;
  const preImage = { id: "const_1", value: "before", name: "Original" };

  it("restores a key the failed apply still owns", async () => {
    // Live holds what the apply wrote, so the apply is the last writer.
    getById.mockResolvedValue({ id: "const_1", value: "after" });
    applyChanges.mockResolvedValue(["value"]);

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
      { isRevert: true },
    );
  });

  it("leaves a key a later writer has since changed", async () => {
    // Someone else wrote after us; their value is newer intent, not ours to undo.
    getById.mockResolvedValue({ id: "const_1", value: "someone-elses" });
    applyChanges.mockResolvedValue([]);

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
    applyChanges.mockResolvedValue([]);

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
    applyChanges.mockResolvedValue(["value"]);
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
