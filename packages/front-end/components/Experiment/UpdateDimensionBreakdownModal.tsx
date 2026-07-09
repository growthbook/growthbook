import React from "react";
import { datetime } from "shared/dates";
import { SourceSnapshotRef } from "shared/enterprise";
import Modal from "@/ui/Modal";
import Button from "@/ui/Button";

interface Props {
  sourceSnapshot: SourceSnapshotRef;
  close: () => void;
  handleUpdateDimensionOnlyClick: () => void;
  handleGoToOverallResultsClick: () => void;
}

export default function UpdateDimensionBreakdownModal({
  sourceSnapshot,
  close,
  handleUpdateDimensionOnlyClick,
  handleGoToOverallResultsClick,
}: Props) {
  const dateLabel = datetime(sourceSnapshot.dateCreated);

  return (
    <Modal.Root
      trackingEventModalType="update-dimension-breakdown"
      open={true}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Modal.Header>
        <Modal.Title>Update Dimension Results?</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p>
          Dimension Results are built from your Overall Results, which already
          hold the latest data available from <b>{dateLabel}</b>.
        </p>
        <p>
          Updating Dimension Results now re-runs on top of that same data. To
          fetch newer data, update your Overall Results first.
        </p>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            handleUpdateDimensionOnlyClick();
            close();
          }}
        >
          Update dimension only
        </Button>
        <Button onClick={handleGoToOverallResultsClick}>
          Update overall results
        </Button>
      </Modal.Footer>
    </Modal.Root>
  );
}
