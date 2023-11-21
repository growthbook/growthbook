import { ReactNode, useState } from "react";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import { HealthStatus, StatusBadge } from "./StatusBadge";

export interface Props {
  title: string;
  helpText?: string;
  children: ReactNode;
  status?: HealthStatus;
  openByDefault?: boolean;
  tooltipBody?: string | JSX.Element;
  statusAlign?: "left" | "right";
}

export default function HealthDrawer({
  title,
  helpText,
  children,
  status,
  openByDefault = false,
  tooltipBody = "",
  statusAlign = "right",
}: Props) {
  const [open, setOpen] = useState(
    status === "unhealthy" ? true : openByDefault
  );

  return (
    <div className="appbox my-2 p-3">
      <a
        className="text-reset"
        href="#"
        onClick={(e) => {
          e.preventDefault();
          setOpen((prev) => !prev);
        }}
        style={{ textDecoration: "none" }}
      >
        <h2 className="d-inline">{title}</h2>{" "}
        <p className="d-inline text-muted">{helpText}</p>
        {status && statusAlign === "left" && (
          <StatusBadge hasTooltip tooltipBody={tooltipBody} status={status} />
        )}
        <div className="float-right">
          {status && statusAlign === "right" && (
            <StatusBadge hasTooltip tooltipBody={tooltipBody} status={status} />
          )}
          {open ? <FaAngleDown /> : <FaAngleRight />}
        </div>
      </a>
      {open && <div>{children}</div>}
    </div>
  );
}
