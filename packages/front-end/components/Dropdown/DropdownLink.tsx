import clsx from "clsx";
import { ReactNode, FC } from "react";

const DropdownLink: FC<{
  closeOnClick?: boolean;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  onClick?: () => void | Promise<void>;
  children: ReactNode;
}> = ({
  active = false,
  disabled = false,
  className = "",
  onClick,
  children,
}) => {
  return (
    <button
      type="button"
      className={clsx("dropdown-item", className, {
        active,
        disabled,
      })}
      disabled={disabled}
      onClick={
        onClick !== undefined
          ? () => {
              onClick();
            }
          : undefined
      }
    >
      {children}
    </button>
  );
};
export default DropdownLink;
