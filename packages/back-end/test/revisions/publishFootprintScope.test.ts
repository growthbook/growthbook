import type { Context } from "back-end/src/models/BaseModel";
import { resolvePublishFootprint } from "back-end/src/revisions/revisionPublishEnvironments";

/**
 * Two different situations were both spelled `[]`, and only one of them was safe.
 *
 * The permission layer ends in `envs.every(...)`, which is vacuously TRUE for an
 * empty list — so an empty footprint allows every environment rather than checking
 * them. That is correct for a change with no environment dimension (a Constant's
 * base value carries none, by declared design) and catastrophic for a change that
 * reaches everywhere without naming anything (an archive flip takes the entity out
 * of service in production too).
 *
 * Both adapters had grown a bespoke archive branch to tell them apart, each added
 * after the hazard was found in that adapter specifically. The tagged reach makes
 * the distinction something an adapter must STATE rather than something the next
 * one has to remember: there is no longer a way to mean "everywhere" by writing
 * nothing.
 *
 * These pin the mapping. The behaviour is deliberately identical to the hand-rolled
 * branches it replaces — what changed is that omitting the case is no longer
 * expressible.
 */

const context = {
  org: {
    id: "org_fp",
    settings: {
      environments: [{ id: "dev" }, { id: "staging" }, { id: "production" }],
    },
  },
} as unknown as Context;

const entity = { project: "prj_1" };

describe("resolvePublishFootprint", () => {
  it("narrows to the environments a scoped change names", () => {
    expect(
      resolvePublishFootprint(
        context,
        { scope: "environments", environments: ["production"] },
        entity,
      ),
    ).toEqual(["production"]);
  });

  it("resolves an unscoped change to the empty (check-skipping) list", () => {
    // The DELIBERATE empty. A base-value change carries no intrinsic environment,
    // so a dev-limited editor may make it — the permission matrix asserts exactly
    // this, and it is the behaviour that must survive the change.
    expect(
      resolvePublishFootprint(context, { scope: "unscoped" }, entity),
    ).toEqual([]);
  });

  it("resolves an everywhere change to every environment the entity serves", () => {
    // The dangerous empty, now named. An archive flip names no environments of its
    // own; read as `[]` it let a dev-limited caller archive production.
    expect(
      resolvePublishFootprint(context, { scope: "everywhere" }, entity).sort(),
    ).toEqual(["dev", "production", "staging"]);
  });

  it("treats an adapter with no footprint concept as unscoped", () => {
    // Same answer `?? []` used to give, so entity types that never scope are
    // unaffected — the point is that they now say so by having no implementation,
    // not by returning a value that means something else somewhere else.
    expect(resolvePublishFootprint(context, undefined, entity)).toEqual([]);
  });

  it("refuses to let a narrowing collapse back into the vacuous case", () => {
    // The hazard reintroduced from the inside: an adapter that claims to narrow and
    // then narrows to nothing. Returning `[]` here would restore exactly the bug
    // the tagged type exists to prevent, so it falls back to the full serve reach —
    // failing closed, which for a permission check means demanding MORE authority.
    expect(
      resolvePublishFootprint(
        context,
        { scope: "environments", environments: [] },
        entity,
      ).sort(),
    ).toEqual(["dev", "production", "staging"]);
  });
});
