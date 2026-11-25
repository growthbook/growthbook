import {
  MemberRoleWithProjects,
  OrganizationInterface,
  ProjectMemberRole,
  Role,
} from "shared/types/organization";
import { getRolePermissions, Permissions } from "../../src/permissions";

// Session Replay's control side (the sidebar link and the page gate) asks
// `canViewSessionReplay({})`; the authority side (SessionReplayModel) asks it
// per SDK connection with that connection's projects. Both call the same shared
// method, so these hold the two argument shapes to one table.

const customRoles: Role[] = [
  {
    id: "sessionReplayFull",
    description: "View and delete replays",
    policies: ["ReadData", "SessionReplayFullAccess"],
  } as unknown as Role,
];

const org = {
  id: "org_1",
  customRoles,
  settings: { environments: [{ id: "production", description: "" }] },
} as unknown as OrganizationInterface;

const rule = (project: string, role: string): ProjectMemberRole => ({
  project,
  role,
  limitAccessByEnvironment: false,
  environments: [],
});

const permissionsFor = (info: MemberRoleWithProjects) =>
  new Permissions(getRolePermissions(info, org, []));

const noaccess = {
  role: "noaccess",
  limitAccessByEnvironment: false,
  environments: [],
};

/** Holds the view policy in prj_a only — the case the nav filter turns on. */
const engineerOfA = permissionsFor({
  ...noaccess,
  projectRoles: [rule("prj_a", "engineer")],
});
const globalEngineer = permissionsFor({ ...noaccess, role: "engineer" });
const collaborator = permissionsFor({ ...noaccess, role: "collaborator" });

describe("the page gate matches the sidebar nav", () => {
  // Both spellings of "no project given" reach the same read-only union, so the
  // page can't 404 a user whose link the nav rendered.
  it.each([
    ["engineer in prj_a", engineerOfA, true],
    ["engineer org-wide", globalEngineer, true],
    ["collaborator", collaborator, false],
  ])("%s", (_label, permissions, expected) => {
    expect(permissions.canViewSessionReplay({})).toBe(expected);
    expect(permissions.canViewSessionReplay({ projects: [] })).toBe(expected);
    expect(permissions.canViewSessionReplay(null)).toBe(expected);
  });
});

describe("authority scopes each SDK connection to its own projects", () => {
  it("admits a connection in a granted project and refuses one outside it", () => {
    expect(engineerOfA.canViewSessionReplay({ projects: ["prj_a"] })).toBe(
      true,
    );
    expect(engineerOfA.canViewSessionReplay({ projects: ["prj_b"] })).toBe(
      false,
    );
  });

  // A connection spanning several projects serves any of them, so one granted
  // project is enough — the same rule canReadMultiProjectResource applies.
  it("admits a multi-project connection on a single granted project", () => {
    expect(
      engineerOfA.canViewSessionReplay({ projects: ["prj_a", "prj_b"] }),
    ).toBe(true);
  });

  it("gives an org-wide grant every connection", () => {
    expect(globalEngineer.canViewSessionReplay({ projects: ["prj_b"] })).toBe(
      true,
    );
  });

  it("gives a collaborator none of them", () => {
    expect(collaborator.canViewSessionReplay({ projects: ["prj_a"] })).toBe(
      false,
    );
  });
});

/**
 * The parity invariant the nav depends on: anyone the model would hand a
 * session must pass the gate the link and the page ask. Narrowing `{}` or
 * dropping `viewSessionReplay` from READ_ONLY_PERMISSIONS breaks this and
 * strands a user on Custom404 after switching projects.
 */
describe("a readable connection implies a readable page", () => {
  const connections = [
    { key: "ck_a", projects: ["prj_a"] },
    { key: "ck_b", projects: ["prj_b"] },
    // No projects means all projects.
    { key: "ck_all", projects: [] as string[] },
  ];

  // Spelled out per persona so an all-refused fixture can't satisfy the
  // implication vacuously.
  it.each([
    ["engineer in prj_a", engineerOfA, ["ck_a", "ck_all"]],
    ["engineer org-wide", globalEngineer, ["ck_a", "ck_b", "ck_all"]],
    ["collaborator", collaborator, []],
  ])("%s", (_label, permissions, expectedKeys) => {
    const readable = connections
      .filter((c) => permissions.canViewSessionReplay({ projects: c.projects }))
      .map((c) => c.key);

    expect(readable).toEqual(expectedKeys);
    expect(permissions.canViewSessionReplay({})).toBe(readable.length > 0);
  });
});

/**
 * Deleting is not read-only, so it keeps `every` semantics: a project-scoped
 * grant does NOT open the unscoped check. Holding view and delete to different
 * answers is what proves the READ_ONLY_PERMISSIONS entry is doing the work.
 */
describe("delete does not inherit the read-only union", () => {
  const replayAdminOfA = permissionsFor({
    ...noaccess,
    projectRoles: [rule("prj_a", "sessionReplayFull")],
  });

  it("opens the unscoped view check but not the unscoped delete check", () => {
    expect(replayAdminOfA.canViewSessionReplay({})).toBe(true);
    expect(replayAdminOfA.canDeleteSessionReplay({})).toBe(false);
  });

  it("scopes delete to the granted project only", () => {
    expect(replayAdminOfA.canDeleteSessionReplay({ projects: ["prj_a"] })).toBe(
      true,
    );
    expect(replayAdminOfA.canDeleteSessionReplay({ projects: ["prj_b"] })).toBe(
      false,
    );
    // `every`, not `some`: one ungranted project in the span refuses.
    expect(
      replayAdminOfA.canDeleteSessionReplay({ projects: ["prj_a", "prj_b"] }),
    ).toBe(false);
  });

  it("never gives the view policy a delete", () => {
    expect(engineerOfA.canDeleteSessionReplay({ projects: ["prj_a"] })).toBe(
      false,
    );
    expect(globalEngineer.canDeleteSessionReplay({})).toBe(false);
  });
});

describe("default roles hold the view policy", () => {
  it.each([
    ["admin", true],
    ["experimenter", true],
    ["engineer", true],
    ["gbDefault_projectAdmin", true],
    ["analyst", false],
    ["collaborator", false],
    ["readonly", false],
    ["visualEditor", false],
    ["noaccess", false],
  ])("%s", (role, expected) => {
    expect(permissionsFor({ ...noaccess, role }).canViewSessionReplay({})).toBe(
      expected,
    );
  });
});
