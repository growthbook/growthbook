import {
  canLandArchiveToggle,
  canLandRevertToTarget,
  canPublishRevisionEntity,
  holdsRevisionDestination,
  Permissions,
  RevisionModel,
} from "shared/permissions";
import { getRolePermissions } from "back-end/src/util/organization.util";
import { buildOrg, PERSONA_IDS, Persona } from "./permission-personas.fixture";

/**
 * Does a CONTROL predict what its ENDPOINT will do?
 *
 * Every review round of the granular-permissions work has produced at least one
 * finding of the same shape: a control offering an action the endpoint then
 * refused, because the two derived the same rule separately and disagreed about
 * one input — the verb at a move's destination, the basis a footprint is measured
 * against, whether an action publishes at all.
 *
 * Patching each site only fixes the sites already found. This closes the class:
 * `permission-matrix-revision-entities` proves the ENDPOINTS answer the oracle
 * below, and this file proves the PREDICTIONS answer the same oracle — so a
 * control and its endpoint cannot drift apart without CI failing.
 *
 * In-process on purpose. Predictions are pure functions over a `Permissions`
 * instance, so no HTTP is needed, and the assertions cost milliseconds instead of
 * adding hundreds of requests to the slowest suite in the repo.
 */

const org = buildOrg("org_prediction_parity");

// The same oracle the endpoint matrix asserts against, for the operations a
// control predicts. Kept as literals rather than imported so that "endpoint and
// prediction agree" can't be satisfied by both reading a wrong shared value.
const ORACLE: Record<string, Persona[]> = {
  "publish a draft": ["publisher", "creatorPublisher", "editor", "full"],
  archive: ["deleter", "full"],
  "revert straight to published": ["reverter", "full"],
};

const MODELS: RevisionModel[] = ["constant", "config", "saved-group"];

/**
 * The `Permissions` a persona's role produces — the very object a control holds.
 * Built straight from the role, not through a request context, so this stays a
 * pure in-process check with no database.
 */
function permissionsFor(persona: Persona, envLimited: boolean): Permissions {
  const role = envLimited ? `${persona}${"_dev"}` : persona;
  const member = org.members.find((m) => m.id === `u_${role}`);
  if (!member) throw new Error(`no fixture member for role ${role}`);
  return new Permissions(getRolePermissions(member, org, []));
}

/**
 * The entity under test, in no project. Saved Groups are list-scoped and the
 * others scalar-scoped, so both shapes are present and the helpers pick.
 */
const entity = { project: "", projects: [] as string[] };

/** A revision that changes content only — it relocates nothing. */
const inPlaceRevision = {
  target: {
    proposedChanges: [{ op: "replace" as const, path: "/value", value: "x" }],
  },
};

describe("control predictions match the endpoint oracle", () => {
  describe.each(MODELS)("%s", (model) => {
    describe.each(PERSONA_IDS)("%s", (persona) => {
      // Saved Groups hold the mirrored SavedGroup* atoms, so every persona
      // answers the same way for all three entities.
      const expected = (op: string) => ORACLE[op].includes(persona);

      it("predicts publishing a draft the same way the endpoint decides it", () => {
        const permissions = permissionsFor(persona, false);
        expect(
          canPublishRevisionEntity(
            permissions,
            model,
            inPlaceRevision,
            entity,
            // A change that reaches production: the footprint the endpoint
            // derives for this draft.
            ["production"],
          ),
        ).toBe(expected("publish a draft"));
      });

      it("predicts archiving the same way the endpoint decides it", () => {
        const permissions = permissionsFor(persona, false);
        expect(
          canLandArchiveToggle(permissions, model, entity, ["production"]),
        ).toBe(expected("archive"));
      });

      it("predicts landing a revert the same way the endpoint decides it", () => {
        const permissions = permissionsFor(persona, false);
        expect(
          canLandRevertToTarget(permissions, model, entity, {}, ["production"]),
        ).toBe(expected("revert straight to published"));
      });
    });
  });
});

/**
 * The env-scoped half. Publish, revert and delete are environment-scoped atoms,
 * so a persona limited to `dev` must be predicted as refused for a change that
 * reaches production and permitted for one that stays in dev. Getting this wrong
 * in either direction is the "footprint measured against the wrong thing" class.
 */
describe("control predictions respect the environment footprint", () => {
  const envScoped: Persona[] = ["publisher", "deleter", "reverter"];

  describe.each(envScoped)("%s limited to dev", (persona) => {
    const permissions = permissionsFor(persona, true);

    it("is refused for a change reaching production", () => {
      const reaching = {
        publish: canPublishRevisionEntity(
          permissions,
          "constant",
          inPlaceRevision,
          entity,
          ["production"],
        ),
        archive: canLandArchiveToggle(permissions, "constant", entity, [
          "production",
        ]),
        revert: canLandRevertToTarget(permissions, "constant", entity, {}, [
          "production",
        ]),
      };
      expect(reaching).toEqual({
        publish: false,
        archive: false,
        revert: false,
      });
    });

    it("is permitted for the same change confined to dev", () => {
      const confined = {
        publish: canPublishRevisionEntity(
          permissions,
          "constant",
          inPlaceRevision,
          entity,
          ["dev"],
        ),
        archive: canLandArchiveToggle(permissions, "constant", entity, ["dev"]),
        revert: canLandRevertToTarget(permissions, "constant", entity, {}, [
          "dev",
        ]),
      };
      expect(confined).toEqual({
        publish: persona === "publisher",
        archive: persona === "deleter",
        revert: persona === "reverter",
      });
    });
  });
});

/**
 * The destination half, which is where the last two rounds' front-end findings
 * were. Landing a draft is a publish wherever it lands, so a relocating draft
 * takes the PUBLISH atom in the destination — not whichever narrow atom carried
 * the source side. A reverter or deleter must therefore be refused the
 * destination even though they may land the change in place.
 */
describe("a relocating draft is predicted against the destination", () => {
  const movesToOther = {
    target: {
      proposedChanges: [
        { op: "replace" as const, path: "/project", value: "prj_other" },
      ],
    },
  };

  it("asks for publish in the destination, whatever carried the source", () => {
    const held = Object.fromEntries(
      (["publisher", "reverter", "deleter", "editor", "full"] as Persona[]).map(
        (persona) => [
          persona,
          holdsRevisionDestination(
            permissionsFor(persona, false),
            "constant",
            "publish",
            movesToOther,
            entity,
            ["production"],
          ),
        ],
      ),
    );
    // Exactly the personas holding the publish atom, and no others.
    expect(held).toEqual({
      publisher: true,
      reverter: false,
      deleter: false,
      editor: true,
      full: true,
    });
  });

  it("passes vacuously when the revision relocates nothing", () => {
    expect(
      holdsRevisionDestination(
        permissionsFor("reverter", false),
        "constant",
        "publish",
        inPlaceRevision,
        entity,
        ["production"],
      ),
    ).toBe(true);
  });
});
