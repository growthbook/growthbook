import {
  factMetricValidator,
  resolveCappingSettingsPatch,
  validateFactMetricCapping,
  validateCappingSettingsOrdering,
  validateCappingSettingsIgnoreZerosConsistency,
  validateCappingSettingsMetricTypeCompatibility,
  validateCappingSettingsValueEntered,
} from "../../src/validators/fact-table";
import {
  apiFactMetricValidator,
  postFactMetricValidator,
  updateFactMetricValidator,
} from "../../src/validators/fact-metrics";
import { postBulkImportFactsValidator } from "../../src/validators/bulk-import";

describe("top-level lower capping settings", () => {
  const lowerCappingSettings = { type: "absolute", value: 0 };
  const createBody = {
    name: "Revenue",
    metricType: "mean",
    numerator: { factTableId: "ft_events", column: "value" },
    lowerCappingSettings,
  };

  it("accepts lower-only capping in external create and bulk import requests", () => {
    const created = postFactMetricValidator.bodySchema.parse(createBody);
    const bulk = postBulkImportFactsValidator.bodySchema.parse({
      factMetrics: [{ id: "fact__revenue", data: createBody }],
    });
    expect(created.lowerCappingSettings).toEqual(lowerCappingSettings);
    expect(created).not.toHaveProperty("cappingSettings");
    expect(bulk.factMetrics?.[0].data.lowerCappingSettings).toEqual(
      lowerCappingSettings,
    );
  });

  it.each([null, lowerCappingSettings])(
    "accepts the same lower field in internal, external write, and response schemas: %j",
    (lowerCappingSettings) => {
      const payload = { lowerCappingSettings };
      expect(
        factMetricValidator.pick({ lowerCappingSettings: true }).parse(payload),
      ).toEqual(payload);
      expect(updateFactMetricValidator.bodySchema.parse(payload)).toEqual(
        payload,
      );
      expect(
        apiFactMetricValidator
          .pick({ lowerCappingSettings: true })
          .parse(payload),
      ).toEqual(payload);
    },
  );

  it("preserves upper-only requests without adding a lower cap", () => {
    const payload = { cappingSettings: { type: "percentile", value: 0.99 } };
    expect(updateFactMetricValidator.bodySchema.parse(payload)).toEqual(
      payload,
    );
  });
});

describe("validateCappingSettingsMetricTypeCompatibility", () => {
  const percentileUpper = { type: "percentile" as const, value: 0.99 };
  const percentileLower = { type: "percentile" as const, value: 0.01 };
  const absoluteUpper = { type: "absolute" as const, value: 15.78923 };
  const absoluteLower = { type: "absolute" as const, value: 10.19583 };

  it("allows percentile capping on both tails for ratio metrics", () => {
    expect(() =>
      validateCappingSettingsMetricTypeCompatibility(
        "ratio",
        percentileUpper,
        percentileLower,
      ),
    ).not.toThrow();
  });

  it("allows uncapped ratio metrics", () => {
    expect(() =>
      validateCappingSettingsMetricTypeCompatibility(
        "ratio",
        { type: "", value: 0 },
        null,
      ),
    ).not.toThrow();
  });

  it("rejects an absolute upper cap on a ratio metric", () => {
    expect(() =>
      validateCappingSettingsMetricTypeCompatibility(
        "ratio",
        absoluteUpper,
        null,
      ),
    ).toThrow(/Ratio metrics support only percentile capping/);
  });

  it("rejects an absolute lower cap on a ratio metric", () => {
    // Regression: this is the shape found on fact__2CdFPYWVC8mgxjSBDWqhCL.
    expect(() =>
      validateCappingSettingsMetricTypeCompatibility(
        "ratio",
        percentileUpper,
        absoluteLower,
      ),
    ).toThrow(/Ratio metrics support only percentile capping/);
  });

  it.each([0, -10])(
    "rejects an absolute lower floor of %s on a ratio metric",
    (value) => {
      expect(() =>
        validateCappingSettingsMetricTypeCompatibility(
          "ratio",
          percentileUpper,
          { type: "absolute", value },
        ),
      ).toThrow(/Ratio metrics support only percentile capping/);
    },
  );

  it("rejects absolute caps on both tails of a ratio metric", () => {
    expect(() =>
      validateCappingSettingsMetricTypeCompatibility(
        "ratio",
        absoluteUpper,
        absoluteLower,
      ),
    ).toThrow(/Ratio metrics support only percentile capping/);
  });

  it("allows absolute capping for non-ratio metric types", () => {
    for (const metricType of ["mean", "proportion", "retention"]) {
      expect(() =>
        validateCappingSettingsMetricTypeCompatibility(
          metricType,
          absoluteUpper,
          absoluteLower,
        ),
      ).not.toThrow();
    }
  });

  it("treats 'none'/empty tail types as not absolute", () => {
    expect(() =>
      validateCappingSettingsMetricTypeCompatibility(
        "ratio",
        { type: "none", value: 0 },
        { type: "", value: 0 },
      ),
    ).not.toThrow();
  });
});

