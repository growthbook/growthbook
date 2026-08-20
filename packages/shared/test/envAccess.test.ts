import { OrganizationInterface } from "shared/types/organization";
import { envScopeLabels, memberEnvAccess } from "../src/permissions/envAccess";

const org = {
  settings: {
    environments: [
      { id: "production", description: "" },
      { id: "dev", description: "", projects: ["prj_clo"] },
      { id: "staging", description: "", projects: ["prj_brainzy"] },
    ],
  },
  customRoles: [
    {
      id: "qa_publisher",
      description: "",
      policies: ["ReadData", "FlagsPublish"],
    },
    {
      id: "qa_reviewer",
      description: "",
      policies: ["ReadData", "FlagsReview"],
    },
    {
      id: "qa_drafter",
      description: "",
      policies: ["ReadData", "FlagsEditDrafts"],
    },
  ],
} as unknown as Partial<OrganizationInterface>;

const env = (id: string, projects?: string[]) => ({ id, projects });

const drafters = {
  id: "team_drafters",
  name: "Drafters",
  role: "qa_drafter",
  limitAccessByEnvironment: false,
  environments: [],
  additionalRoles: [
    {
      role: "qa_publisher",
      limitAccessByEnvironment: true,
      environments: ["production"],
    },
  ],
};

// The devbox case: own role reviews in dev, a team publishes in production.
const peon = {
  role: "qa_reviewer",
  limitAccessByEnvironment: true,
  environments: ["dev"],
  teams: ["team_drafters"],
  projectRoles: [],
};

describe("memberEnvAccess", () => {
  it("counts environment access granted by a team", () => {
    const result = memberEnvAccess(peon, env("production"), org, "", [
      drafters,
    ]);
    expect(result.access).toBe("yes");
    expect(
      result.sources
        .filter((s) => s.access === "yes")
        .map((s) => [s.role, s.sourceType, s.sourceName]),
    ).toEqual([["qa_publisher", "team", "Drafters"]]);
  });

  it("does not let one rule borrow another rule's environments", () => {
    // qa_publisher covers production only, so dev must come from the own role.
    const result = memberEnvAccess(peon, env("dev", ["prj_clo"]), org, "", [
      drafters,
    ]);
    expect(result.access).toBe("yes");
    expect(
      result.sources.filter((s) => s.access === "yes").map((s) => s.role),
    ).toEqual(["qa_reviewer"]);
  });

  it("reports no access when every applicable rule excludes the environment", () => {
    const result = memberEnvAccess(
      peon,
      env("staging", ["prj_brainzy"]),
      org,
      "",
      [drafters],
    );
    expect(result.access).toBe("no");
    expect(result.outsideProject).toBe(false);
  });

  it("flags an environment that does not belong to the project being viewed", () => {
    const result = memberEnvAccess(
      peon,
      env("dev", ["prj_clo"]),
      org,
      "prj_brainzy",
      [drafters],
    );
    expect(result).toEqual({
      access: "N/A",
      outsideProject: true,
      sources: [],
    });
  });

  it("is not applicable when no contributing rule is environment-scoped", () => {
    const result = memberEnvAccess(
      { role: "noaccess", limitAccessByEnvironment: false, environments: [] },
      env("production"),
      org,
      "",
    );
    expect(result.access).toBe("N/A");
  });

  it("keeps a project override's own restriction when viewing that project", () => {
    const result = memberEnvAccess(
      {
        role: "qa_publisher",
        limitAccessByEnvironment: true,
        environments: ["production"],
        projectRoles: [
          {
            project: "prj_brainzy",
            role: "qa_publisher",
            limitAccessByEnvironment: true,
            environments: ["staging"],
          },
        ],
      },
      env("production"),
      org,
      "prj_brainzy",
    );
    expect(result.access).toBe("no");
  });

  it("lists each contributing rule once", () => {
    const result = memberEnvAccess(peon, env("production"), org, "", [
      drafters,
    ]);
    expect(result.sources).toHaveLength(3);
  });
});

describe("envScopeLabels", () => {
  it("names what a role does in an environment, in a fixed order", () => {
    expect(envScopeLabels("qa_publisher", org)).toEqual(["publish"]);
    expect(envScopeLabels("qa_reviewer", org)).toEqual(["review"]);
  });

  it("is empty for a role with no environment-scoped authority", () => {
    expect(envScopeLabels("qa_drafter", org)).toEqual([]);
  });

  it("is empty for admins, who are not bound by environment limits", () => {
    expect(envScopeLabels("admin", org)).toEqual([]);
  });

  it("spells out env-scoped atoms that are not revision actions", () => {
    expect(envScopeLabels("engineer", org)).toContain("run experiments");
  });
});
