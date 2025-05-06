import { Box, Flex, Grid, Text } from "@radix-ui/themes";
import {
  FactMetricInterface,
  FactTableInterface,
  VariantSettings,
} from "back-end/types/fact-table";
import { useState } from "react";
import { PiCaretDown, PiCaretRight, PiFolder, PiX } from "react-icons/pi";
import { useForm } from "react-hook-form";
import { BsThreeDotsVertical } from "react-icons/bs";
import { isFactMetricId, isMetricGroupId } from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/components/Radix/Button";
import SelectField, { GroupedValue } from "@/components/Forms/SelectField";
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
    getMetricGroupById,
  } = useDefinitions();

  const metrics = parseVariants(value);

  const tags = new Map<string, number>();

  const metricGroupOptions: { value: string; label: string }[] = [];
  const tagOptions: { value: string; label: string }[] = [];
  const officialMetricOptions: { value: string; label: string }[] = [];
  const individualMetricOptions: { value: string; label: string }[] = [];

  const tagToMetricMap = new Map<string, string[]>();

  [...metricGroups, ...factMetrics, ...legacyMetrics].forEach((met) => {
    if (datasource && met.datasource !== datasource) return;
    if (metrics.some((m) => m.id === met.id)) return;
    if (!met.id) return;

    if (isMetricGroupId(met.id)) {
      metricGroupOptions.push({
        value: met.id,
        label: met.name,
      });
    } else if ("managedBy" in met && met.managedBy) {
      officialMetricOptions.push({
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
      tagOptions.push({
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

  const options: GroupedValue[] = [];

  if (metricGroupOptions.length > 0) {
    options.push({
      label: "Metric Groups",
      options: metricGroupOptions,
    });
  }
  if (officialMetricOptions.length > 0) {
    options.push({
      label: "Official Metrics",
      options: officialMetricOptions,
    });
  }
  if (tagOptions.length > 0) {
    options.push({
      label: "Tags",
      options: tagOptions,
    });
  }
  if (individualMetricOptions.length > 0) {
    options.push({
      label:
        officialMetricOptions.length > 0
          ? "Other Metrics"
          : "Individual Metrics",
      options: individualMetricOptions,
    });
  }

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
          if (value.startsWith("tag:")) {
            const num = tagToMetricMap.get(value.slice(4))?.length || 0;
            return (
              <Flex align="center" gap="2">
                <Tag tag={value.slice(4)} />
                <Text size="1">
                  ({num} metric
                  {num === 1 ? "" : "s"})
                </Text>
              </Flex>
            );
          }
          if (isMetricGroupId(value)) {
            const group = getMetricGroupById(value);
            const num = group?.metrics?.length || 0;
            return (
              <Flex align="center" gap="2">
                <PiFolder /> <Text>{label}</Text>
                <Text size="1">
                  ({num} metric{num === 1 ? "" : "s"})
                </Text>
              </Flex>
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

  // Remove all keys where value === undefined
  Object.keys(newSettings).forEach((key) => {
    if (newSettings[key] === undefined) {
      delete newSettings[key];
    }
  });

  if (settings.windowDelaySettings) {
    if (
      Object.entries(settings.windowDelaySettings).every(
        ([key, value]) => metric.windowSettings[key] === value
      )
    ) {
      delete newSettings.windowDelaySettings;
    }
  }

  if (settings.windowSettings) {
    if (
      Object.entries(settings.windowSettings).every(
        ([key, value]) => metric.windowSettings[key] === value
      )
    ) {
      delete newSettings.windowSettings;
    }
  }

  if (settings.cappingSettings) {
    if (
      Object.entries(settings.cappingSettings).every(
        ([key, value]) => metric.cappingSettings[key] === value
      )
    ) {
      delete newSettings.cappingSettings;
    }
  }

  if (settings.quantileSettings) {
    if (
      metric.quantileSettings &&
      Object.entries(settings.quantileSettings).every(
        ([key, value]) => metric.quantileSettings?.[key] === value
      )
    ) {
      delete newSettings.quantileSettings;
    }
  }

  if (settings.additionalFilters?.length === 0) {
    delete newSettings.additionalFilters;
  }

  return newSettings;
}

function getDefaultName(
  metric: FactMetricInterface,
  settings: VariantSettings,
  factTable: FactTableInterface
) {
  const nameParts: string[] = [];

  if (settings.windowDelaySettings !== undefined) {
    const { delayValue, delayUnit } = settings.windowDelaySettings;
    nameParts.push(`(Delay: ${delayValue} ${delayUnit})`);
  }
  if (settings.windowSettings !== undefined) {
    const { type, windowUnit, windowValue } = settings.windowSettings;
    if (type === "") {
      nameParts.push(`(No conversion window)`);
    } else if (type === "conversion") {
      nameParts.push(`(Window: ${windowValue} ${windowUnit})`);
    } else if (type === "lookback") {
      nameParts.push(`(Lookback: ${windowValue} ${windowUnit})`);
    }
  }
  if (settings.cappingSettings !== undefined) {
    const { type, value, ignoreZeros } = settings.cappingSettings;
    if (!type) {
      nameParts.push("(Uncapped)");
    } else {
      nameParts.push(
        `(Capping: ${
          type === "percentile"
            ? `P${value * 100}${ignoreZeros ? " Ignore Zeros" : ""}`
            : type === "absolute"
            ? value
            : ""
        })`
      );
    }
  }
  if (settings.quantileSettings !== undefined) {
    const { ignoreZeros, quantile } = settings.quantileSettings;
    nameParts.push(
      `(Quantile: ${quantile}${ignoreZeros ? ` ignore zeros` : ""})`
    );
  }
  if (
    settings.additionalFilters !== undefined &&
    settings.additionalFilters.length > 0
  ) {
    const filterNames = settings.additionalFilters
      .map((filter) => factTable.filters.find((f) => f.id === filter)?.name)
      .filter(Boolean)
      .join(", ");
    nameParts.push(`(Filters: ${filterNames})`);
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
  const { getFactMetricById, getFactTableById } = useDefinitions();

  const form = useForm<VariantSettings>({
    defaultValues: {
      name: "",
    },
  });

  const metric = getFactMetricById(id);
  if (!metric) return null;

  const factTable = getFactTableById(metric.numerator.factTableId);
  if (!factTable) return null;

  const value = {
    name: form.watch("name"),
    windowDelaySettings: form.watch("windowDelaySettings"),
    windowSettings: form.watch("windowSettings"),
    cappingSettings: form.watch("cappingSettings"),
    quantileSettings: form.watch("quantileSettings"),
    additionalFilters: form.watch("additionalFilters"),
  };

  const overrideDelay = value.windowDelaySettings !== undefined;

  const overrideCapping = value.cappingSettings !== undefined;

  const defaultName = getDefaultName(
    metric,
    simplifyVariantSettings(metric, value),
    factTable
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
                    "cappingSettings",
                    override ? metric.cappingSettings : undefined
                  );
                }}
              />
            </td>
            <td>
              {overrideCapping ? (
                <Flex gap="2" wrap="wrap" align="center">
                  <SelectField
                    value={value.cappingSettings?.type || ""}
                    onChange={(v: "" | "absolute" | "percentile") =>
                      form.setValue("cappingSettings.type", v)
                    }
                    options={[
                      { value: "", label: "None" },
                      { value: "absolute", label: "Absolute" },
                      { value: "percentile", label: "Percentile" },
                    ]}
                    sort={false}
                  />
                  {value.cappingSettings?.type ? (
                    <Field
                      type="number"
                      {...form.register("cappingSettings.value")}
                      required
                      style={{ width: 70 }}
                    />
                  ) : null}
                  {value.cappingSettings?.type === "percentile" ? (
                    <Checkbox
                      value={value.cappingSettings?.ignoreZeros || false}
                      setValue={(v) =>
                        form.setValue("cappingSettings.ignoreZeros", v)
                      }
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
                    "windowDelaySettings",
                    override
                      ? {
                          delayUnit: metric.windowSettings.delayUnit || "days",
                          delayValue: metric.windowSettings.delayValue || 0,
                        }
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
                    {...form.register("windowDelaySettings.delayValue")}
                    required
                    style={{ width: 70 }}
                  />
                  <SelectField
                    value={value.windowDelaySettings?.delayUnit || ""}
                    onChange={(v: "weeks" | "days" | "hours" | "minutes") =>
                      form.setValue("windowDelaySettings.delayUnit", v)
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
