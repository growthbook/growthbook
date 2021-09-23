import { FC, useState, CSSProperties } from "react";
import { FaTrash } from "react-icons/fa";
import clsx from "clsx";
import Modal from "./Modal";

const DeleteButton: FC<{
  onClick: () => Promise<void>;
  className?: string;
  style?: CSSProperties;
  outline?: boolean;
  link?: boolean;
  displayName: string;
  text?: string;
  additionalMessage?: string;
}> = ({
  onClick,
  className,
  displayName,
  style,
  outline = true,
  link = false,
  text = "",
  additionalMessage = "",
}) => {
  const [confirming, setConfirming] = useState(false);
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
        >
          <p>Are you sure? This action cannot be undone.</p>
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
        href="#"
        style={style}
        onClick={(e) => {
          e.preventDefault();
          setConfirming(true);
        }}
      >
        <FaTrash /> {text}
      </a>
    </>
  );
};

export default DeleteButton;
