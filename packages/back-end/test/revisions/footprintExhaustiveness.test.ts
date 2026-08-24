import {
  REVISION_PERMISSIONS,
  featurePublishFootprint,
} from "shared/permissions";
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
 * An example test pins only the cell it was written for; the same rule kept
 * going missing from other cells, so the whole table is asserted at once.
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
 * Feature Flags are NOT in `revisionTargetType` — they predate the generic
 * revision system and compute their footprint through `featurePublishFootprint`
 * rather than an adapter. So the enumeration above skipped the one model with a
 * bespoke path, which is exactly where a gap would hide.
 */
describe("feature archive-class footprints", () => {
  const environmentIds = ["dev", "staging", "production"];

  it.each([
    ["archiving", true],
    ["unarchiving", false],
  ])("%s answers for the environments it serves", (_label, archived) => {
    const footprint = featurePublishFootprint({
      feature: {
        environmentSettings: {
          dev: { enabled: true },
          production: { enabled: false },
        },
      },
      liveRules: [],
      changes: { archived },
      environmentIds,
      holdoutEnvs: [],
    });
    expect(footprint).not.toEqual([]);
  });

  // Deliberately NOT widened, and the one place the flag family legitimately
  // differs from Constants and Configs.
  //
  // A Constant's base value and a base Config are served in every environment they
  // apply to, so an archive flip there reaches all of them. A flag disabled in
  // every environment is served in NONE — archiving it changes nothing live, so an
  // unbound footprint is the honest answer rather than an oversight, and demanding
  // authority everywhere would refuse a change with no live effect. The feature
  // archive control measures the same serving set.
  it.each([
    ["archiving", true],
    ["unarchiving", false],
  ])(
    "%s a flag enabled nowhere binds to no environment",
    (_label, archived) => {
      const footprint = featurePublishFootprint({
        feature: { environmentSettings: {} },
        liveRules: [],
        changes: { archived },
        environmentIds,
        holdoutEnvs: [],
      });
      expect(footprint).toEqual([]);
    },
  );
});

/**
 * The same enumeration for the atom side.
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
