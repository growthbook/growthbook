import { Flex } from "@radix-ui/themes";
import {
  PiArrowLineUp,
  PiCalendarCheck,
  PiCalendarDots,
  PiChartBarHorizontal,
  PiDivide,
  PiFingerprint,
  PiFunnel,
  PiHash,
  PiPercent,
  PiRepeat,
  PiSigma,
  PiTarget,
} from "react-icons/pi";
import { CommercialFeature } from "shared/enterprise";
import { Select, SelectGroup, SelectItem, SelectLabel } from "@/ui/Select";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import { FormMetricType } from "@/components/FactTables/MetricEditor/metricFormTranslation";
import styles from "./MetricTypeSelect.module.scss";

export const TYPE_LABELS: Record<FormMetricType, string> = {
  proportion: "Proportion",
  threshold: "Threshold",
  retention: "Retention",
  funnel: "Funnel",
  rowCount: "Count",
  colSum: "Sum",
  colMax: "Max",
  countDist: "Count distinct",
  activeDays: "Active days",
  ratio: "Ratio",
  quantile: "Percentile",
  dailyParticipation: "Daily participation",
};

export const TYPE_DESCRIPTIONS: Record<FormMetricType, string> = {
  proportion:
    "Percent of units that did something at least once, e.g. signed up.",
  threshold:
    "Percent of units that crossed a threshold, e.g. placed 3+ orders.",
  retention:
    "Percent of units active again after a set time, e.g. week 2 retention.",
  funnel:
    "Percent of units that completed steps in order, e.g. cart → checkout → purchase.",
  rowCount: "Average number of events per unit, e.g. orders per user.",
  colSum: "Average total value per unit, e.g. revenue per user.",
  colMax: "Average of each unit's highest value, e.g. top score per player.",
  countDist: "Average number of unique values per unit, e.g. products viewed.",
  activeDays: "Average number of days each unit was active.",
  ratio: "One metric divided by another, e.g. revenue per order.",
  quantile: "A percentile of all values, e.g. median order value.",
  dailyParticipation: "Share of days since exposure that each unit was active.",
};

const GROUPS: { label: string; types: readonly FormMetricType[] }[] = [
  {
    label: "Conversion rate",
    types: ["proportion", "threshold", "retention", "funnel"],
  },
  {
    label: "Average per unit",
    types: ["rowCount", "colSum", "colMax", "countDist", "activeDays"],
  },
  { label: "Advanced", types: ["ratio", "quantile", "dailyParticipation"] },
];

const TYPE_ICONS = {
  proportion: PiPercent,
  threshold: PiTarget,
  retention: PiRepeat,
  funnel: PiFunnel,
  rowCount: PiHash,
  colSum: PiSigma,
  colMax: PiArrowLineUp,
  countDist: PiFingerprint,
  activeDays: PiCalendarDots,
  ratio: PiDivide,
  quantile: PiChartBarHorizontal,
  dailyParticipation: PiCalendarCheck,
} satisfies Record<FormMetricType, typeof PiPercent>;

type Gate = { kind: "commercial" } | { kind: "datasource"; suffix: string };

const PREMIUM_FEATURES: Partial<Record<FormMetricType, CommercialFeature>> = {
  retention: "retention-metrics",
  funnel: "funnel-metrics",
  quantile: "quantile-metrics",
};

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
    retention: !hasRetentionMetrics ? { kind: "commercial" } : undefined,
    funnel: !hasFunnelMetrics ? { kind: "commercial" } : undefined,
    quantile: !hasQuantileMetrics
      ? { kind: "commercial" }
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
        aria-label="Metric type"
        label="Metric type"
        triggerClassName={styles.trigger}
        value={value}
        setValue={(v) => onChange(v as FormMetricType)}
      >
        {GROUPS.map((group) => (
          <SelectGroup key={group.label}>
            <SelectLabel>{group.label}</SelectLabel>
            {group.types.map((type) => {
              const g = gate[type];
              const Icon = TYPE_ICONS[type];
              return (
                <SelectItem
                  key={type}
                  value={type}
                  disabled={!!g}
                  className={styles.item}
                  textValue={TYPE_LABELS[type]}
                >
                  <span className={styles.option}>
                    <span className={styles.icon} aria-hidden="true">
                      <Icon size={20} />
                    </span>
                    <span className={styles.copy}>
                      <Flex as="span" align="center" gap="2">
                        <span className={styles.title}>
                          {TYPE_LABELS[type]}
                          {g?.kind === "datasource" ? g.suffix : ""}
                        </span>
                        {PREMIUM_FEATURES[type] && (
                          <PaidFeatureBadge
                            commercialFeature={PREMIUM_FEATURES[type]}
                          />
                        )}
                      </Flex>
                      <span className={styles.description}>
                        {TYPE_DESCRIPTIONS[type]}
                      </span>
                    </span>
                  </span>
                </SelectItem>
              );
            })}
          </SelectGroup>
        ))}
      </Select>
    </Flex>
  );
}
