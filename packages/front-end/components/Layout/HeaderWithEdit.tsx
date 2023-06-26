import clsx from "clsx";
import { ReactElement } from "react";
import { GBEdit } from "../Icons";

export interface Props {
  className?: string;
  containerClassName?: string;
  children: string | ReactElement;
  edit?: () => void;
  editElement?: ReactElement;
  editClassName?: string;
  additionalActions?: ReactElement;
  stopPropagation?: boolean;
}

export default function HeaderWithEdit({
  children,
  edit,
  editElement,
  editClassName = "a",
  additionalActions,
  className = "h3",
  containerClassName = "",
  stopPropagation = false,
}: Props) {
  return (
    <div className={clsx("d-flex align-items-center mb-2", containerClassName)}>
      <div className={clsx(className, "mb-0")}>{children}</div>
      {edit && (
        <div className="ml-1">
          <a
            className={editClassName}
            role="button"
            onClick={(e) => {
              e.preventDefault();
              if (stopPropagation) e.stopPropagation();
              edit();
            }}
          >
            {editElement || <GBEdit />}
          </a>
        </div>
      )}
      {additionalActions && <div className="ml-1">{additionalActions}</div>}
    </div>
  );
}
