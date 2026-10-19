import {
  SavedGroupReferences,
  totalSavedGroupReferences,
} from "@/hooks/useSavedGroupReferences";

const empty: SavedGroupReferences = {
  features: [],
  experiments: [],
  contextualBandits: [],
  interleavings: [],
  savedGroups: [],
};

const refs = (
  overrides: Partial<SavedGroupReferences>,
): SavedGroupReferences => ({ ...empty, ...overrides });

describe("totalSavedGroupReferences", () => {
  it.each([
    ["features", refs({ features: [{ id: "f1", name: "f1" }] })],
    ["experiments", refs({ experiments: [{ id: "e1", name: "e1" }] })],
    [
      "contextualBandits",
      refs({ contextualBandits: [{ id: "cb1", name: "cb1" }] }),
    ],
    ["interleavings", refs({ interleavings: [{ id: "il1", name: "il1" }] })],
    ["savedGroups", refs({ savedGroups: [{ id: "grp1", groupName: "grp1" }] })],
  ])("counts %s", (_, input) => {
    expect(totalSavedGroupReferences(input)).toBe(1);
  });

  it("sums across every resource type", () => {
    expect(
      totalSavedGroupReferences(
        refs({
          features: [{ id: "f1", name: "f1" }],
          experiments: [{ id: "e1", name: "e1" }],
          contextualBandits: [{ id: "cb1", name: "cb1" }],
          interleavings: [
            { id: "il1", name: "il1" },
            { id: "il2", name: "il2" },
          ],
          savedGroups: [{ id: "grp1", groupName: "grp1" }],
        }),
      ),
    ).toBe(6);
  });

  it("treats a missing result as zero", () => {
    expect(totalSavedGroupReferences(null)).toBe(0);
    expect(totalSavedGroupReferences(undefined)).toBe(0);
    expect(totalSavedGroupReferences(empty)).toBe(0);
  });
});
