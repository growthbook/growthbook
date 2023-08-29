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
    <a
      className={clsx("dropdown-item", className, {
        active,
        disabled,
      })}
      role="button"
      onClick={
        onClick !== undefined
          ? (e) => {
              e.preventDefault();
              onClick();
            }
          : undefined
      }
    >
      {children}
    </a>
  );
};
export default DropdownLink;
