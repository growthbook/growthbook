import { useEffect, useState } from "react";
import { Box, Card } from "@radix-ui/themes";
import { CappingType } from "shared/types/fact-table";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import Checkbox from "@/ui/Checkbox";

type CappingMode = "" | "absolute" | "percentile";

type TailSettings = {
  type?: CappingType;
  value?: number;
  ignoreZeros?: boolean;
} | null;

function isUpperCapped(mode: CappingMode, value: number | undefined): boolean {
  if (mode === "absolute") return (value ?? 0) > 0;
  if (mode === "percentile") return (value ?? 0) > 0 && (value ?? 0) < 1;
  return false;
}

function isLowerCapped(
  mode: CappingMode,
  lowerValue: number | undefined,
): boolean {
  if (mode === "absolute") {
    return lowerValue !== undefined && Number.isFinite(lowerValue);
  }
  if (mode === "percentile")
    return (lowerValue ?? 0) > 0 && (lowerValue ?? 0) < 1;
  return false;
}

function getCappingMode(cappingSettings: { type?: CappingType }): CappingMode {
  if (cappingSettings?.type === "percentile") {
    return "percentile";
  }
  if (cappingSettings?.type === "absolute") {
    return "absolute";
  }
  return "";
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
      ? [{ value: "absolute", label: "Absolute capping" }]
      : []),
    ...(datasourceType !== "mixpanel"
      ? [{ value: "percentile", label: "Percentile capping" }]
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
        label="Cap user values"
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
                mode === "absolute" ? "Max value per user" : "Percentile value"
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

/**
 * A single independent capping tail (upper or lower) for Fact Metrics. Each
 * tail has its own type selector and value, writing to its own settings object
 * so the two tails can use different types (e.g. absolute-0 floor + percentile
 * ceiling).
 */
function FactCappingTailEditor({
  form,
  path,
  isLower,
  metricType,
  datasourceType,
  idSuffix,
}: {
  form: {
    watch: (path: string) => unknown;
    setValue: (path: string, value: unknown) => void;
  };
  /** Form path of this tail's settings object. */
  path: "cappingSettings" | "lowerCappingSettings";
  isLower: boolean;
  metricType: string;
  datasourceType?: string;
  idSuffix: string;
}) {
  const settings = form.watch(path) as TailSettings;
  const mode = getCappingMode(settings ?? {});

  const cappingOptions = [
    { value: "", label: "No" },
    ...(metricType !== "ratio"
      ? [{ value: "absolute", label: "Absolute capping" }]
      : []),
    ...(datasourceType !== "mixpanel"
      ? [{ value: "percentile", label: "Percentile capping" }]
      : []),
  ];

  const value = settings?.value ?? 0;
  const capped = isLower
    ? isLowerCapped(mode, settings?.value)
    : isUpperCapped(mode, value);

  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    setFocused(false);
    setDraft("");
  }, [mode]);

  // Disabling a tail: the lower tail is an optional object (null = no cap); the
  // upper tail is always present, so reset it to an empty/no-cap object.
  const clearTail = () => {
    if (isLower) {
      form.setValue(path, null);
    } else {
      form.setValue(path, { type: "", value: 0, ignoreZeros: false });
    }
  };

  const writeTail = (m: CappingMode, n: number) => {
    form.setValue(path, {
      type: m,
      value: n,
      ignoreZeros: settings?.ignoreZeros ?? false,
    });
  };

  const setCappingMode = (m: CappingMode) => {
    if (!m) {
      clearTail();
      return;
    }
    // Start a newly-enabled tail with a 0 value; the user then enters a value.
    form.setValue(path, {
      type: m,
      value: 0,
      ignoreZeros: settings?.ignoreZeros ?? false,
    });
  };

  const flushInput = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      clearTail();
      return;
    }
    const n = parseFloat(trimmed);
    if (Number.isNaN(n)) {
      clearTail();
      return;
    }
    const nowCapped = isLower ? isLowerCapped(mode, n) : isUpperCapped(mode, n);
    if (!nowCapped) {
      clearTail();
      return;
    }
    writeTail(mode, n);
  };

  const displayValue = focused ? draft : capped ? String(value) : "";

  const label = isLower
    ? mode === "absolute"
      ? "Lower tail (floor)"
      : "Lower tail (floor percentile)"
    : mode === "absolute"
      ? "Upper tail (ceiling)"
      : "Upper tail (ceiling percentile)";

  const valueHelpText = isLower
    ? mode === "absolute"
      ? "Values below this are raised to this floor. Must be less than the ceiling when both use absolute capping."
      : "Quantile for the floor (e.g. 0.05). Must be less than the upper percentile when both use percentile capping."
    : mode === "absolute"
      ? "Maximum aggregated value per user."
      : "Quantile for the ceiling (e.g. 0.99).";

  const selectHelpText = isLower
    ? "Lower-tail winsorization: raise extreme low aggregated user values."
    : "Upper-tail winsorization: limit extreme high aggregated user values.";

  return (
    <Box mb="3">
      <SelectField
        label={isLower ? "Cap low values" : "Cap high values"}
        value={mode}
        onChange={(v: CappingMode) => {
          setCappingMode(v);
        }}
        sort={false}
        options={cappingOptions}
        helpText={selectHelpText}
      />
      {mode ? (
        <Card>
          <Field
            label={label}
            type="number"
            step="any"
            // Lower absolute floors may be zero or negative, so no min there.
            min={mode === "percentile" ? "0" : isLower ? undefined : "0"}
            max={mode === "percentile" ? "1" : undefined}
            placeholder="None"
            value={displayValue}
            onFocus={() => {
              setFocused(true);
              setDraft(capped ? String(value) : "");
            }}
            onBlur={(e) => {
              flushInput(e.target.value);
              setFocused(false);
            }}
            onChange={(e) => setDraft(e.target.value)}
            helpText={valueHelpText}
          />
          {mode === "percentile" && capped ? (
            <Checkbox
              label="Ignore zeros"
              value={settings?.ignoreZeros ?? false}
              setValue={(v) => {
                form.setValue(path, {
                  type: settings?.type ?? mode,
                  value: settings?.value ?? 0,
                  ignoreZeros: v,
                });
              }}
              id={`cappingIgnoreZeros${idSuffix}`}
            />
          ) : null}
        </Card>
      ) : null}
    </Box>
  );
}

/** Fact metrics: independent upper- and lower-tail capping (SQL warehouses only). */
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
  return (
    <div className="form-group">
      <FactCappingTailEditor
        form={form}
        path="cappingSettings"
        isLower={false}
        metricType={metricType}
        datasourceType={datasourceType}
        idSuffix="Upper"
      />
      <FactCappingTailEditor
        form={form}
        path="lowerCappingSettings"
        isLower={true}
        metricType={metricType}
        datasourceType={datasourceType}
        idSuffix="Lower"
      />
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
