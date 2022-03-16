import { FC, useState, useEffect, CSSProperties } from "react";
import clsx from "clsx";
import Modal from "./Modal";

const ConfirmButton: FC<{
  onClick: () => Promise<void>;
  className?: string;
  style?: CSSProperties;
  outline?: boolean;
  link?: boolean;
  header?: string;
  cta?: string;
  text?: string;
  title?: string;
  color?: string;
  icon?: React.ReactElement;
  message?: string;
  additionalMessage?: string;
  getConfirmationContent?: () => Promise<string | React.ReactElement>;
}> = ({
  onClick,
  className,
  cta,
  style,
  outline = true,
  link = false,
  header = "Confirm",
  text = "",
  title = "",
  color = "danger",
  icon,
  message = "Are you sure?",
  additionalMessage = "",
  getConfirmationContent,
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
  }, [confirming]);

  return (
    <>
      {confirming ? (
        <Modal
          header={header}
          close={() => setConfirming(false)}
          open={true}
          cta={cta}
          submitColor={color}
          submit={onClick}
        >
          {dynamicContent ? dynamicContent : <p>{message}</p>}
          {additionalMessage && <p>{additionalMessage}</p>}
        </Modal>
      ) : (
        ""
      )}
      <a
        className={clsx(
          link
            ? `text-${color}`
            : ["btn", outline ? `btn-outline-${color}` : `btn-${color}`],
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
        {icon} {text}
      </a>
    </>
  );
};

export default ConfirmButton;
