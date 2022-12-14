import { FC } from "react";
import clsx from "clsx";
import { ExperimentStatus } from "back-end/types/experiment";
import styles from "./StatusIndicator.module.scss";

const getColor = (status: ExperimentStatus) => {
  switch (status) {
    case "draft":
      return "warning";
    case "running":
      return "info";
    case "stopped":
      return "secondary";
  }
};

const StatusIndicator: FC<{
  status: ExperimentStatus;
  archived: boolean;
  showBubble?: boolean;
  className?: string;
}> = ({ status, archived, className = "", showBubble = true }) => {
  if (archived) {
    return (
      <div
        className={`badge badge-secondary ${className}`}
        style={{ fontSize: "1.1em" }}
      >
        Archived
      </div>
    );
  }

  const color = getColor(status);

  return (
    <div className={clsx(styles.container, className, `text-${color}`)}>
      {showBubble && <div className={clsx(styles.bubble, `bg-${color}`)} />}
      {status}
    </div>
  );
};

export default StatusIndicator;
