import { Select, SelectGroup, SelectItem, SelectLabel } from "@/ui/Select";
import Text from "@/ui/Text";
import { FormMetricType } from "@/components/FactTables/MetricEditor/metricFormTranslation";

const TYPE_LABELS: Record<FormMetricType, string> = {
  proportion: "Simple proportion",
  threshold: "Threshold",
  retention: "Retention",
  funnel: "Funnel",
  rowCount: "Row count",
  colSum: "Column sum",
  colMax: "Column max",
  countDist: "Count distinct",
  activeDays: "Active days",
  ratio: "Ratio",
  quantile: "Percentile",
  dailyParticipation: "Daily participation",
};

// Descriptive copy adapted from [fmid].tsx's MetricType display and the one
// Figma-confirmed string ("Row count"); the rest weren't individually pulled
// from Figma - a cosmetic refinement for review, not a functional risk.
const TYPE_DESCRIPTIONS: Record<FormMetricType, string> = {
  proportion:
    "Percent of experiment units who do something, e.g. sign up or click a button.",
  threshold:
    "Percent of experiment units whose activity crosses a threshold, e.g. placed 3+ orders.",
  retention:
    "Percent of experiment units who are still active a set period after exposure.",
  funnel:
    "Percent of experiment units who complete an ordered sequence of events.",
  rowCount:
    "Adds up how many times this happened per person, e.g. total page views.",
  colSum: "Adds up a numeric column per person, e.g. total revenue.",
  colMax:
    "Takes the largest value of a numeric column per person, e.g. highest order value.",
  countDist:
    "Counts distinct values of a column per person, e.g. unique products viewed.",
  activeDays: "Counts the number of distinct days this happened per person.",
  ratio:
    "The ratio of two numeric values among experiment units, e.g. revenue per order.",
  quantile:
    "A percentile of values across experiment units, e.g. median order value.",
  dailyParticipation:
    "The average percent of days after exposure that a unit is active.",
};

const GROUPS: { label: string; types: readonly FormMetricType[] }[] = [
  {
    label: "Unit Count",
    types: ["proportion", "threshold", "retention", "funnel"],
  },
  {
    label: "Value",
    types: ["rowCount", "colSum", "colMax", "countDist", "activeDays"],
  },
  { label: "Special", types: ["ratio", "quantile", "dailyParticipation"] },
];

// Premium items are disabled (not silently swallowed on click, as today's
// flat ButtonSelectField does) - a stricter, more accessible upgrade the
// native Select's disabled state gives us for free.
export default function MetricTypeSelect({
  value,
  onChange,
  hasRetentionMetrics,
  hasFunnelMetrics,
  hasQuantileMetrics,
  quantileAvailableForDatasource,
}: {
  value: FormMetricType;
  onChange: (type: FormMetricType) => void;
  hasRetentionMetrics: boolean;
  hasFunnelMetrics: boolean;
  hasQuantileMetrics: boolean;
  quantileAvailableForDatasource: boolean;
}) {
  const disabled: Partial<Record<FormMetricType, boolean>> = {
    retention: !hasRetentionMetrics,
    funnel: !hasFunnelMetrics,
    quantile: !hasQuantileMetrics || !quantileAvailableForDatasource,
  };

  return (
    <Select
      label="What are you measuring?"
      value={value}
      setValue={(v) => onChange(v as FormMetricType)}
    >
      {GROUPS.map((group) => (
        <SelectGroup key={group.label}>
          <SelectLabel>{group.label}</SelectLabel>
          {group.types.map((type) => (
            <SelectItem key={type} value={type} disabled={disabled[type]}>
              <Text weight="semibold" as="div">
                {TYPE_LABELS[type]}
                {disabled[type] ? " (premium)" : ""}
              </Text>
              <Text size="sm" color="text-mid" as="div">
                {TYPE_DESCRIPTIONS[type]}
              </Text>
            </SelectItem>
          ))}
        </SelectGroup>
      ))}
    </Select>
  );
}
