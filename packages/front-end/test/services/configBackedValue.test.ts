import { setConfigBacking } from "shared/util";
import {
  ResolvableInput,
  resolveConfigBackedValue,
} from "@/services/configBackedValue";

const config: ResolvableInput = {
  key: "checkout",
  type: "json",
  value: JSON.stringify({ a: 1, b: { c: 2, d: 4 } }),
  environmentValues: {
    production: JSON.stringify({ a: 5, b: { c: 2, d: 4 } }),
  },
  project: "",
  archived: false,
  source: "config",
};

const resolve = (patch: string, environment?: string) =>
  resolveConfigBackedValue({
    inputs: [config],
    configKey: "checkout",
    value: setConfigBacking("checkout", patch),
    project: "",
    environment,
  });

describe("resolveConfigBackedValue", () => {
  it("serves the config itself under an empty patch", () => {
    expect(resolve("{}")).toEqual({ a: 1, b: { c: 2, d: 4 } });
  });

  it("deep-merges the value's own patch onto the config", () => {
    expect(resolve(JSON.stringify({ b: { c: 3 } }))).toEqual({
      a: 1,
      b: { c: 3, d: 4 },
    });
  });

  it("takes the environment's value of the config", () => {
    expect(resolve(JSON.stringify({ b: { c: 3 } }), "production")).toEqual({
      a: 5,
      b: { c: 3, d: 4 },
    });
  });
});
