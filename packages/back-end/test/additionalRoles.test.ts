import { OrganizationInterface } from "shared/types/organization";
import { getUserPermissions } from "back-end/src/util/organization.util";

const testOrg = {
  id: "org_additional_roles",
  name: "Test Org",
  ownerEmail: "test@test.com",
  url: "https://test.com",
  dateCreated: new Date(),
  settings: {
    environments: [
      { id: "development" },
      { id: "staging" },
      { id: "production" },
    ],
  },
  members: [],
  invites: [],
} as unknown as OrganizationInterface;

const member = (over: Record<string, unknown>) => ({
  id: "u_1",
  role: "engineer",
  limitAccessByEnvironment: true,
  environments: ["development"],
  ...over,
});

const envsFor = (
  perms: ReturnType<typeof getUserPermissions>,
  permission: string,
  project?: string,
) => {
  const scope = project ? perms.projects[project] : perms.global;
  const grants = (scope?.envGrants ?? []).filter((g) =>
    g.permissions.includes(permission as never),
  );
  return [...new Set(grants.flatMap((g) => g.environments))].sort();
};

describe("project overrides from a member and a team", () => {
  const withTeam = (
    memberProjectRole: Record<string, unknown> | null,
    teamRole: Record<string, unknown>,
  ) => {
    const org = {
      ...testOrg,
      members: [
        member({
          role: "readonly",
          limitAccessByEnvironment: false,
          environments: [],
          teams: ["team_1"],
          ...(memberProjectRole
            ? { projectRoles: [memberProjectRole] }
            : { projectRoles: [] }),
        }),
      ],
    } as OrganizationInterface;

    return getUserPermissions({ id: "u_1" }, org, [
      {
        id: "team_1",
        name: "Team One",
        limitAccessByEnvironment: false,
        environments: [],
        ...teamRole,
      },
    ] as unknown as Parameters<typeof getUserPermissions>[2]);
  };

  it("unions the two overrides rather than one replacing the other", () => {
    const perms = withTeam(
      {
        project: "prj_1",
        role: "readonly",
        limitAccessByEnvironment: false,
        environments: [],
      },
      {
        role: "readonly",
        projectRoles: [
          {
            project: "prj_1",
            role: "engineer",
            limitAccessByEnvironment: true,
            environments: ["production"],
          },
        ],
      },
    );

    expect(perms.projects["prj_1"].permissions.readData).toBe(true);
    expect(perms.projects["prj_1"].permissions.publishFeatures).toBe(true);
    expect(envsFor(perms, "publishFeatures", "prj_1")).toEqual(["production"]);
  });

  it("drops a team's global role inside a project the member overrode", () => {
    const perms = withTeam(
      {
        project: "prj_1",
        role: "readonly",
        limitAccessByEnvironment: false,
        environments: [],
      },
      { role: "engineer" },
    );

    expect(perms.global.permissions.publishFeatures).toBe(true);
    expect(perms.projects["prj_1"].permissions.publishFeatures).toBeFalsy();
  });

  it("drops the member's global role inside a project only the team overrode", () => {
    const org = {
      ...testOrg,
      members: [
        member({
          role: "engineer",
          limitAccessByEnvironment: false,
          environments: [],
          teams: ["team_1"],
          projectRoles: [],
        }),
      ],
    } as OrganizationInterface;

    const perms = getUserPermissions({ id: "u_1" }, org, [
      {
        id: "team_1",
        name: "Team One",
        role: "readonly",
        limitAccessByEnvironment: false,
        environments: [],
        projectRoles: [
          {
            project: "prj_1",
            role: "readonly",
            limitAccessByEnvironment: false,
            environments: [],
          },
        ],
      },
    ] as unknown as Parameters<typeof getUserPermissions>[2]);

    expect(perms.global.permissions.publishFeatures).toBe(true);
    expect(perms.projects["prj_1"].permissions.publishFeatures).toBeFalsy();
  });
});

describe("additional role rules", () => {
  it("does not let No Access suppress a rule added alongside it", () => {
    const org = {
      ...testOrg,
      members: [
        member({
          role: "noaccess",
          limitAccessByEnvironment: false,
          environments: [],
          additionalRoles: [
            {
              role: "engineer",
              limitAccessByEnvironment: false,
              environments: [],
            },
          ],
        }),
      ],
    } as OrganizationInterface;
    const perms = getUserPermissions({ id: "u_1" }, org, []);

    expect(perms.global.permissions.readData).toBe(true);
    expect(perms.global.permissions.publishFeatures).toBe(true);
    expect(perms.global.limitAccessByEnvironment).toBe(false);
  });

  it("a single rule resolves exactly as before", () => {
    const org = { ...testOrg, members: [member({})] } as OrganizationInterface;
    const perms = getUserPermissions({ id: "u_1" }, org, []);

    expect(envsFor(perms, "publishFeatures")).toEqual(["development"]);
  });

  it("unions environments across additional rules", () => {
    const org = {
      ...testOrg,
      members: [
        member({
          additionalRoles: [
            {
              role: "engineer",
              limitAccessByEnvironment: true,
              environments: ["production"],
            },
          ],
        }),
      ],
    } as OrganizationInterface;
    const perms = getUserPermissions({ id: "u_1" }, org, []);

    expect(envsFor(perms, "publishFeatures")).toEqual([
      "development",
      "production",
    ]);
  });

  it("keeps one rule's environments out of another rule's permissions", () => {
    const org = {
      ...testOrg,
      members: [
        member({
          role: "readonly",
          limitAccessByEnvironment: false,
          environments: [],
          additionalRoles: [
            {
              role: "engineer",
              limitAccessByEnvironment: true,
              environments: ["staging"],
            },
          ],
        }),
      ],
    } as OrganizationInterface;
    const perms = getUserPermissions({ id: "u_1" }, org, []);

    expect(envsFor(perms, "publishFeatures")).toEqual(["staging"]);
  });

  it("merges two rules for the same project instead of dropping one", () => {
    const org = {
      ...testOrg,
      members: [
        member({
          projectRoles: [
            {
              project: "prj_1",
              role: "engineer",
              limitAccessByEnvironment: true,
              environments: ["development"],
            },
            {
              project: "prj_1",
              role: "engineer",
              limitAccessByEnvironment: true,
              environments: ["production"],
            },
          ],
        }),
      ],
    } as OrganizationInterface;
    const perms = getUserPermissions({ id: "u_1" }, org, []);

    expect(envsFor(perms, "publishFeatures", "prj_1")).toEqual([
      "development",
      "production",
    ]);
  });

  it("supports additional rules inside a project role", () => {
    const org = {
      ...testOrg,
      members: [
        member({
          projectRoles: [
            {
              project: "prj_1",
              role: "engineer",
              limitAccessByEnvironment: true,
              environments: ["development"],
              additionalRoles: [
                {
                  role: "engineer",
                  limitAccessByEnvironment: true,
                  environments: ["staging"],
                },
              ],
            },
          ],
        }),
      ],
    } as OrganizationInterface;
    const perms = getUserPermissions({ id: "u_1" }, org, []);

    expect(envsFor(perms, "publishFeatures", "prj_1")).toEqual([
      "development",
      "staging",
    ]);
  });
});
