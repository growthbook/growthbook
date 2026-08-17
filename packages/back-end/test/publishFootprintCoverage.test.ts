import { revisionTargetType } from "shared/enterprise";
import { ENV_SCOPED_PERMISSIONS } from "shared/permissions";
import { getAdapter } from "back-end/src/revisions";

const ATOM_SUFFIX: Record<string, string> = {
  "saved-group": "SavedGroups",
  constant: "Constants",
  config: "Configs",
};

describe("publish footprint covers every environment-scoped family", () => {
  // resolvePublishFootprint returns [] both for a deliberate "unscoped" change
  // and for an adapter that never implemented publishFootprint. [] skips the
  // environment check, so the second case must stay impossible.
  it.each(revisionTargetType)(
    "%s: implements publishFootprint, or has no env-scoped permission",
    (type) => {
      const suffix = ATOM_SUFFIX[type];
      expect(suffix).toBeDefined();

      const envScopedAtoms = ENV_SCOPED_PERMISSIONS.filter((p) =>
        p.endsWith(suffix),
      );

      if (!getAdapter(type).publishFootprint) {
        expect(envScopedAtoms).toEqual([]);
      }
    },
  );
});
