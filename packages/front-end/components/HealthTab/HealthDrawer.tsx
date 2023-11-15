import { ReactNode, useState } from "react";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import Tooltip from "../Tooltip/Tooltip";

export interface Props {
  title: string;
  children: ReactNode;
  status?: HealthStatus;
  openByDefault?: boolean;
  tooltipBody?: string | JSX.Element;
}

export const BadgeColors = {
  healthy: "badge-green",
  unhealthy: "badge-red",
  unknown: "badge-gray",
};

export type HealthStatus = keyof typeof BadgeColors;

export default function HealthDrawer({
  title,
  children,
  status,
  openByDefault = false,
  tooltipBody = "",
}: Props) {
  const [open, setOpen] = useState(openByDefault);

  return (
    <div className="appbox mb-4 p-3">
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
        {status && (
          <Tooltip
            body={tooltipBody}
            className={"badge border ml-2 " + BadgeColors[status]}
            tipPosition="top"
          >
            {status}
          </Tooltip>
        )}
        <div className="float-right">
          {open ? <FaAngleDown /> : <FaAngleRight />}
        </div>
      </a>
      {open && <div>{children}</div>}
    </div>
  );
}
