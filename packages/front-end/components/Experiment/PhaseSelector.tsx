import { date } from "shared/dates";
import { phaseSummary } from "@/services/utils";
import SelectField from "../Forms/SelectField";
import { useSnapshot } from "./SnapshotProvider";

export interface Props {
  mutateExperiment?: () => void;
  editPhases?: () => void;
  newUi?: boolean;
}

export default function PhaseSelector({
  mutateExperiment,
  editPhases,
  newUi,
}: Props) {
  const { phase, setPhase, experiment } = useSnapshot();

  const phaseOptions = experiment?.phases?.map((phase, i) => ({
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
      : phaseOptions ?? [];

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
      label={newUi ? undefined : "Phase"}
      labelClassName="mr-2"
      className={newUi ? "phase-selector-clean" : undefined}
      isSearchable={false}
      formatOptionLabel={({ value, label }) => {
        if (value === "edit") {
          return <div className="cursor-pointer">{label}</div>;
        }

        const phaseIndex = parseInt(value) || 0;
        const phase = experiment?.phases?.[phaseIndex];
        if (!phase) return value;

        if (newUi) {
          return (
            <div className="small text-gray">
              <div className="phase-label">Phase {phaseIndex + 1}:</div>
              <div className="date-label font-weight-bold">
                {date(phase.dateStarted ?? "")} —{" "}
                {phase.dateEnded ? date(phase.dateEnded) : "now"}
              </div>
            </div>
          );
        }

        return (
          <div className="d-flex">
            <div className="mr-2">{phaseIndex + 1}:</div>
            <div className="small">
              <div>
                {phase.name === "Main" ? phaseSummary(phase) : phase.name}
              </div>
              <div>
                <strong>{date(phase.dateStarted ?? "")}</strong> to{" "}
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
