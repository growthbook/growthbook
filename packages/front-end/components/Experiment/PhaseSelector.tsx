import { date } from "shared/dates";
import { ExperimentPhaseStringDates } from "shared/types/experiment";
import { Flex } from "@radix-ui/themes";
import { HoldoutInterface } from "shared/validators";
import { phaseSummary } from "@/services/utils";
import Tooltip from "@/components/Tooltip/Tooltip";
import SelectField from "@/components/Forms/SelectField";
import Text from "@/ui/Text";
import { useSnapshot } from "./SnapshotProvider";

export interface Props {
  mutateExperiment?: () => void;
  editPhases?: () => void;
  phase?: number;
  phases?: ExperimentPhaseStringDates[];
  setPhase?: (p: number) => void;
  isBandit?: boolean;
  isHoldout?: boolean;
  newUi?: boolean;
  holdout?: HoldoutInterface;
}

export default function PhaseSelector({
  mutateExperiment,
  editPhases,
  phase,
  phases,
  setPhase,
  isBandit,
  isHoldout,
  newUi = true,
  holdout,
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

  function formatPhase(
    { value, label }: { value: string; label: string },
    meta?: { context?: string },
  ) {
    if (value === "edit") {
      return (
        <div className="cursor-pointer btn btn-outline-primary">{label}</div>
      );
    }

    const phaseIndex = parseInt(value) || 0;
    const phase = (phases ?? experiment?.phases)?.[phaseIndex];
    if (!phase) return value;

    const isValueContext = meta?.context === "value";

    if (isValueContext) {
      // Collapsed/selected value mode - show tooltip version
      return (
        <Tooltip
          body={
            <>
              <div className="font-weight-bold">
                {!isHoldout && `Phase ${phaseIndex + 1}: `} {phase.name}
              </div>
              {!isHoldout && (
                <div className="mt-1">{phaseSummary(phase, isBandit)}</div>
              )}
            </>
          }
          shouldDisplay={!isBandit}
          tipPosition="top"
        >
          <>
            {newUi ? (
              <span className="font-weight-bold">
                {!isHoldout
                  ? "Phase "
                  : phaseIndex === 0
                    ? "Holdout: "
                    : "Analysis: "}
              </span>
            ) : null}
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
              - {phase.dateEnded ? date(phase.dateEnded, "UTC") : "now"}
            </span>
          </>
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
          — {phase.dateEnded ? date(phase.dateEnded, "UTC") : "now"}
        </span>
        {!isHoldout && (
          <div className="small">{phaseSummary(phase, isBandit)}</div>
        )}
      </div>
    );
  }

  const selectOptions =
    !isHoldout && editPhases && mutateExperiment
      ? [
          {
            label: "Phases",
            value: "",
            options: phaseOptions,
          },
          {
            label: "",
            value: "",
            options: [
              {
                label: "Edit Phases",
                value: "edit",
              },
            ],
          },
        ]
      : phaseOptions;

  if (newUi) {
    return (
      <Flex direction="row" gap="2" align="center">
        {!newUi ? (
          <Text weight="medium">{isHoldout ? "Date Range:" : "Phase:"}</Text>
        ) : null}
        {selectOptions.length > 1 ? (
          <SelectField
            options={selectOptions}
            value={(phase !== undefined ? phase : snapshotPhase) + ""}
            onChange={(value) => {
              if (mutateExperiment && editPhases && value === "edit") {
                editPhases();
                return;
              }
              (setPhase ?? setSnapshotPhase)(parseInt(value) || 0);
            }}
            sort={false}
            containerClassName="select-dropdown-no-underline"
            isSearchable={false}
            formatOptionLabel={(option, meta) => formatPhase(option, meta)}
          />
        ) : (
          <div className="phase-selector text-dark">
            {selectOptions.length >= 1 ? (
              <div className="gb-select__single-value" style={{ height: 24 }}>
                {formatPhase(selectOptions[0], { context: "value" })}
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

  return (
    <div>
      <div className="uppercase-title text-muted">
        {isHoldout ? "Date Range" : "Phase"}
      </div>
      {selectOptions.length > 1 ? (
        <SelectField
          options={selectOptions}
          value={(phase !== undefined ? phase : snapshotPhase) + ""}
          onChange={(value) => {
            if (mutateExperiment && editPhases && value === "edit") {
              editPhases();
              return;
            }
            (setPhase ?? setSnapshotPhase)(parseInt(value) || 0);
          }}
          sort={false}
          label={isHoldout ? "Date Range" : "Phase"}
          labelClassName="mr-2"
          containerClassName="phase-selector align-right select-dropdown-underline pr-1"
          isSearchable={false}
          formatOptionLabel={(option, meta) => formatPhase(option, meta)}
        />
      ) : (
        <div className="phase-selector text-dark">
          {selectOptions.length >= 1 ? (
            <div className="gb-select__single-value" style={{ height: 24 }}>
              {formatPhase(selectOptions[0], { context: "value" })}
            </div>
          ) : (
            <div className="gb-select__single-value" style={{ height: 24 }}>
              <em>No phases</em>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
