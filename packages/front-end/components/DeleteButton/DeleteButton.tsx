import { FC, useState, useEffect, CSSProperties } from "react";
import { FaTrash } from "react-icons/fa";
import clsx from "clsx";
import Modal from "../Modal";

const DeleteButton: FC<{
  onClick: () => Promise<void>;
  className?: string;
  iconClassName?: string;
  style?: CSSProperties;
  outline?: boolean;
  link?: boolean;
  displayName: string;
  text?: string;
  title?: string;
  useIcon?: boolean;
  deleteMessage?: string;
  additionalMessage?: string;
  getConfirmationContent?: () => Promise<string | React.ReactElement>;
  canDelete?: boolean;
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
}) => {
  const [confirming, setConfirming] = useState(false);
  const [dynamicContent, setDynamicContent] = useState<
    string | React.ReactElement
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
          {dynamicContent ? dynamicContent : <p>{deleteMessage}</p>}
          {additionalMessage && <p>{additionalMessage}</p>}
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
          setConfirming(true);
        }}
      >
        {useIcon && <FaTrash className={iconClassName} />}
        {text && ` ${text}`}
      </a>
    </>
  );
};

export default DeleteButton;
