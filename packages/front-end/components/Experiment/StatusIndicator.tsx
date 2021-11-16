import { FC } from "react";
import styles from "./StatusIndicator.module.scss";
import clsx from "clsx";

const getColor = (status: "draft" | "running" | "stopped") => {
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
  status: "draft" | "running" | "stopped";
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
