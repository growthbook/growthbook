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
}> = ({ status, archived }) => {
  if (archived) {
    return (
      <div className="badge badge-secondary" style={{ fontSize: "1.1em" }}>
        Archived
      </div>
    );
  }

  const color = getColor(status);

  return (
    <div className={clsx(styles.container, `text-${color}`)}>
      <div className={clsx(styles.bubble, `bg-${color}`)} />
      {status}
    </div>
  );
};

export default StatusIndicator;
