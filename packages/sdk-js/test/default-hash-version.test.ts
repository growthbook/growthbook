import { GrowthBook, GrowthBookClient } from "../src";

const rollout = (hashVersion?: number) => ({
  features: {
    f: {
      defaultValue: false,
      rules: [{ force: true, coverage: 0.5, hashAttribute: "id", hashVersion }],
    },
  },
});
const ids = Array.from({ length: 200 }, (_, i) => "user" + i);
const evalAll = (
  payload: ReturnType<typeof rollout>,
  defaultHashVersion?: number,
) =>
  ids.map((id) =>
    new GrowthBook({ attributes: { id }, defaultHashVersion })
      .initSync({ payload })
      .isOn("f"),
  );

describe("defaultHashVersion", () => {
  const v1 = evalAll(rollout(1));
  const v2 = evalAll(rollout(2));

  it("differs between versions", () => {
    expect(v1).not.toEqual(v2);
  });

  it("defaults to version 1", () => {
    expect(evalAll(rollout())).toEqual(v1);
  });

  it("applies to rollouts without a hashVersion", () => {
    expect(evalAll(rollout(), 2)).toEqual(v2);
  });

  it("does not override a rule's own hashVersion", () => {
    expect(evalAll(rollout(1), 2)).toEqual(v1);
  });

  it("applies to GrowthBookClient and inline experiments", () => {
    const client = new GrowthBookClient({ defaultHashVersion: 2 }).initSync({
      payload: rollout(),
    });
    expect(ids.map((id) => client.isOn("f", { attributes: { id } }))).toEqual(
      v2,
    );

    const run = (defaultHashVersion?: number, hashVersion?: number) =>
      ids.map(
        (id) =>
          new GrowthBook({ attributes: { id }, defaultHashVersion }).run({
            key: "exp",
            variations: [0, 1],
            hashVersion,
          }).value,
      );
    expect(run(2)).toEqual(run(undefined, 2));
    expect(run(2)).not.toEqual(run());
  });
});
