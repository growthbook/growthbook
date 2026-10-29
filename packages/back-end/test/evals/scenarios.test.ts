// Must load before anything imports shared/experiments: in the other order,
// a cycle leaves shared's decision criteria holding an empty
// shared/experiments, and reading a running experiment over REST fails.
import "shared/enterprise";
import { gradeOutcome } from "./harness/graders/outcome";
import { replayReferenceActions } from "./harness/replay";
import { closeWorldDb, createWorld, openWorldDb } from "./harness/world";
import { SUITES } from "./scenarios";

jest.mock("back-end/src/util/secrets", () => ({
  ...jest.requireActual("back-end/src/util/secrets"),
  CRON_ENABLED: 0,
}));

// Key-free half of the evals: each scenario's seed and graders, exercised
// without a model.
jest.setTimeout(30000);
beforeAll(openWorldDb, 60000);
afterAll(closeWorldDb);

const scenarios = SUITES.flatMap((suite) => suite.scenarios);

it("scenario ids are unique", () => {
  const ids = scenarios.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
});

describe.each(scenarios.map((s) => [s.id, s] as const))("%s", (_, scenario) => {
  const seeded = async () => {
    const world = await createWorld({ agentModel: "claude-sonnet-5-5" });
    const target = await scenario.seed(world);
    return { world, target, before: await world.read(target) };
  };

  // Make Changes scenarios get theirs with the endpoint they exercise.
  const hasReference =
    scenario.referenceActions({ experimentId: "exp_probe" }).length > 0;

  (hasReference ? it : it.skip)(
    "the reference actions reach the expected end state",
    async () => {
      const { world, target, before } = await seeded();
      const actions = scenario.referenceActions(target);
      const { calls, responses } = await replayReferenceActions(world, actions);
      expect(
        calls.flatMap((c, i) => {
          const expected = actions[i].expectStatus;
          const ok =
            expected === undefined
              ? c.status >= 200 && c.status < 300
              : c.status === expected;
          return ok
            ? []
            : [
                {
                  request: `${c.method} ${c.path}`,
                  status: c.status,
                  response: responses[i],
                },
              ];
        }),
      ).toEqual([]);
      const outcome = gradeOutcome(
        scenario,
        calls,
        before,
        await world.read(target),
      );
      expect(outcome.state.reasons).toEqual([]);
      expect(outcome.calls.reasons).toEqual([]);
    },
  );

  it("the graders judge the untouched seed correctly", async () => {
    const { world, target, before } = await seeded();
    const outcome = gradeOutcome(
      scenario,
      [],
      before,
      await world.read(target),
    );
    expect(outcome.calls.pass).toBe(true);
    // Doing nothing passes only when doing nothing is the goal.
    expect(outcome.state.pass).toBe(scenario.expect.plan === "untouched");
  });
});
