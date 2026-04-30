import { getLatestPhaseVariations } from "../src/experiments";

describe("getLatestPhaseVariations", () => {
  it("preserves status from latest phase variations", () => {
    const result = getLatestPhaseVariations({
      variations: [
        { id: "v0", key: "0", name: "Control" },
        { id: "v1", key: "1", name: "Treatment" },
      ],
      phases: [
        {
          variations: [
            { id: "v0", status: "active" },
            { id: "v1", status: "passThrough" },
          ],
        },
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: "v0",
        status: "active",
      }),
      expect.objectContaining({
        id: "v1",
        status: "passThrough",
      }),
    ]);
  });

  it("falls back to all active variations when phase includes unknown IDs", () => {
    const result = getLatestPhaseVariations({
      variations: [
        { id: "v0", key: "0", name: "Control" },
        { id: "v1", key: "1", name: "Treatment" },
      ],
      phases: [
        {
          variations: [
            { id: "v0", status: "active" },
            { id: "v-missing", status: "passThrough" },
          ],
        },
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: "v0",
        status: "active",
      }),
      expect.objectContaining({
        id: "v1",
        status: "active",
      }),
    ]);
  });

  it("falls back to all active variations when latest phase variations is empty", () => {
    const result = getLatestPhaseVariations({
      variations: [
        { id: "v0", key: "0", name: "Control" },
        { id: "v1", key: "1", name: "Treatment" },
      ],
      phases: [
        {
          variations: [],
        },
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: "v0",
        status: "active",
      }),
      expect.objectContaining({
        id: "v1",
        status: "active",
      }),
    ]);
  });
});
