import { describe, expect, it } from "vitest";
import type { MetricTimeSeriesVariation } from "shared/validators";
import {
  findTimeSeriesVariation,
  getTimeSeriesGraphVariations,
} from "@/components/Experiment/timeSeriesVariations";
import type { GraphVariation } from "@/components/Experiment/ExperimentDateGraph";

const storedVariations: MetricTimeSeriesVariation[] = [
  { id: "variation-a", name: "Original name" },
  { id: "variation-b", name: "Duplicate name" },
  { id: "variation-c", name: "Duplicate name" },
];

function graphVariation({
  id,
  name,
  index = 0,
}: {
  id: string;
  name: string;
  index?: number;
}): GraphVariation {
  return {
    name,
    index,
    experimentVariationId: id,
  };
}

describe("time-series variation matching", () => {
  it("matches a renamed variation by its stable ID", () => {
    const variation = graphVariation({
      id: "variation-a",
      name: "Renamed variation",
    });

    expect(findTimeSeriesVariation(storedVariations, variation)?.id).toBe(
      "variation-a",
    );
  });

  it("distinguishes duplicate names by stable ID", () => {
    const variation = graphVariation({
      id: "variation-c",
      name: "Duplicate name",
    });

    expect(findTimeSeriesVariation(storedVariations, variation)?.id).toBe(
      "variation-c",
    );
  });

  it("does not fall back to a name when a stable ID is present but missing", () => {
    const variation = graphVariation({
      id: "missing-variation",
      name: "Original name",
    });

    expect(
      findTimeSeriesVariation(storedVariations, variation),
    ).toBeUndefined();
  });

  it("uses names when the experiment variation id is absent", () => {
    const [variation] = getTimeSeriesGraphVariations([
      { name: "Original name", index: 0 },
    ]);

    expect(variation.experimentVariationId).toBeUndefined();
    expect(findTimeSeriesVariation(storedVariations, variation)?.id).toBe(
      "variation-a",
    );
  });

  it("uses experimentVariationId instead of the legacy id field", () => {
    const variationWithLegacyId = {
      id: "warehouse-key",
      experimentVariationId: "variation-a",
      name: "Renamed variation",
      index: 0,
    };
    const [variation] = getTimeSeriesGraphVariations([variationWithLegacyId]);

    expect(variation).toEqual({
      name: "Renamed variation",
      index: 0,
      experimentVariationId: "variation-a",
    });
    expect(findTimeSeriesVariation(storedVariations, variation)?.id).toBe(
      "variation-a",
    );
  });

  it("preserves caller order", () => {
    expect(
      getTimeSeriesGraphVariations([
        {
          experimentVariationId: "variation-c",
          name: "Third",
          index: 2,
        },
        {
          experimentVariationId: "variation-a",
          name: "First",
          index: 0,
        },
      ]).map((variation) => variation.experimentVariationId),
    ).toEqual(["variation-c", "variation-a"]);
  });
});
