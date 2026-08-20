import {
  canCommentOnRevisionEntity,
  canLandArchiveToggle,
  canLandRevertToTarget,
  canPublishRevisionEntity,
  canReviewRevisionEntity,
  canStageArchiveDraft,
  holdsRevisionDestination,
  Permissions,
  RevisionModel,
} from "shared/permissions";
import { getRolePermissions } from "back-end/src/util/organization.util";
import {
  buildOrg,
  OPERATION_ORACLE,
  PERSONA_IDS,
  Persona,
} from "./permission-personas.fixture";

// Keep client-side authority predictions aligned with the endpoint oracle.

const org = buildOrg("org_prediction_parity");

// The operations a control predicts. The expectations come from the shared oracle
// in the fixture — the same entries `permission-matrix-revision-entities` drives the
// real endpoints against — so endpoint and prediction are held to one table.
type PredictedOperation =
  | "publish a draft"
  | "archive"
  | "unarchive"
  | "revert straight to published"
  | "submit a review verdict"
  | "comment on a draft"
  | "stage an archive in a new draft"
  | "stage an unarchive in a new draft";

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
      const expected = (op: PredictedOperation) =>
        OPERATION_ORACLE[op].includes(persona);

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

      it("predicts reviewing the same way the endpoint decides it", () => {
        const permissions = permissionsFor(persona, false);
        expect(
          canReviewRevisionEntity(
            permissions,
            model,
            // Judged on the revision's snapshot, which may predate a move.
            { target: { snapshot: entity } },
            entity,
          ),
        ).toBe(expected("submit a review verdict"));
      });

      it("predicts landing a revert the same way the endpoint decides it", () => {
        const permissions = permissionsFor(persona, false);
        expect(
          canLandRevertToTarget(permissions, model, entity, {}, ["production"]),
        ).toBe(expected("revert straight to published"));
      });

      // The way back out. Held next to `archive` because they are one round trip:
      // a persona passing both owns the toggle, and the delete atom must not.
      it("predicts unarchiving the same way the endpoint decides it", () => {
        const permissions = permissionsFor(persona, false);
        expect(
          canLandArchiveToggle(
            permissions,
            model,
            { ...entity, archived: true },
            ["production"],
          ),
        ).toBe(expected("unarchive"));
      });

      it("predicts commenting the same way the endpoint decides it", () => {
        const permissions = permissionsFor(persona, false);
        expect(
          canCommentOnRevisionEntity(
            permissions,
            model,
            { target: { snapshot: entity } },
            entity,
          ),
        ).toBe(expected("comment on a draft"));
      });

      // Staging is project-scoped, so a footprint reaching production must not
      // change either answer — the assertions above already pin the landing side.
      it("predicts staging an archive the same way the endpoint decides it", () => {
        const permissions = permissionsFor(persona, false);
        expect(
          canStageArchiveDraft({ permissions, model, entity, archived: true }),
        ).toBe(expected("stage an archive in a new draft"));
      });

      it("predicts staging an unarchive the same way the endpoint decides it", () => {
        const permissions = permissionsFor(persona, false);
        expect(
          canStageArchiveDraft({ permissions, model, entity, archived: false }),
        ).toBe(expected("stage an unarchive in a new draft"));
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

    // Staging publishes nothing, so the restriction is inapplicable rather than
    // inert: a dev-limited deleter may still PROPOSE an archive that would reach
    // production, and only the landing above stops it.
    it("stages an archive regardless of the restriction", () => {
      expect(
        canStageArchiveDraft({
          permissions,
          model: "constant",
          entity,
          archived: true,
        }),
      ).toBe(persona === "deleter");
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
