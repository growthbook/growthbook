import { useEffect, useState } from "react";
import { CappingType } from "shared/types/fact-table";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import Checkbox from "@/ui/Checkbox";

type CappingMode = "" | "absolute" | "percentile";

function isUpperCapped(mode: CappingMode, value: number | undefined): boolean {
  if (mode === "absolute") return (value ?? 0) > 0;
  if (mode === "percentile") return (value ?? 0) > 0 && (value ?? 0) < 1;
  return false;
}

/** Legacy metrics: upper-tail capping only (SQL / Mixpanel upper bound). */
function LegacyMetricCappingSettingsFormContent({
  form,
  datasourceType,
  metricType,
}: {
  form: {
    watch: (path: string) => unknown;
    setValue: (path: string, value: unknown) => void;
  };
  datasourceType?: string;
  metricType: string;
}) {
  useEffect(() => {
    form.setValue("cappingSettings.lowerType", "");
    form.setValue("cappingSettings.lowerValue", 0);
    form.setValue("cappingSettings.lowerIgnoreZeros", false);
  }, [form]);

  const cappingSettings = form.watch("cappingSettings") as
    | { type?: CappingType; value?: number; ignoreZeros?: boolean }
    | undefined;
  const type = cappingSettings?.type;
  const mode: CappingMode =
    type === "percentile"
      ? "percentile"
      : type === "absolute"
        ? "absolute"
        : "";

  const cappingOptions = [
    { value: "", label: "No" },
    ...(metricType !== "ratio"
      ? [{ value: "absolute", label: "Absolute Capping" }]
      : []),
    ...(datasourceType !== "mixpanel"
      ? [{ value: "percentile", label: "Percentile Capping" }]
      : []),
  ];

  const upperValue = cappingSettings?.value ?? 0;
  const upperCapped = isUpperCapped(mode, upperValue);

  const [upperFocused, setUpperFocused] = useState(false);
  const [upperDraft, setUpperDraft] = useState("");

  useEffect(() => {
    setUpperFocused(false);
    setUpperDraft("");
  }, [mode]);

  const setCappingMode = (m: CappingMode) => {
    if (!m) {
      form.setValue("cappingSettings.type", "");
      form.setValue("cappingSettings.value", 0);
      form.setValue("cappingSettings.ignoreZeros", false);
      return;
    }
    if (m === "absolute") {
      form.setValue("cappingSettings.type", "absolute");
      form.setValue("cappingSettings.value", 0);
      form.setValue("cappingSettings.ignoreZeros", false);
      return;
    }
    form.setValue("cappingSettings.type", "percentile");
    form.setValue("cappingSettings.value", 0);
    form.setValue("cappingSettings.ignoreZeros", false);
  };

  const flushUpperInput = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      form.setValue("cappingSettings.type", "");
      form.setValue("cappingSettings.value", 0);
      form.setValue("cappingSettings.ignoreZeros", false);
      return;
    }
    const n = parseFloat(trimmed);
    if (Number.isNaN(n)) {
      form.setValue("cappingSettings.type", "");
      form.setValue("cappingSettings.value", 0);
      form.setValue("cappingSettings.ignoreZeros", false);
      return;
    }
    if (mode === "absolute") {
      if (n > 0) {
        form.setValue("cappingSettings.type", "absolute");
        form.setValue("cappingSettings.value", n);
      } else {
        form.setValue("cappingSettings.type", "");
        form.setValue("cappingSettings.value", 0);
        form.setValue("cappingSettings.ignoreZeros", false);
      }
    } else if (mode === "percentile") {
      if (n > 0 && n < 1) {
        form.setValue("cappingSettings.type", "percentile");
        form.setValue("cappingSettings.value", n);
      } else {
        form.setValue("cappingSettings.type", "");
        form.setValue("cappingSettings.value", 0);
        form.setValue("cappingSettings.ignoreZeros", false);
      }
    }
  };

  const upperDisplayValue = upperFocused
    ? upperDraft
    : upperCapped
      ? String(upperValue)
      : "";

  return (
    <div className="form-group">
      <SelectField
        label="Cap User Values"
        value={mode}
        onChange={(v: CappingMode) => {
          setCappingMode(v);
        }}
        sort={false}
        options={cappingOptions}
        helpText="Winsorization: limit how extreme aggregated user values can be on the high end. Does not apply to binomial metrics."
      />
      <div
        style={{
          display: mode ? "block" : "none",
        }}
        className="appbox p-3 bg-light"
      >
        {mode ? (
          <>
            <Field
              label={
                mode === "absolute" ? "Max Value per User" : "Percentile Value"
              }
              type="number"
              step="any"
              min="0"
              max={mode === "percentile" ? "1" : undefined}
              placeholder="None"
              value={upperDisplayValue}
              onFocus={() => {
                setUpperFocused(true);
                setUpperDraft(upperCapped ? String(upperValue) : "");
              }}
              onBlur={(e) => {
                flushUpperInput(e.target.value);
                setUpperFocused(false);
              }}
              onChange={(e) => setUpperDraft(e.target.value)}
              helpText={
                mode === "absolute"
                  ? "Maximum aggregated value per user"
                  : "All aggregated user values will be capped at this percentile (e.g. 0.99 = 99th percentile)"
              }
            />
            {mode === "percentile" && upperCapped ? (
              <Checkbox
                label="Ignore zeros"
                value={cappingSettings?.ignoreZeros ?? false}
                setValue={(v) => {
                  form.setValue("cappingSettings.ignoreZeros", v);
                }}
                id="cappingIgnoreZeros"
              />
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function getCappingMode(cappingSettings: {
  type?: CappingType;
  lowerType?: CappingType;
}): CappingMode {
  if (
    cappingSettings?.type === "percentile" ||
    cappingSettings?.lowerType === "percentile"
  ) {
    return "percentile";
  }
  if (
    cappingSettings?.type === "absolute" ||
    cappingSettings?.lowerType === "absolute"
  ) {
    return "absolute";
  }
  return "";
}

function isLowerCapped(
  mode: CappingMode,
  lowerValue: number | undefined,
): boolean {
  if (mode === "absolute") return (lowerValue ?? 0) > 0;
  if (mode === "percentile")
    return (lowerValue ?? 0) > 0 && (lowerValue ?? 0) < 1;
  return false;
}

function applyUpperValue(
  form: {
    getValues: (path: string) => unknown;
    setValue: (path: string, value: unknown) => void;
  },
  mode: CappingMode,
  n: number,
) {
  const capped = isUpperCapped(mode, n);
  if (!capped) {
    form.setValue("cappingSettings.value", 0);
    const lv = form.getValues("cappingSettings.lowerValue") as number;
    if (mode === "absolute" || mode === "percentile") {
      if (!isLowerCapped(mode, lv)) {
        form.setValue("cappingSettings.type", "");
        form.setValue("cappingSettings.lowerType", "");
        form.setValue("cappingSettings.ignoreZeros", false);
        form.setValue("cappingSettings.lowerIgnoreZeros", false);
      } else {
        form.setValue("cappingSettings.type", "");
      }
    }
  } else {
    form.setValue("cappingSettings.value", n);
    if (mode === "absolute") {
      form.setValue("cappingSettings.type", "absolute");
    } else if (mode === "percentile") {
      form.setValue("cappingSettings.type", "percentile");
    }
  }
}

function applyLowerValue(
  form: {
    getValues: (path: string) => unknown;
    setValue: (path: string, value: unknown) => void;
  },
  mode: CappingMode,
  n: number,
) {
  const capped = isLowerCapped(mode, n);
  if (!capped) {
    form.setValue("cappingSettings.lowerValue", 0);
    form.setValue("cappingSettings.lowerType", "");
    const uv = form.getValues("cappingSettings.value") as number;
    if (mode === "percentile" && !isUpperCapped("percentile", uv)) {
      form.setValue("cappingSettings.type", "");
      form.setValue("cappingSettings.ignoreZeros", false);
      form.setValue("cappingSettings.lowerIgnoreZeros", false);
    } else if (mode === "absolute" && !isUpperCapped("absolute", uv)) {
      form.setValue("cappingSettings.type", "");
      form.setValue("cappingSettings.ignoreZeros", false);
      form.setValue("cappingSettings.lowerIgnoreZeros", false);
    }
  } else {
    form.setValue("cappingSettings.lowerValue", n);
    form.setValue(
      "cappingSettings.lowerType",
      mode === "absolute" ? "absolute" : "percentile",
    );
    const uv = form.getValues("cappingSettings.value") as number;
    if (isUpperCapped(mode, uv)) {
      form.setValue(
        "cappingSettings.type",
        mode === "absolute" ? "absolute" : "percentile",
      );
    } else {
      form.setValue("cappingSettings.type", "");
    }
  }
}

/** Fact metrics: upper- and optional lower-tail capping (SQL warehouses only). */
function FactMetricCappingSettingsFormContent({
  form,
  datasourceType,
  metricType,
}: {
  form: {
    watch: (path: string) => unknown;
    getValues: (path: string) => unknown;
    setValue: (path: string, value: unknown) => void;
  };
  datasourceType?: string;
  metricType: string;
}) {
  const cappingSettings = form.watch("cappingSettings") as
    | {
        type?: CappingType;
        lowerType?: CappingType;
        value?: number;
        lowerValue?: number;
        ignoreZeros?: boolean;
        lowerIgnoreZeros?: boolean;
      }
    | undefined;
  const mode = getCappingMode(cappingSettings ?? {});

  const cappingOptions = [
    {
      value: "",
      label: "No",
    },
    ...(metricType !== "ratio"
      ? [
          {
            value: "absolute",
            label: "Absolute Capping",
          },
        ]
      : []),
    ...(datasourceType !== "mixpanel"
      ? [
          {
            value: "percentile",
            label: "Percentile Capping",
          },
        ]
      : []),
  ];

  const capType = cappingSettings?.type;
  const lowerValue = cappingSettings?.lowerValue ?? 0;
  const upperValue = cappingSettings?.value ?? 0;

  const upperCapped = isUpperCapped(mode, upperValue);
  const lowerCapped = isLowerCapped(mode, lowerValue);

  useEffect(() => {
    if (capType === "absolute") {
      form.setValue(
        "cappingSettings.lowerType",
        isLowerCapped("absolute", lowerValue) ? "absolute" : "",
      );
    } else if (capType === "percentile") {
      form.setValue(
        "cappingSettings.lowerType",
        isLowerCapped("percentile", lowerValue) ? "percentile" : "",
      );
    }
  }, [capType, lowerValue, form]);

  useEffect(() => {
    if (mode !== "absolute" && mode !== "percentile") return;
    if (capType) return;
    if (mode === "absolute" && isUpperCapped("absolute", upperValue)) {
      form.setValue("cappingSettings.type", "absolute");
    }
    if (mode === "percentile" && isUpperCapped("percentile", upperValue)) {
      form.setValue("cappingSettings.type", "percentile");
    }
  }, [mode, capType, upperValue, form]);

  const setCappingMode = (m: CappingMode) => {
    if (!m) {
      form.setValue("cappingSettings.type", "");
      form.setValue("cappingSettings.lowerType", "");
      form.setValue("cappingSettings.value", 0);
      form.setValue("cappingSettings.lowerValue", 0);
      form.setValue("cappingSettings.ignoreZeros", false);
      form.setValue("cappingSettings.lowerIgnoreZeros", false);
      return;
    }
    if (m === "absolute") {
      form.setValue("cappingSettings.type", "absolute");
      form.setValue("cappingSettings.value", 0);
      form.setValue("cappingSettings.lowerValue", 0);
      form.setValue("cappingSettings.lowerType", "");
      form.setValue("cappingSettings.ignoreZeros", false);
      form.setValue("cappingSettings.lowerIgnoreZeros", false);
      return;
    }
    form.setValue("cappingSettings.type", "percentile");
    form.setValue("cappingSettings.value", 0);
    form.setValue("cappingSettings.lowerValue", 0);
    form.setValue("cappingSettings.lowerType", "");
    form.setValue("cappingSettings.ignoreZeros", false);
    form.setValue("cappingSettings.lowerIgnoreZeros", false);
  };

  const [upperFocused, setUpperFocused] = useState(false);
  const [upperDraft, setUpperDraft] = useState("");
  const [lowerFocused, setLowerFocused] = useState(false);
  const [lowerDraft, setLowerDraft] = useState("");

  useEffect(() => {
    setUpperFocused(false);
    setLowerFocused(false);
    setUpperDraft("");
    setLowerDraft("");
  }, [mode]);

  const flushUpperInput = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      applyUpperValue(form, mode, 0);
      return;
    }
    const n = parseFloat(trimmed);
    if (Number.isNaN(n)) {
      applyUpperValue(form, mode, 0);
      return;
    }
    applyUpperValue(form, mode, n);
  };

  const flushLowerInput = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      applyLowerValue(form, mode, 0);
      return;
    }
    const n = parseFloat(trimmed);
    if (Number.isNaN(n)) {
      applyLowerValue(form, mode, 0);
      return;
    }
    applyLowerValue(form, mode, n);
  };

  const upperDisplayValue = upperFocused
    ? upperDraft
    : upperCapped
      ? String(upperValue)
      : "";
  const lowerDisplayValue = lowerFocused
    ? lowerDraft
    : lowerCapped
      ? String(lowerValue)
      : "";

  return (
    <div className="form-group">
      <SelectField
        label="Cap User Values"
        value={mode}
        onChange={(v: CappingMode) => {
          setCappingMode(v);
        }}
        sort={false}
        options={cappingOptions}
        helpText="Winsorization: limit extreme aggregated user values on the upper tail, lower tail, or both (SQL-based Fact Metrics). Choose a cap type, then enter values or leave each field empty (None) for an uncapped tail."
      />
      <div
        style={{
          display: mode ? "block" : "none",
        }}
        className="appbox p-3 bg-light"
      >
        {mode ? (
          <>
            <Field
              label={
                mode === "absolute"
                  ? "Upper tail (ceiling)"
                  : "Upper tail (ceiling percentile)"
              }
              type="number"
              step="any"
              min="0"
              max={mode === "percentile" ? "1" : undefined}
              placeholder="None"
              value={upperDisplayValue}
              onFocus={() => {
                setUpperFocused(true);
                setUpperDraft(upperCapped ? String(upperValue) : "");
              }}
              onBlur={(e) => {
                flushUpperInput(e.target.value);
                setUpperFocused(false);
              }}
              onChange={(e) => setUpperDraft(e.target.value)}
              helpText={
                mode === "absolute"
                  ? "Maximum aggregated value per user. Leave empty for no upper cap."
                  : "Quantile for the ceiling (e.g. 0.99). Leave empty for no upper cap."
              }
            />
            <Field
              label={
                mode === "absolute"
                  ? "Lower tail (floor)"
                  : "Lower tail (floor percentile)"
              }
              type="number"
              step="any"
              min="0"
              max={mode === "percentile" ? "1" : undefined}
              placeholder="None"
              value={lowerDisplayValue}
              onFocus={() => {
                setLowerFocused(true);
                setLowerDraft(lowerCapped ? String(lowerValue) : "");
              }}
              onBlur={(e) => {
                flushLowerInput(e.target.value);
                setLowerFocused(false);
              }}
              onChange={(e) => setLowerDraft(e.target.value)}
              helpText={
                mode === "absolute"
                  ? "Values below this are raised to this floor. Leave empty for no lower cap."
                  : "Quantile for the floor (e.g. 0.05). Leave empty for no lower cap. Must be less than the upper percentile when both are set."
              }
            />
            {mode === "percentile" && (upperCapped || lowerCapped) ? (
              <Checkbox
                label="Ignore zeros"
                value={
                  (cappingSettings?.ignoreZeros ?? false) ||
                  (cappingSettings?.lowerIgnoreZeros ?? false)
                }
                setValue={(v) => {
                  form.setValue("cappingSettings.ignoreZeros", v);
                  form.setValue("cappingSettings.lowerIgnoreZeros", v);
                }}
                id="cappingIgnoreZeros"
              />
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

export function MetricCappingSettingsForm({
  form,
  datasourceType,
  metricType,
  /** Lower-tail winsorization is supported for Fact Metrics (SQL) only, not Legacy or Mixpanel. */
  allowLowerTailCapping = false,
}: {
  form: {
    watch: (path: string) => unknown;
    getValues?: (path: string) => unknown;
    setValue: (path: string, value: unknown) => void;
  };
  datasourceType?: string;
  metricType: string;
  allowLowerTailCapping?: boolean;
}) {
  if (allowLowerTailCapping) {
    return (
      <FactMetricCappingSettingsFormContent
        form={
          form as {
            watch: (path: string) => unknown;
            getValues: (path: string) => unknown;
            setValue: (path: string, value: unknown) => void;
          }
        }
        datasourceType={datasourceType}
        metricType={metricType}
      />
    );
  }
  return (
    <LegacyMetricCappingSettingsFormContent
      form={form}
      datasourceType={datasourceType}
      metricType={metricType}
    />
  );
}
