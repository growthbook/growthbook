import { ReactNode } from "react";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";

export interface Props {
  title: string;
  children: ReactNode;
  status: "healthy" | "unhealthy" | "notEnoughData";
  open: boolean;
  handleOpen: (boolean) => void;
}

const BadgeColors = {
  healthy: "badge-green",
  unhealthy: "badge-red",
  notEnoughData: "badge-gray",
};

export default function HealthDrawer({
  title,
  children,
  status,
  open,
  handleOpen,
}: Props) {
  return (
    <div className="appbox mb-4 p-3">
      <a
        className="text-reset"
        href="#"
        onClick={(e) => {
          e.preventDefault();
          handleOpen(!open);
        }}
        style={{ textDecoration: "none" }}
      >
        <h2 className="d-inline">{title}</h2>{" "}
        <span className={"badge border ml-2 " + BadgeColors[status]}>
          {status}
        </span>{" "}
        {open ? <FaAngleDown /> : <FaAngleRight />}
      </a>
      {open && <div>{children}</div>}
    </div>
  );
}
