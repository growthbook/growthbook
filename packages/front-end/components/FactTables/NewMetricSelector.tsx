import { Box, Flex, Grid, Text } from "@radix-ui/themes";
import {
  FactMetricInterface,
  FactTableInterface,
} from "back-end/types/fact-table";
import { useState } from "react";
import { PiCaretDown, PiCaretRight, PiFolder, PiX } from "react-icons/pi";
import { useForm } from "react-hook-form";
import { BsThreeDotsVertical } from "react-icons/bs";
import { isFactMetricId, isMetricGroupId } from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/components/Radix/Button";
import SelectField from "@/components/Forms/SelectField";
import PopoverForm from "@/components/Radix/PopoverForm";
import Field from "@/components/Forms/Field";
import Checkbox from "@/components/Radix/Checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownSubMenu,
} from "@/components/Radix/DropdownMenu";
import Link from "@/components/Radix/Link";
import MetricName from "@/components/Metrics/MetricName";
import Tag from "@/components/Tags/Tag";

interface VariantSettings {
  id?: string;
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

function parseVariants(
  ids: string[]
): {
  id: string;
  variants: VariantSettings[];
}[] {
  // Ids are either a metric id directly `met_abc123`
  // OR a metric id + variant settings JSON: `met_abc123#{"name":"My Variant"}
  // Group by metric id and parse the variant settings
  const metrics: {
    id: string;
    variants: VariantSettings[];
  }[] = [];
  ids.forEach((id) => {
    try {
      const [metricId, variantSettings] = id.split("#");
      const parsedSettings = variantSettings
        ? JSON.parse(decodeURIComponent(variantSettings))
        : null;
      const existingMetric = metrics.find((m) => m.id === metricId);
      if (existingMetric) {
        if (parsedSettings) {
          existingMetric.variants.push(parsedSettings);
        }
      } else {
        metrics.push({
          id: metricId,
          variants: parsedSettings ? [parsedSettings] : [],
        });
      }
    } catch (e) {
      // Ignore JSON parse errors
      console.log(e.message);
    }
  });
  return metrics;
}
function stringifyVariants(
  metrics: {
    id: string;
    variants: VariantSettings[];
  }[]
): string[] {
  // Convert the metric id and variant settings back to a string
  const ids: string[] = [];
  metrics.forEach((metric) => {
    const id = metric.id;
    ids.push(id);
    metric.variants.forEach((variant) => {
      const variantString = JSON.stringify(variant);
      ids.push(`${id}#${encodeURIComponent(variantString)}`);
    });
  });
  return ids;
}

export default function NewMetricSelector({
  value,
  setValue,
  datasource,
}: {
  value: string[];
  setValue: (value: string[]) => void;
  datasource?: string;
}) {
  const {
    factMetrics,
    metrics: legacyMetrics,
    metricGroups,
    getFactMetricById,
    getFactTableById,
  } = useDefinitions();

  const metrics = parseVariants(value);

  const tags = new Map<string, number>();

  const groupedMetricOptions: { value: string; label: string }[] = [];

  const individualMetricOptions: { value: string; label: string }[] = [];

  const tagToMetricMap = new Map<string, string[]>();

  [...metricGroups, ...factMetrics, ...legacyMetrics].forEach((met) => {
    if (datasource && met.datasource !== datasource) return;
    if (metrics.some((m) => m.id === met.id)) return;
    if (!met.id) return;

    if (isMetricGroupId(met.id)) {
      groupedMetricOptions.push({
        value: met.id,
        label: met.name,
      });
    } else {
      individualMetricOptions.push({
        value: met.id,
        label: met.name,
      });
    }

    if (met.tags) {
      met.tags.forEach((t) => {
        tags.set(t, (tags.get(t) || 0) + 1);

        tagToMetricMap.set(t, [...(tagToMetricMap.get(t) || []), met.id]);
      });
    }
  });

  // Sort tags so most popular come first and add to metricOptions
  [...tags.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([tag, count]) => {
      groupedMetricOptions.push({
        value: `tag:${tag}`,
        label: `Tag: ${tag} (${count})`,
      });
    });

  function addMetrics(ids: string[]) {
    const newMetrics = [...metrics];

    ids.forEach((id) => {
      if (value.includes(id)) return;

      if (isFactMetricId(id)) {
        const factMetric = getFactMetricById(id);
        if (!factMetric) return;

        const factTable = getFactTableById(factMetric.numerator.factTableId);
        if (!factTable) return;

        newMetrics.push({
          id,
          variants: getMaterializedVariantOptions(factTable, factMetric),
        });
      } else {
        newMetrics.push({
          id,
          variants: [],
        });
      }
    });

    if (metrics.length !== newMetrics.length) {
      setValue(stringifyVariants(newMetrics));
    }
  }

  const options =
    groupedMetricOptions.length > 0 && individualMetricOptions.length > 0
      ? [
          {
            label: "Metric Groups and Tags",
            options: groupedMetricOptions,
          },
          {
            label: "Individual Metrics",
            options: individualMetricOptions,
          },
        ]
      : [...groupedMetricOptions, ...individualMetricOptions];

  return (
    <Box mb="5">
      <SelectField
        options={options}
        onChange={(selected) => {
          if (!selected) return;

          if (selected.startsWith("tag:")) {
            addMetrics(tagToMetricMap.get(selected.slice(4)) || []);
          } else {
            addMetrics([selected]);
          }
        }}
        initialOption="Add a metric..."
        value=""
        sort={false}
        closeMenuOnSelect={false}
        formatOptionLabel={({ value, label }) => {
          if (!value) return label;
          if (value.startsWith("tag:"))
            return (
              <>
                Tag: <Tag tag={value.slice(4)} /> (
                {tagToMetricMap.get(value.slice(4))?.length || 0})
              </>
            );
          if (isMetricGroupId(value)) {
            return (
              <>
                <PiFolder /> {label}
              </>
            );
          }
          return <MetricName id={value} disableTooltip={true} />;
        }}
      />
      <Grid columns="1fr 1fr 1fr" gap="2" mt="2">
        {metrics.map(({ id, variants }) => {
          return (
            <SelectedMetric
              key={id}
              id={id}
              variants={variants}
              onSave={(settings) => {
                const newMetrics = [...metrics];
                const index = newMetrics.findIndex((m) => m.id === id);
                if (index !== -1) {
                  newMetrics[index].variants = settings;
                }
                setValue(stringifyVariants(newMetrics));
              }}
              onRemove={() => {
                setValue(stringifyVariants(metrics.filter((m) => m.id !== id)));
              }}
            />
          );
        })}
      </Grid>
    </Box>
  );
}

function SelectedMetric({
  id,
  variants,
  onSave,
  onRemove,
}: {
  id: string;
  variants: VariantSettings[];
  onSave: (settings: VariantSettings[]) => void;
  onRemove: () => void;
}) {
  const {
    getFactTableById,
    getFactMetricById,
    getMetricById,
    getMetricGroupById,
  } = useDefinitions();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  let name = id;

  let materializedVariantOptions: VariantSettings[] = [];

  if (isFactMetricId(id)) {
    const metric = getFactMetricById(id);
    if (metric) {
      name = metric.name;
      const factTable = getFactTableById(metric.numerator.factTableId);
      if (factTable) {
        materializedVariantOptions = getMaterializedVariantOptions(
          factTable,
          metric
        );
      }
    }
  } else if (isMetricGroupId(id)) {
    const group = getMetricGroupById(id);
    if (group) {
      name = group.name;
    }
  } else {
    const metric = getMetricById(id);
    if (metric) {
      name = metric.name;
    }
  }

  return (
    <Box
      style={{
        position: "relative",
        backgroundColor: "var(--color-panel-translucent)",
      }}
      className="border rounded"
      py="1"
      px="3"
    >
      <Flex direction="column" gap="0">
        <Flex gap="1" align="start">
          <Box flexGrow="1">
            <Text size="2" weight="bold">
              <MetricName
                id={id}
                disableTooltip={true}
                showOfficialLabel={true}
                isGroup={isMetricGroupId(id)}
              />
            </Text>
          </Box>
          <Box>
            <DropdownMenu
              trigger={
                <div
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      onRemove();
                      e.preventDefault();
                    }
                  }}
                >
                  <Button size={"xs"} variant="ghost">
                    <BsThreeDotsVertical />
                  </Button>
                </div>
              }
              menuPlacement="end"
            >
              {isFactMetricId(id) ? (
                <>
                  <DropdownSubMenu trigger={"Saved Variants"}>
                    {materializedVariantOptions.map((variant) => {
                      const checked = variants.some((v) => v.id === variant.id);
                      return (
                        <DropdownMenuCheckboxItem
                          key={variant.id}
                          checked={checked}
                          onClick={(e) => {
                            e.preventDefault();
                            if (checked) {
                              onSave(
                                variants.filter((v) => v.id !== variant.id)
                              );
                            } else {
                              onSave([...variants, variant]);
                            }
                          }}
                        >
                          {variant.name}
                        </DropdownMenuCheckboxItem>
                      );
                    })}
                  </DropdownSubMenu>
                  <DropdownMenuItem
                    onClick={() => {
                      setOpen(true);
                    }}
                  >
                    Add Ad-hoc Variant
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              ) : null}

              <DropdownMenuItem
                onClick={() => {
                  onRemove();
                }}
                color="red"
              >
                Remove Metric {variants.length > 0 ? "(and all variants)" : ""}
              </DropdownMenuItem>
            </DropdownMenu>
          </Box>
        </Flex>
        {variants.length > 0 && (
          <Box>
            <Link
              onClick={(e) => {
                e.preventDefault();
                setExpanded(!expanded);
              }}
              href="#"
              size="1"
            >
              + {variants.length} variant{variants.length > 1 ? "s" : ""}{" "}
              {expanded ? <PiCaretDown /> : <PiCaretRight />}
            </Link>
            {expanded ? (
              <>
                {variants.map((variant, index) => {
                  // If the first part of the variant name is the same as the metric name, remove it
                  const shortName = variant.name.replace(
                    new RegExp(`^${name} `),
                    ""
                  );
                  return (
                    <Flex gap="2" align="center" key={index}>
                      <Text>└</Text>
                      <Box flexGrow="1">
                        <Text size={"1"}>{shortName}</Text>
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
                  );
                })}
              </>
            ) : null}
          </Box>
        )}
      </Flex>
      {open && (
        <AdhocVariantForm
          id={id}
          onSave={(settings) => {
            onSave([...variants, settings]);
            setOpen(false);
          }}
          close={() => setOpen(false)}
        />
      )}
    </Box>
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

  // Remove all keys where value === undefined
  Object.keys(newSettings).forEach((key) => {
    if (newSettings[key] === undefined) {
      delete newSettings[key];
    }
  });

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
  id,
  onSave,
  close,
}: {
  id: string;
  onSave: (settings: VariantSettings) => void;
  close: () => void;
}) {
  const { getFactMetricById } = useDefinitions();

  const form = useForm<VariantSettings>({
    defaultValues: {
      name: "",
    },
  });

  const metric = getFactMetricById(id);
  if (!metric) return null;

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
            <th style={{ width: 70 }}>Override</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Capping</td>
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
          </tr>
          <tr>
            <td>Conversion Delay</td>
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

function getMaterializedVariantOptions(
  factTable: FactTableInterface,
  metric: FactMetricInterface
): VariantSettings[] {
  const variants: VariantSettings[] = [];

  // Only create these variants if the metric doesn't have any filters yet
  if (!metric.numerator.filters?.length) {
    factTable.filters.forEach((filter) => {
      // TODO: mark official variants
      // TODO: add description
      variants.push({
        name: `${metric.name} ${filter.name}`,
        id: `filter:${filter.id}`,
        additionalFilters: [filter.id],
      });
    });
  }

  return variants;
}
