import React, { useState } from "react";
import Modal from "@/ui/Modal";
import Button from "@/ui/Button";
import { SingleValue } from "@/components/Forms/SelectField";
import CustomDimensionFields, {
  CustomDimensionDraft,
  isCustomDimensionDraftValid,
} from "@/components/Dimensions/CustomDimensionFields";

export default function CustomDimensionModal({
  initialDraft,
  constituentOptions,
  cutoffMin,
  cutoffMax,
  close,
  onApply,
}: {
  initialDraft: CustomDimensionDraft;
  constituentOptions: SingleValue[];
  cutoffMin?: Date;
  cutoffMax?: Date;
  close: () => void;
  onApply: (draft: CustomDimensionDraft) => void;
}) {
  const [draft, setDraft] = useState<CustomDimensionDraft>(initialDraft);
  const valid = isCustomDimensionDraftValid(draft, cutoffMin, cutoffMax);

  return (
    <Modal.Root
      trackingEventModalType="custom-dimension-config"
      open={true}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Modal.Header>
        <Modal.Title>
          {draft.kind === "cutoff"
            ? "Break Down by First Exposure Time"
            : "Break Down by Two Dimensions"}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <CustomDimensionFields
          draft={draft}
          setDraft={setDraft}
          constituentOptions={constituentOptions}
          cutoffMin={cutoffMin}
          cutoffMax={cutoffMax}
        />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button
          disabled={!valid}
          onClick={() => {
            onApply(draft);
            close();
          }}
        >
          Apply
        </Button>
      </Modal.Footer>
    </Modal.Root>
  );
}
