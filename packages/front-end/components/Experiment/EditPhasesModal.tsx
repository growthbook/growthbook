import { useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { date, datetime } from "shared/dates";
import { Box, Flex } from "@radix-ui/themes";
import { phaseSummary } from "@/services/utils";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import DialogLayout from "@/ui/Dialog/Patterns/DialogLayout";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
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
  const isHoldout = experiment.type === "holdout";

  const [editPhase, setEditPhase] = useState<number | null>(
    isDraft && !isMultiPhase ? 0 : null,
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
    <DialogLayout
      trackingEventModalType="edit-phases-modal"
      trackingEventModalSource={source}
      open={true}
      header={!isHoldout ? "Edit Phases" : "Edit Holdout Period"}
      close={close}
      size="lg"
    >
      <Box mb="2">
        <Table className="table gbtable responsive-table" variant="ghost">
          <TableHeader>
            <TableRow>
              <TableColumnHeader></TableColumnHeader>
              <TableColumnHeader>Name</TableColumnHeader>
              <TableColumnHeader>Dates</TableColumnHeader>
              {!isHoldout ? (
                <TableColumnHeader>Traffic</TableColumnHeader>
              ) : null}
              {hasStoppedPhases ? (
                <TableColumnHeader>Reason for Stopping</TableColumnHeader>
              ) : null}
              <TableColumnHeader></TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {experiment.phases.map((phase, i) => (
              <TableRow key={i}>
                <TableCell>{i + 1}</TableCell>
                <TableCell>{phase.name}</TableCell>
                <TableCell>
                  <strong title={datetime(phase.dateStarted ?? "", "UTC")}>
                    {date(phase.dateStarted ?? "", "UTC")}
                  </strong>{" "}
                  to{" "}
                  <strong title={datetime(phase.dateEnded ?? "", "UTC")}>
                    {phase.dateEnded ? date(phase.dateEnded, "UTC") : "now"}
                  </strong>
                </TableCell>
                {!isHoldout ? (
                  <TableCell>
                    {phaseSummary(
                      phase,
                      experiment.type === "multi-armed-bandit",
                    )}
                  </TableCell>
                ) : null}
                {hasStoppedPhases ? (
                  <TableCell>
                    {phase.dateEnded ? (
                      phase.reason
                    ) : (
                      <em className="text-muted">not applicable</em>
                    )}
                  </TableCell>
                ) : null}
                <TableCell justify="end" style={{ width: 125 }}>
                  <Flex gap="2" justify="end" align="center">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditPhase(i);
                      }}
                    >
                      Edit
                    </Button>
                    {!isHoldout &&
                      (experiment.status !== "running" || !hasLinkedChanges) &&
                      experiment.phases.length > 1 && (
                        <DeleteButton
                          useRadix
                          text="Delete"
                          displayName="phase"
                          onClick={async () => {
                            await apiCall(
                              `/experiment/${experiment.id}/phase/${i}`,
                              {
                                method: "DELETE",
                              },
                            );
                            mutateExperiment();
                          }}
                        />
                      )}
                  </Flex>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      {!isHoldout && (experiment.status !== "running" || !hasLinkedChanges) && (
        <Button
          icon={<GBAddCircle />}
          onClick={() => {
            setEditPhase(-1);
          }}
        >
          New Phase
        </Button>
      )}
    </DialogLayout>
  );
}
