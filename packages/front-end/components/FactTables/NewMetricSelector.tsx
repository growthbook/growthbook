import { Box, Card, Flex, Grid, Text } from "@radix-ui/themes";
import { FactMetricInterface } from "back-end/types/fact-table";
import { useState } from "react";
import { PiX } from "react-icons/pi";
import { useForm } from "react-hook-form";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/components/Radix/Button";
import SelectField from "@/components/Forms/SelectField";
import PopoverForm from "@/components/Radix/PopoverForm";
import Field from "@/components/Forms/Field";
import Checkbox from "@/components/Radix/Checkbox";

interface VariantSettings {
  name: string;

  conversionDelayValue?: number;
  conversionDelayUnit?: "weeks" | "days" | "hours" | "minutes";
  conversionWindowType?: "" | "conversion" | "lookback";
  conversionWindowValue?: number;
  conversionWindowUnit?: "weeks" | "days" | "hours" | "minutes";

  cappingType?: "" | "absolute" | "percentile";
  cappingValue?: number;
  cappingIgnoreZeros?: boolean;

  quantileLevel?: number;
  quantileIgnoreZeros?: boolean;

  additionalFilters?: string[];

  numeratorAggregateFilter?: string;
  denominatorAggregateFilter?: string;
}

export default function NewMetricSelector() {
  const { factMetrics, getFactMetricById } = useDefinitions();
  const [metrics, setMetrics] = useState<
    {
      id: string;
      variants: VariantSettings[];
    }[]
  >([]);

  const metricOptions = factMetrics
    .filter((m) => !metrics.some((mm) => mm.id === m.id))
    .map((m) => ({
      value: m.id,
      label: m.name,
    }));

  return (
    <Box mb="5">
      <SelectField
        options={metricOptions}
        onChange={(selected) => {
          setMetrics((prev) => {
            const existing = prev.find((m) => m.id === selected);
            if (existing) {
              return prev;
            } else {
              return [...prev, { id: selected, variants: [] }];
            }
          });
        }}
        initialOption="Add a metric..."
        value=""
        sort={false}
      />
      <Grid columns="1fr 1fr 1fr" gap="2" mt="2">
        {metrics.map(({ id, variants }) => {
          const metric = getFactMetricById(id);
          if (!metric) return null;
          return (
            <SelectedMetric
              key={id}
              metric={metric}
              variants={variants}
              onSave={(settings) => {
                setMetrics((prev) => {
                  const newMetrics = [...prev];
                  const index = newMetrics.findIndex((m) => m.id === id);
                  if (index !== -1) {
                    newMetrics[index].variants = settings;
                  }
                  return newMetrics;
                });
              }}
              onRemove={() => {
                setMetrics((prev) => prev.filter((m) => m.id !== id));
              }}
            />
          );
        })}
      </Grid>
    </Box>
  );
}

function SelectedMetric({
  metric,
  variants,
  onSave,
  onRemove,
}: {
  metric: FactMetricInterface;
  variants: VariantSettings[];
  onSave: (settings: VariantSettings[]) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ position: "relative" }}>
      <Button
        variant="soft"
        size="xs"
        color="red"
        onClick={onRemove}
        style={{ position: "absolute", top: -3, right: -3 }}
      >
        <PiX />
      </Button>
      <Flex direction="column" gap="0">
        <Flex gap="1" align="center">
          <Text size="2" weight="bold">
            {metric.name}
          </Text>
          <Box>
            <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
              +&nbsp;Variant
            </Button>

            {open && (
              <AdhocVariantForm
                metric={metric}
                onSave={(settings) => {
                  onSave([...variants, settings]);
                  setOpen(false);
                }}
                close={() => setOpen(false)}
              />
            )}
          </Box>
        </Flex>
        {variants.map((variant, index) => (
          <Flex gap="2" align="center" key={index}>
            <Text>└</Text>
            <Box flexGrow="1">
              <Text>{variant.name}</Text>
            </Box>
            <Button
              variant="ghost"
              size="xs"
              color="red"
              onClick={() => {
                const newVariants = [...variants];
                newVariants.splice(index, 1);
                onSave(newVariants);
              }}
            >
              <PiX />
            </Button>
          </Flex>
        ))}
      </Flex>
    </Card>
  );
}

