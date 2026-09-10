import { Flex } from "@radix-ui/themes";
import { CommercialFeature } from "shared/enterprise";
import { Select, SelectGroup, SelectItem, SelectLabel } from "@/ui/Select";
import Text from "@/ui/Text";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
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
    label: "Unit count",
    types: ["proportion", "threshold", "retention", "funnel"],
  },
  {
    label: "Value",
    types: ["rowCount", "colSum", "colMax", "countDist", "activeDays"],
  },
  { label: "Special", types: ["ratio", "quantile", "dailyParticipation"] },
];

type Gate =
  | { kind: "commercial"; feature: CommercialFeature }
  | { kind: "datasource"; suffix: string };

// Premium items are disabled (not silently swallowed on click, as today's
// flat ButtonSelectField does) - a stricter, more accessible upgrade the
// native Select's disabled state gives us for free. The commercial-gated
// label is wrapped in PremiumTooltip (the app's standard upgrade-path
// pattern) rather than a plain "(premium)" suffix - it renders a visible
// premium badge regardless of whether hover works on a disabled item, so
// the upgrade path survives even if a hover tooltip doesn't fire there.
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
  // Quantile can be disabled for two different reasons - a commercial gate
  // or a datasource that can't run it - and they need different treatment:
  // "premium" copy/upsell is factually wrong (and points at the wrong fix)
  // for a customer who already has the feature but is on the wrong warehouse.
  const gate: Partial<Record<FormMetricType, Gate>> = {
    retention: !hasRetentionMetrics
      ? { kind: "commercial", feature: "retention-metrics" }
      : undefined,
    funnel: !hasFunnelMetrics
      ? { kind: "commercial", feature: "funnel-metrics" }
      : undefined,
    quantile: !hasQuantileMetrics
      ? { kind: "commercial", feature: "quantile-metrics" }
      : !quantileAvailableForDatasource
        ? {
            kind: "datasource",
            suffix: " (not available for this Data Source)",
          }
        : undefined,
  };

  return (
    <Flex direction="column" gap="1">
      <Select
        label="What are you measuring?"
        value={value}
        setValue={(v) => onChange(v as FormMetricType)}
      >
        {GROUPS.map((group) => (
          <SelectGroup key={group.label}>
            <SelectLabel>{group.label}</SelectLabel>
            {group.types.map((type) => {
              const g = gate[type];
              return (
                <SelectItem key={type} value={type} disabled={!!g}>
                  {g?.kind === "commercial" ? (
                    <PremiumTooltip commercialFeature={g.feature}>
                      {TYPE_LABELS[type]}
                    </PremiumTooltip>
                  ) : (
                    <>
                      {TYPE_LABELS[type]}
                      {g?.kind === "datasource" ? g.suffix : ""}
                    </>
                  )}
                </SelectItem>
              );
            })}
          </SelectGroup>
        ))}
      </Select>
      {/* One description line below the selected type (spec) - keeping
          SelectItem's children to a plain label avoids Select mirroring a
          multi-line description into the closed trigger, where Radix has no
          room for it and it would overflow or truncate. */}
      <Text size="sm" color="text-mid" as="div">
        {TYPE_DESCRIPTIONS[value]}
      </Text>
    </Flex>
  );
}
