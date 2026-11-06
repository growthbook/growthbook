import {
  sameScope,
  scopeFromStates,
} from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";

describe("scopeFromStates", () => {
  const envs = ["dev", "prod"];
  const both = { dev: "active", prod: "disabled-rule" } as const;

  it.each([
    {
      name: "keeps an explicit list that covers every environment",
      states: both,
      stored: false,
      expected: { allEnvironments: false, environments: ["dev", "prod"] },
    },
    {
      name: "keeps all environments",
      states: both,
      stored: true,
      expected: { allEnvironments: true, environments: [] },
    },
    {
      name: "reads full coverage as all when the stored setting is unknown",
      states: both,
      stored: null,
      expected: { allEnvironments: true, environments: [] },
    },
    {
      name: "lists the covered environments otherwise",
      states: { dev: "active", prod: "missing" } as const,
      stored: null,
      expected: { allEnvironments: false, environments: ["dev"] },
    },
  ])("$name", ({ states, stored, expected }) => {
    expect(scopeFromStates(states, envs, stored)).toEqual(expected);
  });
});

describe("sameScope", () => {
  const all = { allEnvironments: true, environments: [] };
  const explicit = (...environments: string[]) => ({
    allEnvironments: false,
    environments,
  });

  it.each([
    { name: "all and all", a: all, b: all, expected: true },
    {
      name: "the same list in another order",
      a: explicit("dev", "prod"),
      b: explicit("prod", "dev"),
      expected: true,
    },
    {
      name: "all and a list of every environment",
      a: all,
      b: explicit("dev", "prod"),
      expected: false,
    },
    {
      name: "lists that differ",
      a: explicit("dev"),
      b: explicit("dev", "prod"),
      expected: false,
    },
  ])("$name", ({ a, b, expected }) => {
    expect(sameScope(a, b)).toBe(expected);
  });
});
