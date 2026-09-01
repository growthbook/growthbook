import React, { useState } from "react";
import Modal from "@/ui/Modal";
import Button from "@/ui/Button";
import { SingleValue } from "@/components/Forms/SelectField";
import CustomDimensionFields, {
  CustomDimensionDraft,
  customDimensionDraftError,
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
  const invalidReason = customDimensionDraftError(draft, cutoffMin, cutoffMax);

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
            ? "First Exposed After"
            : "Combination of Dimensions"}
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
          disabled={invalidReason !== null}
          title={invalidReason ?? undefined}
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
