import { FC } from "react";
import clsx from "clsx";
import { ExperimentStatus } from "shared/types/experiment";
import { FaArchive, FaClock, FaPlay, FaStop } from "react-icons/fa";
import { BsConeStriped } from "react-icons/bs";
import styles from "./StatusIndicator.module.scss";

const StatusIndicator: FC<{
  status: ExperimentStatus;
  archived: boolean;
  className?: string;
}> = ({ status, archived, className = "" }) => {
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
          <BsConeStriped className="mr-1" />
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
    case "scheduled":
      return (
        <div className={clsx(styles.container, className, "text-info")}>
          <FaClock className="mr-1" />
          Scheduled
        </div>
      );
    case "stopped":
      return (
        <div className={clsx(styles.container, className, "text-secondary")}>
          <FaStop className="mr-1" />
          Stopped
        </div>
      );
    default:
      return null;
  }
};

export default StatusIndicator;
