import type { FeatureInterface } from "shared/types/feature";
import {
  assertValidExperimentPrerequisites,
  assertValidPrerequisiteParents,
} from "back-end/src/services/prerequisiteParents";
import { getAllFeaturesWithoutEditorFields } from "back-end/src/models/FeatureModel";
import { ApiReqContext } from "back-end/types/api";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getAllFeaturesWithoutEditorFields: jest.fn(),
}));
const scanContext = { scan: true } as unknown as ApiReqContext;
jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgObject: () => scanContext,
  getEnvironments: () => [{ id: "production" }, { id: "dev" }],
}));

const ctx = { org: { id: "org" } } as unknown as ApiReqContext;
const flag = (id: string, ...parents: string[]): FeatureInterface =>
  ({
    id,
    valueType: "boolean",
    archived: false,
    environmentSettings: { production: { enabled: true } },
    rules: [],
    prerequisites: parents.map((p) => ({ id: p, condition: "{}" })),
  }) as unknown as FeatureInterface;
// Direct parents load with the caller's context; ancestors with the scan
// context. Resolves requested ids against whichever map the context gets.
const stub = (
  visible: (context: unknown) => Record<string, FeatureInterface>,
) =>
  jest
    .mocked(getAllFeaturesWithoutEditorFields)
    .mockImplementation(async (context, opts) => {
      const byId = visible(context);
      return (opts?.ids ?? []).flatMap((id) => (byId[id] ? [byId[id]] : []));
    });

beforeEach(() => jest.mocked(getAllFeaturesWithoutEditorFields).mockReset());

describe("assertValidPrerequisiteParents", () => {
  it("does not query when the write adds no prerequisite", async () => {
    await assertValidPrerequisiteParents(ctx, flag("c", "p"), flag("c", "p"));
    expect(getAllFeaturesWithoutEditorFields).not.toHaveBeenCalled();
  });

  it("finds a cycle through an ancestor the caller cannot read", async () => {
    // c -> p -> hidden -> c; `hidden` only resolves for the scan context.
    const p = flag("p", "hidden");
    const hidden = flag("hidden", "c");
    stub((context) => (context === scanContext ? { p, hidden } : { p }));
    await expect(
      assertValidPrerequisiteParents(ctx, flag("c", "p")),
    ).rejects.toThrow(/circular dependency/);
  });

  it("finds cycles per environment, as the SDK evaluates them", async () => {
    const gated = (id: string, env: string, parent: string) =>
      ({
        ...flag(id),
        rules: [
          {
            type: "force",
            value: "true",
            environments: [env],
            prerequisites: [{ id: parent, condition: "{}" }],
          },
        ],
      }) as unknown as FeatureInterface;
    // A gates on B in production; B gates on A in dev: never in one payload.
    stub(() => ({ b: gated("b", "dev", "a") }));
    await expect(
      assertValidPrerequisiteParents(ctx, gated("a", "production", "b")),
    ).resolves.toBeUndefined();
    stub(() => ({ b: gated("b", "production", "a") }));
    await expect(
      assertValidPrerequisiteParents(ctx, gated("a", "production", "b")),
    ).rejects.toThrow(/circular/);
  });

  it("refuses a chain still open after the depth limit", async () => {
    const byId: Record<string, FeatureInterface> = {};
    for (let i = 0; i < 60; i++) byId[`n${i}`] = flag(`n${i}`, `n${i + 1}`);
    stub(() => byId);
    await expect(
      assertValidPrerequisiteParents(ctx, flag("c", "n0")),
    ).rejects.toThrow(/too deep/);
  });

  const str = { ...flag("str"), valueType: "string" } as FeatureInterface;

  it("requires a boolean parent only for top-level prerequisites", async () => {
    stub(() => ({ str }));
    const child = flag("child");
    await expect(
      assertValidPrerequisiteParents(ctx, {
        ...child,
        rules: [
          {
            type: "force",
            value: "true",
            prerequisites: [{ id: "str", condition: "{}" }],
          },
        ],
      } as unknown as FeatureInterface),
    ).resolves.toBeUndefined();
    await expect(
      assertValidPrerequisiteParents(ctx, flag("child", "str")),
    ).rejects.toThrow(/must be a boolean feature, not string/);
  });
});

describe("assertValidExperimentPrerequisites", () => {
  const gate = (id: string) => ({ id, condition: '{"value": true}' });

  it("checks only parents the phase adds", async () => {
    stub(() => ({ ok: flag("ok") }));
    await assertValidExperimentPrerequisites(
      ctx,
      [gate("gone"), gate("ok")],
      [gate("gone")],
    );
    expect(getAllFeaturesWithoutEditorFields).toHaveBeenCalledTimes(1);
    expect(getAllFeaturesWithoutEditorFields).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ ids: ["ok"] }),
    );
  });

  it("accepts a parent of any value type", async () => {
    stub(() => ({ str: { ...flag("str"), valueType: "string" } }));
    await expect(
      assertValidExperimentPrerequisites(ctx, [
        { id: "str", condition: '{"value": "control"}' },
      ]),
    ).resolves.toBeUndefined();
  });

  it("rejects a missing or archived parent", async () => {
    stub(() => ({ old: { ...flag("old"), archived: true } }));
    await expect(
      assertValidExperimentPrerequisites(ctx, [gate("nope")]),
    ).rejects.toThrow(/"nope" not found/);
    await expect(
      assertValidExperimentPrerequisites(ctx, [gate("old")]),
    ).rejects.toThrow(/is archived/);
  });
});
