import { ReactNode, FC, useState, ReactElement, isValidElement } from "react";
import Modal from "@/components/Modal";

const ConfirmButton: FC<{
  onClick: () => Promise<void>;
  modalHeader: string;
  confirmationText?: string | ReactElement;
  ctaColor?: string;
  cta?: string | ReactElement;
  ctaEnabled?: boolean;
  size?: "md" | "lg" | "max" | "fill";
  children: ReactNode;
  additionalMessage?: ReactElement | null | string;
  disabled?: boolean;
}> = ({
  onClick,
  modalHeader,
  confirmationText = "Are you sure?",
  cta = "Yes",
  ctaEnabled = true,
  size = "md",
  ctaColor = "primary",
  children,
  additionalMessage = "",
  disabled = false,
}) => {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      {confirming ? (
        <Modal
          trackingEventModalType=""
          header={modalHeader}
          close={() => setConfirming(false)}
          open={true}
          cta={cta}
          ctaEnabled={ctaEnabled}
          submitColor={ctaColor}
          submit={onClick}
          size={size}
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
          !disabled && setConfirming(true);
        }}
      >
        {children}
      </span>
    </>
  );
};

export default ConfirmButton;
