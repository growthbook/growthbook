import React from "react";
import clsx from "clsx";
import LoadingSpinner from "./LoadingSpinner";
import styles from "./LoadingOverlay.module.scss";

export default function LoadingOverlay({
  text = "Loading...",
  relativePosition = false,
}: {
  text?: string;
  relativePosition?: boolean;
}): React.ReactElement {
  const overlayClasses = clsx(styles.overlay, {
    relativePosition: relativePosition,
  });
  return (
    <div className={overlayClasses}>
      <div className={styles.text}>
        <LoadingSpinner /> {text}
      </div>
    </div>
  );
}
