import { ReactNode } from "react";
import { StatusBadge, StatusBadgeHealth } from "./StatusBadge";

export interface Props {
  id?: string;
  title: string;
  helpText?: string;
  children: ReactNode;
  status: StatusBadgeHealth;
}

export default function HealthCard({
  id,
  title,
  helpText,
  children,
  status,
}: Props) {
  return (
    <div className="appbox my-3 p-3" id={id}>
      <div className="mb-2">
        <h2 className="d-inline">{title}</h2>{" "}
        {status !== "healthy" && <StatusBadge status={status} />}
        <span className="text-muted float-right">{helpText}</span>
      </div>
      <hr className="mt-0"></hr>
      <div>{children}</div>
    </div>
  );
}
