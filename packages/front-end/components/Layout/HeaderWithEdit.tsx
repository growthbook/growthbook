import clsx from "clsx";
import { ReactElement } from "react";
import { GBEdit } from "../Icons";
import Tooltip from "../Tooltip/Tooltip";

export interface Props {
  className?: string;
  containerClassName?: string;
  children: string | ReactElement;
  edit?: () => void;
  editClassName?: string;
  additionalActions?: ReactElement;
  stopPropagation?: boolean;
  disabledMessage?: false | null | undefined | string | ReactElement;
}

export default function HeaderWithEdit({
  children,
  edit,
  editClassName = "a",
  additionalActions,
  className = "h3",
  containerClassName = "mb-2",
  stopPropagation = false,
  disabledMessage = null,
}: Props) {
  return (
    <div className={clsx("d-flex align-items-center", containerClassName)}>
      <div className={clsx(className, "mb-0")}>{children}</div>
      {edit ? (
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
            <GBEdit />
          </a>
        </div>
      ) : disabledMessage ? (
        <div className="ml-1 text-muted">
          <Tooltip body={disabledMessage}>
            <GBEdit />
          </Tooltip>
        </div>
      ) : null}
      {additionalActions && <div className="ml-1">{additionalActions}</div>}
    </div>
  );
}
