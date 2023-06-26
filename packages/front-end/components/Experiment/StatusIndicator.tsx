import { FC } from "react";
import clsx from "clsx";
import { ExperimentStatus } from "back-end/types/experiment";
import { FaArchive, FaPause, FaPlay, FaStop } from "react-icons/fa";
import styles from "./StatusIndicator.module.scss";

const getColor = (status: ExperimentStatus) => {
  switch (status) {
    case "draft":
      return "warning-orange";
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
  newUi?: boolean;
}> = ({ status, archived, className = "", showBubble = true, newUi }) => {
  if (newUi) {
    if (archived) {
      return (
        <div className={clsx(styles.container, className, "text-muted")}>
          <FaArchive className="mr-1" />
          Archived
        </div>
      );
    }
    switch (status) {
      case "draft":
        return (
          <div
            className={clsx(styles.container, className, "text-warning-orange")}
          >
            <FaPause className="mr-1" />
            Draft
          </div>
        );
      case "running":
        return (
          <div className={clsx(styles.container, className, "text-info")}>
            <FaPlay className="mr-1" />
            Running
          </div>
        );
      case "stopped":
        return (
          <div className={clsx(styles.container, className, "text-secondary")}>
            <FaStop className="mr-1" />
            Stopped
          </div>
        );
    }
  }

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
