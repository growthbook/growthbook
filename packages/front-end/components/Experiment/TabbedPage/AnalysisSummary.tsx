import { ReactNode, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Collapsible from "react-collapsible";
import { PiCaretRight } from "react-icons/pi";
import { date } from "shared/dates";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { PValueCorrection } from "shared/types/stats";
import { getScopedSettings } from "shared/settings";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { ATTRIBUTION_MODEL_LABELS } from "@/components/Experiment/MetricAnalysisWindowSelector";
import { IN_PROGRESS_CONVERSION_LABELS } from "@/components/Experiment/AnalysisForm";
import Metadata from "@/ui/Metadata";
import Text from "@/ui/Text";

const CORRECTION_LABELS: Record<Exclude<PValueCorrection, null>, string> = {
  "holm-bonferroni": "Holm-Bonferroni",
  "benjamini-hochberg": "Benjamini-Hochberg",
};

type Row = [label: string, value: ReactNode];

const onOff = (on: boolean) => (on ? "On" : "Off");

function Rows({ rows }: { rows: Row[] }) {
  return (
    <Flex direction="column" gap="4">
      {rows.map(([label, value]) => (
        <Metadata key={label} size="sm" row label={label} value={value} />
      ))}
    </Flex>
  );
}

/**
 * How the experiment is analysed, beyond the metrics and queries the setup page
 * already shows: each value as it will actually apply, with the org's and the
 * project's defaults folded in, and features the org doesn't have left out.
 * The settings people reach for first stay in view; the rest fold away.
 */
export default function AnalysisSummary({
  experiment,
}: {
  experiment: ExperimentInterfaceStringDates;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { organization, hasCommercialFeature } = useUser();
  const { getProjectById } = useDefinitions();
  const { settings } = getScopedSettings({
    organization,
    project: getProjectById(experiment.project || "") ?? undefined,
    experiment,
  });

  const frequentist = settings.statsEngine.value === "frequentist";
  const hasCuped = hasCommercialFeature("regression-adjustment");
  const cupedOn = hasCuped && settings.regressionAdjustmentEnabled.value;
  const hasSequential =
    frequentist && hasCommercialFeature("sequential-testing");
  const sequentialOn = hasSequential && settings.sequentialTestingEnabled.value;

  const main: Row[] = [
    ["Stats engine", frequentist ? "Frequentist" : "Bayesian"],
  ];
  if (hasCuped) {
    main.push(["CUPED", onOff(cupedOn)]);
  }
  if (
    hasCommercialFeature("post-stratification") &&
    !organization.settings?.disablePrecomputedDimensions
  ) {
    main.push([
      "Post-stratification",
      onOff(settings.postStratificationEnabled.value),
    ]);
  }
  if (hasSequential) {
    main.push(["Sequential testing", onOff(sequentialOn)]);
  }
  if (frequentist) {
    main.push(["P-value threshold", String(settings.pValueThreshold.value)]);
  }

  // Advanced lists only what is actually set: an unused setting is noise here.
  const advanced: Row[] = [];
  const correction = settings.pValueCorrection.value;
  if (frequentist && correction) {
    advanced.push([
      "Multiple testing correction",
      CORRECTION_LABELS[correction],
    ]);
  }
  if (sequentialOn) {
    advanced.push([
      "Sequential tuning parameter",
      settings.sequentialTestingTuningParameter.value.toLocaleString(),
    ]);
  }
  if (cupedOn) {
    advanced.push([
      "CUPED lookback",
      `${settings.regressionAdjustmentDays.value} days`,
    ]);
  }

  const attribution = settings.attributionModel.value;
  const lookback = experiment.lookbackOverride;
  advanced.push([
    "Metric analysis windows",
    attribution === "lookbackOverride" && lookback
      ? `${ATTRIBUTION_MODEL_LABELS[attribution]}: ${
          lookback.type === "date"
            ? `since ${date(lookback.value)}`
            : `last ${lookback.value} ${lookback.valueUnit}`
        }`
      : ATTRIBUTION_MODEL_LABELS[attribution],
  ]);
  advanced.push([
    "Metric conversion windows",
    IN_PROGRESS_CONVERSION_LABELS[
      experiment.skipPartialData ? "strict" : "loose"
    ],
  ]);
  if (experiment.queryFilter) {
    advanced.push([
      "Custom SQL filter",
      <Text
        key="filter"
        size="sm"
        color="text-high"
        mono
        overflowWrap="anywhere"
      >
        {experiment.queryFilter}
      </Text>,
    ]);
  }

  return (
    <Flex direction="column" gap="4">
      <Rows rows={main} />
      {advanced.length ? (
        <Collapsible
          trigger={
            <Text size="sm" weight="medium" color="text-mid">
              <PiCaretRight className="chevron" style={{ marginRight: 4 }} />
              Advanced
            </Text>
          }
          open={advancedOpen}
          onTriggerOpening={() => setAdvancedOpen(true)}
          onTriggerClosing={() => setAdvancedOpen(false)}
          transitionTime={100}
        >
          <Box pt="4">
            <Rows rows={advanced} />
          </Box>
        </Collapsible>
      ) : null}
    </Flex>
  );
}
