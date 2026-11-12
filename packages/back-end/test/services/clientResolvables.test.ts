import { ConstantInterface } from "shared/types/constant";
import { ConfigInterface } from "shared/types/config";
import { getClientResolvables } from "back-end/src/services/resolvableValues";
import { ReqContext } from "back-end/types/request";

const constant = (overrides: Partial<ConstantInterface>) =>
  ({
    key: "c",
    type: "string",
    value: "v",
    project: "",
    archived: false,
    ...overrides,
  }) as ConstantInterface;

const config = (overrides: Partial<ConfigInterface>) =>
  ({
    key: "cfg",
    value: "{}",
    project: "",
    archived: false,
    ...overrides,
  }) as ConfigInterface;

const contextWith = (
  constants: ConstantInterface[],
  configs: ConfigInterface[],
) =>
  ({
    models: {
      constants: { getAll: async () => constants },
      configs: { getAll: async () => configs },
    },
  }) as unknown as ReqContext;

describe("getClientResolvables", () => {
  it("keeps the globals and the project's own, never another project's", async () => {
    const resolvables = await getClientResolvables(
      contextWith(
        [
          constant({ key: "global" }),
          constant({ key: "mine", project: "p1" }),
          constant({ key: "theirs", project: "p2" }),
        ],
        [config({ key: "shared" }), config({ key: "other", project: "p2" })],
      ),
      "p1",
    );
    expect(resolvables.map((r) => [r.source, r.key])).toEqual([
      ["constant", "global"],
      ["constant", "mine"],
      ["config", "shared"],
    ]);
  });

  it("carries environment values and config flavors only when set", async () => {
    const flavors = [{ config: "cfg-prod", environments: ["production"] }];
    const [withValues, plain, flavored] = await getClientResolvables(
      contextWith(
        [
          constant({ key: "a", environmentValues: { production: "p" } }),
          constant({ key: "b" }),
        ],
        [config({ key: "cfg", scopedOverrides: flavors })],
      ),
      "",
    );
    expect(withValues.environmentValues).toEqual({ production: "p" });
    expect(plain).not.toHaveProperty("environmentValues");
    expect(plain).not.toHaveProperty("scopedOverrides");
    expect(flavored.scopedOverrides).toEqual(flavors);
  });

  it("sends only what the given keys reach", async () => {
    const resolvables = await getClientResolvables(
      contextWith(
        [
          constant({
            key: "a",
            type: "json",
            value: '{"$extends":["@const:b"]}',
          }),
          constant({ key: "b" }),
          constant({ key: "flavored", type: "json", value: "{}" }),
          constant({ key: "unused" }),
        ],
        [
          config({
            key: "child",
            parent: "base",
            extends: ["mixin"],
            value: '{"$extends":["@const:a"]}',
            scopedOverrides: [{ config: "child-prod" }],
          }),
          config({ key: "base" }),
          config({ key: "mixin" }),
          config({
            key: "child-prod",
            value: '{"$extends":["@const:flavored"]}',
          }),
          config({ key: "unrelated" }),
        ],
      ),
      "",
      { constants: [], configs: ["child"] },
    );
    expect(resolvables.map((r) => [r.source, r.key])).toEqual([
      ["constant", "a"],
      ["constant", "b"],
      ["constant", "flavored"],
      ["config", "child"],
      ["config", "base"],
      ["config", "mixin"],
      ["config", "child-prod"],
    ]);
  });
});
