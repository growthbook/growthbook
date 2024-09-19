import { ExperimentStatus } from "back-end/types/experiment";

export interface Props {
  status: ExperimentStatus;
  subStatus?: string;
}

function getColor(status: ExperimentStatus) {
  switch (status) {
    case "draft":
      return "warning";
    case "running":
      return "info";
    case "stopped":
      return "secondary";
  }
}

export default function ExperimentStatusIndicator({
  status,
  subStatus,
}: Props) {
  const color = getColor(status);
  return (
    <div className="d-flex align-items-center nowrap">
      <div
        className={`bg-${color} rounded-circle`}
        style={{ width: 10, height: 10 }}
      />
      <div className={`text-${color} ml-2`}>
        {status}
        {subStatus ? <> ({subStatus})</> : null}
      </div>
    </div>
  );
}
