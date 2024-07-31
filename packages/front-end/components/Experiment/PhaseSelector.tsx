import { date } from "shared/dates";
import { phaseSummary } from "@/services/utils";
import Tooltip from "@/components/Tooltip/Tooltip";
import SelectField from "@/components/Forms/SelectField";
import { useSnapshot } from "./SnapshotProvider";

export interface Props {
  mutateExperiment?: () => void;
  editPhases?: () => void;
}

export default function PhaseSelector({ mutateExperiment, editPhases }: Props) {
  const { phase, setPhase, experiment } = useSnapshot();

  const phaseOptions =
    experiment?.phases?.map((phase, i) => ({
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
    const phase = experiment?.phases?.[phaseIndex];
    if (!phase) return value;

    return (
      <>
        <Tooltip
          body={
            <>
              <div className="tooltip-phase-label font-weight-bold">
                {phaseIndex + 1}: {phase.name}
              </div>
              <div className="mt-1">
                {phaseSummary(phase, experiment.type === "multi-armed-bandit")}
              </div>
            </>
          }
          tipPosition="right"
          className="phase-selector-with-tooltip"
        >
          <>
            <span className="font-weight-bold">{phaseIndex + 1}: </span>
            <span className="date-label">
              {date(phase.dateStarted ?? "")} —{" "}
              {phase.dateEnded ? date(phase.dateEnded) : "now"}
            </span>
          </>
        </Tooltip>
        <div className="phase-selector-select-option cursor-pointer">
          <span className="font-weight-bold">{phaseIndex + 1}: </span>
          <span className="phase-label font-weight-bold">{phase.name}</span>
          <div className="break mt-1" />
          <span className="date-label mt-1">
            {date(phase.dateStarted ?? "")} —{" "}
            {phase.dateEnded ? date(phase.dateEnded) : "now"}
          </span>
          <div className="phase-summary text-muted small">
            {phaseSummary(phase)}
          </div>
        </div>
      </>
    );
  }

  const selectOptions =
    editPhases && mutateExperiment
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
      <div className="uppercase-title text-muted">Phase</div>
      {selectOptions.length > 1 ? (
        <SelectField
          options={selectOptions}
          value={phase + ""}
          onChange={(value) => {
            if (mutateExperiment && editPhases && value === "edit") {
              editPhases();
              return;
            }
            setPhase(parseInt(value) || 0);
          }}
          sort={false}
          labelClassName="mr-2"
          containerClassName="phase-selector select-dropdown-underline pr-5"
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
