import type { Context } from "back-end/src/models/BaseModel";
import {
  archiveServeFootprint,
  resolvePublishFootprint,
} from "back-end/src/revisions/revisionPublishEnvironments";

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
 * The tagged reach makes the distinction something an adapter must STATE rather
 * than something the next one has to remember: there is no way to mean
 * "everywhere" by writing nothing.
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

/**
 * The same fail-closed rule, on the helper ten call sites reach for directly:
 * unbound means everywhere, never nowhere. The permission matrix never exercises
 * an entity with no scope of its own — the only shape that reaches the fallback —
 * so the rule is pinned here.
 */
describe("archiveServeFootprint", () => {
  it("keeps an entity's own binding when it has one", () => {
    expect(archiveServeFootprint(context, entity, ["production"])).toEqual([
      "production",
    ]);
  });

  it("falls back to every environment the entity serves when unbound", () => {
    // The branch with the teeth. An unbound entity still SERVES production, so
    // taking it out of service must demand production authority — `[]` here
    // would skip the environment check entirely.
    expect(archiveServeFootprint(context, entity, []).sort()).toEqual([
      "dev",
      "production",
      "staging",
    ]);
  });

  it("falls back the same way when no scope argument is passed at all", () => {
    // Callers that omit the argument rely on the default; an omitted scope must
    // not mean something weaker than an explicitly empty one.
    expect(archiveServeFootprint(context, entity).sort()).toEqual([
      "dev",
      "production",
      "staging",
    ]);
  });
});
