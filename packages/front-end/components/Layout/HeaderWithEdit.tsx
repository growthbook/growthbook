import clsx from "clsx";
import { ReactElement } from "react";
import { GBEdit } from "../Icons";

export interface Props {
  className?: string;
  children: string | ReactElement;
  edit?: () => void;
  additionalActions?: ReactElement;
}

export default function HeaderWithEdit({
  children,
  edit,
  additionalActions,
  className = "h3",
}: Props) {
  return (
    <div className="d-flex align-items-center mb-2">
      <div className={clsx(className, "mb-0")}>{children}</div>
      {edit && (
        <div className="ml-1">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              edit();
            }}
          >
            <GBEdit />
          </a>
        </div>
      )}
      {additionalActions && <div className="ml-1">{additionalActions}</div>}
    </div>
  );
}
