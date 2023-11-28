import { ReactNode } from "react";
import { HealthStatus, StatusBadge } from "./StatusBadge";

export interface Props {
  title: string;
  helpText?: string;
  children: ReactNode;
  status?: HealthStatus;
}

export default function HealthCard({
  title,
  helpText,
  children,
  status,
}: Props) {
  return (
    <div className="appbox my-2 p-3">
      <h2 className="d-inline">{title}</h2>{" "}
      <p className="d-inline text-muted">{helpText}</p>
      {status && <StatusBadge hasTooltip tooltipBody={""} status={status} />}
      <div>{children}</div>
    </div>
  );
}
