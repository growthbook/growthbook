import { ReactNode, FC, useState, ReactElement, isValidElement } from "react";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

const ConfirmButton: FC<{
  onClick: () => Promise<void>;
  modalHeader: string;
  confirmationText?: string | ReactElement;
  cta?: string;
  ctaEnabled?: boolean;
  size?: "md" | "lg";
  children: ReactNode;
  additionalMessage?: ReactElement | null | string;
  disabled?: boolean;
  isDestructive?: boolean;
}> = ({
  onClick,
  modalHeader,
  confirmationText = "Are you sure?",
  cta = "Yes",
  ctaEnabled = true,
  size = "md",
  children,
  additionalMessage = "",
  disabled = false,
  isDestructive = false,
}) => {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      {confirming && (
        <ModalStandard
          trackingEventModalType=""
          header={modalHeader}
          close={() => setConfirming(false)}
          open={true}
          cta={cta}
          ctaEnabled={ctaEnabled}
          ctaColor={isDestructive ? "red" : "violet"}
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
        </ModalStandard>
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
