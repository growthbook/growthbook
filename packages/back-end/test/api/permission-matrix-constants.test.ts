import {
  api,
  as,
  CONSTANTS,
  describeEntityMatrix,
  expectVerdict,
  seed,
  seedRevertDraft,
} from "./permission-matrix-revision-entities.fixture";
import { Persona } from "./permission-personas.fixture";

describeEntityMatrix(CONSTANTS);

describe("a Constant's environment overrides bind the environment restriction", () => {
  // The change-aware footprint: a base-value change carries no intrinsic
  // environment (declared design), but an environmentValues.production write
  // from a dev-limited editor is exactly what the restriction exists to stop.

  it("dev-limited editor may change the base value", async () => {
    const id = await seed(CONSTANTS);
    as("editor", true);
    expectVerdict(
      await api.post(`/api/v1/${CONSTANTS.base}/${id}`, {
        value: '{"timeout":99}',
      }),
      true,
    );
  });

  it("dev-limited editor may change the dev override", async () => {
    const id = await seed(CONSTANTS);
    as("editor", true);
    expectVerdict(
      await api.post(`/api/v1/${CONSTANTS.base}/${id}`, {
        environmentValues: { dev: '{"timeout":1}' },
      }),
      true,
    );
  });

  it("dev-limited editor may NOT change the production override", async () => {
    const id = await seed(CONSTANTS);
    as("editor", true);
    expectVerdict(
      await api.post(`/api/v1/${CONSTANTS.base}/${id}`, {
        environmentValues: { production: '{"timeout":1}' },
      }),
      false,
    );
  });

  it("unrestricted editor may change the production override", async () => {
    const id = await seed(CONSTANTS);
    as("editor");
    expectVerdict(
      await api.post(`/api/v1/${CONSTANTS.base}/${id}`, {
        environmentValues: { production: '{"timeout":1}' },
      }),
      true,
    );
  });
});

describe("a no-op rebase over a pure-revert draft", () => {
  it.each([
    ["reverter", true],
    ["drafter", true],
    ["deleter", false],
    ["publisher", false],
  ] as [Persona, boolean][])("%s -> allowed=%s", async (persona, isAllowed) => {
    const id = await seed(CONSTANTS);
    const version = await seedRevertDraft(CONSTANTS, id);
    as(persona);
    const res = await api.post(
      `/api/v1/${CONSTANTS.base}-revisions/${id}/${version}/rebase`,
      { conflictResolutions: {} },
    );
    expectVerdict(res, isAllowed);
  });
});
