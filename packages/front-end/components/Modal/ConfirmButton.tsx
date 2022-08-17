import { ReactNode } from "react";
import { FC, useState, ReactElement } from "react";
import Modal from "../Modal";

const ConfirmButton: FC<{
  onClick: () => Promise<void>;
  modalHeader: string;
  confirmationText?: string | ReactElement;
  ctaColor?: string;
  cta?: string;
  children: ReactNode;
}> = ({
  onClick,
  modalHeader,
  confirmationText = "Are you sure?",
  cta = "Yes",
  ctaColor = "primary",
  children,
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
          setConfirming(true);
        }}
      >
        {children}
      </span>
    </>
  );
};

export default ConfirmButton;