describe("validateCappingSettingsIgnoreZerosConsistency", () => {
  const upperIgnore = {
    type: "percentile" as const,
    value: 0.99,
    ignoreZeros: true,
  };
  const upperKeep = {
    type: "percentile" as const,
    value: 0.99,
    ignoreZeros: false,
  };
  const lowerIgnore = {
    type: "percentile" as const,
    value: 0.01,
    ignoreZeros: true,
  };
  const lowerKeep = {
    type: "percentile" as const,
    value: 0.01,
    ignoreZeros: false,
  };

  it("allows both tails ignoring zeros", () => {
    expect(() =>
      validateCappingSettingsIgnoreZerosConsistency(upperIgnore, lowerIgnore),
    ).not.toThrow();
  });

  it("allows neither tail ignoring zeros", () => {
    expect(() =>
      validateCappingSettingsIgnoreZerosConsistency(upperKeep, lowerKeep),
    ).not.toThrow();
  });

  it("treats missing ignoreZeros the same as false", () => {
    expect(() =>
      validateCappingSettingsIgnoreZerosConsistency(
        { type: "percentile", value: 0.99 },
        { type: "percentile", value: 0.01, ignoreZeros: false },
      ),
    ).not.toThrow();
    // null on one side, undefined on the other → both effectively false.
    expect(() =>
      validateCappingSettingsIgnoreZerosConsistency(
        { type: "absolute", value: 15, ignoreZeros: null },
        { type: "absolute", value: 1 },
      ),
    ).not.toThrow();
  });

  it("rejects ignoring zeros on the upper percentile tail only", () => {
    expect(() =>
      validateCappingSettingsIgnoreZerosConsistency(upperIgnore, lowerKeep),
    ).toThrow(/both percentile capping tails or on neither/);
  });

  it("rejects ignoring zeros on the lower percentile tail only", () => {
    expect(() =>
      validateCappingSettingsIgnoreZerosConsistency(upperKeep, lowerIgnore),
    ).toThrow(/both percentile capping tails or on neither/);
  });

  it("ignores the inactive tail's flag when only one tail caps", () => {
    // Upper capping only: a stale ignoreZeros on the (inactive) lower tail must
    // not trigger the mismatch error.
    expect(() =>
      validateCappingSettingsIgnoreZerosConsistency(upperIgnore, {
        type: "none",
        value: 0,
        ignoreZeros: false,
      }),
    ).not.toThrow();
    // No lower tail at all.
    expect(() =>
      validateCappingSettingsIgnoreZerosConsistency(upperIgnore, null),
    ).not.toThrow();
    // Lower capping only, with no upper tail configured.
    expect(() =>
      validateCappingSettingsIgnoreZerosConsistency(
        { type: "none", value: 0 },
        lowerIgnore,
      ),
    ).not.toThrow();
  });

  it("only applies to percentile capping, ignoring absolute tails", () => {
    // ignoreZeros is meaningless for absolute capping, so a percentile tail
    // that ignores zeros paired with an absolute tail (regardless of its flag)
    // must pass.
    expect(() =>
      validateCappingSettingsIgnoreZerosConsistency(upperIgnore, {
        type: "absolute",
        value: 5,
        ignoreZeros: false,
      }),
    ).not.toThrow();
    expect(() =>
      validateCappingSettingsIgnoreZerosConsistency(upperIgnore, {
        type: "absolute",
        value: 5,
        ignoreZeros: true,
      }),
    ).not.toThrow();
    // Absolute upper + percentile lower that ignores zeros.
    expect(() =>
      validateCappingSettingsIgnoreZerosConsistency(
        { type: "absolute", value: 100, ignoreZeros: false },
        lowerIgnore,
      ),
    ).not.toThrow();
    // Both tails absolute with differing flags is irrelevant.
    expect(() =>
      validateCappingSettingsIgnoreZerosConsistency(
        { type: "absolute", value: 100, ignoreZeros: true },
        { type: "absolute", value: 5, ignoreZeros: false },
      ),
    ).not.toThrow();
  });
});

