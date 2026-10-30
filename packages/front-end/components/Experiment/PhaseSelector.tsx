import { ReactNode } from "react";
import { date } from "shared/dates";
import { parseIntWithDefault } from "shared/util";
import { ExperimentPhaseStringDates } from "shared/types/experiment";
import { Flex } from "@radix-ui/themes";
import { HoldoutInterfaceStringDates } from "shared/validators";
import { phaseSummary } from "@/services/utils";
import Tooltip from "@/ui/Tooltip";
import SelectField from "@/components/Forms/SelectField";
import { useSnapshot } from "./SnapshotProvider";
import { upcomingEnd } from "./TabbedPage/statusSchedule";

export interface Props {
  phase?: number;
  phases?: ExperimentPhaseStringDates[];
  isBandit?: boolean;
  isHoldout?: boolean;
  holdout?: HoldoutInterfaceStringDates;
  // The selected phase's tooltip, as if it were the only phase.
  details?: (phaseIndex: number) => ReactNode;
}

export default function PhaseSelector({
  phase,
  phases,
  isBandit,
  isHoldout,
  holdout,
  details,
}: Props) {
  const {
    phase: snapshotPhase,
    setPhase: setSnapshotPhase,
    experiment,
  } = useSnapshot();

  const phaseOptions =
    (phases ?? experiment?.phases)?.map((phase, i) => ({
      label: i + "",
      value: i + "",
    })) || [];

  // Running, the latest phase ends when it's scheduled to, or open-ended.
  const ends = (index: number, phase: ExperimentPhaseStringDates) =>
    phase.dateEnded
      ? date(phase.dateEnded, "UTC")
      : (index === phaseOptions.length - 1 &&
          experiment?.status === "running" &&
          upcomingEnd(experiment, new Date())) ||
        "now";

  function formatPhase(
    { value }: { value: string },
    meta?: { context?: string },
  ) {
    const phaseIndex = parseIntWithDefault(value, 0);
    const phase = (phases ?? experiment?.phases)?.[phaseIndex];
    if (!phase) return value;

    const isValueContext = meta?.context === "value";

    if (isValueContext) {
      const tip = details?.(phaseIndex) ?? null;
      // Collapsed/selected value mode - show tooltip version
      return (
        // Closes once pressed, so it stays out of the way of the menu.
        <Tooltip content={tip} enabled={!!tip} side="top">
          <span>
            <span className="font-weight-bold">
              {!isHoldout
                ? "Phase "
                : phaseIndex === 0
                  ? "Holdout: "
                  : "Analysis: "}
            </span>
            {!isHoldout && (
              <span className="font-weight-bold">{phaseIndex + 1}: </span>
            )}
            <span className="date-label">
              {phase.lookbackStartDate && isHoldout
                ? date(
                    holdout?.analysisStartDate ?? phase.lookbackStartDate,
                    "UTC",
                  )
                : date(phase.dateStarted ?? "", "UTC")}{" "}
              – {ends(phaseIndex, phase)}
            </span>
          </span>
        </Tooltip>
      );
    }

    // Dropdown menu mode - show full option version
    return (
      <div className="cursor-pointer">
        <span className="font-weight-bold">{phaseIndex + 1}: </span>
        <span className="font-weight-bold">{phase.name}</span>
        <div className="break mt-1" />
        <span className="date-label mt-1">
          {phase.lookbackStartDate && isHoldout
            ? date(phase.lookbackStartDate, "UTC")
            : date(phase.dateStarted ?? "", "UTC")}{" "}
          – {ends(phaseIndex, phase)}
        </span>
        {!isHoldout && (
          <div className="small">{phaseSummary(phase, isBandit)}</div>
        )}
      </div>
    );
  }

  return (
    <Flex direction="row" gap="2" align="center">
      {phaseOptions.length > 1 ? (
        <SelectField
          size="legacy"
          options={phaseOptions}
          value={(phase !== undefined ? phase : snapshotPhase) + ""}
          onChange={(value) => setSnapshotPhase(parseIntWithDefault(value, 0))}
          sort={false}
          containerClassName="select-dropdown-no-underline"
          isSearchable={false}
          formatOptionLabel={(option, meta) => formatPhase(option, meta)}
        />
      ) : (
        <div className="phase-selector text-dark">
          {phaseOptions.length >= 1 ? (
            <div className="gb-select__single-value" style={{ height: 24 }}>
              {formatPhase(phaseOptions[0], { context: "value" })}
            </div>
          ) : (
            <div className="gb-select__single-value" style={{ height: 24 }}>
              <em>No phases</em>
            </div>
          )}
        </div>
      )}
    </Flex>
  );
}
