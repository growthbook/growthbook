import { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { PValueCorrection } from "shared/types/stats";
import { getScopedSettings } from "shared/settings";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { ATTRIBUTION_MODEL_LABELS } from "@/components/Experiment/MetricAnalysisWindowSelector";
import Metadata from "@/ui/Metadata";
import Text from "@/ui/Text";

const CORRECTION_LABELS: Record<Exclude<PValueCorrection, null>, string> = {
  "holm-bonferroni": "Holm-Bonferroni",
  "benjamini-hochberg": "Benjamini-Hochberg",
};

const empty = (text = "None") => (
  <Text weight="regular" color="text-mid" size="sm" fontStyle="italic">
    {text}
  </Text>
);

const onOff = (on: boolean) => (on ? "On" : "Off");

/**
 * How the experiment is analysed, beyond the metrics and queries the setup page
 * already shows: each value as it will actually apply, with the org's and the
 * project's defaults folded in, and features the org doesn't have left out.
 */
export default function AnalysisSummary({
  experiment,
}: {
  experiment: ExperimentInterfaceStringDates;
}) {
  const { organization, hasCommercialFeature } = useUser();
  const { getProjectById } = useDefinitions();
  const { settings } = getScopedSettings({
    organization,
    project: getProjectById(experiment.project || "") ?? undefined,
    experiment,
  });

  const frequentist = settings.statsEngine.value === "frequentist";
  const rows: [string, ReactNode][] = [
    ["Stats engine", frequentist ? "Frequentist" : "Bayesian"],
  ];
  if (hasCommercialFeature("regression-adjustment")) {
    rows.push(["CUPED", onOff(settings.regressionAdjustmentEnabled.value)]);
  }
  if (
    hasCommercialFeature("post-stratification") &&
    !organization.settings?.disablePrecomputedDimensions
  ) {
    rows.push([
      "Post-stratification",
      onOff(settings.postStratificationEnabled.value),
    ]);
  }
  if (frequentist) {
    if (hasCommercialFeature("sequential-testing")) {
      rows.push([
        "Sequential testing",
        onOff(settings.sequentialTestingEnabled.value),
      ]);
    }
    rows.push(["P-value threshold", String(settings.pValueThreshold.value)]);
    const correction = settings.pValueCorrection.value;
    rows.push([
      "Multiple testing correction",
      correction ? CORRECTION_LABELS[correction] : empty(),
    ]);
  }
  rows.push([
    "Metric analysis windows",
    ATTRIBUTION_MODEL_LABELS[settings.attributionModel.value],
  ]);
  rows.push([
    "Custom SQL filter",
    experiment.queryFilter ? (
      <Text size="sm" color="text-high" mono overflowWrap="anywhere">
        {experiment.queryFilter}
      </Text>
    ) : (
      empty()
    ),
  ]);

  return (
    <Flex direction="column" gap="4">
      {rows.map(([label, value]) => (
        <Metadata key={label} size="sm" stacked label={label} value={value} />
      ))}
    </Flex>
  );
}
