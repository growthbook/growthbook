import { Environment } from "shared/types/organization";
import {
  environmentAppliesToScope,
  featureHasEnvironment,
  filterEnvironmentsByFeature,
  getApplicableEnvIds,
} from "../src/util/features";
import { FeatureInterface } from "../types/feature";

const env = (id: string, projects?: string[]): Environment => ({
  id,
  description: "",
  ...(projects ? { projects } : {}),
});

// One env with no restriction, one per project, one shared by two projects.
const ENVS = [
  env("open"),
  env("only_a", ["prj_a"]),
  env("only_b", ["prj_b"]),
  env("a_or_c", ["prj_a", "prj_c"]),
];

describe("getApplicableEnvIds", () => {
  const cases: [string, Parameters<typeof getApplicableEnvIds>[1], string[]][] =
    [
      ["no scope", undefined, ["open", "only_a", "only_b", "a_or_c"]],
      ["empty scope object", {}, ["open", "only_a", "only_b", "a_or_c"]],
      [
        "legacy empty-string project",
        "",
        ["open", "only_a", "only_b", "a_or_c"],
      ],
      ["legacy string project", "prj_a", ["open", "only_a", "a_or_c"]],
      ["scope with project", { project: "prj_b" }, ["open", "only_b"]],
      [
        "project plus targeting projects union",
        { project: "prj_b", targetingProjects: ["prj_a"] },
        ["open", "only_a", "only_b", "a_or_c"],
      ],
      [
        "targeting all projects trumps the lists",
        { project: "prj_b", targetingAllProjects: true },
        ["open", "only_a", "only_b", "a_or_c"],
      ],
      [
        "project matching nothing keeps only unrestricted envs",
        { project: "prj_zzz" },
        ["open"],
      ],
    ];

  it.each(cases)("%s", (_name, scope, expected) => {
    expect(getApplicableEnvIds(ENVS, scope)).toEqual(expected);
  });

  it("returns [] when the org has no environments", () => {
    expect(getApplicableEnvIds([], "prj_a")).toEqual([]);
  });
});

// The three public spellings must never disagree: they all answer through
// environmentAppliesToScope.
describe("applicability spellings agree", () => {
  const scopes = [
    {},
    { project: "prj_a" },
    { project: "prj_b", targetingProjects: ["prj_c"] },
    { project: "prj_zzz" },
    { targetingAllProjects: true },
  ];

  it.each(scopes.map((s) => [JSON.stringify(s), s] as const))(
    "scope %s",
    (_name, scope) => {
      const feature = scope as unknown as FeatureInterface;
      const viaIds = getApplicableEnvIds(ENVS, scope);
      const viaFilter = filterEnvironmentsByFeature(ENVS, feature).map(
        (e) => e.id,
      );
      const viaPredicate = ENVS.filter((e) =>
        environmentAppliesToScope(e, scope),
      ).map((e) => e.id);
      const viaFeaturePredicate = ENVS.filter((e) =>
        featureHasEnvironment(feature, e),
      ).map((e) => e.id);
      expect(viaFilter).toEqual(viaIds);
      expect(viaPredicate).toEqual(viaIds);
      expect(viaFeaturePredicate).toEqual(viaIds);
    },
  );
});
