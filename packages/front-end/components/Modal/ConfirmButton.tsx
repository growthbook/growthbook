import { ReactNode, FC, useState, ReactElement } from "react";
import Modal from "@/components/Modal";

const ConfirmButton: FC<{
  onClick: () => Promise<void>;
  modalHeader: string;
  confirmationText?: string | ReactElement;
  ctaColor?: string;
  cta?: string;
  children: ReactNode;
  disabled?: boolean;
}> = ({
  onClick,
  modalHeader,
  confirmationText = "Are you sure?",
  cta = "Yes",
  ctaColor = "primary",
  children,
  disabled = false,
}) => {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      {confirming ? (
        <Modal
          header={modalHeader}
          close={() => setConfirming(false)}
          open={true}
          cta={cta}
          submitColor={ctaColor}
          submit={onClick}
        >
          <div>{confirmationText}</div>
        </Modal>
      ) : (
        ""
      )}
      <span
        onClick={(e) => {
          e.preventDefault();
          !disabled && setConfirming(true);
        }}
      >
        {children}
      </span>
    </>
  );
};

export default ConfirmButton;
