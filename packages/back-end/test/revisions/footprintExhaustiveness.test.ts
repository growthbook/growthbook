import { REVISION_PERMISSIONS } from "shared/permissions";
import type { RevisionModel } from "shared/permissions";
import { revisionTargetType } from "shared/enterprise";
import type { RevisionTargetType } from "shared/enterprise";
import type { OrganizationInterface } from "shared/types/organization";
import { getAdapter } from "back-end/src/revisions";
import { buildPatchOps } from "back-end/src/revisions/util";
import type { Context } from "back-end/src/models/BaseModel";

/**
 * ENUMERATION, not examples: every (model × direction) that changes whether an
 * entity is in service must produce a NON-EMPTY environment footprint.
 *
 * This is the one bug class that recurred through four separate review rounds,
 * one installment at a time — Constants archive, then Configs archive, then the
 * unarchive direction, then base-vs-scoped Configs. Each was the same rule
 * missing from a different cell, and each example test only pinned the cell it
 * was written for.
 *
 * It matters because an empty footprint SKIPS the environment check rather than
 * narrowing it, so the failure is silent and it fails OPEN: a caller limited to
 * dev takes an entity out of service, or returns it to service, everywhere.
 *
 * The rule this asserts: if a model's publish atom is environment-scoped, then no
 * archive-class change to it may return `[]`. A model with no environment
 * partition (Saved Groups) must return `[]`, so a footprint appearing there would
 * fail too — the assertion is exact in both directions rather than a floor.
 */

const ORG = {
  id: "org_footprint",
  settings: {
    environments: [
      { id: "dev", description: "" },
      { id: "staging", description: "" },
      { id: "production", description: "" },
    ],
  },
} as unknown as OrganizationInterface;

const context = { org: ORG } as unknown as Context;

/** Models partitioned by environment, per the single source of truth. */
function isEnvPartitioned(model: RevisionModel): boolean {
  return REVISION_PERMISSIONS[model].publish.scope === "environment";
}

/**
 * A minimal live entity per type. Deliberately the LEAST bound shape — no scoped
 * environments, no per-environment values — because that is the shape whose
 * footprint collapsed to empty and skipped the check.
 */
function baseEntity(type: RevisionTargetType, archived: boolean) {
  const common = { id: `ent_${type}`, project: "", archived };
  switch (type) {
    case "constant":
      // No environmentValues: a base-value-only Constant.
      return { ...common, key: "k", type: "string", value: "v" };
    case "config":
      // scopedConfig null: a BASE Config, which names no environments.
      return { ...common, key: "k", scopedConfig: null, value: {} };
    case "saved-group":
      return { ...common, groupName: "g", type: "list", values: [] };
  }
}

describe("archive-class footprints are exhaustive across models and directions", () => {
  // Every registered type, read from the registry rather than a list here — a new
  // entity type is then covered the day it is added, not the day someone
  // remembers to add it below.
  describe.each(revisionTargetType)("%s", (type) => {
    const model = type as RevisionModel;

    describe.each([
      ["archiving", false, true],
      ["unarchiving", true, false],
    ] as const)("%s", (_label, currentlyArchived, proposedArchived) => {
      it(
        isEnvPartitioned(model)
          ? "answers for the environments it serves"
          : "answers for no environments, having no partition",
        () => {
          const entity = baseEntity(type, currentlyArchived);
          const footprint = getAdapter(type).publishFootprint?.(
            context,
            entity,
            buildPatchOps({ archived: proposedArchived }),
          );

          if (!isEnvPartitioned(model)) {
            // Either no footprint function at all, or an empty one. Both mean
            // "the environment check does not apply here", which is correct only
            // because every atom for this model is project-scoped.
            expect(footprint ?? []).toEqual([]);
            return;
          }

          expect(footprint).toBeDefined();
          expect(footprint).not.toEqual([]);
        },
      );
    });
  });
});

/**
 * The same enumeration for the atom side, which is where this pattern started.
 * `granular-flag-permissions.test.ts` proves each declared scope matches the array
 * its atom lives in; this proves the two env-scoped LANDING actions actually have a
 * footprint to be measured against, for every model that declares them.
 */
describe("every environment-scoped landing action has a footprint source", () => {
  it.each(revisionTargetType)("%s", (type) => {
    const model = type as RevisionModel;
    const envScopedActions = (
      ["publish", "revert", "delete", "create"] as const
    ).filter(
      (action) => REVISION_PERMISSIONS[model][action].scope === "environment",
    );

    if (!envScopedActions.length) {
      // Project-scoped throughout, so there is nothing to measure. Stated rather
      // than skipped, so the case doesn't silently vacate.
      expect(isEnvPartitioned(model)).toBe(false);
      return;
    }

    // A model with env-scoped actions MUST be able to compute a footprint;
    // otherwise every one of those actions is checked against `[]` and passes
    // vacuously.
    expect(typeof getAdapter(type).publishFootprint).toBe("function");
  });
});
