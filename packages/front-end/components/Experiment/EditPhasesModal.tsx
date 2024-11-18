import { useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { date, datetime } from "shared/dates";
import { phaseSummary } from "@/services/utils";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { GBAddCircle } from "@/components/Icons";
import EditPhaseModal from "./EditPhaseModal";
import NewPhaseForm from "./NewPhaseForm";

export interface Props {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  mutateExperiment: () => void;
  editTargeting: (() => void) | null;
  source?: string;
}

export default function EditPhasesModal({
  close,
  experiment,
  mutateExperiment,
  editTargeting,
  source,
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
        source="edit-phases-modal"
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
      trackingEventModalType="edit-phases-modal"
      trackingEventModalSource={source}
      open={true}
      header="编辑阶段"
      close={close}
      size="lg"
      closeCta="关闭"
    >
      <table className="table gbtable mb-2">
        <thead>
          <tr>
            <th></th>
            <th>名称</th>
            <th>日期</th>
            <th>流量</th>
            {hasStoppedPhases ? <th>停止原因</th> : null}
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
              <td>
                {phaseSummary(phase, experiment.type === "multi-armed-bandit")}
              </td>
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
                  编辑
                </button>
                {(experiment.status !== "running" || !hasLinkedChanges) && (
                  <DeleteButton
                    className="ml-2"
                    displayName="phase"
                    additionalMessage={
                      experiment.phases.length === 1
                        ? "这是唯一的阶段。删除此阶段将使实验恢复为草稿状态。"
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
          <GBAddCircle /> 新建阶段
        </button>
      )}
    </Modal>
  );
}
