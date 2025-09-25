import { date } from "shared/dates";
import { ExperimentPhaseStringDates } from "back-end/types/experiment";
import { isEqual } from "lodash";
import { phaseSummary } from "@/services/utils";
import Tooltip from "@/components/Tooltip/Tooltip";
import SelectField from "@/components/Forms/SelectField";
import { useSnapshot } from "./SnapshotProvider";

export interface Props {
  mutateExperiment?: () => void;
  editPhases?: () => void;
  phase?: number;
  phases?: ExperimentPhaseStringDates[];
  setPhase?: (p: number) => void;
  isBandit?: boolean;
  isHoldout?: boolean;
}

export default function PhaseSelector({
  mutateExperiment,
  editPhases,
  phase,
  phases,
  setPhase,
  isBandit,
  isHoldout,
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

  function formatPhase({ value, label }: { value: string; label: string }) {
    if (value === "edit") {
      return (
        <div className="cursor-pointer btn btn-outline-primary">{label}</div>
      );
    }

    const phaseIndex = parseInt(value) || 0;
    const phase = (phases ?? experiment?.phases)?.[phaseIndex];
    if (!phase) return value;
    const phaseChanges = () => {
      if (phaseIndex > 0) {
        const previousPhase = experiment?.phases?.[phaseIndex - 1];
        const currentPhase = experiment?.phases?.[phaseIndex];
        if (!previousPhase || !currentPhase) return null;
        const changes = {
          seedChanged: currentPhase.seed !== previousPhase.seed,
          namespaceChanged: !isEqual(
            currentPhase.namespace,
            previousPhase.namespace,
          ),
          variationWeightsChanged: !isEqual(
            currentPhase.variationWeights,
            previousPhase.variationWeights,
          ),
          prerequisitesChanged: !isEqual(
            currentPhase.prerequisites,
            previousPhase.prerequisites,
          ),
          savedGroupsChanged: !isEqual(
            currentPhase.savedGroups,
            previousPhase.savedGroups,
          ),
          disableStickyBucketing:
            currentPhase.disableStickyBucketing !==
            previousPhase.disableStickyBucketing,
          conditionChanged: currentPhase.condition !== previousPhase.condition,
          coverageChanged: currentPhase.coverage !== previousPhase.coverage,
        };
        // no changes
        if (Object.values(changes).every((change) => change === false))
          return null;
        return changes;
      }
      return null;
    };

    return (
      <>
        <Tooltip
          body={
            <>
              <div className="tooltip-phase-label font-weight-bold">
                {!isHoldout && `${phaseIndex + 1}: `} {phase.name}
              </div>
              {!isHoldout && (
                <div className="mt-1">{phaseSummary(phase, isBandit)}</div>
              )}
              <span className="phase-selector-select-option-metadata">
                <div>Changes</div>
                {phaseChanges() === null && (
                  <div className="text-muted">None</div>
                )}
                {phaseChanges()?.seedChanged && (
                  <div className="text-muted">Seed</div>
                )}
                {phaseChanges()?.namespaceChanged && (
                  <div className="text-muted">Namespace</div>
                )}
                {phaseChanges()?.variationWeightsChanged && (
                  <div className="text-muted">Variation Weights</div>
                )}
                {phaseChanges()?.prerequisitesChanged && (
                  <div className="text-muted">Prerequisites</div>
                )}
                {phaseChanges()?.savedGroupsChanged && (
                  <div className="text-muted">Saved Groups</div>
                )}
                {phaseChanges()?.conditionChanged && (
                  <div className="text-muted">Condition</div>
                )}
                {phaseChanges()?.coverageChanged && (
                  <div className="text-muted">Coverage</div>
                )}
                {phaseChanges()?.disableStickyBucketing && (
                  <div className="text-muted">Sticky Bucketing</div>
                )}
              </span>
            </>
          }
          shouldDisplay={!isBandit}
          tipPosition="right"
          className="phase-selector-with-tooltip"
        >
          <>
            {!isHoldout && (
              <span className="font-weight-bold">{phaseIndex + 1}: </span>
            )}
            <span className="date-label">
              {phase.lookbackStartDate && isHoldout
                ? date(phase.lookbackStartDate, "UTC")
                : date(phase.dateStarted ?? "", "UTC")}{" "}
              — {phase.dateEnded ? date(phase.dateEnded, "UTC") : "now"}
            </span>
          </>
        </Tooltip>
        <div className="phase-selector-select-option cursor-pointer">
          <span className="font-weight-bold">{phaseIndex + 1}: </span>
          <span className="phase-label font-weight-bold">{phase.name}</span>
          <div className="break mt-1" />
          <span className="date-label mt-1">
            {phase.lookbackStartDate && isHoldout
              ? date(phase.lookbackStartDate, "UTC")
              : date(phase.dateStarted ?? "", "UTC")}{" "}
            — {phase.dateEnded ? date(phase.dateEnded, "UTC") : "now"}
          </span>
          {!isHoldout && (
            <div className="phase-summary text-muted small">
              {phaseSummary(phase, isBandit)}
            </div>
          )}
        </div>
      </>
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
          labelClassName="mr-2"
          containerClassName="phase-selector align-right select-dropdown-underline pr-1"
          isSearchable={false}
          formatOptionLabel={formatPhase}
        />
      ) : (
        <div className="phase-selector text-dark">
          {selectOptions.length >= 1 ? (
            <div className="gb-select__single-value" style={{ height: 24 }}>
              {formatPhase(selectOptions[0])}
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
