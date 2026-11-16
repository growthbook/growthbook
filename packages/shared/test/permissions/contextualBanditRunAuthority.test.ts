import {
  canRunContextualBanditControl,
  Permissions,
} from "../../src/permissions";

const scope = (
  permissions: Record<string, boolean>,
  environments?: string[],
) => ({
  permissions,
  limitAccessByEnvironment: !!environments,
  environments: environments ?? [],
});

// The default Engineer shape: publish experiments, but no analysis authoring.
const ENGINEER = { readData: true, runExperiments: true };
const ANALYST = { readData: true, runExperiments: true, createAnalyses: true };
const AUTHOR_ONLY = { readData: true, createAnalyses: true };

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
const envs = ["production"];

describe("canRunContextualBanditControl", () => {
  const live = { ...inA, archived: false };

  it("refuses run permission without the update atom", () => {
    expect(canRunContextualBanditControl(user(ENGINEER), live, envs)).toBe(
      false,
    );
    expect(canRunContextualBanditControl(user(ANALYST), live, envs)).toBe(true);
  });

  it("refuses the update atom without run permission", () => {
    expect(canRunContextualBanditControl(user(AUTHOR_ONLY), live, envs)).toBe(
      false,
    );
  });

  // Interleaving skips its run check entirely when no environment is affected
  // (InterleavingModel.canUpdate guards on envs.length > 0); the bandit server
  // calls canRunContextualBandit unconditionally, so the run atom is required
  // even with an empty list. Pinned so the two are not "unified" by mistake.
  it("still requires the run atom with no environments", () => {
    expect(canRunContextualBanditControl(user(AUTHOR_ONLY), live, [])).toBe(
      false,
    );
    expect(canRunContextualBanditControl(user(ANALYST), live, [])).toBe(true);
  });

  it("honours an environment restriction", () => {
    const devOnly = user(ANALYST, {}, { global: ["dev"] });
    expect(canRunContextualBanditControl(devOnly, live, ["dev"])).toBe(true);
    expect(canRunContextualBanditControl(devOnly, live, envs)).toBe(false);
  });

  // Archived is a business rule, not a permission: an archived bandit keeps
  // running and the stop endpoint accepts it. Only Start rejects archived,
  // and that term lives at the Start call site.
  it("ignores archived, which the server never checks to authorize", () => {
    expect(
      canRunContextualBanditControl(
        user(ANALYST),
        { ...inA, archived: true },
        envs,
      ),
    ).toBe(true);
    expect(
      canRunContextualBanditControl(
        user(ENGINEER),
        { ...inA, archived: true },
        envs,
      ),
    ).toBe(false);
  });
});
