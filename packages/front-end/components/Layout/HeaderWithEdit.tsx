import clsx from "clsx";
import { ReactElement } from "react";
import { GBEdit } from "@/components/Icons";
import Tooltip from "@/components/Tooltip/Tooltip";

export interface Props {
  className?: string;
  containerClassName?: string;
  children: string | ReactElement;
  edit?: () => void;
  additionalActions?: ReactElement;
  editClassName?: string;
  stopPropagation?: boolean;
  disabledMessage?: false | null | undefined | string | ReactElement;
}

export default function HeaderWithEdit({
  children,
  edit,
  additionalActions,
  editClassName = "a",
  className = "h3",
  containerClassName = "mb-2",
  stopPropagation = false,
  disabledMessage = null,
}: Props) {
  return (
    <div className={containerClassName}>
      <div className={clsx(className, "mb-0")}>
        {children}{" "}
        {edit ? (
          <span className="ml-1">
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
          </span>
        ) : disabledMessage ? (
          <span className="ml-1 text-muted">
            <Tooltip body={disabledMessage}>
              <GBEdit />
            </Tooltip>
          </span>
        ) : null}
        {additionalActions && <div className="ml-1">{additionalActions}</div>}
      </div>
    </div>
  );
}
