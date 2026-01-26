import { useCallback, useEffect, useState } from "react";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "shared/types/stats";
import { Flex, Text } from "@radix-ui/themes";
import { PiCaretDownFill, PiCheck } from "react-icons/pi";
import Tooltip from "@/components/Tooltip/Tooltip";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/ui/DropdownMenu";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import LoadingSpinner from "@/components/LoadingSpinner";
import { analysisUpdate } from "@/services/snapshots";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

function getChangeTooltip(
  changeTitle: string,
  statsEngine: StatsEngine,
  differenceType: DifferenceType,
  sequentialTestingEnabled: boolean,
  pValueCorrection: PValueCorrection | null,
  pValueThreshold: number,
) {
  let changeText =
    "The uplift comparing the variation to the baseline, in percent change from the baseline value.";
  if (differenceType === "absolute") {
    changeText =
      "The absolute difference between the average values in the variation and the baseline. For non-ratio metrics, this is average difference between users in the variation and the baseline. Differences in proportion metrics are shown in percentage points (pp).";
  } else if (differenceType === "scaled") {
    changeText =
      "The total change in the metric per day if 100% of traffic were to have gone to the variation.";
  }

  const changeElem = (
    <>
      <p>
        <b>{changeTitle}</b> - {changeText}
      </p>
    </>
  );

  let intervalText: React.ReactNode = null;
  if (statsEngine === "bayesian") {
    intervalText = (
      <>
        The interval is a 95% credible interval. The true value is more likely
        to be in the thicker parts of the graph.
      </>
    );
  }
  if (statsEngine === "frequentist") {
    const confidencePct = percentFormatter.format(1 - pValueThreshold);
    intervalText = (
      <>
        The interval is a {confidencePct} confidence interval. If you re-ran the
        experiment 100 times, the true value would be in this range{" "}
        {confidencePct} of the time.
        {sequentialTestingEnabled && (
          <p className="mt-2 mb-0">
            Because sequential testing is enabled, these confidence intervals
            are valid no matter how many times you analyze (or peek at) this
            experiment as it runs.
          </p>
        )}
        {pValueCorrection && (
          <p className="mt-2 mb-0">
            Because your organization has multiple comparisons corrections
            enabled, these confidence intervals have been inflated so that they
            match the adjusted psuedo-p-value. Because confidence intervals do
            not generally exist for all adjusted p-values, we use a method that
            recreates the confidence intervals that would have produced these
            psuedo-p-values. For adjusted psuedo-p-values that are 1.0, the
            confidence intervals are infinite.
          </p>
        )}
      </>
    );
  }

  return (
    <>
      {changeElem}
      {intervalText && (
        <p className="mt-3">
          <b>Graph</b> - {intervalText}
        </p>
      )}
    </>
  );
}

export interface DifferenceTypeChooserChangeColumnLabelProps {
  changeTitle: string;
  differenceType: DifferenceType;
  setDifferenceType?: (differenceType: DifferenceType) => void;
  statsEngine: StatsEngine;
  sequentialTestingEnabled?: boolean;
  pValueCorrection?: PValueCorrection | null;
  pValueThreshold: number;
  snapshot?: ExperimentSnapshotInterface;
  phase: number;
  analysis?: ExperimentSnapshotAnalysis;
  setAnalysisSettings?: (
    settings: ExperimentSnapshotAnalysisSettings | null,
  ) => void;
  mutate?: () => void;
}

export default function DifferenceTypeChooserChangeColumnLabel({
  changeTitle,
  differenceType,
  setDifferenceType,
  statsEngine,
  sequentialTestingEnabled,
  pValueCorrection,
  pValueThreshold,
  snapshot,
  phase,
  analysis,
  setAnalysisSettings,
  mutate,
}: DifferenceTypeChooserChangeColumnLabelProps) {
  const { apiCall } = useAuth();

  const [postLoading, setPostLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [desiredDifferenceType, setDesiredDifferenceType] =
    useState<DifferenceType>(differenceType);

  const differenceTypeMap = new Map<DifferenceType, string>([
    ["relative", "Relative"],
    ["absolute", "Absolute"],
    ["scaled", "Scaled"],
  ]);

  useEffect(() => {
    setDesiredDifferenceType(differenceType);
  }, [differenceType]);

  const triggerAnalysisUpdate = useCallback(analysisUpdate, [
    analysis,
    snapshot,
    phase,
    apiCall,
  ]);

  const handleChangeDifferenceType = async (
    newDifferenceType: DifferenceType,
  ) => {
    setDesiredDifferenceType(newDifferenceType);

    // If there is no snapshot, just update local differenceType
    if (!snapshot || !setDifferenceType) {
      setDifferenceType?.(newDifferenceType);
      return;
    }
    if (!analysis || !setAnalysisSettings || !mutate) {
      return;
    }

    const newSettings: ExperimentSnapshotAnalysisSettings = {
      ...analysis.settings,
      differenceType: newDifferenceType,
    };

    const status = await triggerAnalysisUpdate(
      newSettings,
      analysis,
      snapshot,
      apiCall,
      setPostLoading,
      phase,
    );

    if (status === "success") {
      setDifferenceType?.(newDifferenceType);
      setAnalysisSettings(newSettings);
      track("Experiment Analysis: switch difference type", {
        differenceType: newDifferenceType,
      });
      mutate();
    } else if (status === "fail") {
      setDesiredDifferenceType(differenceType);
      mutate();
    }
    setPostLoading(false);
  };

  const tooltipBody = (
    <div style={{ lineHeight: 1.5 }}>
      {getChangeTooltip(
        changeTitle,
        statsEngine || "bayesian",
        differenceType,
        !!sequentialTestingEnabled,
        pValueCorrection ?? null,
        pValueThreshold,
      )}
    </div>
  );

  const trigger = (
    <Tooltip
      usePortal={true}
      innerClassName={"text-left"}
      body={tooltipBody}
      tipPosition="top"
      shouldDisplay={!dropdownOpen}
    >
      <Flex align="center">
        {changeTitle}
        {setDifferenceType && (
          <>
            <PiCaretDownFill style={{ fontSize: "12px" }} />
            {postLoading && (
              <LoadingSpinner style={{ width: "12px", height: "12px" }} />
            )}
          </>
        )}
      </Flex>
    </Tooltip>
  );

  if (!setDifferenceType) {
    return trigger;
  }

  return (
    <DropdownMenu
      trigger={<div>{trigger}</div>}
      open={dropdownOpen}
      onOpenChange={setDropdownOpen}
      menuPlacement="end"
      variant="soft"
    >
      <DropdownMenuGroup>
        <DropdownMenuLabel
          textSize="1"
          textStyle={{ textTransform: "uppercase", fontWeight: 600 }}
        >
          Difference Type
        </DropdownMenuLabel>
        {[...differenceTypeMap.keys()].map((dt) => (
          <DropdownMenuItem
            key={dt}
            onClick={async () => {
              await handleChangeDifferenceType(dt);
              setDropdownOpen(false);
            }}
          >
            <Flex align="center" gap="2">
              <Flex
                align="center"
                justify="center"
                style={{ width: 16, flexShrink: 0 }}
              >
                {desiredDifferenceType === dt ? <PiCheck /> : null}
              </Flex>
              <Text>{differenceTypeMap.get(dt)}</Text>
            </Flex>
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
    </DropdownMenu>
  );
}