describe("validateCappingSettingsValueEntered", () => {
  it("skips tails with no capping mode selected", () => {
    expect(() =>
      validateCappingSettingsValueEntered({ type: "", value: 0 }, false),
    ).not.toThrow();
    expect(() =>
      validateCappingSettingsValueEntered({ type: "none", value: 0 }, false),
    ).not.toThrow();
    expect(() => validateCappingSettingsValueEntered(null, true)).not.toThrow();
    expect(() =>
      validateCappingSettingsValueEntered(undefined, false),
    ).not.toThrow();
  });

  it("requires a percentile value strictly within (0, 1)", () => {
    expect(() =>
      validateCappingSettingsValueEntered({ type: "percentile" }, false),
    ).toThrow(/greater than 0 and less than 1/);
    expect(() =>
      validateCappingSettingsValueEntered(
        { type: "percentile", value: 0 },
        false,
      ),
    ).toThrow(/greater than 0 and less than 1/);
    expect(() =>
      validateCappingSettingsValueEntered(
        { type: "percentile", value: 1 },
        true,
      ),
    ).toThrow(/greater than 0 and less than 1/);
    expect(() =>
      validateCappingSettingsValueEntered(
        { type: "percentile", value: 0.99 },
        false,
      ),
    ).not.toThrow();
  });

  it("requires the upper absolute ceiling to be greater than 0", () => {
    expect(() =>
      validateCappingSettingsValueEntered({ type: "absolute" }, false),
    ).toThrow(/finite number greater than 0/);
    expect(() =>
      validateCappingSettingsValueEntered(
        { type: "absolute", value: 0 },
        false,
      ),
    ).toThrow(/finite number greater than 0/);
    expect(() =>
      validateCappingSettingsValueEntered(
        { type: "absolute", value: 15 },
        false,
      ),
    ).not.toThrow();
  });

  it("allows any finite absolute floor (including 0 and negatives)", () => {
    expect(() =>
      validateCappingSettingsValueEntered({ type: "absolute", value: 0 }, true),
    ).not.toThrow();
    expect(() =>
      validateCappingSettingsValueEntered(
        { type: "absolute", value: -5 },
        true,
      ),
    ).not.toThrow();
    // But a floor with no value entered is still rejected.
    expect(() =>
      validateCappingSettingsValueEntered({ type: "absolute" }, true),
    ).toThrow(/finite number/);
  });
});

