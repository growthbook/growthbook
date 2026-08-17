import { getReviewAuthorityFootprint, RevisionFields } from "shared/util";
import { OrganizationSettings } from "shared/types/organization";

const ALL_ENVS = ["dev", "staging", "production"];

const base = (over: Partial<RevisionFields> = {}): RevisionFields =>
  ({
    version: 1,
    defaultValue: "false",
    rules: [],
    environmentsEnabled: { dev: true, staging: true, production: true },
    prerequisites: [],
    archived: false,
    metadata: {},
    holdout: null,
    rampActions: [],
    ...over,
  }) as RevisionFields;

const rule = (env: string) => ({
  id: `r_${env}`,
  type: "force" as const,
  description: "",
  value: "true",
  enabled: true,
  environments: [env],
});

const metadataReviewOn: OrganizationSettings = {
  requireReviews: [
    {
      requireReviewOn: true,
      resetReviewOnChange: false,
      environments: [],
      projects: [],
      featureRequireMetadataReview: true,
    },
  ],
};

const metadataReviewOff: OrganizationSettings = {
  requireReviews: [
    {
      requireReviewOn: true,
      resetReviewOnChange: false,
      environments: [],
      projects: [],
      featureRequireMetadataReview: false,
    },
  ],
};

const footprint = (
  revision: RevisionFields,
  bases: RevisionFields[],
  settings?: OrganizationSettings,
) =>
  getReviewAuthorityFootprint({
    revision,
    bases,
    allEnvironments: ALL_ENVS,
    settings,
  });

describe("review authority footprint", () => {
  it("names only the environments the draft changes", () => {
    const live = base();
    const draft = base({ rules: [rule("dev")] });

    expect(footprint(draft, [live])).toEqual({
      scope: "environments",
      environments: ["dev"],
    });
  });

  it("treats a default value change as reaching everywhere", () => {
    const live = base();
    const draft = base({ defaultValue: "true" });

    expect(footprint(draft, [live])).toEqual({ scope: "everywhere" });
  });

  it("returns no environments when nothing changed", () => {
    const live = base();

    expect(footprint(base(), [live])).toEqual({
      scope: "environments",
      environments: [],
    });
  });

  it("unions across bases so drift can only demand more authority", () => {
    // Each base differs from the draft in a different environment, so a
    // single-base read would miss one of them.
    const draft = base();
    const liveRevision = base({
      environmentsEnabled: { dev: true, staging: true, production: false },
    });
    const baseRevision = base({
      environmentsEnabled: { dev: true, staging: false, production: true },
    });

    expect(footprint(draft, [liveRevision])).toEqual({
      scope: "environments",
      environments: ["production"],
    });
    expect(footprint(draft, [baseRevision])).toEqual({
      scope: "environments",
      environments: ["staging"],
    });

    const result = footprint(draft, [liveRevision, baseRevision]);
    expect(result.scope).toBe("environments");
    expect(
      result.scope === "environments" && [...result.environments].sort(),
    ).toEqual(["production", "staging"]);
  });

  it("a metadata-only edit is unbound when the org gates metadata", () => {
    const live = base();
    const draft = base({ metadata: { description: "new" } });

    expect(footprint(draft, [live], metadataReviewOn)).toEqual({
      scope: "unbound",
    });
  });

  it("a metadata-only edit needs nothing when the org does not gate it", () => {
    const live = base();
    const draft = base({ metadata: { description: "new" } });

    expect(footprint(draft, [live], metadataReviewOff)).toEqual({
      scope: "environments",
      environments: [],
    });
  });

  it("a non-metadata global change outranks the metadata gate", () => {
    const live = base();
    const draft = base({
      defaultValue: "true",
      metadata: { description: "new" },
    });

    expect(footprint(draft, [live], metadataReviewOff)).toEqual({
      scope: "everywhere",
    });
  });

  it("counts a kill-switch flip as touching that environment", () => {
    const live = base();
    const draft = base({
      environmentsEnabled: { dev: true, staging: true, production: false },
    });

    expect(footprint(draft, [live])).toEqual({
      scope: "environments",
      environments: ["production"],
    });
  });
});
