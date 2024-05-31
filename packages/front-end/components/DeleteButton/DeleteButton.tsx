import {
  FC,
  useState,
  useEffect,
  CSSProperties,
  ReactElement,
  isValidElement,
} from "react";
import { FaTrash } from "react-icons/fa";
import clsx from "clsx";
import Modal from "@/components/Modal";

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
  deleteMessage?: ReactElement | null | string;
  additionalMessage?: ReactElement | null | string;
  getConfirmationContent?: () => Promise<string | ReactElement | null>;
  canDelete?: boolean;
  disabled?: boolean;
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
  deleteMessage = "Are you sure? This action cannot be undone.",
  additionalMessage = "",
  getConfirmationContent,
  canDelete = true,
  disabled = false,
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
          header={`Delete ${displayName}`}
          close={() => setConfirming(false)}
          open={true}
          cta="Delete"
          submitColor="danger"
          submit={onClick}
          ctaEnabled={canDelete}
        >
          {dynamicContent ? (
            dynamicContent
          ) : isValidElement(deleteMessage) ? (
            deleteMessage
          ) : (
            <p>{deleteMessage}</p>
          )}
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
      <a
        className={clsx(
          link
            ? "text-danger"
            : ["btn", outline ? "btn-outline-danger" : "btn-danger"],
          className
        )}
        title={title}
        href="#"
        style={style}
        onClick={(e) => {
          e.preventDefault();
          !disabled && setConfirming(true);
        }}
      >
        {useIcon && <FaTrash className={iconClassName} />}
        {text && ` ${text}`}
      </a>
    </>
  );
};

export default DeleteButton;
