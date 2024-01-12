import { useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { date, datetime } from "shared/dates";
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
  editTargeting: (() => void) | null;
}

export default function EditPhasesModal({
  close,
  experiment,
  mutateExperiment,
  editTargeting,
}: Props) {
  const isDraft = experiment.status === "draft";
  const isMultiPhase = experiment.phases.length > 1;
  const hasStoppedPhases = experiment.phases.some((p) => p.dateEnded);
  const hasLinkedChanges =
    !!experiment.linkedFeatures?.length || !!experiment.hasVisualChangesets;

  const [editPhase, setEditPhase] = useState<number | null>(
    isDraft && !isMultiPhase ? 0 : null
  );
  const { apiCall } = useAuth();

  if (editPhase === -1) {
    return (
      <NewPhaseForm
        close={() => {
          if (isDraft && !isMultiPhase) {
            close();
          } else {
            setEditPhase(null);
          }
        }}
        experiment={experiment}
        mutate={mutateExperiment}
      />
    );
  }

  if (editPhase !== null) {
    return (
      <EditPhaseModal
        close={() => {
          if (isDraft && !isMultiPhase) {
            close();
          } else {
            setEditPhase(null);
          }
        }}
        experiment={experiment}
        i={editPhase}
        mutate={mutateExperiment}
        editTargeting={() => {
          editTargeting?.();
          close();
        }}
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
            <th>Name</th>
            <th>Dates</th>
            <th>Traffic</th>
            {hasStoppedPhases ? <th>Reason for Stopping</th> : null}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {experiment.phases.map((phase, i) => (
            <tr className="border p-2 m-2" key={i}>
              <td>{i + 1}</td>
              <td>{phase.name}</td>
              <td>
                <strong title={datetime(phase.dateStarted ?? "")}>
                  {date(phase.dateStarted ?? "")}
                </strong>{" "}
                to{" "}
                <strong title={datetime(phase.dateEnded ?? "")}>
                  {phase.dateEnded ? date(phase.dateEnded) : "now"}
                </strong>
              </td>
              <td>{phaseSummary(phase)}</td>
              {hasStoppedPhases ? (
                <td>
                  {phase.dateEnded ? (
                    phase.reason
                  ) : (
                    <em className="text-muted">not applicable</em>
                  )}
                </td>
              ) : null}
              <td className="text-right" style={{ width: 125 }}>
                <button
                  className="btn btn-outline-primary"
                  onClick={(e) => {
                    e.preventDefault();
                    setEditPhase(i);
                  }}
                >
                  Edit
                </button>
                {(experiment.status !== "running" || !hasLinkedChanges) && (
                  <DeleteButton
                    className="ml-2"
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
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(experiment.status !== "running" || !hasLinkedChanges) && (
        <button
          className="btn btn-primary"
          onClick={(e) => {
            e.preventDefault();
            setEditPhase(-1);
          }}
        >
          <GBAddCircle /> New Phase
        </button>
      )}
    </Modal>
  );
}
