import { ReactNode, useState } from "react";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import Tooltip from "../Tooltip/Tooltip";

export interface Props {
  title: string;
  children: ReactNode;
  status?: HealthStatus;
  openByDefault?: boolean;
  tooltipBody?: string | JSX.Element;
  statusAlign?: "left" | "right";
}

export const BadgeColors = {
  healthy: "badge-green",
  unhealthy: "badge-red",
  unknown: "badge-gray",
};

export type HealthStatus = keyof typeof BadgeColors;

const StatusBadge = ({ status, tooltipBody }) => {
  return (
    <Tooltip
      body={tooltipBody}
      className={"badge border ml-2 mr-2 " + BadgeColors[status]}
      tipPosition="top"
    >
      {status}
    </Tooltip>
  );
};

export default function HealthDrawer({
  title,
  children,
  status,
  openByDefault = false,
  tooltipBody = "",
  statusAlign = "left",
}: Props) {
  const [open, setOpen] = useState(openByDefault);

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
        {status && statusAlign === "left" && (
          <StatusBadge tooltipBody={tooltipBody} status={status} />
        )}
        <div className="float-right">
          {status && statusAlign === "right" && (
            <StatusBadge tooltipBody={tooltipBody} status={status} />
          )}
          {open ? <FaAngleDown /> : <FaAngleRight />}
        </div>
      </a>
      {open && <div>{children}</div>}
    </div>
  );
}
