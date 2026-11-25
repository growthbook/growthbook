import { SESSION_REPLAY_MAX_MULTI_FILTER_LENGTH } from "shared/validators";
import {
  emptyDroppedFilters,
  syntaxFiltersToQueryParams,
} from "@/hooks/useSessionReplayFilters";
import type { SyntaxFilter } from "@/services/search";

function filter(
  field: string,
  values: string[],
  extra: Partial<SyntaxFilter> = {},
): SyntaxFilter {
  return { field, values, operator: "", negated: false, ...extra };
}

describe("syntaxFiltersToQueryParams", () => {
  it("merges repeated tokens for the same field instead of overwriting", () => {
    const params = syntaxFiltersToQueryParams([
      filter("country", ["US"]),
      filter("country", ["CA"]),
    ]);
    expect(params.country).toBe("US,CA");
  });

  it("drops negated filters rather than sending their inverse", () => {
    const dropped = emptyDroppedFilters();
    const params = syntaxFiltersToQueryParams(
      [filter("country", ["US"], { negated: true })],
      dropped,
    );
    // country=US would return exactly the sessions the user excluded
    expect(params.country).toBeUndefined();
    // Silently ignoring it leaves the token in the box with no effect
    expect(Array.from(dropped.negated)).toEqual(["country"]);
  });

  it("reports every negated field, not just the first", () => {
    const dropped = emptyDroppedFilters();
    syntaxFiltersToQueryParams(
      [
        filter("country", ["US"], { negated: true }),
        filter("flag", ["checkout"], { negated: true }),
      ],
      dropped,
    );
    expect(Array.from(dropped.negated).sort()).toEqual(["country", "flag"]);
  });

  it("keeps a non-negated filter alongside a negated one", () => {
    const dropped = emptyDroppedFilters();
    const params = syntaxFiltersToQueryParams(
      [filter("country", ["US"], { negated: true }), filter("country", ["CA"])],
      dropped,
    );
    expect(params.country).toBe("CA");
    expect(dropped.negated.has("country")).toBe(true);
  });

  it("does not repeat a value selected twice", () => {
    const params = syntaxFiltersToQueryParams([
      filter("device", ["desktop"]),
      filter("device", ["desktop", "mobile"]),
    ]);
    expect(params.device).toBe("desktop,mobile");
  });

  it("stops at the server's length cap and reports what it left out", () => {
    const keys = Array.from(
      { length: 100 },
      (_, i) => `feature-key-${String(i).padStart(4, "0").repeat(8)}`,
    );
    const dropped = emptyDroppedFilters();
    const params = syntaxFiltersToQueryParams([filter("flag", keys)], dropped);

    expect(params.featureKey.length).toBeLessThanOrEqual(
      SESSION_REPLAY_MAX_MULTI_FILTER_LENGTH,
    );
    expect(dropped.truncated.has("featureKey")).toBe(true);
  });

  // The router widened every multi-value param to the same cap; the UI must
  // not keep dropping selections the server would have accepted.
  it("keeps a country selection that fits the server's cap", () => {
    const dropped = emptyDroppedFilters();
    const countries = Array.from({ length: 30 }, (_, i) =>
      String.fromCharCode(65 + (i % 26), 65 + i),
    );
    const params = syntaxFiltersToQueryParams(
      [filter("country", countries)],
      dropped,
    );

    expect(params.country.split(",")).toHaveLength(countries.length);
    expect(dropped.truncated.size).toBe(0);
  });

  it("reports nothing dropped when the selection fits", () => {
    const dropped = emptyDroppedFilters();
    const params = syntaxFiltersToQueryParams(
      [filter("flag", ["one", "two"])],
      dropped,
    );
    expect(params.featureKey).toBe("one,two");
    expect(dropped.truncated.size).toBe(0);
    expect(dropped.negated.size).toBe(0);
  });
});
