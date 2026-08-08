// The ADAPTER is faked, not the landing module — so the real restore and the real
// ordering both run, and only the writes are stand-ins. Mocking landingSequence
// partially instead hits a circular initialization of LandingConflictError.
const restoredIds: string[] = [];
const failFor = new Set<string>();

jest.mock("back-end/src/revisions", () => ({
  getAdapter: () => ({
    getModel: () => ({
      // Live equals what the landing wrote, so `ownedRestoreValues` judges every
      // key as ours and the restore is actually attempted.
      getById: async (id: string) => ({ id, schema: writtenFor(id) }),
    }),
    applyChanges: async (
      _ctx: unknown,
      current: { id: string },
      values: Record<string, unknown>,
    ) => {
      restoredIds.push(current.id);
      if (failFor.has(current.id)) throw new Error("restore failed");
      return { persistedKeys: Object.keys(values), written: values };
    },
  }),
}));

import { compensateFailedLanding } from "back-end/src/revisions/landingSequence";
import type { Context } from "back-end/src/models/BaseModel";

/** What this landing wrote to each doc, so the ownership check passes. */
function writtenFor(id: string): string {
  if (id === "cfg_root") return "root-after";
  if (id === "cfg_child_a") return "a";
  return "b";
}

/**
 * The compensation five landings share, and which had no test of its own — the
 * dashboard's config publish, the internal constant publish and three saved-group
 * landings all route their rollback through here.
 *
 * Two properties, both invisible to a happy-path test:
 *
 *  1. the ROOT goes back before any descendant. Wrong order is silent: a descendant
 *     restored while the root still declares a field is re-stripped by unconditional
 *     ancestor normalization AND reports success.
 *  2. the revision is un-merged ONLY when every restore came back clean. A live
 *     change with no record is the one outcome nothing can repair, so a failed
 *     restore keeps the record and says the landing left partial state.
 */

const entity = { id: "cfg_root", schema: "root-before" };

function makeContext() {
  return { landingLeftPartialState: false } as unknown as Context & {
    landingLeftPartialState: boolean;
  };
}

const cascade = [
  {
    before: { id: "cfg_child_a", schema: "a-before" },
    written: { schema: "a" },
  },
  {
    before: { id: "cfg_child_b", schema: "b-before" },
    written: { schema: "b" },
  },
];

beforeEach(() => {
  restoredIds.length = 0;
  failFor.clear();
});

describe("compensateFailedLanding", () => {
  it("restores the root before any descendant, and descendants in cascade order", async () => {
    const context = makeContext();
    const unmerge = jest.fn().mockResolvedValue({});

    await compensateFailedLanding({
      context,
      entityType: "config",
      entity,
      persisted: { id: "cfg_root", schema: "root-after" },
      changes: { schema: "root-after" },
      cascade,
      unmerge,
    });

    // Parents before children among descendants, for the same reason the root goes
    // first: a child normalizes against ancestors that must already be back.
    expect(restoredIds).toEqual(["cfg_root", "cfg_child_a", "cfg_child_b"]);
    expect(unmerge).toHaveBeenCalled();
  });

  it("un-merges when nothing was reported written", async () => {
    const context = makeContext();
    const unmerge = jest.fn().mockResolvedValue({});

    await compensateFailedLanding({
      context,
      entityType: "config",
      entity,
      // Nothing reported: the write never landed, so there is nothing live and the
      // merged revision is phantom history.
      persisted: null,
      changes: { schema: "root-after" },
      unmerge,
    });

    expect(restoredIds).toEqual([]);
    expect(unmerge).toHaveBeenCalled();
  });

  it("keeps the revision when the ROOT restore fails", async () => {
    const context = makeContext();
    failFor.add("cfg_root");
    const unmerge = jest.fn();

    await compensateFailedLanding({
      context,
      entityType: "config",
      entity,
      persisted: { id: "cfg_root", schema: "root-after" },
      changes: { schema: "root-after" },
      unmerge,
    });

    expect(unmerge).not.toHaveBeenCalled();
    expect(context.landingLeftPartialState).toBe(true);
  });

  // The gap that produced round-7 P0-2 one file over: gating the un-merge on the
  // root alone removed the record while a descendant was left mutated and live.
  it("keeps the revision when only a DESCENDANT restore fails", async () => {
    const context = makeContext();
    failFor.add("cfg_child_a");
    const unmerge = jest.fn();

    await compensateFailedLanding({
      context,
      entityType: "config",
      entity,
      persisted: { id: "cfg_root", schema: "root-after" },
      changes: { schema: "root-after" },
      cascade,
      unmerge,
    });

    expect(unmerge).not.toHaveBeenCalled();
    expect(context.landingLeftPartialState).toBe(true);
  });

  // A failed un-merge after a clean restore leaves phantom history — recoverable by
  // hand, so it is logged rather than thrown, and must not mask the original error.
  it("does not throw when the un-merge itself fails", async () => {
    const context = makeContext();
    const unmerge = jest.fn().mockRejectedValue(new Error("cas miss"));

    await expect(
      compensateFailedLanding({
        context,
        entityType: "config",
        entity,
        persisted: { id: "cfg_root", schema: "root-after" },
        changes: { schema: "root-after" },
        unmerge,
      }),
    ).resolves.toBeUndefined();
  });
});
