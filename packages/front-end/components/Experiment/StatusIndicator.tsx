import { FC } from "react";
import { Trans } from "@lingui/react/macro";
import clsx from "clsx";
import { ExperimentStatus } from "shared/types/experiment";
import { FaArchive, FaPlay, FaStop } from "react-icons/fa";
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
        <Trans>Archived</Trans>
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
          <Trans>Draft</Trans>
        </div>
      );
    case "running":
      return (
        <div className={clsx(styles.container, className, "text-info")}>
          <FaPlay className="mr-1" />
          <Trans>Running</Trans>
        </div>
      );
    case "stopped":
      return (
        <div className={clsx(styles.container, className, "text-secondary")}>
          <FaStop className="mr-1" />
          <Trans>Stopped</Trans>
        </div>
      );
  }
};

export default StatusIndicator;
