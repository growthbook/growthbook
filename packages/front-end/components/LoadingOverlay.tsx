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
    relativePositionOverlay: relativePosition,
  });
  const overlayTextClasses = clsx(styles.text, {
    relativePositionOverlayText: relativePosition,
  });
  return (
    <div className={overlayClasses}>
      <div className={overlayTextClasses}>
        <LoadingSpinner /> {text}
      </div>
    </div>
  );
}
