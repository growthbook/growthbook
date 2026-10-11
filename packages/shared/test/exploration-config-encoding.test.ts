import {
  DEFAULT_EXPLORE_STATE,
  decodeExplorationConfigJson,
  encodeExplorationConfig,
} from "shared/enterprise";
import type { ExplorationConfig } from "shared/validators";

/** Pre-compression encoder; kept here so we can assert old bookmarks still decode. */
function encodeLegacyExplorationConfig(config: ExplorationConfig): string {
  return btoa(encodeURIComponent(JSON.stringify(config)));
}

describe("exploration config URL encoding", () => {
  const config: ExplorationConfig = {
    ...DEFAULT_EXPLORE_STATE,
    datasource: "ds_test",
    dataset: {
      type: "metric",
      values: [
        {
          type: "metric",
          name: "Purchases",
          metricId: "met_abc",
          unit: "user_id",
          denominatorUnit: null,
          rowFilters: [],
        },
      ],
    },
  };

  it("round-trips through the compressed encoder", () => {
    const encoded = encodeExplorationConfig(config);

    expect(encoded.startsWith("~")).toBe(true);
    expect(decodeExplorationConfigJson(encoded)).toEqual(config);
  });

  it("produces a shorter payload than the legacy base64 encoder", () => {
    const bulky: ExplorationConfig = {
      ...config,
      type: "sql",
      chartType: "bar",
      dimensions: [],
      dataset: {
        type: "sql",
        sql: "SELECT user_id, event_name, timestamp FROM events WHERE ".repeat(
          40,
        ),
        timestampColumn: "timestamp",
        columnTypes: {
          user_id: "string",
          event_name: "string",
          timestamp: "date",
        },
        values: [],
      },
    };

    const compressed = encodeExplorationConfig(bulky);
    const legacy = encodeLegacyExplorationConfig(bulky);

    expect(compressed.length).toBeLessThan(legacy.length);
    expect(decodeExplorationConfigJson(compressed)).toEqual(bulky);
  });

  it("decodes legacy bookmarks that lack the ~ prefix", () => {
    const legacy = encodeLegacyExplorationConfig(config);

    expect(legacy.startsWith("~")).toBe(false);
    expect(decodeExplorationConfigJson(legacy)).toEqual(config);
  });

  it("rejects oversized encoded payloads", () => {
    expect(() =>
      decodeExplorationConfigJson("A".repeat(16 * 1024 + 1)),
    ).toThrow("Exploration config is too large");
  });

  it("rejects malformed compressed and legacy payloads", () => {
    expect(() => decodeExplorationConfigJson("~not-deflate")).toThrow();
    expect(() => decodeExplorationConfigJson("not-a-config")).toThrow();
  });

  it("returns raw JSON for callers to validate (legacy path)", () => {
    // Valid base64 JSON that is not an ExplorationConfig — schema checks live
    // in decodeExplorationConfig on the front-end.
    expect(decodeExplorationConfigJson("eyJmb28iOjF9")).toEqual({ foo: 1 });
  });
});
