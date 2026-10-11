import { describe, expect, it } from "vitest";
import {
  ATTENTION_TILES_FIXTURE,
  deltaFromSeries,
} from "@/components/Experiment/ExperimentListTiles.fixture";

describe("deltaFromSeries", () => {
  it("rounds the change from the first value to the last", () => {
    expect(deltaFromSeries([5, 6, 6, 7, 6, 8, 9])).toBe(80);
    expect(deltaFromSeries([5, 6, 5, 4, 4, 3, 3])).toBe(-40);
    expect(deltaFromSeries([3, 4, 4, 5, 5, 5, 6])).toBe(100);
  });

  it("has no change without a non-zero first value, or without a change", () => {
    expect(deltaFromSeries([0, 4])).toBeNull();
    expect(deltaFromSeries([4])).toBeNull();
    expect(deltaFromSeries([4, 2, 4])).toBeNull();
  });
});

describe("the attention tiles fixture", () => {
  it("takes each tile's count from its series' last value", () => {
    for (const tile of [
      ATTENTION_TILES_FIXTURE["needs-decision"],
      ATTENTION_TILES_FIXTURE.unhealthy,
      ATTENTION_TILES_FIXTURE["ending-soon"],
    ]) {
      expect(tile.count).toBe(tile.series?.[tile.series.length - 1]);
    }
    expect(ATTENTION_TILES_FIXTURE.all.count).toBe(130);
  });
});