function simplifyVariantSettings(
  metric: FactMetricInterface,
  settings: VariantSettings
) {
  // Remove overrides that are identical to the original metric
  const newSettings = { ...settings };
  if (settings.conversionDelayValue === metric.windowSettings.delayValue) {
    delete newSettings.conversionDelayValue;
  }
  if (settings.conversionDelayUnit === metric.windowSettings.delayUnit) {
    delete newSettings.conversionDelayUnit;
  }
  if (settings.cappingType === metric.cappingSettings.type) {
    delete newSettings.cappingType;
  }
  if (settings.cappingValue === metric.cappingSettings.value) {
    delete newSettings.cappingValue;
  }
  if (settings.cappingIgnoreZeros === !!metric.cappingSettings.ignoreZeros) {
    delete newSettings.cappingIgnoreZeros;
  }

  return newSettings;
}

function getDefaultName(
  metric: FactMetricInterface,
  settings: VariantSettings
) {
  const nameParts: string[] = [];

  if (
    settings.conversionDelayUnit !== undefined ||
    settings.conversionDelayValue !== undefined
  ) {
    nameParts.push(
      `[Delay: ${
        settings.conversionDelayValue ?? metric.windowSettings.delayValue
      } ${settings.conversionDelayUnit ?? metric.windowSettings.delayUnit}]`
    );
  }
  if (
    settings.cappingType !== undefined ||
    settings.cappingValue !== undefined ||
    settings.cappingIgnoreZeros !== undefined
  ) {
    if (!(settings.cappingType ?? metric.cappingSettings.type)) {
      nameParts.push("[Uncapped]");
    } else {
      const type = settings.cappingType ?? metric.cappingSettings.type;
      const value = settings.cappingValue ?? metric.cappingSettings.value;
      const ignoreZeros =
        settings.cappingIgnoreZeros ?? metric.cappingSettings.ignoreZeros;

      nameParts.push(
        `[Capping: ${
          type === "percentile"
            ? `P${value * 100}${ignoreZeros ? " Ignore Zeros" : ""}`
            : type === "absolute"
            ? value
            : ""
        }]`
      );
    }
  }

  return `${metric.name} ${nameParts.join(" ")}`;
}

