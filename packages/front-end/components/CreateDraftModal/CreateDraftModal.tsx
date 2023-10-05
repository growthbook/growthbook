import React, { FC, useCallback, useState } from "react";
import Modal from "../Modal";

type CreateDraftModalProps = {
  onConfirm: () => Promise<void>;
  onCancel: () => void;
};

export const CreateDraftModal: FC<CreateDraftModalProps> = ({
  onConfirm,
  onCancel,
}) => {
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string>("");

  const handleSubmitClicked = useCallback(async () => {
    setEnabled(false);

    try {
      await onConfirm();
    } catch (err) {
      setError(err);
      setEnabled(true);
    }
  }, [onConfirm]);

  return (
    <Modal
      header="Create Draft"
      open={true}
      close={onCancel}
      submit={handleSubmitClicked}
      cta="Create Draft"
      error={error}
      ctaEnabled={enabled}
    >
      <p>Attempting to modify this property will create a new draft.</p>
      <p>Would you like to create a new draft?</p>
    </Modal>
  );
};
