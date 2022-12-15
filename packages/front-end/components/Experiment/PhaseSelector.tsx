import { date } from "@/services/dates";
import { phaseSummary } from "@/services/utils";
import SelectField from "../Forms/SelectField";
import { useSnapshot } from "./SnapshotProvider";

export interface Props {
  mutateExperiment?: () => void;
  editPhases?: () => void;
}

export default function PhaseSelector({ mutateExperiment, editPhases }: Props) {
  const { phase, setPhase, experiment } = useSnapshot();

  const phaseOptions = experiment.phases.map((phase, i) => ({
    label: i + "",
    value: i + "",
  }));

  const selectOptions =
    editPhases && mutateExperiment
      ? [
          {
            label: "Phases",
            value: "",
            options: phaseOptions,
          },
          {
            label: "____",
            value: "",
            options: [
              {
                label: "Edit Phases...",
                value: "edit",
              },
            ],
          },
        ]
      : phaseOptions;

  return (
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
      label="Phase"
      labelClassName="mr-2"
      formatOptionLabel={({ value, label }) => {
        if (value === "edit") {
          return <div className="cursor-pointer">{label}</div>;
        }

        const phaseIndex = parseInt(value) || 0;
        const phase = experiment.phases[phaseIndex];
        if (!phase) return value;

        return (
          <div className="d-flex">
            <div className="mr-2">{phaseIndex + 1}:</div>
            <div className="small">
              <div>{phaseSummary(phase)}</div>
              <div>
                <strong>{date(phase.dateStarted)}</strong> to{" "}
                <strong>
                  {phase.dateEnded ? date(phase.dateEnded) : "now"}
                </strong>
              </div>
            </div>
          </div>
        );
      }}
    />
  );
}
