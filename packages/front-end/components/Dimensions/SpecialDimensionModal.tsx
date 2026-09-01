import React, { useState } from "react";
import Modal from "@/ui/Modal";
import Button from "@/ui/Button";
import { SingleValue } from "@/components/Forms/SelectField";
import SpecialDimensionFields, {
  SpecialDimensionDraft,
  isSpecialDimensionDraftValid,
} from "@/components/Dimensions/SpecialDimensionFields";

export default function SpecialDimensionModal({
  initialDraft,
  constituentOptions,
  cutoffMin,
  cutoffMax,
  close,
  onApply,
}: {
  initialDraft: SpecialDimensionDraft;
  constituentOptions: SingleValue[];
  cutoffMin?: Date;
  cutoffMax?: Date;
  close: () => void;
  onApply: (draft: SpecialDimensionDraft) => void;
}) {
  const [draft, setDraft] = useState<SpecialDimensionDraft>(initialDraft);
  const valid = isSpecialDimensionDraftValid(draft, cutoffMin, cutoffMax);

  return (
    <Modal.Root
      trackingEventModalType="special-dimension-config"
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
        <SpecialDimensionFields
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
