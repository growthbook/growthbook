import { useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { date, datetime } from "@/services/dates";
import { phaseSummary } from "@/services/utils";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";
import DeleteButton from "../DeleteButton/DeleteButton";
import { GBAddCircle } from "../Icons";
import EditPhaseModal from "./EditPhaseModal";
import NewPhaseForm from "./NewPhaseForm";

export interface Props {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  mutateExperiment: () => void;
}

export default function EditPhasesModal({
  close,
  experiment,
  mutateExperiment,
}: Props) {
  const [editPhase, setEditPhase] = useState<number | null>(null);
  const { apiCall } = useAuth();

  if (editPhase === -1) {
    return (
      <NewPhaseForm
        close={() => setEditPhase(null)}
        experiment={experiment}
        mutate={mutateExperiment}
      />
    );
  }

  if (editPhase !== null) {
    return (
      <EditPhaseModal
        close={() => {
          setEditPhase(null);
        }}
        experiment={experiment}
        i={editPhase}
        mutate={mutateExperiment}
      />
    );
  }

  return (
    <Modal
      open={true}
      header="Edit Phases"
      close={close}
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
                    await apiCall(`/experiment/${experiment.id}/phase/${i}`, {
                      method: "DELETE",
                    });
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
  );
}
