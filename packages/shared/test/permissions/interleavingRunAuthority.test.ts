import { Permissions } from "../../src/permissions";

const scope = (
  permissions: Record<string, boolean>,
  environments?: string[],
) => ({
  permissions,
  limitAccessByEnvironment: !!environments,
  environments: environments ?? [],
});

const RUN = { readData: true, runExperiments: true };
const NO_RUN = { readData: true };

const user = (
  global: Record<string, boolean>,
  projects: Record<string, Record<string, boolean>> = {},
  envs?: { global?: string[]; projects?: Record<string, string[]> },
) =>
  new Permissions({
    global: scope(global, envs?.global),
    projects: Object.fromEntries(
      Object.entries(projects).map(([id, perms]) => [
        id,
        scope(perms, envs?.projects?.[id]),
      ]),
    ),
  });

const inA = { project: "prj_a" };
const inB = { project: "prj_b" };
const envs = ["production"];

describe("canRunInterleavingUpdate", () => {
  // Run permission in prj_a only.
  const runInAOnly = user(NO_RUN, { prj_a: RUN });

  it("checks only the current project when the update leaves it alone", () => {
    expect(runInAOnly.canRunInterleavingUpdate(inA, {}, envs)).toBe(true);
    expect(runInAOnly.canRunInterleavingUpdate(inB, {}, envs)).toBe(false);
  });

  it("refuses a move into a project without run permission", () => {
    expect(runInAOnly.canRunInterleavingUpdate(inA, inB, envs)).toBe(false);
  });

  it("refuses a move out of a project without run permission", () => {
    expect(runInAOnly.canRunInterleavingUpdate(inB, inA, envs)).toBe(false);
  });

  it("allows a move when both sides grant it", () => {
    const runInBoth = user(NO_RUN, { prj_a: RUN, prj_b: RUN });
    expect(runInBoth.canRunInterleavingUpdate(inA, inB, envs)).toBe(true);
  });

  it("treats a no-op project change as no move", () => {
    expect(runInAOnly.canRunInterleavingUpdate(inA, { ...inA }, envs)).toBe(
      true,
    );
  });

  it("requires unscoped run permission when either side is all-projects", () => {
    expect(runInAOnly.canRunInterleavingUpdate({}, {}, envs)).toBe(false);
    expect(runInAOnly.canRunInterleavingUpdate(inA, {}, envs)).toBe(true);
    // Moving out of prj_a to all-projects reaches every project's payloads.
    expect(
      runInAOnly.canRunInterleavingUpdate(inA, { project: undefined }, envs),
    ).toBe(false);
    expect(user(RUN).canRunInterleavingUpdate({}, {}, envs)).toBe(true);
  });

  it("still honours the environment restriction on both sides", () => {
    const devOnlyInBoth = user(
      NO_RUN,
      { prj_a: RUN, prj_b: RUN },
      { projects: { prj_a: ["dev"], prj_b: ["dev"] } },
    );
    expect(devOnlyInBoth.canRunInterleavingUpdate(inA, inB, ["dev"])).toBe(
      true,
    );
    expect(devOnlyInBoth.canRunInterleavingUpdate(inA, inB, envs)).toBe(false);
  });
});
