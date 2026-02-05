import {
  FC,
  useState,
  useEffect,
  CSSProperties,
  ReactElement,
  isValidElement,
} from "react";
import clsx from "clsx";
import { PiTrashFill } from "react-icons/pi";
import { Box, Text } from "@radix-ui/themes";
import Modal from "@/components/Modal";
import Button from "@/ui/Button";

const DeleteButton: FC<{
  onClick: () => void | Promise<void>;
  className?: string;
  iconClassName?: string;
  style?: CSSProperties;
  outline?: boolean;
  link?: boolean;
  displayName: string;
  text?: string;
  title?: string;
  useIcon?: boolean;
  useRadix?: boolean;
  deleteMessage?: ReactElement | null | string;
  additionalMessage?: ReactElement | null | string;
  getConfirmationContent?: () => Promise<string | ReactElement | null>;
  canDelete?: boolean;
  disabled?: boolean;
  stopPropagation?: boolean;
}> = ({
  onClick,
  className,
  iconClassName,
  displayName,
  style,
  outline = true,
  link = false,
  text = "",
  title = "",
  useIcon = true,
  useRadix = false,
  deleteMessage = "Are you sure? This action cannot be undone.",
  additionalMessage = "",
  getConfirmationContent,
  canDelete = true,
  disabled = false,
  stopPropagation = false,
}) => {
  const [confirming, setConfirming] = useState(false);
  const [dynamicContent, setDynamicContent] = useState<
    string | ReactElement | null
  >("");

  useEffect(() => {
    if (!confirming || !getConfirmationContent) return;
    getConfirmationContent()
      .then((c) => setDynamicContent(c))
      .catch((e) => console.error(e));
  }, [confirming, getConfirmationContent]);

  return (
    <>
      {confirming ? (
        <Modal
          trackingEventModalType=""
          header={`Delete ${displayName}`}
          close={() => setConfirming(false)}
          open={true}
          cta="Delete"
          submitColor="danger"
          submit={onClick}
          ctaEnabled={canDelete}
          increasedElevation={true}
        >
          <Box px="4">
            {dynamicContent ? (
              dynamicContent
            ) : isValidElement(deleteMessage) ? (
              deleteMessage
            ) : (
              <Text as="p" style={{ color: "var(--color-text-mid)" }}>
                {deleteMessage}
              </Text>
            )}
            {additionalMessage &&
              (isValidElement(additionalMessage) ? (
                additionalMessage
              ) : (
                <Text as="p" style={{ color: "var(--color-text-mid)" }}>
                  {additionalMessage}
                </Text>
              ))}
          </Box>
        </Modal>
      ) : (
        ""
      )}
      {useRadix ? (
        <Button
          onClick={() => !disabled && setConfirming(true)}
          variant="ghost"
          color="red"
          title={title}
          stopPropagation={stopPropagation}
        >
          {text}
        </Button>
      ) : (
        <a
          className={clsx(
            link
              ? "text-danger"
              : ["btn", outline ? "btn-outline-danger" : "btn-danger"],
            className,
          )}
          title={title}
          href="#"
          style={style}
          onClick={(e) => {
            e.preventDefault();
            !disabled && setConfirming(true);
          }}
        >
          {useIcon && <PiTrashFill className={iconClassName} />}
          {text && ` ${text}`}
        </a>
      )}
    </>
  );
};

export default DeleteButton;
