import {
  api,
  as,
  CONSTANT_ENTITY,
  describeEntityMatrix,
  expectVerdict,
  seed,
  seedRevertDraft,
} from "./permission-matrix-revision-entities.fixture";
import { Persona } from "./permission-personas.fixture";

describeEntityMatrix(CONSTANT_ENTITY);

describe("a Constant's environment overrides bind the environment restriction", () => {
  // The change-aware footprint: a base-value change carries no intrinsic
  // environment (declared design), but an environmentValues.production write
  // from a dev-limited editor is exactly what the restriction exists to stop.

  it("dev-limited editor may change the base value", async () => {
    const id = await seed(CONSTANT_ENTITY);
    as("editor", true);
    expectVerdict(
      await api.post(`/api/v1/${CONSTANT_ENTITY.base}/${id}`, {
        value: '{"timeout":99}',
      }),
      true,
    );
  });

  it("dev-limited editor may change the dev override", async () => {
    const id = await seed(CONSTANT_ENTITY);
    as("editor", true);
    expectVerdict(
      await api.post(`/api/v1/${CONSTANT_ENTITY.base}/${id}`, {
        environmentValues: { dev: '{"timeout":1}' },
      }),
      true,
    );
  });

  it("dev-limited editor may NOT change the production override", async () => {
    const id = await seed(CONSTANT_ENTITY);
    as("editor", true);
    expectVerdict(
      await api.post(`/api/v1/${CONSTANT_ENTITY.base}/${id}`, {
        environmentValues: { production: '{"timeout":1}' },
      }),
      false,
    );
  });

  it("unrestricted editor may change the production override", async () => {
    const id = await seed(CONSTANT_ENTITY);
    as("editor");
    expectVerdict(
      await api.post(`/api/v1/${CONSTANT_ENTITY.base}/${id}`, {
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
    const id = await seed(CONSTANT_ENTITY);
    const version = await seedRevertDraft(CONSTANT_ENTITY, id);
    as(persona);
    const res = await api.post(
      `/api/v1/${CONSTANT_ENTITY.base}-revisions/${id}/${version}/rebase`,
      { conflictResolutions: {} },
    );
    expectVerdict(res, isAllowed);
  });
});
