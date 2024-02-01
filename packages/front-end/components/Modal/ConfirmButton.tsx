import { ReactNode, FC, useState, ReactElement, isValidElement } from "react";
import Modal from "../Modal";

const ConfirmButton: FC<{
  onClick: () => Promise<void>;
  modalHeader: string;
  confirmationText?: ReactElement | null | string;
  additionalMessage?: ReactElement | null | string;
  ctaColor?: string;
  cta?: string;
  ctaEnabled?: boolean;
  children: ReactNode;
}> = ({
  onClick,
  modalHeader,
  confirmationText = "Are you sure?",
  additionalMessage = "",
  ctaColor = "primary",
  cta = "Yes",
  ctaEnabled = true,
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
          ctaEnabled={ctaEnabled}
          submitColor={ctaColor}
          submit={onClick}
        >
          <div>{confirmationText}</div>
          {additionalMessage &&
            (isValidElement(additionalMessage) ? (
              additionalMessage
            ) : (
              <p>{additionalMessage}</p>
            ))}
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
