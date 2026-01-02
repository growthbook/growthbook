import { FC, CSSProperties } from "react";
import clsx from "clsx";
import { PiPencilSimpleFill } from "react-icons/pi";

const EditButton: FC<{
  onClick: () => void | Promise<void>;
  className?: string;
  iconClassName?: string;
  style?: CSSProperties;
  outline?: boolean;
  link?: boolean;
  text?: string;
  title?: string;
  useIcon?: boolean;
  disabled?: boolean;
}> = ({
  onClick,
  className,
  iconClassName,
  style,
  outline = true,
  link = false,
  text = "Edit",
  title = "",
  useIcon = true,
  disabled = false,
}) => {
  return (
    <>
      <a
        className={clsx(
          link ? "text" : ["btn", outline ? "btn-outline" : "btn-primary"],
          className,
        )}
        title={title}
        href="#"
        style={style}
        onClick={(e) => {
          e.preventDefault();
          !disabled && onClick();
        }}
      >
        {useIcon && <PiPencilSimpleFill className={iconClassName} />}
        {text && ` ${text}`}
      </a>
    </>
  );
};

export default EditButton;
