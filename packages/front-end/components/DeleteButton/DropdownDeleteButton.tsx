// This component is designed for use with Radix UI DropdownMenu components.
// It provides a delete action that renders as a DropdownMenuItem with confirmation modal support.
import { FC, ReactElement, isValidElement } from "react";
import { Text } from "@radix-ui/themes";
import { PiTrashFill } from "react-icons/pi";
import { DropdownMenuItem } from "@/ui/DropdownMenu";

interface DropdownDeleteButtonProps {
  onClick: () => void | Promise<void>;
  displayName: string;
  text?: string;
  deleteMessage?: ReactElement | null | string;
  additionalMessage?: ReactElement | null | string;
  getConfirmationContent?: () => Promise<string | ReactElement | null>;
  canDelete?: boolean;
  disabled?: boolean;
  useIcon?: boolean;
}

const DropdownDeleteButton: FC<DropdownDeleteButtonProps> = ({
  onClick,
  displayName,
  text = "Delete",
  deleteMessage = "Are you sure? This action cannot be undone.",
  additionalMessage = "",
  getConfirmationContent,
  canDelete = true,
  disabled = false,
  useIcon = false,
}) => {
  // Build the confirmation content function
  const getConfirmationContentSync = async (): Promise<
    string | ReactElement | null
  > => {
    // If getConfirmationContent is provided, use it
    if (getConfirmationContent) {
      try {
        const content = await getConfirmationContent();
        // If we have additionalMessage, combine them
        if (additionalMessage && content) {
          return (
            <>
              {isValidElement(content) ? content : <p>{content}</p>}
              {isValidElement(additionalMessage) ? (
                additionalMessage
              ) : (
                <p>{additionalMessage}</p>
              )}
            </>
          );
        }
        return content;
      } catch (e) {
        console.error(e);
        return null;
      }
    }

    // Otherwise, combine deleteMessage and additionalMessage
    if (additionalMessage) {
      return (
        <>
          {isValidElement(deleteMessage) ? (
            deleteMessage
          ) : (
            <p>{deleteMessage}</p>
          )}
          {isValidElement(additionalMessage) ? (
            additionalMessage
          ) : (
            <p>{additionalMessage}</p>
          )}
        </>
      );
    }

    // Just return deleteMessage
    return isValidElement(deleteMessage) ? deleteMessage : deleteMessage;
  };

  return (
    <DropdownMenuItem
      color="red"
      disabled={disabled || !canDelete}
      confirmation={{
        confirmationTitle: `Delete ${displayName}`,
        cta: "Delete",
        submitColor: "danger",
        submit: async () => {
          await onClick();
        },
        getConfirmationContent: getConfirmationContentSync,
      }}
    >
      {useIcon && <PiTrashFill style={{ marginRight: "0.5rem" }} />}
      <Text>{text}</Text>
    </DropdownMenuItem>
  );
};

export default DropdownDeleteButton;
