import { useState } from "react";
import usePermissions from "../../hooks/usePermissions";
import { useAuth } from "../../services/auth";
import { date, datetime } from "../../services/dates";
import { phaseSummary } from "../../services/utils";
import DeleteButton from "../DeleteButton";
import SelectField from "../Forms/SelectField";
import { GBAddCircle } from "../Icons";
import Modal from "../Modal";
import EditPhaseModal from "./EditPhaseModal";
import NewPhaseForm from "./NewPhaseForm";
import { useSnapshot } from "./SnapshotProvider";

export interface Props {
  mutateExperiment?: () => void;
}

export default function PhaseSelector({ mutateExperiment }: Props) {
  const { phase, setPhase, experiment } = useSnapshot();

  const phaseOptions = experiment.phases.map((phase, i) => ({
    label: i + "",
    value: i + "",
  }));

  const [editPhases, setEditPhases] = useState(false);
  const [editPhase, setEditPhase] = useState<number | null>(null);

  const { apiCall } = useAuth();

  const permissions = usePermissions();

  const canEdit = permissions.createAnalyses && !experiment.archived;

  const selectOptions =
    canEdit && mutateExperiment
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
    <>
      {editPhase === -1 ? (
        <NewPhaseForm
          close={() => setEditPhase(null)}
          experiment={experiment}
          mutate={mutateExperiment}
        />
      ) : editPhase !== null ? (
        <EditPhaseModal
          close={() => {
            setEditPhase(null);
          }}
          experiment={experiment}
          i={editPhase}
          mutate={mutateExperiment}
        />
      ) : editPhases ? (
        <Modal
          open={true}
          header="Edit Phases"
          close={() => setEditPhases(false)}
          size="lg"
          closeCta="Close"
        >
          <table className="table gbtable mb-2">
            <thead>
              <tr>
                <th></th>
                <th>Dates</th>
                <th>Traffic</th>
                <th>Reason for Stopping</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {experiment.phases.map((phase, i) => (
                <tr className="border p-2 m-2" key={i}>
                  <td>{i + 1}</td>
                  <td>
                    <strong title={datetime(phase.dateStarted)}>
                      {date(phase.dateStarted)}
                    </strong>{" "}
                    to{" "}
                    <strong title={datetime(phase.dateEnded)}>
                      {phase.dateEnded ? date(phase.dateEnded) : "now"}
                    </strong>
                  </td>
                  <td>{phaseSummary(phase)}</td>
                  <td>{phase.reason}</td>
                  <td>
                    <button
                      className="btn btn-outline-primary mr-2"
                      onClick={(e) => {
                        e.preventDefault();
                        setEditPhase(i);
                      }}
                    >
                      Edit
                    </button>
                    <DeleteButton
                      displayName="phase"
                      additionalMessage={
                        experiment.phases.length === 1
                          ? "This is the only phase. Deleting this will revert the experiment to a draft."
                          : ""
                      }
                      onClick={async () => {
                        await apiCall(
                          `/experiment/${experiment.id}/phase/${i}`,
                          {
                            method: "DELETE",
                          }
                        );
                        mutateExperiment();
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            className="btn btn-primary"
            onClick={(e) => {
              e.preventDefault();
              setEditPhase(-1);
            }}
          >
            <GBAddCircle /> New Phase
          </button>
        </Modal>
      ) : (
        ""
      )}
      <SelectField
        options={selectOptions}
        value={phase + ""}
        onChange={(value) => {
          if (mutateExperiment && canEdit && value === "edit") {
            setEditPhases(true);
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
            <div className="small">
              <div>{phaseSummary(phase)}</div>
              <div>
                <strong>{date(phase.dateStarted)}</strong> to{" "}
                <strong>
                  {phase.dateEnded ? date(phase.dateEnded) : "now"}
                </strong>
              </div>
            </div>
          );
        }}
      />
    </>
  );
}
