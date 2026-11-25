import React from "react";
import { Trans } from "@lingui/react/macro";
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
  const dateLabel = datetime(sourceSnapshot.analysisEndDate);

  return (
    <Modal.Root
      trackingEventModalType="update-dimension-breakdown"
      open={true}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Modal.Header>
        <Modal.Title>
          <Trans>Update Dimension Results?</Trans>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p>
          <Trans>
            Dimension Results are built from your Overall Results, which already
            hold the latest data available from <b>{dateLabel}</b>.
          </Trans>
        </p>
        <p>
          <Trans>
            Updating Dimension Results now re-runs on top of that same data. To
            fetch newer data, update your Overall Results first.
          </Trans>
        </p>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={close}>
          <Trans>Cancel</Trans>
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            handleUpdateDimensionOnlyClick();
            close();
          }}
        >
          <Trans>Update dimension only</Trans>
        </Button>
        <Button onClick={handleGoToOverallResultsClick}>
          <Trans>Update overall results</Trans>
        </Button>
      </Modal.Footer>
    </Modal.Root>
  );
}