function AdhocVariantForm({
  metric,
  onSave,
  close,
}: {
  metric: FactMetricInterface;
  onSave: (settings: VariantSettings) => void;
  close: () => void;
}) {
  const form = useForm<VariantSettings>({
    defaultValues: {
      name: "",
    },
  });

  const value = {
    name: form.watch("name"),
    conversionDelayValue: form.watch("conversionDelayValue"),
    conversionDelayUnit: form.watch("conversionDelayUnit"),
    conversionWindowType: form.watch("conversionWindowType"),
    conversionWindowValue: form.watch("conversionWindowValue"),
    conversionWindowUnit: form.watch("conversionWindowUnit"),
    cappingType: form.watch("cappingType"),
    cappingValue: form.watch("cappingValue"),
    cappingIgnoreZeros: form.watch("cappingIgnoreZeros"),
    quantileLevel: form.watch("quantileLevel"),
    quantileIgnoreZeros: form.watch("quantileIgnoreZeros"),
    additionalFilters: form.watch("additionalFilters"),
    numeratorAggregateFilter: form.watch("numeratorAggregateFilter"),
    denominatorAggregateFilter: form.watch("denominatorAggregateFilter"),
  };

  const overrideDelay =
    value.conversionDelayValue !== undefined &&
    value.conversionDelayUnit !== undefined;

  const overrideCapping =
    value.cappingType !== undefined &&
    value.cappingValue !== undefined &&
    value.cappingIgnoreZeros !== undefined;

  const defaultName = getDefaultName(
    metric,
    simplifyVariantSettings(metric, value)
  );

  const enableSave =
    Object.keys(simplifyVariantSettings(metric, value)).length > 1;

  return (
    <PopoverForm
      width={"450px"}
      disable={!enableSave}
      onSubmit={form.handleSubmit(async (settings) => {
        settings = simplifyVariantSettings(metric, settings);
        settings.name = settings.name || defaultName;
        // TODO: validation
        onSave(settings);
      })}
      close={close}
    >
      <label>Overrides</label>
      <table className="table table-sm appbox gbtable mb-3">
        <thead>
          <tr>
            <th>Property</th>
            <th>Value</th>
            <th style={{ width: 70 }}>Override</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Capping</td>
            <td>
              {overrideCapping ? (
                <Flex gap="2" wrap="wrap" align="center">
                  <SelectField
                    value={value.cappingType || ""}
                    onChange={(v: "" | "absolute" | "percentile") =>
                      form.setValue("cappingType", v)
                    }
                    options={[
                      { value: "", label: "None" },
                      { value: "absolute", label: "Absolute" },
                      { value: "percentile", label: "Percentile" },
                    ]}
                    sort={false}
                  />
                  {value.cappingType ? (
                    <Field
                      type="number"
                      {...form.register("cappingValue")}
                      required
                      style={{ width: 70 }}
                    />
                  ) : null}
                  {value.cappingType === "percentile" ? (
                    <Checkbox
                      value={value.cappingIgnoreZeros || false}
                      setValue={(v) => form.setValue("cappingIgnoreZeros", v)}
                      label="Ignore Zeros"
                    />
                  ) : null}
                </Flex>
              ) : (
                <>
                  {metric.cappingSettings.type === "percentile"
                    ? `P${metric.cappingSettings.value * 100}${
                        metric.cappingSettings.ignoreZeros
                          ? " (Ignore Zeros)"
                          : ""
                      }`
                    : metric.cappingSettings.type === "absolute"
                    ? metric.cappingSettings.value
                    : "None"}
                </>
              )}
            </td>
            <td>
              <Checkbox
                value={overrideCapping}
                setValue={(override) => {
                  form.setValue(
                    "cappingType",
                    override ? metric.cappingSettings.type : ""
                  );
                  form.setValue(
                    "cappingValue",
                    override ? metric.cappingSettings.value || 0 : undefined
                  );
                  form.setValue(
                    "cappingIgnoreZeros",
                    override
                      ? metric.cappingSettings.ignoreZeros || false
                      : undefined
                  );
                }}
              />
            </td>
          </tr>
          <tr>
            <td>Conversion Delay</td>
            <td>
              {overrideDelay ? (
                <Flex gap="2" wrap="wrap" align="center">
                  <Field
                    type="number"
                    {...form.register("conversionDelayValue")}
                    required
                    style={{ width: 70 }}
                  />
                  <SelectField
                    value={value.conversionDelayUnit || ""}
                    onChange={(v: "weeks" | "days" | "hours" | "minutes") =>
                      form.setValue("conversionDelayUnit", v)
                    }
                    options={[
                      { value: "weeks", label: "Weeks" },
                      { value: "days", label: "Days" },
                      { value: "hours", label: "Hours" },
                      { value: "minutes", label: "Minutes" },
                    ]}
                    required
                    sort={false}
                  />
                </Flex>
              ) : (
                <>
                  {metric.windowSettings.delayValue
                    ? `${metric.windowSettings.delayValue} ${metric.windowSettings.delayUnit}`
                    : "None"}
                </>
              )}
            </td>
            <td>
              <Checkbox
                value={overrideDelay}
                setValue={(override) => {
                  form.setValue(
                    "conversionDelayValue",
                    override ? metric.windowSettings.delayValue || 0 : undefined
                  );
                  form.setValue(
                    "conversionDelayUnit",
                    override
                      ? metric.windowSettings.delayUnit || "days"
                      : undefined
                  );
                }}
              />
            </td>
          </tr>
          {/* TODO: More properties */}
        </tbody>
      </table>

      <Box mb="3">
        <Field
          label="Name"
          placeholder={defaultName}
          {...form.register("name")}
        />
      </Box>
    </PopoverForm>
  );
}
