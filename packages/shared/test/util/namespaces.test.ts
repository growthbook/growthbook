import type { Namespaces } from "shared/types/organization";
import { isNamespaceSelectable } from "../../src/util/namespaces";

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
