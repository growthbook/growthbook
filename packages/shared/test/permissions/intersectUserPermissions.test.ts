import { hasPermission, intersectUserPermissions } from "shared/permissions";
import {
  Permission,
  UserPermission,
  UserPermissions,
} from "shared/types/organization";

const PERMISSIONS: Permission[] = [
  "publishFeatures",
  "runExperiments",
  "manageFeatures",
  "readData",
  "manageTeam",
];
const ENVS = ["dev", "staging", "production"];
const PROJECTS = ["prj_a", "prj_b", "prj_c"];

// Deterministic PRNG so a failure reproduces.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPermission(rand: () => number): UserPermission {
  const pick = <T>(items: T[]) => items.filter(() => rand() < 0.5);
  const permissions = Object.fromEntries(
    pick(PERMISSIONS).map((p) => [p, true]),
  );
  const limit = () => rand() < 0.5;
  const base: UserPermission = {
    limitAccessByEnvironment: limit(),
    environments: pick(ENVS),
    permissions,
  };
  // Half legacy-only, half with per-role grants.
  if (rand() < 0.5) return base;
  const grantCount = 1 + Math.floor(rand() * 3);
  return {
    ...base,
    envGrants: Array.from({ length: grantCount }, () => ({
      limitAccessByEnvironment: limit(),
      environments: pick(ENVS),
      permissions: pick(PERMISSIONS),
    })),
  };
}

function randomPermissions(rand: () => number): UserPermissions {
  const projects: UserPermissions["projects"] = {};
  for (const p of PROJECTS) {
    if (rand() < 0.4) projects[p] = randomPermission(rand);
  }
  return { global: randomPermission(rand), projects };
}

const envCases: (string[] | undefined)[] = [
  undefined,
  [],
  ["dev"],
  ["production"],
  ["dev", "production"],
  ENVS,
];
const projectCases = [undefined, "", ...PROJECTS, "prj_unlisted"];

function admin(): UserPermissions {
  return {
    global: {
      limitAccessByEnvironment: false,
      environments: [],
      permissions: Object.fromEntries(PERMISSIONS.map((p) => [p, true])),
    },
    projects: {},
  };
}

describe("intersectUserPermissions", () => {
  it("allows exactly what both sides allow", () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 200; i++) {
      const a = randomPermissions(rand);
      const b = randomPermissions(rand);
      const both = intersectUserPermissions(a, b);
      for (const permission of PERMISSIONS) {
        for (const project of projectCases) {
          for (const envs of envCases) {
            const expected =
              hasPermission(a, permission, project, envs) &&
              hasPermission(b, permission, project, envs);
            expect({
              i,
              permission,
              project,
              envs,
              allowed: hasPermission(both, permission, project, envs),
            }).toEqual({ i, permission, project, envs, allowed: expected });
          }
        }
      }
    }
  });

  it("caps an admin at a dev-only publisher key", () => {
    const key: UserPermissions = {
      global: {
        limitAccessByEnvironment: true,
        environments: ["dev"],
        permissions: { publishFeatures: true },
        envGrants: [
          {
            limitAccessByEnvironment: true,
            environments: ["dev"],
            permissions: ["publishFeatures"],
          },
        ],
      },
      projects: {},
    };
    const both = intersectUserPermissions(admin(), key);
    expect(hasPermission(both, "publishFeatures", "prj_a", ["dev"])).toBe(true);
    expect(
      hasPermission(both, "publishFeatures", "prj_a", ["production"]),
    ).toBe(false);
    expect(hasPermission(both, "manageTeam")).toBe(false);
  });

  it("never lets a key's project role exceed the user", () => {
    const user: UserPermissions = {
      global: {
        limitAccessByEnvironment: false,
        environments: [],
        permissions: { readData: true },
      },
      projects: {},
    };
    const key: UserPermissions = {
      global: {
        limitAccessByEnvironment: false,
        environments: [],
        permissions: {},
      },
      projects: { prj_a: admin().global },
    };
    const both = intersectUserPermissions(user, key);
    expect(hasPermission(both, "readData", "prj_a")).toBe(true);
    expect(hasPermission(both, "manageFeatures", "prj_a")).toBe(false);
    expect(hasPermission(both, "readData", "prj_b")).toBe(false);
  });
});