describe("capping writes", () => {
  const metric = {
    metricType: "mean" as const,
    cappingSettings: {
      type: "percentile" as const,
      value: 0.99,
      ignoreZeros: true,
    },
    lowerCappingSettings: {
      type: "percentile" as const,
      value: 0.05,
      ignoreZeros: true,
    },
  };

  it.each(["cappingSettings", "lowerCappingSettings"] as const)(
    "rejects invalid values on %s without altering the original",
    (key) => {
      for (const value of [undefined, 0, -1, 1, 5, NaN, Infinity, -Infinity]) {
        expect(() =>
          resolveCappingSettingsPatch({ [key]: { type: "percentile", value } }),
        ).toThrow();
        if (value !== undefined) {
          expect(() =>
            resolveCappingSettingsPatch(
              { [key]: { type: "percentile", value } },
              metric,
            ),
          ).toThrow();
        }
      }
      expect(metric.lowerCappingSettings.value).toBe(0.05);
      expect(metric.cappingSettings.value).toBe(0.99);
    },
  );

  it("preserves omissions and same-type partial updates", () => {
    expect(resolveCappingSettingsPatch({}, metric)).toEqual({});
    expect(
      resolveCappingSettingsPatch(
        { lowerCappingSettings: { type: "percentile", ignoreZeros: false } },
        metric,
      ),
    ).toEqual({
      lowerCappingSettings: {
        type: "percentile",
        value: 0.05,
        ignoreZeros: false,
      },
    });
  });

  it.each(["cappingSettings", "lowerCappingSettings"] as const)(
    "requires an explicit value when changing %s type",
    (key) => {
      expect(() =>
        resolveCappingSettingsPatch({ [key]: { type: "absolute" } }, metric),
      ).toThrow(`${key}.value`);
      expect(() =>
        resolveCappingSettingsPatch(
          { [key]: { type: "percentile" } },
          {
            ...metric,
            [key]: { type: "absolute", value: 0.5 },
          },
        ),
      ).toThrow(`${key}.value`);
    },
  );

  it.each([0, -10, 10])(
    "preserves an explicit absolute floor of %s",
    (value) => {
      expect(
        resolveCappingSettingsPatch({
          lowerCappingSettings: { type: "absolute", value },
        }),
      ).toEqual({
        lowerCappingSettings: { type: "absolute", value, ignoreZeros: false },
      });
    },
  );

  it.each(["", "none"] as const)(
    "normalizes only an explicit disable (%s)",
    (type) => {
      expect(
        resolveCappingSettingsPatch(
          { cappingSettings: { type }, lowerCappingSettings: { type } },
          metric,
        ),
      ).toEqual({
        cappingSettings: { type: "", value: 0, ignoreZeros: false },
        lowerCappingSettings: null,
      });
      expect(
        resolveCappingSettingsPatch({ lowerCappingSettings: null }, metric),
      ).toEqual({ lowerCappingSettings: null });
    },
  );

  it("validates the merged pair and keeps mixed types independent", () => {
    expect(() =>
      validateFactMetricCapping(
        {
          ...metric,
          lowerCappingSettings: {
            type: "percentile",
            value: 0.999,
            ignoreZeros: true,
          },
        },
        metric,
      ),
    ).toThrow(/less than upper/);
    expect(() =>
      validateFactMetricCapping(
        {
          ...metric,
          lowerCappingSettings: {
            type: "percentile",
            value: 0.05,
            ignoreZeros: false,
          },
        },
        metric,
      ),
    ).toThrow(/Ignore zeros/);
    expect(() =>
      validateCappingSettingsOrdering(
        { type: "absolute", value: 10 },
        { type: "absolute", value: 10 },
      ),
    ).toThrow(/less than upper/);
    expect(() =>
      validateFactMetricCapping(
        { ...metric, lowerCappingSettings: { type: "absolute", value: 100 } },
        metric,
      ),
    ).not.toThrow();
  });

  it("preserves unchanged legacy values but validates the full pair when edited", () => {
    const legacy = {
      ...metric,
      cappingSettings: { type: "percentile" as const, value: 0 },
    };
    expect(() =>
      validateFactMetricCapping({ ...legacy }, legacy),
    ).not.toThrow();
    expect(resolveCappingSettingsPatch(legacy, legacy)).toEqual({
      cappingSettings: legacy.cappingSettings,
      lowerCappingSettings: legacy.lowerCappingSettings,
    });
    expect(() =>
      validateFactMetricCapping(
        { ...legacy, lowerCappingSettings: null },
        legacy,
      ),
    ).toThrow(/cappingSettings.value/);
  });

  it.each([
    "quantile",
    "proportion",
    "retention",
    "dailyParticipation",
    "funnel",
  ] as const)(
    "rejects new caps on %s and requires explicit disabling on type changes",
    (metricType) => {
      expect(() =>
        validateFactMetricCapping({ ...metric, metricType }),
      ).toThrow(/not supported/);
      expect(() =>
        validateFactMetricCapping({ ...metric, metricType }, metric),
      ).toThrow(/not supported/);
      expect(() =>
        validateFactMetricCapping(
          {
            ...metric,
            metricType,
            cappingSettings: { type: "", value: 0 },
            lowerCappingSettings: null,
          },
          metric,
        ),
      ).not.toThrow();
    },
  );

  it("applies ratio absolute restrictions only on creation", () => {
    const ratio = {
      ...metric,
      metricType: "ratio" as const,
      lowerCappingSettings: { type: "absolute" as const, value: 0 },
    };
    expect(() => validateFactMetricCapping(ratio)).toThrow(/Ratio metrics/);
    expect(() => validateFactMetricCapping(ratio, ratio)).not.toThrow();
    expect(() =>
      validateFactMetricCapping(
        { ...ratio, lowerCappingSettings: { type: "absolute", value: -10 } },
        ratio,
      ),
    ).not.toThrow();
  });

  it.each(["numerator", "denominator"] as const)(
    "rejects a new user filter on %s with either tail",
    (side) => {
      const filtered = {
        ...metric,
        cappingSettings: { type: "" as const, value: 0 },
        [side]: {
          factTableId: "ft",
          column: "$$distinctUsers",
          aggregateFilterColumn: "amount",
        },
      };
      expect(() => validateFactMetricCapping(filtered, metric)).toThrow(
        /user filter/,
      );
      expect(() =>
        validateFactMetricCapping(
          { ...filtered, lowerCappingSettings: null },
          metric,
        ),
      ).not.toThrow();
    },
  );

  it("rejects obsolete nested lower settings instead of stripping them", () => {
    expect(() =>
      updateFactMetricValidator.bodySchema.parse({
        cappingSettings: {
          type: "none",
          lowerCappingSettings: { type: "absolute", value: 0 },
        },
      }),
    ).toThrow();
  });
});
