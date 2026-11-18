import type { Namespaces } from "shared/types/organization";
import {
  isMultiRangeInPayload,
  isNamespaceSelectable,
} from "../../src/util/namespaces";

describe("isNamespaceSelectable", () => {
  const base = { name: "ns", label: "NS", description: "" };
  const legacy: Namespaces = { ...base, status: "active", format: "legacy" };
  const multiRange: Namespaces = {
    ...base,
    status: "active",
    format: "multiRange",
    hashAttribute: "id",
    seed: "s",
  };

  it.each([
    ["a legacy namespace, for any attribute", legacy, "device", "", true],
    ["an inactive one", { ...legacy, status: "inactive" }, "id", "", false],
    ["a multi-range one on the same attribute", multiRange, "id", "", true],
    ["a multi-range one on another attribute", multiRange, "device", "", false],
    [
      "a multi-range one, with a fallback attribute",
      multiRange,
      "id",
      "device",
      false,
    ],
    ["a legacy one, with a fallback attribute", legacy, "id", "device", true],
  ])("%s", (_, namespace, hashAttribute, fallbackAttribute, expected) => {
    expect(
      isNamespaceSelectable(namespace, { hashAttribute, fallbackAttribute }),
    ).toBe(expected);
  });
});

describe("isMultiRangeInPayload", () => {
  const legacy = {
    enabled: true,
    name: "ns",
    range: [0, 0.5] as [number, number],
  };
  const multi = {
    enabled: true,
    name: "ns",
    ranges: [[0, 0.5]] as [number, number][],
  };
  it("follows the namespace's shape without a definition", () => {
    expect(isMultiRangeInPayload(legacy)).toBe(false);
    expect(isMultiRangeInPayload(multi)).toBe(true);
  });
  it("trusts the org's definition over the shape", () => {
    const defs = new Map([["ns", { format: "multiRange" as const }]]);
    expect(isMultiRangeInPayload(legacy, defs)).toBe(true);
  });
});
